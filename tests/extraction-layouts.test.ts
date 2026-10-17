import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDocument, classifyPage, derivePageTypes, documentHasType, extractDocument, normalizeValue } from './helpers/legacy-extraction.ts';
import { createEmptyWorkspace, getIssues, getProposedFields } from '../lib/engine.ts';
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import type { ShipmentDocument, SourcePage } from '../lib/types.ts';

// Entirely synthetic, deliberately varied supplier-independent layouts. No client sample data.
function doc(name: string, pages: SourcePage[]): ShipmentDocument {
  return { id: name, caseId: 'case', name, type: classifyDocument(name, pages.map(p => p.text).join('\n')), mime: 'application/pdf', size: 1, sha256: name, version: 1, active: true, uploadedAt: '2026-10-10T00:00:00Z', synthetic: true, extractionStatus: 'extracted', pages };
}
const actor = { id: 'test', name: 'Synthetic Reviewer', email: 'reviewer@example.invalid' };

test('mixed invoice/packing PDF has page types and packing packages never become commercial quantities', () => {
  const d = doc('CI+PL.pdf', [
    { page: 1, text: 'North River Demo Co.,Ltd.\nCOMMERCIAL INVOICE\nTO: Demo Buyer\tINVOICE No.: DEMO-88\nInvoice Date: Apr. 09.2026\nNo.\tDescription\tQTY\tUNIT\tUnit Price (USD)\tAmount (USD)\n1\tFarm equipment\t3\tSET\t2000.00\t6000.00\nTotal Amount\t6000.00', textSource: 'ocr', ocrConfidence: .91 },
    { page: 2, text: 'PACKING LIST\nInvoice Number: DEMO-88\nNo. | Description | QTY (PACKAGE) | G.W. (KG) | N.W. (KG)\n1 | Farm equipment | 90 | 1300 | 1100\n | TOTAL | 90 | 1300 | 1100', textSource: 'ocr', ocrConfidence: .91 },
  ]);
  derivePageTypes(d); assert.equal(d.pages[0].documentType, 'invoice'); assert.equal(d.pages[1].documentType, 'packing_list');
  assert.ok(documentHasType(d, 'invoice')); assert.ok(documentHasType(d, 'packing_list'));
  const result = extractDocument(d); assert.equal(result.goods.length, 1); assert.equal(result.goods[0].quantity, '3'); assert.equal(result.goods[0].unit, 'SET');
  assert.equal(result.candidates.filter(c => c.page === 2 && c.field === 'quantity').length, 0); assert.ok(result.candidates.some(c => c.page === 2 && c.field === 'packageCount' && c.value === '90'));
  const state = applyAction(createEmptyWorkspace('test'), { type: 'intake', documents: [d] }, actor);
  assert.equal(getIssues(state).some(i => i.id.includes('missing-packing')), false);
  assert.equal(getIssues(state).some(i => i.title.includes('quantity')), false);
  assert.ok(state.documents[0].pages.every(p => p.documentType));
});

test('inline OCR columns split at explicit labels instead of appending invoice number to importer', () => {
  const d = doc('scan.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nTO: DEMO IMPORT COMPANY INVOICE No.: XYZ-2026-8\nStreet and country INVOICE DATE: Apr. 09.2026\nPhone number: 010000 CONTRACT NO.: CONTRACT-DEMO-8', textSource: 'ocr', ocrConfidence: .9 }]);
  const r = extractDocument(d).candidates;
  assert.equal(r.find(c => c.field === 'importer')!.value, 'DEMO IMPORT COMPANY');
  assert.equal(r.find(c => c.field === 'invoiceNumber')!.value, 'XYZ-2026-8');
  assert.equal(r.find(c => c.field === 'invoiceDate')!.value, '2026-04-09');
  assert.equal(r.find(c => c.field === 'contractNumber')!.value, 'CONTRACT-DEMO-8');
  assert.ok(r.every(c => c.confidence !== 'high')); assert.ok(r.every(c => c.method.includes('ocr')));
});

