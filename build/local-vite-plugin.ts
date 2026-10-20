import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { assertLocalRequest, isLoopbackAddress, LOCAL_REQUEST_HEADER } from '../lib/local-auth.ts';
import { localSampleResponse } from '../lib/local-sample-review.ts';

/** This proof exists only between Vite's loopback listener and its local Worker. */
export function authorizeLocalIncoming(request: IncomingMessage, token: string): void {
  // Never accept a proof supplied by a caller, even on a loopback socket.
  delete request.headers[LOCAL_REQUEST_HEADER];
  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index]?.toLowerCase() === LOCAL_REQUEST_HEADER) request.rawHeaders.splice(index, 2);
  }
  if (!isLoopbackAddress(request.socket.remoteAddress)) throw new Error('Only loopback clients can use local mode.');
  const host = request.headers.host;
  if (!host) throw new Error('Local request host is required.');
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
  }
  assertLocalRequest(new Request(new URL(request.url || '/', `http://${host}`), { headers }));
  request.headers[LOCAL_REQUEST_HEADER] = token;
  request.rawHeaders.push(LOCAL_REQUEST_HEADER, token);
}
export function localOnly(token: string): Plugin {
  return {
    name: 'aicd-local-only', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          authorizeLocalIncoming(request, token);
          const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;
          const sample = await localSampleResponse(server.config.root, request.method || 'GET', pathname);
          if (sample) { response.writeHead(sample.status, sample.headers); response.end(sample.body); return; }
          next();
        }
        catch {
          response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end('AICD local mode accepts direct requests from this Mac only.');
        }
      });
    },
  };
}
