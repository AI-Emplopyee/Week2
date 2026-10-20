import { createHash } from 'node:crypto';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';
import { rasterizePdfPage } from '../lib/pdf-raster.ts';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/** Shared local raster preparation for the automatic reader and isolated evaluations. No text/OCR is produced. */
export async function renderOriginalPage(bytes, document, page) {
  if (bytes.length > MAX_BYTES || createHash('sha256').update(bytes).digest('hex') !== document.sha256) throw new Error('Original integrity check failed.');
  let input = bytes;
  let raw;
  let library;
  let pdf;
  try {
    if (document.mime === 'application/pdf') {
      library = await PDFiumLibrary.init();
      pdf = await library.loadDocument(bytes);
      if (pdf.getPageCount() !== document.pages.length) throw new Error('Original PDF page count changed.');
      const raster = await rasterizePdfPage(pdf, page);
      input = raster.data;
      raw = { width: raster.width, height: raster.height, channels: 4 };
    } else if (!/^image\/(png|jpeg|webp)$/.test(document.mime) || page !== 1) throw new Error('Unsupported visual original.');
    for (const quality of [88, 76, 62]) {
      const { data, info } = await sharp(input, { ...(raw ? { raw } : {}), limitInputPixels: 40_000_000 }).rotate().resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_IMAGE_BYTES) return { bytes: data, width: info.width, height: info.height };
    }
    throw new Error('The rendered original is too large.');
  } finally { pdf?.destroy(); library?.destroy(); }
}

export function startLocalBackground(origin, { intervalMs = 3000, request = fetch, log = console.error } = {}) {
  const controller = new AbortController();
  let active = false;
  let timer;
  const call = async (path, options = {}) => {
    const response = await request(new URL(path, origin), { ...options, headers: { origin, ...options.headers }, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) { const error = new Error(body.error || `Background request failed (${response.status}).`); error.status = response.status; throw error; }
    return body;
  };
  const latestRevision = async () => (await call('/api/workspace?revisionOnly=1')).revision;
  const processJob = async ({ document, page }, revision) => {
    const visionPages = [];
    try {
      if (document.mime === 'application/pdf' || document.mime.startsWith('image/')) {
        const original = await request(new URL(`/api/documents/${encodeURIComponent(document.id)}`, origin), { signal: controller.signal });
        if (!original.ok || Number(original.headers.get('content-length')) > MAX_BYTES) throw new Error('The saved original is unavailable.');
        const raster = await renderOriginalPage(new Uint8Array(await original.arrayBuffer()), document, page);
        for (let attempt = 0; attempt < 4; attempt++) {
          const form = new FormData();
          for (const [key, value] of Object.entries({ revision: await latestRevision(), caseId: document.caseId, documentId: document.id, documentVersion: document.version, sha256: document.sha256, page, width: raster.width, height: raster.height, automatic: 'true' })) form.set(key, String(value));
          form.set('image', new Blob([raster.bytes], { type: 'image/jpeg' }), `page-${page}.jpg`);
          try { const saved = await call('/api/ai/vision-page', { method: 'POST', body: form }); visionPages.push({ page, imageSha256: saved.imageSha256 }); break; }
          catch (error) { if (error.status !== 409 || attempt === 3) throw error; }
        }
      }
      await call('/api/ai/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, caseId: document.caseId, documentId: document.id, documentVersion: document.version, sha256: document.sha256, pages: [page], ...(visionPages.length ? { visionPages } : {}), consent: true, automatic: true }) });
    } catch (error) {
      if (controller.signal.aborted) return;
      // 409 is a changed original; 423 means another reader owns it; 429 is a timed pause.
      // Provider failures are already durable. Rendering failures are recorded here.
      if (![409, 423, 429].includes(error.status)) {
        await call('/api/ai/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ failure: { documentId: document.id, documentVersion: document.version, sha256: document.sha256, page, error: 'Automatic processing stopped. Retry this page explicitly after checking the original and provider connection.' } }) }).catch(() => undefined);
        log(`AICD automatic reader: a page needs attention (${error.status || 'preparation'}).`);
      }
    }
  };
  const tick = async () => {
    if (active || controller.signal.aborted) return;
    active = true;
    try {
      const queue = await call('/api/ai/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (queue.configured) await Promise.allSettled(queue.jobs.slice(0, 2).map(job => processJob(job, queue.revision)));
    } catch { /* Startup/server restarts are retried without provider calls. */ }
    finally { active = false; if (!controller.signal.aborted) timer = setTimeout(tick, intervalMs); }
  };
  timer = setTimeout(tick, intervalMs);
  return { stop() { controller.abort(); clearTimeout(timer); } };
}
