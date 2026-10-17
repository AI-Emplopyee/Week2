import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createEmptyWorkspace, getIssues } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { parseIntakeMetadata, sourceCollectionSchema } from '../lib/intake-metadata.ts';
import { boundedPdfPages } from '../lib/pdf-pages.ts';
import { acceptedFile, parseMutation } from '../lib/server-validation.ts';
import type { Actor, SourceCollection, UploadedDocument, WorkspaceState } from '../lib/types.ts';

const actor: Actor = { id: 'archive-reviewer', name: 'Synthetic archive reviewer', email: 'archive@example.invalid' };
const collection: SourceCollection = { name: 'SYNTHETIC_ARCHIVE', folder: '2016/Job One', caseType: 'import' };
function upload(id: string, overrides: Partial<UploadedDocument> = {}): UploadedDocument {
  return {
    id, name: `${id}.txt`, mime: 'text/plain', size: 100,
    sha256: `synthetic-${id}`, synthetic: true, extractionStatus: 'extracted',
    sourcePaths: [`2016/Job One/${id}.txt`],
    pages: [{ page: 1, textSource: 'pdf_text', text: 'COMMERCIAL INVOICE\nInvoice Number: SYNTHETIC-ARCHIVE-ONE\nImporter: Fictional Buyer\nExporter: Fictional Seller\nGross Weight: 100 KG\nDescription | Quantity | Unit | Unit Price | Amount\nSynthetic widget | 1 | PCS | 10 | 10' }],
    ...overrides,
  };
}
function ingest(state: WorkspaceState, docs: UploadedDocument[], sourceCollection = collection) {
  return applyAction(state, { type: 'intake', sourceCollection, documents: docs }, actor);
}

test('a historical folder becomes an unconfirmed packet without changing an existing shipment or approving draft data', () => {
  let state = applyAction(createEmptyWorkspace('ws_archive_test'), { type: 'intake', documents: [upload('existing-live')] }, actor);
  const liveId = state.cases[0].id;
  state = applyAction(state, { type: 'review_field', caseId: liveId, field: 'importer', value: 'Preserved manually checked importer', reason: 'Previously checked synthetic shipment.' }, actor);
  const live = structuredClone(state.cases[0]);
  const liveDocuments = structuredClone(state.documents);
  const liveCandidates = structuredClone(state.candidates);
  // This archive has the same invoice number: a folder import must still not
  // silently join the unrelated live shipment.
  const imported = ingest(state, [upload('archive-invoice')]);
  assert.equal(imported.cases.length, 2);
  assert.deepEqual(imported.cases.find(item => item.id === liveId), live);
  assert.deepEqual(imported.documents.filter(document => document.caseId === liveId), liveDocuments);
  assert.deepEqual(imported.candidates.filter(candidate => candidate.caseId === liveId), liveCandidates);
  const packet = imported.cases.find(item => item.sourceCollection)!;
  assert.deepEqual(packet.sourceCollection, collection);
  assert.equal(packet.groupingConfirmed, false);
  assert.equal(packet.groupingConfidence, 'low');
  assert.equal(packet.status, 'review');
  assert.equal(packet.approval, undefined);
  assert.deepEqual(packet.fields, {});
  assert.ok(packet.goods.length > 0);
  assert.ok(packet.goods.every(line => !line.reviewed));
  assert.equal(packet.declarationDraft?.fields.length, 0);
  assert.ok(getIssues(imported, packet.id).some(issue => issue.kind === 'grouping' && !issue.resolved));
  assert.throws(() => applyAction(imported, { type: 'approve', caseId: packet.id }, actor));
});

test('later batches share their source packet while different folders and ordinary intake remain separate', () => {
  let state = ingest(createEmptyWorkspace('ws_archive_test'), [upload('first')]);
  const packetId = state.cases[0].id;
  state = ingest(state, [upload('second')]);
  assert.equal(state.cases.length, 1);
  assert.deepEqual(state.cases[0].documentIds, ['first', 'second']);
  state = ingest(state, [upload('other-folder')], { ...collection, folder: '2017/Another Job' });
  assert.equal(state.cases.filter(item => !item.mergedInto).length, 2);
  const packetBefore = structuredClone(state.cases.find(item => item.id === packetId));
  state = applyAction(state, { type: 'intake', documents: [upload('new-live')] }, actor);
  assert.equal(state.cases.filter(item => !item.mergedInto).length, 3);
  assert.deepEqual(state.cases.find(item => item.id === packetId), packetBefore);
  assert.equal(state.documents.find(document => document.id === 'new-live')!.caseId === packetId, false);
  assert.throws(() => applyAction(state, { type: 'intake', sourceCollection: collection, targetCaseId: packetId, documents: [upload('forced')] }, actor), /cannot target/);
});

