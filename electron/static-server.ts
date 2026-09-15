import * as http from 'node:http';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticServerOptions {
  /** Absolute path to the exported Next.js site (the `out` directory). */
  rootDir: string;
  /** Serves managed media files when the request path starts with this prefix. */
  mediaResolver?: (id: string) => Promise<{ filePath: string; mimeType: string } | null>;
}

/**
 * Minimal localhost-only static server for the exported renderer.
 * Using a real HTTP server (instead of file://) keeps Next.js asset
 * resolution, routing, and fetches well-defined. Binds 127.0.0.1 only.
 */
export class StaticServer {
  private server?: http.Server;
  private port = 0;

  constructor(private readonly options: StaticServerOptions) {}

  async start(): Promise<number> {
    if (this.server) return this.port;

    this.server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        respond(res, 500, 'Internal error');
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        this.port = typeof address === 'object' && address ? address.port : 0;
        resolve();
      });
    });

    return this.port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
    this.port = 0;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return respond(res, 405, 'Method not allowed');
    }

    const url = new URL(req.url ?? '/', this.baseUrl);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/media/') && this.options.mediaResolver) {
      const id = pathname.slice('/media/'.length).replace(/[^a-zA-Z0-9-]/g, '');
      const found = await this.options.mediaResolver(id).catch(() => null);
      if (!found) return respond(res, 404, 'Media not found');
      return this.serveFile(res, found.filePath, found.mimeType);
    }

    // Map URL to a file inside rootDir; fall back to index.html (SPA).
    const relative = pathname.replace(/^\/+/, '');
    let filePath = path.normalize(path.join(this.options.rootDir, relative || 'index.html'));
    if (!filePath.startsWith(this.options.rootDir)) return respond(res, 403, 'Forbidden');

    let stat = await fsp.stat(filePath).catch(() => null);
    if (stat?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath).catch(() => null);
    }
    if (!stat) {
      filePath = path.join(this.options.rootDir, 'index.html');
      stat = await fsp.stat(filePath).catch(() => null);
    }
    if (!stat) return respond(res, 404, 'Not found');

    const ext = path.extname(filePath).toLowerCase();
    await this.serveFile(res, filePath, MIME_TYPES[ext] ?? 'application/octet-stream');
  }

  private async serveFile(res: ServerResponse, filePath: string, contentType: string): Promise<void> {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  }
}

function respond(res: ServerResponse, status: number, body: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(body);
}
