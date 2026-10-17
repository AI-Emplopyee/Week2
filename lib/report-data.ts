import type { WorkspaceState } from './types.ts';
import { getIssues } from './engine.ts';
import { DECLARATION_FIELDS } from './declaration-catalog.ts';
import { migrateDeclarationDraft } from './declaration.ts';

export function buildReport(state: WorkspaceState, caseId: string) {
  const shipment = state.cases.find(c => c.id === caseId);
  if (!shipment) throw new Error('Không tìm thấy hồ sơ.');
  const documents = state.documents.filter(d => d.caseId === caseId);
  const candidates = state.candidates.filter(c => c.caseId === caseId && documents.some(d => d.id === c.documentId && d.active && d.version === c.documentVersion));
  const issues = getIssues(state, caseId);
  const issuePriority: Record<string, number> = { conflict: 0, stale: 1, document: 2, missing: 3, transfer: 4, unsupported: 5, goods: 6, grouping: 7, uncertain: 8 };
  const open = issues.filter(i => !i.resolved).sort((a,b) => (issuePriority[a.kind] ?? 9) - (issuePriority[b.kind] ?? 9));
  const handoffs = state.handoffs.filter(h => h.caseId === caseId);
  const snapshots = state.snapshots.filter(s => s.caseId === caseId);
  const declarationDraft = migrateDeclarationDraft(shipment.declarationDraft);
  const declarationCoverage = DECLARATION_FIELDS.map(field => ({ field, entries: declarationDraft.fields.filter(entry => entry.fieldId === field.id) }));
  return { shipment, documents, candidates, issues, open, handoffs, snapshots,
    declarationDraft, declarationCoverage,
    audit: state.audit.filter(a => a.caseId === caseId),
    normalizations: candidates.flatMap(c => c.normalizations.map(n => ({ ...n, field: c.field, documentId: c.documentId, page: c.page }))),
    generatedAt: new Date().toISOString(), workspaceRevision: state.revision,
    customsValidation: 'Not yet assessed' as const,
  };
}
