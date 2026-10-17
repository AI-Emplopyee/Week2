import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyWorkspace } from '../lib/engine.ts';
import { getDeclarationEntry, isDeclarationSourceCurrent } from '../lib/declaration.ts';
import { syncShipmentDeclaration } from '../lib/shipment-autofill.ts';
import type { Candidate, ShipmentCase, ShipmentDocument } from '../lib/types.ts';

const actor={id:'guide-reviewer',name:'Guide reviewer',email:'reviewer@example.invalid'};

test('guide-derived codes preserve original Kimi evidence identities and both joint dependencies',()=>{
  const state=createEmptyWorkspace('guide-evidence');
  const shipment:ShipmentCase={id:'case',reference:'SYNTHETIC-1',title:'Synthetic shipment',status:'review',caseType:'import',assignedTo:'',createdAt:'',updatedAt:'',documentIds:['invoice'],fields:{},goods:[],groupingConfidence:'high',groupingReason:'Synthetic',groupingConfirmed:true,synthetic:true,resolutions:[]};
  const document:ShipmentDocument={id:'invoice',caseId:shipment.id,name:'synthetic-invoice.pdf',type:'invoice',mime:'application/pdf',size:1,sha256:'b'.repeat(64),active:true,version:1,uploadedAt:'',synthetic:true,extractionPipeline:'kimi',extractionStatus:'extracted',aiProcessedPages:[1],pages:[{page:1,text:'',documentType:'invoice',aiReadability:'clear'}]};
  const facts=[['invoiceDocumentKind','COMMERCIAL INVOICE'],['importerEntityType','company'],['exporterEntityType','company']];
  state.cases.push(shipment);state.documents.push(document);
  state.candidates=facts.map(([field,value],index):Candidate=>({id:`original-${index}`,caseId:shipment.id,documentId:document.id,documentVersion:1,page:1,field,value,originalText:`${field}: ${value}`,location:'Original image region',method:'kimi:synthetic_vision',confidence:'high',readability:'clear',normalizations:[],visualEvidence:{imageSha256:'a'.repeat(64),bounds:[0,index*0.2,1,0.2],textAgreement:false}}));
  const original=structuredClone(state.candidates);
  syncShipmentDeclaration(state,shipment,actor);
  assert.deepEqual(state.candidates,original,'Derived working candidates never overwrite or duplicate stored evidence.');
  const form=getDeclarationEntry(shipment.declarationDraft,'1.39')!;
  const parties=getDeclarationEntry(shipment.declarationDraft,'1.7')!;
  assert.deepEqual(form.value,{kind:'code',code:'A'});
  assert.deepEqual(parties.value,{kind:'code',code:'4'});
  assert.deepEqual(form.sourceCandidateIds,['original-0']);assert.deepEqual(parties.sourceCandidateIds,['original-1','original-2']);
  assert.match(parties.basis,/vnaccs-guide:1.7/);assert.equal(parties.provenance.length,2);
  for(const entry of [form,parties])for(const proof of entry.provenance)assert.equal(isDeclarationSourceCurrent(proof,{caseId:shipment.id,documents:state.documents,goods:[],candidates:state.candidates}),true);
  assert.equal(parties.review,null);assert.equal(parties.codeVerification,'unverified');
});