test('wrapped invoice descriptions and numeric tail retain full evidence without quantity-note duplication', () => {
  const d = doc('invoice.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nUnit Price Amount\nNo. Description QTY UNIT (EUR) (EUR)\nModular water system (60m)\n1 QUANTITY: 3 SET 3 SET 2000.00 6000.00\n| Total Amount 6000.00', textSource: 'ocr', ocrConfidence: .91 }]);
  const r = extractDocument(d); assert.equal(r.goods.length, 1); const line = r.goods[0];
  assert.equal(line.description, 'Modular water system (60m)'); assert.equal(line.quantity, '3'); assert.equal(line.unit, 'SET'); assert.equal(line.unitPrice, '2000.00'); assert.equal(line.amount, '6000.00');
  assert.match(line.originalText!, /Modular water system/); assert.match(line.originalText!, /QUANTITY: 3 SET/);
  assert.equal(r.candidates.find(c => c.field === 'invoiceTotal')!.value, '6000.00'); assert.equal(r.candidates.find(c => c.field === 'currency')!.value, 'EUR');
});

test('packing totals require explicit package and weight headers, never infer price/amount columns', () => {
  const d = doc('packing-list.pdf', [{ page: 1, text: 'PACKING LIST\nNo. Description QTY GW. NW. Volume\n(PACKAGE) (KG) (KG) (CBM)\nTOTAL 90 1300.00 | 1100.00 8', textSource: 'ocr', ocrConfidence: .9 }]);
  const r = extractDocument(d); assert.equal(r.goods.length, 0);
  assert.equal(r.candidates.find(c => c.field === 'packageCount')!.value, '90'); assert.equal(r.candidates.find(c => c.field === 'grossWeight')!.value, '1300.00'); assert.equal(r.candidates.find(c => c.field === 'netWeight')!.value, '1100.00');
  assert.equal(r.candidates.filter(c => c.field === 'invoiceTotal').length, 0);
});

test('house/master B/L identifiers and transport parties remain distinct from commercial parties', () => {
  const h = doc('HBL-copy.pdf', [{ page: 1, text: 'BILL OF LADING\nB/L No.: HOUSE-DEMO-12\nManifest No.: BOOK-DEMO-12\nShipper: Demo Supplier\nConsignee: TO ORDER OF DEMO BANK\nPackages: 12\nGross Weight (kg): 100\nVessel: SYNTHETIC SHIP', textSource: 'ocr', ocrConfidence: .9 }]);
  const m = doc('carrier-MBL.pdf', [{ page: 1, text: 'BILL OF LADING\nB/L No.: MASTER-DEMO-77\nS/O No: BOOK-DEMO-12\nShipper: Demo Forwarder\nConsignee: Demo Destination Agent\nPackages: 12\nGross Weight (kg): 100\nVessel: SYNTHETIC SHIP', textSource: 'pdf_text' }]);
  const hr = extractDocument(h).candidates, mr = extractDocument(m).candidates;
  assert.equal(hr.find(c => c.field === 'houseBillOfLading')!.value, 'HOUSE-DEMO-12'); assert.equal(mr.find(c => c.field === 'masterBillOfLading')!.value, 'MASTER-DEMO-77');
  assert.equal(hr.find(c => c.field === 'houseShipper')!.value, 'Demo Supplier'); assert.equal(mr.find(c => c.field === 'masterShipper')!.value, 'Demo Forwarder');
  assert.equal(hr.some(c => ['importer', 'exporter', 'billOfLading'].includes(c.field)), false); assert.equal(mr.some(c => ['importer', 'exporter', 'billOfLading'].includes(c.field)), false);
  const state = applyAction(createEmptyWorkspace('test'), { type: 'intake', documents: [h, m] }, actor);
  assert.equal(state.cases.length, 1);
  assert.equal(getIssues(state).some(i => i.kind === 'conflict' && /shipper|consignee/i.test(i.field || '')), false);
  assert.ok(getIssues(state).some(i => i.kind === 'conflict' && i.field === 'billOfLading'), 'Neither consignee matches an importer, so the declaration bill remains a question.');
});

test('paired transport headers require two explicit identifiers and reject unrelated label text', () => {
  const d = doc('HBL.pdf', [{ page: 1, text: 'BILL OF LADING\nMANIFEST NO. BILL OF LADING NO.\nBOOK-DEMO-8\n\nHOUSE-DEMO-8\nEXPORT REFERENCES\nPORT OF DISCHARGE PLACE OF DELIVERY\nCONTAINER & SEAL NUMBERS', textSource: 'ocr', ocrConfidence: .65 }]);
  const r = extractDocument(d).candidates;
  assert.equal(r.find(c => c.field === 'houseBillOfLading')!.value, 'HOUSE-DEMO-8'); assert.equal(r.find(c => c.field === 'transportReference')!.value, 'BOOK-DEMO-8');
  assert.equal(r.some(c => ['portOfDischarge', 'container'].includes(c.field)), false); assert.ok(r.every(c => c.confidence === 'low'));
});

