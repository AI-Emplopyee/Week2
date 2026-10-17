import { buildShipmentFacts, isShipmentFactClear } from './shipment-autofill.ts';
import { guidePrimaryDocumentTypes } from './vnaccs-guide-rules.ts';
import type { ShipmentDocument, SourcePage, WorkspaceState } from './types.ts';

type Diagnostic = { page: number; field: string; reasons: string[] };
export type RejectionAssessment = { blocking: boolean; supersededFields: string[] };
const blocked = (): RejectionAssessment => ({ blocking: true, supersededFields: [] });

/** A rejected value stays rejected. Only an explicit guide priority can make its
 * failed secondary reading irrelevant to the completed declaration reading pass. */
export function assessPageRejections(state: WorkspaceState, document: ShipmentDocument, pageNumber: number): RejectionAssessment {
  if (!document.aiRejectedPages?.includes(pageNumber)) return { blocking: false, supersededFields: [] };
  const page = document.pages.find(page => page.page === pageNumber);
  const shipment = state.cases.find(shipment => shipment.id === document.caseId && !shipment.mergedInto);
  if (!shipment || !document.active || document.referenceOnly || document.extractionPipeline !== 'kimi' || !document.aiProcessedPages?.includes(pageNumber) || page?.aiReadability !== 'clear' || !page.documentType) return blocked();
  // Use the latest read of this exact page, never an older successful batch or
  // another page's diagnostics. Legacy flags without full diagnostics stay blocked.
  const audit = [...state.audit].reverse().find(entry => {
    if (entry.action !== 'ai_header_proposals_received' || !entry.after || typeof entry.after !== 'object') return false;
    const after = entry.after as Record<string, unknown>;
    return after.documentId === document.id && Array.isArray(after.pages) && after.pages.includes(pageNumber);
  });
  const after = audit?.after as Record<string, unknown> | undefined;
  if (!after || after.documentVersion !== document.version || !Array.isArray(after.rejectionDiagnostics) || !Number.isInteger(after.rejected) || after.rejected !== after.rejectionDiagnostics.length || !after.rejected) return blocked();
  const diagnostics: Diagnostic[] = [];
  const indexes = new Set<number>();
  for (const value of after.rejectionDiagnostics) {
    if (!value || typeof value !== 'object') return blocked();
    const diagnostic = value as Record<string, unknown>;
    if (!Number.isInteger(diagnostic.index) || Number(diagnostic.index) < 0 || indexes.has(Number(diagnostic.index))) return blocked();
    indexes.add(Number(diagnostic.index));
    if (!Number.isInteger(diagnostic.page) || !(after.pages as unknown[]).includes(diagnostic.page) || typeof diagnostic.field !== 'string' || !Array.isArray(diagnostic.reasons) || !diagnostic.reasons.length || !diagnostic.reasons.every(reason => typeof reason === 'string')) return blocked();
    if (diagnostic.page === pageNumber) diagnostics.push(diagnostic as Diagnostic);
  }
  if (!diagnostics.length) return blocked();
  const facts = buildShipmentFacts(state, shipment);
  const supersededFields = new Set<string>();
  for (const diagnostic of diagnostics) {
    // The narrow supported case is a secondary header assigned to a goods row.
    // Missing/corrupt evidence, unknown fields and other failures still need repair.
    if (!diagnostic.reasons.every(reason => reason === 'row_scope_mismatch')) return blocked();
    const primaryTypes = guidePrimaryDocumentTypes(diagnostic.field);
    const fact = facts[diagnostic.field];
    if (!primaryTypes?.length || primaryTypes.includes(page.documentType) || !fact?.rule || fact.status !== 'agreed' || !isShipmentFactClear(state, diagnostic.field, fact.candidates)) return blocked();
    if (['currency', 'incoterm'].includes(diagnostic.field) && !/^[A-Z]{3}$/.test(fact.value ?? '')) return blocked();
    const primary = fact.candidates.filter(candidate => {
      const source = state.documents.find(source => source.id === candidate.documentId && source.version === candidate.documentVersion && source.caseId === shipment.id && source.active && !source.referenceOnly);
      const sourcePage = source?.pages.find(page => page.page === candidate.page);
      return !candidate.lineId && !!sourcePage?.documentType && primaryTypes.includes(sourcePage.documentType) && !source?.aiRejectedPages?.includes(candidate.page);
    });
    if (!isShipmentFactClear(state, diagnostic.field, primary)) return blocked();
    supersededFields.add(diagnostic.field);
  }
  return { blocking: false, supersededFields: [...supersededFields].sort() };
}

export function documentSourceReady(state: WorkspaceState, document: ShipmentDocument): boolean {
  return document.extractionPipeline === 'kimi' && document.extractionStatus === 'extracted' && document.pages.length > 0 &&
    document.pages.every(page => document.aiProcessedPages?.includes(page.page) && page.aiReadability === 'clear' && !assessPageRejections(state, document, page.page).blocking);
}

/** Shared automatic queue predicate; explicit page rereads remain available. */
export function sourcePageNeedsKimi(state: WorkspaceState, document: ShipmentDocument, page: SourcePage): boolean {
  return document.extractionPipeline !== 'kimi' || !page.aiReadability || !document.aiProcessedPages?.includes(page.page) || assessPageRejections(state, document, page.page).blocking;
}
