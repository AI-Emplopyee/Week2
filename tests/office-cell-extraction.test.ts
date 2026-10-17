import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractDocument } from './helpers/legacy-extraction.ts';
import type { ShipmentDocument } from '../lib/types.ts';

const document = (text: string): ShipmentDocument => ({ id:'office_doc',caseId:'case_one',name:'invoice.xlsx',type:'invoice',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',size:100,sha256:'synthetic',version:1,active:true,uploadedAt:'2026-01-01',synthetic:true,extractionStatus:'extracted',pages:[{page:1,label:'Invoice',text,textSource:'office'}] });
test('worksheet labels cannot consume the following row fax/address as importer', () => {
  const result=extractDocument(document('A4: Phone: +00 000 | E4: Consignee:\nA5: Fax: +00 123 | E5: Example Buyer\nA8: Shipped by: | B8: Air | D8: Example Seller'));
  assert.equal(result.candidates.length,0);
});
test('worksheet explicit values preserve cell evidence and remain proposals', () => {
  const result=extractDocument(document('A1: Invoice number: TEST-001\nA2: Currency | B2: USD\nA3: Invoice total: 120.00\nA4: Buyer | B4: Example Buyer Ltd'));
  assert.equal(result.candidates.find(c=>c.field==='importer')?.value,'Example Buyer Ltd');
  assert.equal(result.candidates.find(c=>c.field==='invoiceNumber')?.value,'TEST-001');
  assert.ok(result.candidates.every(c=>c.confidence==='medium'&&c.originalText.includes(':')&&c.location.includes('Invoice')));
  assert.equal(result.goods.length,0);
});
