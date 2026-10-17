import assert from 'node:assert/strict';
import test from 'node:test';
import { CORROBORATED_EXPORTER_POLICY, selectCorroboratedExporter } from '../lib/exporter-reconciliation.ts';
import { deriveGuideCandidates, selectGuideCandidates } from '../lib/vnaccs-guide-rules.ts';
import type { Candidate, DocumentType, ShipmentDocument } from '../lib/types.ts';

const document = (id: string, type: DocumentType): ShipmentDocument => ({
  id, caseId: 'case', name: `${id}.pdf`, type, mime: 'application/pdf', size: 1, sha256: id,
  active: true, version: 1, uploadedAt: '', synthetic: true, extractionPipeline: 'kimi',
  extractionStatus: 'extracted', aiProcessedPages: [1],
  pages: [{ page: 1, text: '', aiReadability: 'clear', documentType: type }],
});
const candidate = (documentId: string, field: string, value: string, extra: Partial<Candidate> = {}): Candidate => ({
  id: `${documentId}-${field}`, caseId: 'case', documentId, documentVersion: 1, page: 1, field, value,
  originalText: value, location: 'Page 1', confidence: 'high', readability: 'clear',
  method: 'kimi:test:source_text_proposal', normalizations: [], ...extra,
});
function fixture() {
  const documents = [document('invoice', 'invoice'), document('certificate', 'certificate_of_origin'), document('detail', 'packing_list')];
  const candidates = [
    candidate('invoice', 'exporter', 'SYNTHETIC IMPORT AND EXPORT CO.,LTD'),
    candidate('invoice', 'exporterAddress', '12 Example Road, Port City'),
    candidate('certificate', 'exporter', 'SYNTHETIC IMPORT & EXPORT CO., LTD.', { originalText: "1. Products consigned from (Exporter's business name, address, country)\nSYNTHETIC IMPORT & EXPORT CO., LTD." }),
    candidate('certificate', 'exporterAddress', '12 Example Road\nPort City'),
    candidate('detail', 'exporter', 'SYNTHETIC FACTORY CO., LTD.'),
    candidate('detail', 'exporterAddress', '99 Factory Road'),
  ];
  return { documents, candidates };
}
const strong = (_field: string, values: Candidate[]) => values.length > 0 && values.every(value => value.confidence === 'high' && value.readability === 'clear');
function select(field: string, source = fixture(), clear = strong) {
  return selectCorroboratedExporter(field, source.candidates.filter(candidate => candidate.field === field), source.documents, source.candidates, clear);
}

test('corroborated invoice exporter and address use invoice spelling and preserve original evidence', () => {
  const source = fixture();
  const original = structuredClone(source);
  for (const field of ['exporter', 'exporterAddress']) {
    const result = select(field, source)!;
    assert.equal(result.rule, CORROBORATED_EXPORTER_POLICY);
    assert.equal(result.rule.origin, 'user_policy');
    assert.deepEqual(result.candidates.map(candidate => candidate.documentId), ['invoice', 'certificate']);
    assert.ok(result.candidates.every(candidate => candidate.value === source.candidates.find(value => value.documentId === 'invoice' && value.field === field)!.value));
    assert.deepEqual(new Set(result.supportingCandidates.map(candidate => candidate.id)), new Set(source.candidates.slice(0, 4).map(candidate => candidate.id)));
    for (const projected of result.candidates) {
      const before = source.candidates.find(candidate => candidate.id === projected.id)!;
      assert.equal(projected.originalText, before.originalText);
      assert.equal(projected.documentId, before.documentId);
      assert.equal(projected.page, before.page);
    }
  }
  assert.deepEqual(source, original, 'Selection must not mutate any saved source candidate.');
});

test('previous typography normalization does not replace the invoice display spelling', () => {
  const source = fixture();
  const name = source.candidates[0], original = name.value;
  name.value = source.candidates[2].value;
  name.normalizations.push({ before: original, after: name.value, reason: 'party-typography: equivalent explicit name and address' });
  assert.ok(select('exporter', source)!.candidates.every(candidate => candidate.value === original));
});

test('certificate name needs explicit exporter role instead of an unlabelled name or manufacturer logo', () => {
  for (const quote of ['SYNTHETIC IMPORT & EXPORT CO., LTD.', 'Manufacturer: SYNTHETIC IMPORT & EXPORT CO., LTD.']) {
    const source = fixture();
    source.candidates[2].originalText = quote;
    assert.equal(select('exporter', source), undefined);
    assert.equal(select('exporterAddress', source), undefined);
  }
  for (const label of ['Exporter:', 'Goods consigned from:', 'Người xuất khẩu:', '出口商:']) {
    const source = fixture();
    source.candidates[2].originalText = `${label} ${source.candidates[2].value}`;
    assert.ok(select('exporter', source));
  }
});

