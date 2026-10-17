import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveGuideCandidates, selectGuideCandidates, withinGuideLineTolerance } from '../lib/vnaccs-guide-rules.ts';
import { parseExactDecimal } from '../lib/integrity.ts';
import type { Candidate, DocumentType, ShipmentDocument } from '../lib/types.ts';

const document = (id: string, type: DocumentType): ShipmentDocument => ({ id, caseId: 'case', name: id+'.pdf', type, mime: 'application/pdf', size: 1, sha256: id, active: true, version: 1, uploadedAt: '', synthetic: true, extractionPipeline: 'kimi', extractionStatus: 'extracted', aiProcessedPages: [1], pages: [{ page: 1, text: '', aiReadability: 'clear', documentType: type }] });
const candidate = (doc: string, field: string, value: string, extra: Partial<Candidate> = {}): Candidate => ({ id: `${doc}-${field}-${value}`, caseId: 'case', documentId: doc, documentVersion: 1, page: 1, field, value, originalText: value, location: 'Page 1', confidence: 'high', readability: 'clear', method: 'kimi:test:source_vision_proposal', normalizations: [], ...extra });

test('invoice source rule selects invoice number but retains agreeing corroboration', () => {
  const docs = [document('invoice','invoice'),document('packing','packing_list'),document('contract','contract')];
  const candidates = [candidate('invoice','invoiceNumber','INV-1',{confidence:'medium'}),candidate('packing','invoiceNumber','INV-1',{confidence:'medium'}),candidate('contract','invoiceNumber','INV-OLD')];
  const selected = selectGuideCandidates('invoiceNumber',candidates,docs,candidates);
  assert.deepEqual(selected.candidates.map(c=>c.documentId),['invoice','packing']);
  assert.equal(selected.rule?.section,'1.41');
  assert.equal(candidates.length,3);
});

test('source authority never chooses arbitrarily between two primary invoices', () => {
  const docs = [document('one','invoice'),document('two','invoice'),document('packing','packing_list')];
  const candidates = [candidate('one','invoiceTotal','100'),candidate('two','invoiceTotal','200'),candidate('packing','invoiceTotal','300')];
  assert.deepEqual(selectGuideCandidates('invoiceTotal',candidates,docs,candidates).candidates.map(c=>c.value),['100','200']);
  assert.equal(selectGuideCandidates('grossWeight',candidates.map(c=>({...c,field:'grossWeight'})),docs,candidates).rule,undefined);
});

test('unclear primary source does not silently override another source', () => {
  const docs=[document('invoice','invoice'),document('other','packing_list')];
  const candidates=[candidate('invoice','invoiceNumber','INV-1',{readability:'uncertain'}),candidate('other','invoiceNumber','INV-2')];
  assert.equal(selectGuideCandidates('invoiceNumber',candidates,docs,candidates).candidates.length,2);
});

test('contract seller and transport vessel use the guide while preserving source roles', () => {
  const docs=[document('contract','contract'),document('invoice','invoice'),document('bill','bill_of_lading')];
  const exporters=[candidate('contract','exporter','Seller Ltd'),candidate('invoice','exporter','Agent Ltd')];
  assert.equal(selectGuideCandidates('exporter',exporters,docs,exporters).candidates[0].value,'Seller Ltd');
  const vessels=[candidate('invoice','vessel','OLD'),candidate('bill','vessel','CURRENT')];
  assert.equal(selectGuideCandidates('vessel',vessels,docs,vessels).candidates[0].value,'CURRENT');
});

test('explicit Kimi semantic facts map to guide codes with original evidence IDs', () => {
  const docs=[document('invoice','invoice'),document('bill','bill_of_lading')];
  const source=[candidate('invoice','invoiceDocumentKind','COMMERCIAL INVOICE'),candidate('invoice','importerEntityType','JOINT STOCK COMPANY'),candidate('invoice','exporterEntityType','CO.,LTD'),candidate('bill','transportMethod','BY SEA'),candidate('bill','shipmentLoadType','FCL')];
  const derived=deriveGuideCandidates(source,docs);
  assert.equal(derived.find(c=>c.field==='invoiceForm')?.value,'A');
  assert.equal(derived.find(c=>c.field==='partyClassification')?.value,'4');
  assert.equal(derived.find(c=>c.field==='transportMode')?.value,'2');
  assert.ok(derived.every(c=>source.some(s=>s.id===c.id&&s.originalText===c.originalText)));
  assert.ok(derived.every(c=>c.normalizations.at(-1)?.reason.startsWith('vnaccs-guide:')));
});

test('unknown sea loading and legacy OCR never create guide codes', () => {
  const docs=[document('invoice','invoice'),document('bill','bill_of_lading')];
  assert.deepEqual(deriveGuideCandidates([candidate('bill','transportMethod','BY SEA')],docs),[]);
  assert.deepEqual(deriveGuideCandidates([candidate('invoice','invoiceDocumentKind','COMMERCIAL INVOICE',{method:'browser_local_ocr'})],docs),[]);
  assert.deepEqual(deriveGuideCandidates([candidate('invoice','invoiceTotal','100')],docs),[]);
});

test('guide line tolerance is inclusive and exact beyond floating-point precision', () => {
  const value=parseExactDecimal('9007199254740993')!;
  assert.equal(withinGuideLineTolerance(value,parseExactDecimal('9007199254740994')!),true);
  assert.equal(withinGuideLineTolerance(value,parseExactDecimal('9007199254740994.000000000000000001')!),false);
  assert.equal(withinGuideLineTolerance(value,parseExactDecimal('9007199254740992')!),true);
});

