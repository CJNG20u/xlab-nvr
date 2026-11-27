import http from 'http';
import https from 'https';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import type { Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { readSettings } from './storage.ts';

const wsServer = new WebSocketServer({ noServer: true });

function buildUpstreamUrl(reqUrl: string, baseGo2rtcUrl: string): URL {
  const base = new URL(baseGo2rtcUrl.replace(/\/+$/, '') + '/');
  const stripped = reqUrl.replace(/^\/go2rtc/, '');
  const safePath = '/' + stripped.replace(/^\/+/, '');
  const resolved = new URL(safePath, base);
  if (resolved.origin !== base.origin) {
    throw new Error('Blocked cross-origin proxy target');
  }
  return resolved;
}

export function handleGo2RtcHttpProxy(req: Request, res: Response): void {
  let targetUrl: URL;
  try {
    const settings = readSettings();
    targetUrl = buildUpstreamUrl(req.originalUrl, settings.go2rtcUrl);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Invalid go2rtc URL configuration',
    });
    return;
  }

  const client = targetUrl.protocol === 'https:' ? https : http;
  const headers: http.OutgoingHttpHeaders = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  delete headers['content-length'];
  delete headers.cookie; // never forward the NVR session cookie to go2rtc

  const proxyReq = client.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: req.method,
      headers,
      timeout: 15_000,
    },
    (proxyRes) => {
      const resHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };
      delete resHeaders['transfer-encoding'];
      res.writeHead(proxyRes.statusCode || 502, resHeaders);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('Upstream go2rtc request timed out'));
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: `go2rtc unreachable: ${err.message}`,
      });
    }
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
}

export function attachGo2RtcWsProxy(
  server: http.Server,
  isAuthorized: (req: IncomingMessage) => boolean = () => true
): void {
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const reqUrl = req.url || '';
    if (!reqUrl.startsWith('/go2rtc/')) {
      return;
    }

    if (!isAuthorized(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    let upstreamUrl: URL;
    try {
      const settings = readSettings();
      upstreamUrl = buildUpstreamUrl(reqUrl, settings.go2rtcUrl);
      upstreamUrl.protocol = upstreamUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    } catch {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (clientWs) => {
      const upstreamWs = new WebSocket(upstreamUrl.toString(), {
        handshakeTimeout: 10_000,
      });

      const pendingClientMessages: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];

      upstreamWs.on('open', () => {
        for (const msg of pendingClientMessages) {
          if (upstreamWs.readyState === WebSocket.OPEN) {
            upstreamWs.send(msg.data, { binary: msg.isBinary });
          }
        }
        pendingClientMessages.length = 0;
      });

      clientWs.on('message', (data, isBinary) => {
        if (upstreamWs.readyState === WebSocket.OPEN) {
          upstreamWs.send(data, { binary: isBinary });
        } else if (upstreamWs.readyState === WebSocket.CONNECTING) {
          if (pendingClientMessages.length < 32) {
            pendingClientMessages.push({ data, isBinary });
          }
        }
      });

      upstreamWs.on('message', (data, isBinary) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      const closeBoth = (code = 1000) => {
        const safeCode = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1000;
        if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
          try {
            clientWs.close(safeCode);
          } catch {
            clientWs.terminate();
          }
        }
        if (
          upstreamWs.readyState === WebSocket.OPEN ||
          upstreamWs.readyState === WebSocket.CONNECTING
        ) {
          try {
            upstreamWs.close(safeCode);
          } catch {
            upstreamWs.terminate();
          }
        }
      };

      upstreamWs.on('close', (code) => closeBoth(code));
      clientWs.on('close', (code) => closeBoth(code));
      upstreamWs.on('error', () => closeBoth(1011));
      clientWs.on('error', () => closeBoth(1011));
    });
  });
}
