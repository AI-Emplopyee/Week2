import assert from 'node:assert/strict';
import test from 'node:test';
import { ECUS_FORM_FIELDS, ECUS_ADDITIONAL_CATALOG, ecusFormValue, ecusFormValueUpdate, getEcusFormField, getEcusRequiredIssues } from '../lib/ecus-form.ts';
import { DECLARATION_CATALOG, getDeclarationField } from '../lib/declaration-catalog.ts';
import { declarationActionSchema, declarationValueSchema, emptyDeclarationValue, getDeclarationIssues, saveDeclarationField, validateDeclarationEntry } from '../lib/declaration.ts';
import { reviewQuestion } from '../lib/review-questions.ts';
import type { DeclarationDraft, DeclarationSaveContext, SaveDeclarationFieldAction } from '../lib/declaration-types.ts';
import type { GoodsLine, WorkspaceState } from '../lib/types.ts';

const goods: GoodsLine = { id: 'goods-stable', description: '', quantity: '', unit: '', unitPrice: '', amount: '', hsCode: '', origin: '', dutyRate: '', vatRate: '', reviewed: false, manual: true };
const context: DeclarationSaveContext = { caseId: 'case-ecus', documents: [], goods: [goods], actor: { id: 'reviewer', name: 'Reviewer', email: 'reviewer@example.invalid' }, at: '2026-10-15T12:00:00.000Z' };
function action(fieldId: string, extra: Partial<SaveDeclarationFieldAction> = {}): SaveDeclarationFieldAction {
  return { type: 'save_declaration_field', caseId: context.caseId, fieldId, ...(getDeclarationField(fieldId)?.scope === 'item' ? { goodsLineId: goods.id } : {}), applicability: 'applicable', basis: 'Provided by the shipment reviewer.', value: emptyDeclarationValue(fieldId), provenance: [{ kind: 'manual', note: 'Provided by the shipment reviewer.' }], reason: 'Capture the supplied declaration information.', review: false, ...extra };
}

test('ECUS forms keep the 25 supplied goods columns and exact photographed required headers', () => {
  const goodsFields = ECUS_FORM_FIELDS.filter(field => field.tab === 'goods');
  assert.equal(goodsFields.length, 25);
  assert.ok(goodsFields.every(field => field.required));
  assert.deepEqual(goodsFields.filter(field => field.readOnly).map(field => field.key), ['goodsSequence']);
  assert.deepEqual(ECUS_FORM_FIELDS.filter(field => field.required && field.tab !== 'goods').map(field => field.key), ['declarationType', 'customsOffice', 'partyClassification', 'transportMode', 'exporter', 'exporterAddress', 'packageCount', 'arrivalDate', 'portOfLoadingCode', 'invoiceForm', 'invoicePriceCategory', 'invoiceTotal', 'incoterm', 'currency']);
  assert.equal(new Set(ECUS_FORM_FIELDS.map(field => field.key)).size, ECUS_FORM_FIELDS.length);
  assert.deepEqual(ECUS_FORM_FIELDS.filter(field => field.fieldId === '1.26').map(field => field.rowIndex), [0, 1, 2, 3, 4]);
  assert.equal(ECUS_FORM_FIELDS.filter(field => field.fieldId === '1.66').length, 9);
});

test('new ECUS entries extend accepted values while preserving the historical 96-field reference catalog', () => {
  assert.equal(DECLARATION_CATALOG.length, 96);
  for (const field of ECUS_FORM_FIELDS) {
    const catalog = getDeclarationField(field.fieldId);
    assert.ok(catalog, field.key);
    assert.ok(catalog.components.some(component => component.key === field.component), field.key);
    assert.ok(declarationValueSchema.safeParse(emptyDeclarationValue(field.fieldId)).success, field.key);
  }
  assert.ok(ECUS_ADDITIONAL_CATALOG.some(field => field.id === 'ecus.goodsCode'));
  const request = action('ecus.exciseTaxAmount', { value: { kind: 'decimal', amount: '0' } });
  assert.ok(declarationActionSchema.safeParse(request).success);
  const saved = saveDeclarationField(undefined, request, context);
  assert.deepEqual(saved.fields[0].value, { kind: 'decimal', amount: '0' });
  assert.equal(saved.fields[0].goodsLineId, goods.id);
  assert.equal(declarationActionSchema.safeParse({ ...request, fieldId: 'ecus.invented' }).success, false);
  assert.throws(() => saveDeclarationField(undefined, action('ecus.goodsSequence', { value: { kind: 'count', count: '12' } }), context), /system/);
});

