/**
 * Build deterministic provider-response fixtures for older domain tests. This
 * helper is test-only: production intake never invokes the historical parser.
 * Kimi integration and grounding are covered separately by the provider tests.
 */
import { applyAction } from '../../lib/engine.ts';
import type { Action, Actor, ShipmentDocument, UploadedDocument, WorkspaceState } from '../../lib/types.ts';
import { classifyDocument, derivePageTypes, extractDocument } from './legacy-extraction.ts';

export function kimiFixture(upload: UploadedDocument): UploadedDocument {
  if (upload.aiCandidates || !upload.pages.length) return upload;
  const document: ShipmentDocument = {
    ...structuredClone(upload), active: true, version: 1, caseId: '', synthetic: upload.synthetic ?? false,
    type: classifyDocument(upload.name, upload.pages.map(page => page.text).join('\n')),
    uploadedAt: '2026-01-01T00:00:00Z',
  };
  delete document.extractionPipeline;
  derivePageTypes(document);
  const { candidates } = extractDocument(document);
  return {
    ...upload,
    extractionPipeline: 'kimi',
    aiStatus: 'completed',
    aiPageReadings: document.pages.map(page => ({
      page: page.page,
      documentType: page.documentType === 'other' ? document.type : page.documentType!,
      readability: page.text.trim() && !(page.textSource === 'ocr' && (page.ocrConfidence ?? 1) < 0.65) ? 'clear' : 'uncertain',
    })),
    aiCandidates: candidates.flatMap(candidate => candidate.field === 'container' && candidate.value.includes(',')
      ? candidate.value.split(/,\s*/).map((value, index) => ({ ...candidate, id: `${candidate.id}:${index}`, value }))
      : [candidate]).map(candidate => ({
      ...candidate,
      method: `kimi:test_fixture:${candidate.method}`,
      readability: candidate.confidence === 'low' ? 'uncertain' : 'clear',
    })),
  };
}

export function applyFixtureAction(state: WorkspaceState, action: Action, actor: Actor): WorkspaceState {
  const prepared = action.type === 'intake'
    ? { ...action, documents: action.documents.map(kimiFixture) }
    : action.type === 'replace_document' ? { ...action, document: kimiFixture(action.document) }
      : action;
  return applyAction(state, prepared, actor);
}