test('unclear contradictory semantic facts cannot disappear before guide code derivation', () => {
  const docs=[document('invoice','invoice'),document('bill','bill_of_lading')];
  const scenarios=[
    [candidate('bill','transportMethod','BY SEA'),candidate('bill','transportMethod','BY AIR',{confidence:'low',readability:'uncertain'}),candidate('bill','shipmentLoadType','FCL')],
    [candidate('invoice','invoiceDocumentKind','COMMERCIAL INVOICE'),candidate('invoice','invoiceDocumentKind','PROFORMA INVOICE',{readability:'uncertain'})],
    [candidate('invoice','importerEntityType','company'),candidate('invoice','exporterEntityType','company'),candidate('invoice','exporterEntityType','individual',{confidence:'low'})],
    [candidate('invoice','invoicePaymentCategory','goods to be paid'),candidate('invoice','invoicePaymentCategory','free of charge',{readability:'uncertain'})],
  ];
  for(const source of scenarios)assert.deepEqual(deriveGuideCandidates(source,docs),[]);
});

test('a derived joint fact requires every dependency to pass the shared evidence check', () => {
  const docs=[document('invoice','invoice')];
  const source=[candidate('invoice','importerEntityType','company'),candidate('invoice','exporterEntityType','company',{confidence:'medium'})];
  const seen:string[]=[];
  assert.deepEqual(deriveGuideCandidates(source,docs,(field,candidates)=>{seen.push(field);return candidates.every(candidate=>candidate.confidence==='high');}),[]);
  assert.deepEqual(seen,['importerEntityType','exporterEntityType']);
  source[1].confidence='high';assert.equal(deriveGuideCandidates(source,docs).find(candidate=>candidate.field==='partyClassification')?.value,'4');
  source.push(candidate('invoice','partyClassification','2',{readability:'uncertain'}));
  assert.ok(!deriveGuideCandidates(source,docs).some(candidate=>candidate.field==='partyClassification'),'An explicit unresolved code is never replaced with a derivation.');
});

test('unclear importer and consignee readings cannot choose a bill silently', () => {
  const docs=[document('invoice','invoice'),document('house','bill_of_lading'),document('master','bill_of_lading')];
  const bills=[candidate('house','houseBillOfLading','HBL-1'),candidate('master','masterBillOfLading','MBL-1')];
  const roles=[candidate('invoice','importer','Buyer Ltd'),candidate('house','houseConsignee','Buyer Ltd'),candidate('master','masterConsignee','Forwarder Ltd')];
  assert.deepEqual(selectGuideCandidates('billOfLading',bills,docs,[...bills,...roles]).candidates,[bills[0]]);
  const conflictingImporter=candidate('invoice','importer','Different Buyer',{confidence:'low',readability:'uncertain'});
  assert.deepEqual(selectGuideCandidates('billOfLading',bills,docs,[...bills,...roles,conflictingImporter]).candidates,bills);
  const conflictingParty=candidate('house','houseConsignee','Different Consignee',{confidence:'low'});
  assert.deepEqual(selectGuideCandidates('billOfLading',bills,docs,[...bills,...roles,conflictingParty]).candidates,bills);
  assert.deepEqual(selectGuideCandidates('billOfLading',bills,docs,[...bills,...roles],()=>false).candidates,bills);
});

test('unread or foreign Kimi facts cannot establish guide-derived codes', () => {
  const source=[candidate('invoice','invoiceDocumentKind','COMMERCIAL INVOICE')];
  const unread=document('invoice','invoice');delete unread.pages[0].aiReadability;
  assert.deepEqual(deriveGuideCandidates(source,[unread]),[]);
  const foreign=document('invoice','invoice');foreign.caseId='another-case';
  assert.deepEqual(deriveGuideCandidates(source,[foreign]),[]);
});

test('clear legal forms inside Kimi party names supply the company classification with original evidence', () => {
  const docs=[document('invoice','invoice'),document('contract','contract')];
  for(const buyer of ['SYNTHETIC JOINT STOCK COMPANY','SYNTHETIC JOINTSTOCKCOMPANY','CÔNG TY SYNTHETIC']) {
    const sources=[candidate('invoice','importer',buyer),candidate('contract','exporter','SYNTHETIC MACHINERY CO.,LTD.')];
    const decisions=deriveGuideCandidates(sources,docs).filter(candidate=>candidate.field==='partyClassification');
    assert.equal(decisions.length,2);assert.ok(decisions.every(candidate=>candidate.value==='4'));
    assert.deepEqual(decisions.map(candidate=>candidate.id),sources.map(candidate=>candidate.id));
    assert.deepEqual(decisions.map(candidate=>candidate.originalText),sources.map(candidate=>candidate.originalText));
  }
});

test('party-name fallback cannot bypass unknown names, uncertainty, conflicting identities or explicit entity-type readings', () => {
  const docs=[document('invoice','invoice'),document('contract','contract')];
  const base=[candidate('invoice','importer','BUYER JOINT STOCK COMPANY'),candidate('contract','exporter','SELLER CO LTD')];
  const scenarios=[
    [candidate('invoice','importer','Nguyen Van A'),base[1]],
    [candidate('invoice','importer','LTDan Nguyen'),base[1]],
    [{...base[0],readability:'uncertain' as const},base[1]],
    [...base,candidate('invoice','importer','OTHER JOINT STOCK COMPANY')],
    [...base,candidate('invoice','importerEntityType','unknown')],
    [...base,candidate('invoice','importerEntityType','company',{confidence:'low'})],
    [...base,candidate('invoice','partyClassification','2')],
  ];
  for(const sources of scenarios)assert.ok(!deriveGuideCandidates(sources,docs).some(candidate=>candidate.field==='partyClassification'));
  assert.ok(!deriveGuideCandidates(base,docs,()=>false).some(candidate=>candidate.field==='partyClassification'));
});
