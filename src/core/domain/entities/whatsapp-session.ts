import type { SessionStatus } from '@/shared/view-models';

/**
 * A linked (or linking) WhatsApp account. The aggregate tracks the lifecycle
 * state machine; the WhatsApp gateway owns the actual transport.
 *
 * Lifecycle:
 *   initializing -> awaiting_qr  -> connecting -> connected
 *                       |              |            |
 *                 qr_expired    disconnected   logged_out / error
 */
export interface WhatsAppSession {
  id: string;
  name: string;
  phoneNumber?: string;
  pushName?: string;
  status: SessionStatus;
  isDefault: boolean;
  lastError?: string;
  linkedAt?: number;
  lastConnectedAt?: number;
  /** transient — never persisted */
  qrCode?: string;
  pairingCode?: string;
  createdAt: number;
}

export const SESSION_TERMINAL_STATES: readonly SessionStatus[] = ['logged_out', 'qr_expired', 'error'];

export function isSessionUsable(session: WhatsAppSession): boolean {
  return session.status === 'connected';
}

export function isSessionLinking(session: WhatsAppSession): boolean {
  return (
    session.status === 'initializing' ||
    session.status === 'awaiting_qr' ||
    session.status === 'connecting'
  );
}
