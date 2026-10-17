import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { getDeclarationEntry } from '../lib/declaration.ts';
import type { Action, Actor, GoodsLine, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'ecus-workflow-reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
const act = (state: WorkspaceState, action: Action) => applyAction(state, action, actor);
const row = (id: string): GoodsLine => ({ id, description: '', quantity: '', unit: '', unitPrice: '', amount: '', hsCode: '', origin: '', dutyRate: '', vatRate: '', reviewed: false, manual: true });
function fixture() {
  let state = act(createEmptyWorkspace('ecus-workflow'), { type: 'create_case', title: 'Synthetic ECUS workflow' });
  const caseId = state.cases[0].id;
  state = act(state, { type: 'review_goods', caseId, goods: [row('row-one')], reviewedLineIds: [], reason: 'Add a blank test row.' });
  return state;
}
const save = (state: WorkspaceState, fieldId: string, value: Extract<Action,{type:'save_declaration_field'}>['value']) => act(state, {
  type: 'save_declaration_field', caseId: state.cases[0].id, goodsLineId: state.cases[0].goods[0].id,
  fieldId, value, applicability: 'applicable', basis: 'Synthetic reviewer data.',
  provenance: [{ kind: 'manual', note: 'Explicit synthetic test value.' }], reason: 'Save a partial goods cell.', review: false,
});

test('IDA goods edits update commercial checks without approving a whole row', () => {
  let state = fixture();
  state = save(state, '1.78', { kind: 'text', text: 'Synthetic item' });
  state = save(state, '1.83', { kind: 'quantity', amount: '2.000000000000000001', unitCode: 'PCE' });
  state = save(state, '1.85', { kind: 'decimal', amount: '20' });
  state = save(state, 'ecus.vatTaxRate', { kind: 'decimal', amount: '0' });
  const line = state.cases[0].goods[0];
  assert.equal(line.description, 'Synthetic item');
  assert.equal(line.quantity, '2.000000000000000001');
  assert.equal(line.unit, 'PCE');
  assert.equal(line.amount, '20');
  assert.equal(line.vatRate, '0');
  assert.equal(line.reviewed, false);
  assert.equal(line.manual, true);
  const restored = JSON.parse(JSON.stringify(state));
  assert.deepEqual(restored.cases[0].declarationDraft, state.cases[0].declarationDraft);
});

test('appending a row preserves generated multi-quote evidence and cannot rewrite it', () => {
  const state = fixture();
  const shipment = state.cases[0];
  const sourceText = 'Synthetic item\nQuantity: 2';
  state.documents.push({ id: 'source', caseId: shipment.id, name: 'synthetic.txt', mime: 'text/plain', size: sourceText.length, sha256: 'source-hash', type: 'invoice', version: 1, active: true, extractionStatus: 'extracted', pages: [{page: 1, text: sourceText}], uploadedAt: '2026-10-15T12:00:00Z', synthetic: true });
  shipment.documentIds.push('source');
  shipment.goods[0] = { ...row('row-one'), description: 'Synthetic item', sourceDocumentId: 'source', sourcePage: 1, originalText: sourceText, manual: false };
  state.candidates.push({id:'candidate',caseId:shipment.id,documentId:'source',documentVersion:1,page:1,field:'description',value:'Synthetic item',originalText:'Synthetic item',location:'Synthetic source line',lineId:'row-one',confidence:'high',method:'kimi:test',normalizations:[]});
  const next = act(state, {type:'review_goods',caseId:shipment.id,goods:[...shipment.goods,row('row-two')],reviewedLineIds:[],reason:'Append another synthetic row.'});
  assert.equal(next.cases[0].goods.length,2);
  assert.equal(next.cases[0].goods[0].originalText,sourceText);
  assert.throws(()=>act(state,{type:'review_goods',caseId:shipment.id,goods:[{...shipment.goods[0],originalText:'Forged evidence'}],reason:'Cannot change source text.'}),/văn bản nguồn/);
});

test('goods tax questions retain row identity in local correspondence', () => {
  let state = fixture();
  const caseId = state.cases[0].id;
  state.cases[0].groupingConfirmed = true;
  state = act(state, {type:'review_goods',caseId,goods:[...state.cases[0].goods,row('row-two')],reason:'Append a second test row.'});
  const issue = getIssues(state,caseId).find(issue => issue.ecusFieldKey==='vatTaxAmount' && issue.goodsLineId==='row-two')!;
  assert.ok(issue);
  state = act(state,{type:'draft_questions',caseId,issueIds:[issue.id],locale:'en'});
  assert.match(state.emailDrafts![0].body,/VAT amount — goods row 2/);
  assert.equal(getDeclarationEntry(state.cases[0].declarationDraft,'ecus.vatTaxAmount','row-two'),undefined);
});
