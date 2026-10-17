import { extractWithKimi, kimiStatus, KIMI_LIMITS, type KimiConfig } from './kimi.ts';
import type { ShipmentDocument, UploadedDocument } from './types.ts';

type Dependencies = { extract?: typeof extractWithKimi; allowRequest?: () => Promise<boolean>; maxRequests?: number };

/** Round-robin batches give every document a first pass before long documents consume the budget. */
export async function enrichIntakeWithKimi(documents: UploadedDocument[], config: KimiConfig, dependencies: Dependencies = {}): Promise<void> {
  const status = kimiStatus(config);
  if (!status.configured) {
    for (const document of documents) { document.aiStatus = 'unavailable'; if (document.extractionPipeline === 'kimi' && document.extractionStatus !== 'unsupported') document.extractionStatus = 'pending_ai'; }
    return;
  }
  const plans = documents.map(document => {
    const chunks: number[][] = []; let chunk: number[] = []; let characters = 0; let unread = false;
    for (const page of document.pages) {
      if (!page.text.trim() || page.text.length > KIMI_LIMITS.maxTextCharacters) { unread = true; continue; }
      if (chunk.length >= KIMI_LIMITS.maxPages || characters + page.text.length > KIMI_LIMITS.maxTextCharacters) { chunks.push(chunk); chunk = []; characters = 0; }
      chunk.push(page.page); characters += page.text.length;
    }
    if (chunk.length) chunks.push(chunk);
    return { document, chunks, unread, done: 0, failed: false };
  });
  let remaining = Math.min(dependencies.maxRequests ?? KIMI_LIMITS.requestsPerMinute, KIMI_LIMITS.requestsPerMinute);
  const largest = Math.max(0, ...plans.map(plan => plan.chunks.length));
  for (let pass = 0; pass < largest; pass++) {
    for (const plan of plans) {
      const pages = plan.chunks[pass];
      if (!pages || plan.failed || remaining <= 0) continue;
      if (dependencies.allowRequest && !await dependencies.allowRequest()) { remaining = 0; break; }
      remaining--;
      const document: ShipmentDocument = { ...plan.document, caseId: '', type: 'other', version: 1, active: true, uploadedAt: new Date().toISOString(), synthetic: !!plan.document.synthetic };
      try {
        const result = await (dependencies.extract ?? extractWithKimi)(config, document, pages, { beforeRepair: async () => {
          if (remaining <= 0) return false;
          if (dependencies.allowRequest && !await dependencies.allowRequest()) { remaining = 0; return false; }
          remaining--;
          return true;
        } });
        plan.document.aiCandidates = [...(plan.document.aiCandidates ?? []), ...result.candidates];
        plan.document.aiProcessedPages = [...new Set([...(plan.document.aiProcessedPages ?? []), ...result.pages])];
        plan.document.aiPageReadings = [...(plan.document.aiPageReadings ?? []).filter(page => !result.pages.includes(page.page)), ...(result.pageReadings ?? [])];
        for (const page of plan.document.pages) {
          const reading = result.pageReadings?.find(reading => reading.page === page.page);
          if (reading) { page.documentType = reading.documentType; page.aiReadability = reading.readability; }
        }
        plan.done++;
      } catch {
        plan.failed = true;
        plan.document.aiError = 'AI extraction could not finish. Original documents are preserved; no local extractor is used as a fallback.';
      }
    }
  }
  for (const plan of plans) {
    plan.document.aiStatus = plan.failed && !plan.done ? 'failed' : plan.done === plan.chunks.length && !plan.unread && plan.chunks.length ? 'completed' : 'partial';
    if (plan.document.extractionPipeline === 'kimi' && plan.document.extractionStatus !== 'unsupported') {
      plan.document.extractionStatus = plan.document.aiStatus !== 'completed' ? 'pending_ai' : plan.document.aiPageReadings?.some(page => page.readability === 'uncertain') ? 'needs_transcription' : 'extracted';
    }
    if (plan.document.aiStatus === 'partial' && !plan.document.aiError) plan.document.aiError = 'AI checked only part of this document. Unreadable pages or the request limit require further review.';
  }
}
