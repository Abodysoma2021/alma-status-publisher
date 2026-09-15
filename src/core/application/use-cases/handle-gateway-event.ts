import type { EventBus } from '../ports/infrastructure';
import type { SessionRepository } from '../ports/repositories';
import type { GatewayEvent, WhatsAppGateway } from '../ports/whatsapp-gateway';
import { AppError } from '../../domain/errors';
import type { WhatsAppSession } from '../../domain/entities/whatsapp-session';
import type { NoticePayload } from '@/shared/view-models';

/**
 * The single place where raw gateway events (from open-wa) become domain
 * state. Keeps the session state machine honest and central.
 */
export class HandleGatewayEvent {
  constructor(
    private deps: {
      sessions: SessionRepository;
      gateway: WhatsAppGateway;
      events: EventBus;
    },
  ) {}

  async execute(event: GatewayEvent): Promise<void> {
    const session = await this.deps.sessions.get(event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'starting':
        await this.update(session.id, {
          status: session.linkedAt ? 'connecting' : 'initializing',
          lastError: undefined,
        });
        break;

      case 'qr':
        await this.update(session.id, { status: 'awaiting_qr', qrCode: event.payload, pairingCode: undefined, lastError: undefined });
        break;

      case 'pairing_code':
        await this.update(session.id, { status: 'awaiting_qr', pairingCode: event.payload });
        break;

      case 'connecting':
        await this.update(session.id, { status: 'connecting', qrCode: undefined, pairingCode: undefined });
        break;

      case 'connected': {
        const isFirstLink = !session.linkedAt;
        await this.update(session.id, {
          status: 'connected',
          linkedAt: session.linkedAt ?? Date.now(),
          lastConnectedAt: Date.now(),
          qrCode: undefined,
          pairingCode: undefined,
          lastError: undefined,
          phoneNumber: event.payload ?? session.phoneNumber,
        });
        if (isFirstLink) {
          this.deps.events.publish('notice', {
            level: 'success',
            messageKey: 'notice.session-linked',
            params: { name: session.name },
          } satisfies NoticePayload);
          // Auto-promote the first ever linked number to default.
          const all = await this.deps.sessions.list();
          if (!all.some((s) => s.isDefault)) {
            const saved = await this.deps.sessions.get(session.id);
            if (saved) await this.deps.sessions.save({ ...saved, isDefault: true });
          }
        }
        break;
      }

      case 'disconnected':
        await this.update(session.id, { status: 'disconnected' });
        this.deps.events.publish('notice', {
          level: 'warning',
          messageKey: 'notice.session-disconnected',
          params: { name: session.name },
        } satisfies NoticePayload);
        break;

      case 'qr_expired':
        await this.update(session.id, { status: 'qr_expired', qrCode: undefined, pairingCode: undefined, lastError: 'QR_EXPIRED' });
        break;

      case 'logged_out':
        await this.update(session.id, { status: 'logged_out', qrCode: undefined, pairingCode: undefined, lastError: 'LOGGED_OUT' });
        this.deps.events.publish('notice', {
          level: 'error',
          messageKey: 'notice.session-logged-out',
          params: { name: session.name },
        } satisfies NoticePayload);
        break;

      case 'error':
        await this.update(session.id, {
          status: 'error',
          qrCode: undefined,
          pairingCode: undefined,
          lastError: event.payload ?? AppError.from(event.payload).code,
        });
        break;
    }
  }

  private async update(id: string, patch: Partial<WhatsAppSession>) {
    const current = await this.deps.sessions.get(id);
    if (!current) return;
    await this.deps.sessions.save({ ...current, ...patch });
    this.deps.events.publish('session-updated', { sessionId: id });
  }
}

/** Wires gateway events into the handler with error isolation. */
export function bindGatewayToApplication(gateway: WhatsAppGateway, handler: HandleGatewayEvent): () => void {
  return gateway.onEvent((event) => {
    void handler.execute(event).catch(() => {
      // Never let a state-sync failure crash the process.
    });
  });
}
