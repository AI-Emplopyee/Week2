import { sourcePageNeedsKimi } from './source-completeness.ts';
import { buildAiBatches, canRenderVisionDocument, runDocumentAi, type AiProgress, type ClientAiStatus } from './client-vision.ts';
import type { WorkspaceResponse } from './types.ts';

/** Resume only the selected shipment. Reading pages never approves a draft or sends mail. */
export async function runCaseKimi(options: {
  workspace: WorkspaceResponse; caseId: string; status: ClientAiStatus; signal?: AbortSignal;
  onWorkspace?: (workspace: WorkspaceResponse) => void; onProgress?: (progress: AiProgress) => void;
}, dependencies: { run?: typeof runDocumentAi } = {}) {
  let workspace = options.workspace;
  const queue = workspace.state.documents.filter(document => document.caseId === options.caseId && document.active && !document.referenceOnly && !['unsupported', 'failed'].includes(document.extractionStatus))
    .map(document => {
      const pages = document.pages.filter(page => sourcePageNeedsKimi(workspace.state, document, page)).map(page => page.page);
      return { documentId: document.id, batches: pages.length ? buildAiBatches(document.pages, pages, options.status.limits, canRenderVisionDocument(document)) : [] };
    });
  while (queue.some(item => item.batches.length)) {
    for (const item of queue) {
      const pages = item.batches.shift();
      if (!pages) continue;
      if (options.signal?.aborted) throw new DOMException('Reading stopped.', 'AbortError');
      const result = await (dependencies.run ?? runDocumentAi)({ workspace, documentId: item.documentId, pages, status: options.status, signal: options.signal, onWorkspace: options.onWorkspace, onProgress: options.onProgress });
      workspace = result.workspace;
    }
  }
  return workspace;
}
