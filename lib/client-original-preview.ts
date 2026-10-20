import { fetchWithSession } from './auth-client.ts';
import { throwIfAborted } from './client-intake-utils.ts';
import { openPdfRasterizer } from './client-pdf-raster.ts';
import type { ShipmentDocument } from './types.ts';

const MAX_PREVIEW_BYTES = 64 * 1024 * 1024;

/** Display the saved original's pixels only. No extraction, uploads or AI requests. */
export async function openOriginalPdfPreview(
  source: Pick<ShipmentDocument, 'id' | 'sha256'>,
  signal?: AbortSignal,
  dependencies: { fetch?: typeof fetchWithSession; open?: typeof openPdfRasterizer } = {},
) {
  throwIfAborted(signal);
  const response = await (dependencies.fetch ?? fetchWithSession)(`/api/documents/${encodeURIComponent(source.id)}`, { signal });
  if (!response.ok) throw new Error('The original file could not be loaded.');
  if (Number(response.headers.get('content-length') || 0) > MAX_PREVIEW_BYTES) throw new Error('Download this large original to view it.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error('Download this large original to view it.');
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  if (fingerprint !== source.sha256.toLowerCase()) throw new Error('The original file changed. Reload the document.');
  throwIfAborted(signal);
  const pdf = await (dependencies.open ?? openPdfRasterizer)(bytes, signal, { maxPages: 200 });
  if (signal?.aborted) { pdf.close(); throwIfAborted(signal); }
  let closed = false;
  let pending: Promise<unknown> = Promise.resolve();
  return {
    pageCount: pdf.pageCount,
    render(page: number) {
      // The worker protocol supports one request at a time. Rapid page changes
      // are serialized; the UI ignores any older completed page.
      const result = pending.catch(() => undefined).then(() => {
        throwIfAborted(signal);
        if (closed) throw new Error('The original preview was closed.');
        if (!Number.isInteger(page) || page < 1 || page > pdf.pageCount) throw new Error('This original page does not exist.');
        return pdf.render(page);
      });
      pending = result;
      return result;
    },
    close() { if (!closed) { closed = true; pdf.close(); } },
  };
}
