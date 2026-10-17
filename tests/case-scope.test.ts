import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { parseMutation } from '../lib/server-validation.ts';
import { sourceCollectionSchema } from '../lib/intake-metadata.ts';
import { caseScopeMessage } from '../lib/case-scope.ts';
import { syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import { translateSystemText } from '../lib/i18n-core.ts';
import type { Actor, CaseType, UploadedDocument } from '../lib/types.ts';

const actor: Actor = { id: 'scope-reviewer', name: 'Synthetic reviewer', email: 'reviewer@example.invalid' };
const document: UploadedDocument = {
  id: 'scope-invoice', name: 'synthetic-invoice.txt', mime: 'text/plain', size: 200,
  sha256: 'synthetic-case-scope', extractionStatus: 'extracted', synthetic: true,
  pages: [{ page: 1, textSource: 'pdf_text', text: 'COMMERCIAL INVOICE\nInvoice Number: SYNTHETIC-SCOPE\nInvoice Total: 100 USD\nImporter: Fictional Buyer\nExporter: Fictional Seller' }],
};

for (const type of ['export', 'reference', 'unknown', 'unsupported'] as CaseType[]) {
  test(`${type} is stored, labeled and blocked from import-only checks and autofill`, () => {
    const collection = { name: 'SYNTHETIC_ARCHIVE', folder: 'folder', caseType: type };
    assert.equal(sourceCollectionSchema.parse(collection).caseType, type);
    let state = applyAction(createEmptyWorkspace('scope-workspace'), { type: 'intake', documents: [document], sourceCollection: collection }, actor);
    const id = state.cases[0].id;
    state = applyAction(state, { type: 'confirm_grouping', caseId: id, reason: 'Synthetic source comparison.' }, actor);
    syncShipmentDeclaration(state, state.cases[0], actor);
    assert.equal(state.documents.length, 1);
    assert.ok(state.candidates.length > 0);
    assert.equal(state.cases[0].declarationDraft?.fields.length, 0);
    const issues = getIssues(state, id);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].title, caseScopeMessage(type)?.title);
    assert.notEqual(translateSystemText(issues[0].description, 'en'), issues[0].description);
    assert.throws(() => applyAction(state, { type: 'approve', caseId: id }, actor), /nhập khẩu/);
    assert.throws(() => applyAction(state, { type: 'handoff', caseId: id }, actor), /nhập khẩu/);
    // Even a forged resolved notice cannot bypass the independent case-type guard.
    state.cases[0].resolutions.push({ issueId: issues[0].id, fingerprint: issues[0].fingerprint, reason: 'Synthetic forged resolution', actor: actor.name, at: '2026-01-01' });
    assert.throws(() => applyAction(state, { type: 'approve', caseId: id }, actor), /nhập khẩu/);
  });
}

test('new sample folders do not imply import and audited type changes survive later batches', () => {
  let state = applyAction(createEmptyWorkspace('scope-workspace'), { type: 'intake', documents: [document], sourceCollection: { name: 'SYNTHETIC_ARCHIVE', folder: 'folder' } }, actor);
  const id = state.cases[0].id;
  assert.equal(state.cases[0].caseType, 'unknown');
  const action = parseMutation({ revision: state.revision, action: { type: 'update_case', caseId: id, caseType: 'export' } }).action;
  state = applyAction(state, action, actor);
  state = applyAction(state, { type: 'intake', documents: [{ ...document, id: 'second', sha256: 'synthetic-second' }], sourceCollection: { name: 'SYNTHETIC_ARCHIVE', folder: 'folder', caseType: 'import' } }, actor);
  assert.equal(state.cases[0].caseType, 'export');
  assert.equal(state.cases[0].sourceCollection?.caseType, 'export');
  assert.ok(state.audit.some(entry => entry.action === 'case_updated'));
});
