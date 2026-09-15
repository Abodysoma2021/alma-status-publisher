/**
 * Port to the WhatsApp transport. The application layer only knows that
 * sessions can be linked and statuses can be posted — the open-wa adapter
 * lives in infrastructure.
 */
export type GatewaySessionEventType =
  | 'starting'
  | 'qr'
  | 'pairing_code'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'qr_expired'
  | 'logged_out'
  | 'error';

export interface GatewayEvent {
  sessionId: string;
  type: GatewaySessionEventType;
  /** QR string, pairing code, phone number or error message depending on type. */
  payload?: string;
}

export interface GatewayEventListener {
  (event: GatewayEvent): void;
}

export interface WhatsAppGateway {
  /**
   * Start (or restore) a session. Resolves once the linking handshake has been
   * kicked off; progress and outcomes arrive as gateway events.
   */
  startSession(sessionId: string, pairingPhone?: string): Promise<void>;
  /** Abort an in-progress link handshake and kill its browser. */
  cancelSession(sessionId: string): Promise<void>;
  /** Gracefully close a connected session (keeps its data for later restore). */
  closeSession(sessionId: string): Promise<void>;
  /** Erase persisted WhatsApp credentials for the session. */
  wipeSessionData(sessionId: string): Promise<void>;
  isConnected(sessionId: string): boolean;

  sendTextStatus(sessionId: string, text: string, options: { backgroundColor: string; textColor: string; fontIndex: number }): Promise<void>;
  sendImageStatus(sessionId: string, imageDataUrl: string, caption?: string): Promise<void>;
  sendVideoStatus(sessionId: string, videoDataUrl: string, caption?: string): Promise<void>;

  onEvent(listener: GatewayEventListener): () => void;
}