test('required questions include absent drafts and missing goods cells, but never absent optional cells or auto sequence', () => {
  const issues = getEcusRequiredIssues(undefined, context);
  assert.equal(issues.length, 14 + 24);
  assert.equal(issues.filter(issue => issue.goodsLineId === goods.id).length, 24);
  assert.ok(issues.every(issue => issue.field && issue.ecusFieldKey));
  assert.ok(!issues.some(issue => ['goodsSequence', 'invoiceNumber', 'invoiceDate', 'importer', 'contractNumber'].includes(issue.ecusFieldKey!)));
  assert.equal(getDeclarationIssues(undefined, context).length, issues.length);
  const state = { documents: [], candidates: [] } as unknown as WorkspaceState;
  assert.equal(reviewQuestion(state, issues[0]).kind, 'missing');
  assert.equal(getEcusRequiredIssues(undefined, { ...context, goods: [] }).length, 14);
});

test('all required controls must have applicable values; explicit zero taxes satisfy missing checks', () => {
  let draft: DeclarationDraft = { schemaVersion: 1, fields: [] };
  for (const field of ECUS_FORM_FIELDS.filter(field => field.required && !field.readOnly)) {
    const goodsLineId = field.tab === 'goods' ? goods.id : undefined;
    const prior = draft.fields.find(entry => entry.fieldId === field.fieldId && entry.goodsLineId === goodsLineId);
    const supplied = field.input === 'date' ? '2026-10-15' : ['decimal', 'integer'].includes(field.input) ? '0' : 'Provided';
    const value = ecusFormValueUpdate(field, prior?.value ?? emptyDeclarationValue(field.fieldId), supplied);
    draft = saveDeclarationField(draft, action(field.fieldId, { value, ...(goodsLineId ? { goodsLineId } : {}) }), context);
  }
  assert.deepEqual(getEcusRequiredIssues(draft, context), []);
  const goodsCode = draft.fields.find(entry => entry.fieldId === 'ecus.goodsCode')!;
  goodsCode.applicability = 'not_applicable';
  assert.deepEqual(getEcusRequiredIssues(draft, context).map(issue => issue.ecusFieldKey), ['goodsCode']);
  goodsCode.applicability = 'applicable';
  const firstLine = context.goods[0];
  assert.equal(getEcusRequiredIssues(draft, { ...context, goods: [{ ...firstLine, id: 'new-line' }, firstLine] }).filter(issue => issue.goodsLineId === 'new-line').length, 24);
  assert.equal(ecusFormValue(getEcusFormField('importDutyAmount')!, draft, goods.id), '0');
});

test('editing a later repeated input keeps empty preceding slots, all companion cells and stable row identities', () => {
  const category = getEcusFormField('permitCategory3')!;
  const reference = getEcusFormField('permitNumber3')!;
  const value = ecusFormValueUpdate(category, emptyDeclarationValue('1.38'), 'P3');
  assert.equal(value.kind, 'permit_rows');
  if (value.kind !== 'permit_rows') throw new Error('Wrong value shape');
  assert.equal(value.rows.length, 3);
  assert.deepEqual(value.rows[0], { id: value.rows[0].id, categoryCode: '', reference: '' });
  const updated = ecusFormValueUpdate(reference, value, 'PERMIT-123');
  assert.ok(declarationValueSchema.safeParse(updated).success);
  if (updated.kind !== 'permit_rows') throw new Error('Wrong value shape');
  assert.deepEqual(updated.rows.map(row => row.id), value.rows.map(row => row.id));
  assert.equal(updated.rows[2].categoryCode, 'P3');
  assert.equal(updated.rows[2].reference, 'PERMIT-123');
  assert.equal(value.rows[2].reference, '');
});

test('goods price and taxable value do not require invisible currency cells', () => {
  const price = saveDeclarationField(undefined, action('1.86', { value: { kind: 'unit_price', amount: '2.50', currencyCode: '', unitCode: '' } }), context);
  const taxable = saveDeclarationField(price, action('1.87', { value: { kind: 'money', amount: '100000', currencyCode: '' } }), context);
  for (const entry of taxable.fields) assert.ok(!validateDeclarationEntry(entry, context, taxable).some(finding => finding.code === 'money_pair'));
});
