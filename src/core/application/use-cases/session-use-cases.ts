import { AppError } from '../../domain/errors';
import type { WhatsAppSession } from '../../domain/entities/whatsapp-session';
import type { EventBus, IdGenerator } from '../ports/infrastructure';
import type { SessionRepository } from '../ports/repositories';
import type { WhatsAppGateway } from '../ports/whatsapp-gateway';

export interface SessionUseCaseDeps {
  sessions: SessionRepository;
  gateway: WhatsAppGateway;
  ids: IdGenerator;
  events: EventBus;
}

async function emitSessionChanged(deps: SessionUseCaseDeps, id: string) {
  deps.events.publish('session-updated', { sessionId: id });
}

export class ListSessions {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(): Promise<WhatsAppSession[]> {
    // qrCode/pairingCode are part of the live view — the linking dialog
    // renders the QR straight from this list.
    return this.deps.sessions.list();
  }
}

export class StartLinking {
  constructor(private deps: SessionUseCaseDeps) {}

  async execute(input: { name: string; pairingPhone?: string }): Promise<WhatsAppSession> {
    const name = input.name.trim();
    if (!name) throw new AppError('VALIDATION_FAILED', 'Session name is required');
    if (input.pairingPhone && !/^\+?\d{6,15}$/.test(input.pairingPhone.replace(/[\s-]/g, ''))) {
      throw new AppError('VALIDATION_FAILED', 'Invalid phone number for pairing code');
    }

    const session: WhatsAppSession = {
      id: this.deps.ids.next(),
      name,
      status: 'initializing',
      isDefault: false,
      createdAt: Date.now(),
    };
    await this.deps.sessions.save(session);

    // Fire and forget — QR / outcome arrives as gateway events.
    void this.deps.gateway
      .startSession(session.id, input.pairingPhone?.replace(/[\s-]/g, ''))
      .catch(async (err) => {
        await this.markFailed(session.id, err);
      });

    await emitSessionChanged(this.deps, session.id);
    return session;
  }

  private async markFailed(id: string, err: unknown) {
    const session = await this.deps.sessions.get(id);
    if (!session) return;
    const appErr = AppError.from(err);
    const status = appErr.code === 'QR_EXPIRED' ? 'qr_expired' : appErr.code === 'LOGGED_OUT' ? 'logged_out' : 'error';
    await this.deps.sessions.save({
      ...session,
      status,
      qrCode: undefined,
      pairingCode: undefined,
      lastError: appErr.code,
    });
    this.deps.events.publish('session-updated', { sessionId: id });
  }
}

export class CancelLinking {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string): Promise<void> {
    await this.deps.gateway.cancelSession(sessionId);
    await this.deps.sessions.delete(sessionId);
    this.deps.events.publish('session-removed', { sessionId });
  }
}

export class RenameSession {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('VALIDATION_FAILED', 'Name required');
    const session = await requireSession(this.deps.sessions, sessionId);
    await this.deps.sessions.save({ ...session, name: trimmed });
    await emitSessionChanged(this.deps, sessionId);
  }
}

export class ConfirmSession {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string, name: string): Promise<WhatsAppSession> {
    const session = await requireSession(this.deps.sessions, sessionId);
    const trimmed = name.trim() || session.name;
    await this.deps.sessions.save({ ...session, name: trimmed });
    await emitSessionChanged(this.deps, sessionId);
    return { ...session, name: trimmed };
  }
}

export class RelinkSession {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string): Promise<void> {
    const session = await requireSession(this.deps.sessions, sessionId);
    if (session.status === 'connected') throw new AppError('CONFLICT', 'Session already connected');
    await this.deps.gateway.wipeSessionData(sessionId);
    await this.deps.sessions.save({
      ...session,
      status: 'initializing',
      qrCode: undefined,
      pairingCode: undefined,
      lastError: undefined,
      phoneNumber: undefined,
    });
    void this.deps.gateway.startSession(sessionId).catch(async (err) => {
      const s = await this.deps.sessions.get(sessionId);
      if (s) {
        await this.deps.sessions.save({ ...s, status: 'error', lastError: AppError.from(err).code });
        this.deps.events.publish('session-updated', { sessionId });
      }
    });
    await emitSessionChanged(this.deps, sessionId);
  }
}

export class UnlinkSession {
  constructor(private deps: SessionUseCaseDeps) {}
  /** Close the browser but keep WhatsApp credentials for later restore. */
  async execute(sessionId: string): Promise<void> {
    const session = await requireSession(this.deps.sessions, sessionId);
    await this.deps.gateway.closeSession(sessionId);
    await this.deps.sessions.save({ ...session, status: 'disconnected', qrCode: undefined, pairingCode: undefined });
    await emitSessionChanged(this.deps, sessionId);
  }
}

export class RemoveSession {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string): Promise<void> {
    await this.deps.gateway.cancelSession(sessionId).catch(() => undefined);
    await this.deps.gateway.wipeSessionData(sessionId).catch(() => undefined);
    await this.deps.sessions.delete(sessionId);
    this.deps.events.publish('session-removed', { sessionId });
  }
}

export class SetDefaultSession {
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(sessionId: string): Promise<void> {
    const target = await requireSession(this.deps.sessions, sessionId);
    const all = await this.deps.sessions.list();
    for (const s of all) {
      await this.deps.sessions.save({ ...s, isDefault: s.id === sessionId });
    }
    await emitSessionChanged(this.deps, target.id);
  }
}

export class RestoreSessions {
  /** On app start: relink every saved session that had linked at least once. */
  constructor(private deps: SessionUseCaseDeps) {}
  async execute(): Promise<void> {
    const sessions = await this.deps.sessions.list();
    for (const session of sessions) {
      if (!session.linkedAt) continue;
      await this.deps.sessions.save({
        ...session,
        status: 'connecting',
        qrCode: undefined,
        pairingCode: undefined,
      });
      this.deps.events.publish('session-updated', { sessionId: session.id });
      void this.deps.gateway.startSession(session.id).catch(async (err) => {
        const s = await this.deps.sessions.get(session.id);
        if (!s) return;
        const code = AppError.from(err).code;
        await this.deps.sessions.save({
          ...s,
          status: code === 'LOGGED_OUT' ? 'logged_out' : 'disconnected',
          lastError: code,
        });
        this.deps.events.publish('session-updated', { sessionId: s.id });
      });
    }
  }
}

async function requireSession(repo: SessionRepository, id: string): Promise<WhatsAppSession> {
  const session = await repo.get(id);
  if (!session) throw new AppError('NOT_FOUND', `Session ${id} not found`);
  return session;
}