test('duplicate originals retain every distinct source path without changing their shipment or reviewed values', () => {
  let state = applyAction(createEmptyWorkspace('ws_archive_test'), { type: 'intake', documents: [upload('live-original')] }, actor);
  const caseId = state.cases[0].id;
  state = applyAction(state, { type: 'review_field', caseId, field: 'importer', value: 'Preserved live buyer', reason: 'Synthetic existing human decision.' }, actor);
  const beforeCase = structuredClone(state.cases[0]);
  const beforeCandidates = structuredClone(state.candidates);
  const original = state.documents[0];
  state = ingest(state, [
    upload('archive-copy-one', { sha256: original.sha256, sourcePaths: ['2016/Job One/copy-one.txt'] }),
    upload('archive-copy-two', { sha256: original.sha256, sourcePaths: ['2017/Job Two/copy-two.txt'], referenceOnly: true }),
  ]);
  assert.equal(state.documents.length, 1);
  assert.equal(state.cases.length, 1);
  assert.deepEqual(state.cases[0], beforeCase);
  assert.deepEqual(state.candidates, beforeCandidates);
  assert.deepEqual(state.documents[0].sourcePaths, [...original.sourcePaths!, '2016/Job One/copy-one.txt', '2017/Job Two/copy-two.txt']);
  assert.equal(state.documents[0].referenceOnly, original.referenceOnly);
  assert.equal(state.documents[0].name, original.name);
  assert.equal(state.documents[0].version, original.version);
  assert.equal(state.documents[0].caseId, caseId);
  assert.equal(state.audit.filter(entry => entry.action === 'document_source_linked').length, 2);
  const replayed = ingest(state, [upload('same-again', { sha256: original.sha256, sourcePaths: ['2017/Job Two/copy-two.txt'] })]);
  assert.equal(replayed.documents[0].sourcePaths!.length, 3);
  assert.deepEqual(replayed.cases[0], beforeCase);
});

test('reference-only sources retain originals and provenance but never supply candidates, goods, or AI proposals', () => {
  const document = upload('technical-reference', { referenceOnly: true, sourcePaths: ['2016/Job One/catalog.pdf', '2016/Job One/copy/catalog.pdf'] });
  const state = ingest(createEmptyWorkspace('ws_archive_test'), [document]);
  assert.equal(state.documents[0].referenceOnly, true);
  assert.deepEqual(state.documents[0].sourcePaths, document.sourcePaths);
  assert.deepEqual(state.documents[0].pages.map(({ page, text, textSource }) => ({ page, text, textSource })), document.pages);
  assert.equal(state.candidates.length, 0);
  assert.equal(state.cases[0].goods.length, 0);
  assert.equal(state.cases[0].declarationDraft?.fields.length, 0);
  assert.throws(() => applyAction(state, {
    type: 'add_ai_candidates', caseId: state.cases[0].id, documentId: document.id,
    documentVersion: 1, model: 'synthetic-model', pages: [1],
    proposals: [{ field: 'invoiceNumber', value: 'SYNTHETIC-ARCHIVE-ONE', quote: 'Invoice Number: SYNTHETIC-ARCHIVE-ONE', page: 1, confidence: 'medium' }],
  }, actor), /Reference-only/);
  assert.equal(state.candidates.length, 0);
});

test('reference-only copies do not satisfy required ECUS information after a packet is confirmed', () => {
  let state = ingest(createEmptyWorkspace('ws_archive_test'), [upload('reference-invoice', { referenceOnly: true })]);
  state = applyAction(state, { type: 'confirm_grouping', caseId: state.cases[0].id, reason: 'Synthetic explicit grouping check.' }, actor);
  const issues = getIssues(state, state.cases[0].id);
  assert.ok(issues.some(issue => issue.ecusFieldKey === 'invoiceTotal' && issue.id.endsWith(':required') && !issue.resolved));
  assert.ok(!issues.some(issue => /:missing-(invoice|packing|transport)$/.test(issue.id)));
  assert.equal(state.candidates.length, 0);
  assert.equal(state.cases[0].declarationDraft?.fields.length, 0);
});

