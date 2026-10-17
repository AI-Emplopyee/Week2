import assert from 'node:assert/strict';
import { applyAction } from '../lib/engine.ts';
import { emptyDeclarationValue } from '../lib/declaration.ts';
import { ECUS_FORM_FIELDS, ecusFormValue, ecusFormValueUpdate } from '../lib/ecus-form.ts';
import type { DeclarationValue } from '../lib/declaration-types.ts';
import type { Actor, WorkspaceState } from '../lib/types.ts';

/** Explicit synthetic reviewer inputs for lifecycle fixtures; never used by application autofill. */
export function completeRequiredEcusFixture(original: WorkspaceState, caseId: string, actor: Actor): WorkspaceState {
  let state = original;
  const shipment = state.cases.find(item => item.id === caseId)!;
  const changes = new Map<string, { fieldId: string; goodsLineId?: string; value: DeclarationValue }>();
  for (const field of ECUS_FORM_FIELDS.filter(field => field.required && !field.readOnly)) {
    for (const goodsLineId of field.tab === 'goods' ? shipment.goods.map(line => line.id) : [undefined]) {
      const entry = shipment.declarationDraft?.fields.find(entry => entry.fieldId === field.fieldId && entry.goodsLineId === goodsLineId);
      if (entry?.applicability === 'applicable' && ecusFormValue(field, shipment.declarationDraft, goodsLineId).trim()) continue;
      const key = JSON.stringify([field.fieldId, goodsLineId ?? null]);
      const value = changes.get(key)?.value ?? entry?.value ?? emptyDeclarationValue(field.fieldId);
      const supplied = field.key === 'hsCode' ? '12345678' : field.key === 'origin' ? 'VN' : field.input === 'date' ? '2026-10-15' : ['decimal', 'integer'].includes(field.input) ? '0' : 'SYNTHETIC';
      changes.set(key, { fieldId: field.fieldId, ...(goodsLineId ? { goodsLineId } : {}), value: ecusFormValueUpdate(field, value, supplied) });
    }
  }
  for (const change of changes.values()) state = applyAction(state, {
    type: 'save_declaration_field', caseId, ...change, applicability: 'applicable',
    basis: 'Explicit synthetic data for a complete lifecycle test.',
    provenance: [{ kind: 'manual', note: 'Test-only reviewer instruction, not inferred from documents or a verified customs code.' }],
    reason: 'Supply synthetic required ECUS controls for lifecycle testing.', review: true,
  }, actor);
  const current = state.cases.find(item => item.id === caseId)!;
  state = applyAction(state, { type: 'review_goods', caseId, goods: current.goods, reviewedLineIds: current.goods.map(line => line.id), reason: 'Explicit review of the complete synthetic goods table.' }, actor);
  assert.ok(state.cases.find(item => item.id === caseId)!.goods.every(line => line.reviewed));
  return state;
}