test('multiple container identifiers are one set and cannot conflict with themselves', () => {
  const d = doc('HBL.pdf', [{ page: 1, text: 'BILL OF LADING\nAAAA1234567/SEAL123\nBBBB7654321/SEAL999\nAAAA1234567/SEAL123', textSource: 'ocr', ocrConfidence: .9 }]);
  const r = extractDocument(d).candidates.filter(c => c.field === 'container'); assert.equal(r.length, 1); assert.equal(r[0].value, 'AAAA1234567, BBBB7654321');
});

test('equal explicit decimal values do not manufacture weight conflicts', () => {
  const invoice = doc('invoice.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: NUM-1\nImporter: Synthetic Buyer\nGross Weight: 1300.00' }]);
  const packing = doc('packing.pdf', [{ page: 1, text: 'PACKING LIST\nInvoice Number: NUM-1\nImporter: Synthetic Buyer\nGross Weight: 1300.000' }]);
  const state = applyAction(createEmptyWorkspace('test'), { type: 'intake', documents: [invoice, packing] }, actor);
  assert.equal(getIssues(state).some(i => i.kind === 'conflict' && i.field === 'grossWeight'), false);
  assert.equal(getProposedFields(state, state.cases[0].id).grossWeight, '1300.00');
});

test('month names normalize unambiguously, low OCR confidence remains low and customs values stay blank', () => {
  assert.equal(normalizeValue('invoiceDate', 'Apr. 09.2026').value, '2026-04-09');
  const d = doc('invoice.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: LOW1\nDescription | Quantity | Unit | Amount | HS Code | Origin\nDemo article | 1 | EA | 40 | 123456 | DEMO COUNTRY', textSource: 'ocr', ocrConfidence: .3 }]);
  const r = extractDocument(d); assert.ok(r.candidates.every(c => c.confidence === 'low')); assert.equal(r.goods[0].hsCode, ''); assert.equal(r.goods[0].origin, '');
});

test('document labels are detected from headings without treating a reference as a second document', () => {
  assert.equal(classifyPage('COMMERCIAL INVOICE\nBill of Lading Number: REF123'), 'invoice');
  assert.equal(classifyPage('Invoice Number: REF123'), 'other');
  assert.equal(classifyDocument('PKL Detail.pdf', ''), 'packing_list');
  assert.equal(classifyDocument('CO-FE.pdf', ''), 'certificate_of_origin');
});

test('two-row column headers bind currency subheadings to preceding price/amount columns', () => {
  const d = doc('invoice.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nUnit Price\tAmount\nNo.\tDescription\tQTY\tUNIT\t(USD)\t(USD)\nSynthetic pump assemblies\n1\tQUANTITY: 2 SET\t2\tSET\t150.00\t300.00\n|\tTotal Amount\t300.00', textSource: 'ocr', ocrConfidence: .94 }]);
  const r = extractDocument(d); assert.equal(r.goods.length, 1);
  assert.equal(r.goods[0].description, 'Synthetic pump assemblies'); assert.equal(r.goods[0].quantity, '2'); assert.equal(r.goods[0].unit, 'SET'); assert.equal(r.goods[0].unitPrice, '150.00'); assert.equal(r.goods[0].amount, '300.00');
  assert.equal(r.candidates.find(c => c.field === 'currency')!.value, 'USD');
});

test('reviewer transcription replaces OCR provenance only for edited pages', () => {
  const d = doc('invoice.pdf', [{ page: 1, text: 'COMMERCIAL INVOICE\nInvoice Number: OCR-DEMO', textSource: 'ocr', ocrConfidence: .9 }, { page: 2, text: 'Invoice Total: 10', textSource: 'ocr', ocrConfidence: .3 }]);
  let state = applyAction(createEmptyWorkspace('test'), { type: 'intake', documents: [d] }, actor);
  state = applyAction(state, { type: 'transcribe_document', documentId: d.id, pages: [{ page: 2, text: 'Invoice Total: 12' }], reason: 'Checked the original page.' }, actor);
  assert.equal(state.documents[0].pages[0].textSource, 'ocr'); assert.equal(state.documents[0].pages[0].ocrConfidence, .9);
  assert.equal(state.documents[0].pages[1].textSource, 'manual'); assert.equal(state.documents[0].pages[1].ocrConfidence, undefined);
  const current = state.candidates.filter(c => c.documentVersion === 2 && c.page === 2);
  assert.ok(current.every(c => c.method.startsWith('manual_transcription') && !c.method.includes('ocr') && c.confidence === 'low'));
});