test('long reference PDFs retain all physical pages without raising the normal shipment page limit', async () => {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 70; index++) pdf.addPage();
  const bytes = await pdf.save();
  await assert.rejects(boundedPdfPages(bytes), /50 pages/);
  const pages = await boundedPdfPages(bytes, [], { referenceOnly: true });
  assert.equal(pages.length, 70);
  assert.equal(pages[69].page, 70);
  assert.ok(pages.every(page => page.text === ''));
  const original = upload('reference-brochure', { name: 'brochure.pdf', mime: 'application/pdf', pages, referenceOnly: true, extractionStatus: 'needs_transcription' });
  const state = ingest(createEmptyWorkspace('ws_archive_test'), [original]);
  assert.equal(state.documents[0].pages.length, 70);
  assert.equal(state.candidates.length, 0);
  assert.equal(getIssues(state).some(issue => issue.kind === 'document'), false);
});

test('a new batch invalidates an earlier packet approval and marks contradictory reviewed values stale', () => {
  let state = ingest(createEmptyWorkspace('ws_archive_test'), [upload('original')]);
  const packetId = state.cases[0].id;
  const gross = state.candidates.find(candidate => candidate.field === 'grossWeight')!;
  assert.ok(gross);
  state = applyAction(state, { type: 'review_field', caseId: packetId, field: 'grossWeight', value: gross.value, candidateId: gross.id, reason: 'Synthetic earlier review.' }, actor);
  state.cases[0].groupingConfirmed = true;
  state.cases[0].status = 'approved';
  state.cases[0].approval = { actor: actor.name, at: '2026-01-01', snapshotId: 'synthetic-frozen-snapshot' };
  const contradictory = upload('later', { pages: [{ page: 1, textSource: 'pdf_text', text: 'PACKING LIST\nGross Weight: 200 KG\nPackages: 2' }] });
  state = ingest(state, [contradictory]);
  const packet = state.cases.find(item => item.id === packetId)!;
  assert.equal(packet.groupingConfirmed, false);
  assert.equal(packet.status, 'review');
  assert.equal(packet.approval, undefined);
  assert.equal(packet.fields.grossWeight.value, gross.value);
  assert.equal(packet.fields.grossWeight.stale, true);
});

test('intake metadata keeps source format provenance and rejects fake manual approvals or unbounded metadata', () => {
  const prepared = {
    name: 'invoice.xlsx', sourcePaths: ['2016/Job One/invoice.xlsx'], referenceOnly: false,
    pages: [{ page: 1, label: 'Sheet: Commercial Invoice', text: 'Synthetic extracted table', textSource: 'office' }],
    extractionStatus: 'extracted',
  };
  assert.deepEqual(parseIntakeMetadata([prepared], [prepared.name])[0], prepared);
  assert.throws(() => parseIntakeMetadata([{ ...prepared, pages: [{ ...prepared.pages[0], textSource: 'manual' }] }], [prepared.name]), /audited/);
  assert.throws(() => parseIntakeMetadata([{ ...prepared, sourcePaths: ['x'.repeat(1501)] }], [prepared.name]));
  assert.throws(() => parseIntakeMetadata([{ ...prepared, approved: true }], [prepared.name]));
  assert.throws(() => sourceCollectionSchema.parse({ ...collection, targetCaseId: 'existing' }));
  assert.throws(() => parseMutation({ revision: 0, action: { type: 'intake', sourceCollection: collection, documents: [] } }));
});

test('archive source formats validate container signatures and retain their actual MIME types', () => {
  const zip = new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]);
  const office = new Uint8Array([208, 207, 17, 224, 161, 177, 26, 225]);
  const tiff = new Uint8Array([73, 73, 42, 0, 0, 0, 0, 0]);
  const xml = new TextEncoder().encode('<?xml version="1.0"?><Synthetic/>');
  assert.equal(acceptedFile('invoice.xlsx', zip).mime, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(acceptedFile('invoice.xls', office).mime, 'application/vnd.ms-excel');
  assert.equal(acceptedFile('contract.docx', zip).mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(acceptedFile('scan.tif', tiff).mime, 'image/tiff');
  assert.equal(acceptedFile('declaration.xml', xml).mime, 'application/xml');
  assert.equal(acceptedFile('archive.zip', zip).mime, 'application/zip');
  assert.throws(() => acceptedFile('invoice.xlsx', office), /ZIP/);
  assert.throws(() => acceptedFile('invoice.xls', zip), /Office/);
  assert.throws(() => acceptedFile('scan.tif', zip), /TIFF/);
  assert.throws(() => acceptedFile('declaration.xml', office), /XML/);
  assert.throws(() => acceptedFile('unexpected.exe', office), /not supported/);
});