test('different primary names, addresses or IDs remain conflicts despite more agreeing copies', () => {
  for (const field of ['exporter', 'exporterAddress', 'exporterCode']) {
    const source = fixture();
    source.documents.push(document('second-invoice', 'invoice'));
    source.candidates.push(candidate('second-invoice', 'exporter', 'SYNTHETIC IMPORT AND EXPORT CO.,LTD'), candidate('second-invoice', 'exporterAddress', '12 Example Road, Port City'));
    if (field === 'exporterCode') {
      source.candidates.push(candidate('invoice', field, 'ID-100'), candidate('certificate', field, 'ID-200'));
    } else source.candidates.find(candidate => candidate.documentId === 'certificate' && candidate.field === field)!.value = field === 'exporter' ? 'OTHER SELLER CO LTD' : '13 Example Road, Port City';
    assert.equal(select('exporter', source), undefined, field);
    assert.equal(select('exporterAddress', source), undefined, field);
  }
});

test('same-entity secondary contradictions and uncertainty cannot be discarded as a different party', () => {
  for (const kind of ['address', 'address-unclear', 'name-unclear', 'code', 'code-unclear']) {
    const source = fixture();
    source.candidates[4].value = source.candidates[0].value;
    source.candidates[5].value = source.candidates[1].value;
    if (kind === 'address') source.candidates[5].value = '88 Different Road';
    if (kind === 'address-unclear') source.candidates[5].readability = 'uncertain';
    if (kind === 'name-unclear') source.candidates[4].confidence = 'low';
    if (kind.startsWith('code')) source.candidates.push(candidate('invoice', 'exporterCode', 'ID-100'), candidate('detail', 'exporterCode', kind === 'code' ? 'ID-200' : 'ID-100', { readability: kind === 'code-unclear' ? 'uncertain' : 'clear' }));
    assert.equal(select('exporter', source), undefined, kind);
    assert.equal(select('exporterAddress', source), undefined, kind);
  }
});

test('low, uncertain, stale or foreign primary readings cannot establish corroboration', () => {
  for (const change of [
    (value: Candidate) => { value.confidence = 'low'; },
    (value: Candidate) => { value.readability = 'uncertain'; },
    (value: Candidate) => { value.documentVersion = 0; },
    (value: Candidate) => { value.caseId = 'another-case'; },
    (value: Candidate) => { value.method = 'browser_local_ocr'; },
  ]) {
    const source = fixture();
    change(source.candidates[2]);
    assert.equal(select('exporter', source), undefined);
  }
  assert.equal(select('exporter', fixture(), () => false), undefined);
});

test('unread primary pages block reconciliation even before they produce a candidate', () => {
  for (const type of ['invoice', 'certificate_of_origin'] as const) {
    const source = fixture();
    const unread = document('unread', type);
    unread.aiProcessedPages = [];
    delete unread.pages[0].aiReadability;
    source.documents.push(unread);
    assert.equal(select('exporter', source), undefined);
  }
});

test('primary address must be linked to its party on the same page and original copies are not corroboration', () => {
  const wrongPage = fixture();
  wrongPage.documents[1].pages.push({ page: 2, text: '', aiReadability: 'clear', documentType: 'certificate_of_origin' });
  wrongPage.documents[1].aiProcessedPages!.push(2);
  wrongPage.candidates[3].page = 2;
  assert.equal(select('exporter', wrongPage), undefined);
  const copies = fixture();
  copies.documents[1].sha256 = copies.documents[0].sha256;
  assert.equal(select('exporter', copies), undefined);
});

test('both invoice and certificate roles are necessary and supplied contracts keep guide authority', () => {
  for (const removed of ['invoice', 'certificate']) {
    const source = fixture();
    source.documents = source.documents.filter(document => document.id !== removed);
    assert.equal(select('exporter', source), undefined);
  }
  const source = fixture();
  source.documents.push(document('contract', 'contract'));
  assert.equal(select('exporter', source), undefined, 'An unread or empty contract must not be bypassed.');
  source.candidates.push(candidate('contract', 'exporter', 'CONTRACT SELLER CO LTD'));
  const result = selectGuideCandidates('exporter', source.candidates.filter(candidate => candidate.field === 'exporter'), source.documents, source.candidates);
  assert.equal(result.rule?.id, 'vnaccs-guide:1.20');
  assert.deepEqual(result.candidates.map(candidate => candidate.value), ['CONTRACT SELLER CO LTD']);
});

test('party classification retains the corroboration dependencies and stops when they fail', () => {
  const source = fixture();
  source.candidates.push(candidate('invoice', 'importer', 'SYNTHETIC BUYER JOINT STOCK COMPANY'));
  const derived = deriveGuideCandidates(source.candidates, source.documents).filter(candidate => candidate.field === 'partyClassification');
  assert.ok(derived.length > 0);
  assert.ok(derived.every(candidate => candidate.value === '4'));
  assert.deepEqual(new Set(derived.map(candidate => candidate.id)), new Set([...source.candidates.slice(0, 4), source.candidates.at(-1)!].map(candidate => candidate.id)));
  assert.ok(derived.some(candidate => candidate.normalizations.some(change => change.reason.startsWith(CORROBORATED_EXPORTER_POLICY.id))));
  for (const candidate of derived) assert.equal(candidate.originalText, source.candidates.find(source => source.id === candidate.id)!.originalText);
  source.candidates[3].value = '88 Different Road';
  assert.ok(!deriveGuideCandidates(source.candidates, source.documents).some(candidate => candidate.field === 'partyClassification'));
});
