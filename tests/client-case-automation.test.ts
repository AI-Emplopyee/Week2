import assert from 'node:assert/strict';
import test from 'node:test';
import { runCaseKimi } from '../lib/client-case-automation.ts';
import { createEmptyWorkspace } from '../lib/engine.ts';
import type { ShipmentDocument, WorkspaceResponse } from '../lib/types.ts';
const status = { configured:true, model:'kimi-test',endpoint:'https://api.moonshot.ai/v1',provider:'Moonshot',limits:{maxPages:2,maxTextCharacters:24000,maxCandidates:500} };
const document=(id:string,count:number,caseId='case'):ShipmentDocument=>({id,caseId,name:id+'.pdf',type:'other',mime:'application/pdf',size:1,sha256:id,active:true,version:1,uploadedAt:'',synthetic:true,extractionStatus:'extracted',pages:Array.from({length:count},(_,index)=>({page:index+1,text:'Legacy OCR must not count as read',textSource:'ocr'}))});
const workspace=(documents:ShipmentDocument[]):WorkspaceResponse=>({state:{...createEmptyWorkspace('synthetic-case-automation'),documents},actor:{id:'tester',name:'Tester',email:'tester@example.invalid'},role:'owner',issues:[]});

test('selected-case automatic reading resumes legacy originals, keeps revision, and visits all documents fairly',async()=>{
  const initial=workspace([document('long',3),document('short',1),document('other-case',1,'different')]);
  const calls:{id:string;pages:number[];revision:number}[]=[];
  const result=await runCaseKimi({workspace:initial,caseId:'case',status},{run:async options=>{
    calls.push({id:options.documentId,pages:options.pages!,revision:options.workspace.state.revision});
    return {workspace:{...options.workspace,state:{...options.workspace.state,revision:options.workspace.state.revision+1}},added:1,rejected:0,processed:options.pages!.length};
  }});
  assert.deepEqual(calls,[{id:'long',pages:[1],revision:0},{id:'short',pages:[1],revision:1},{id:'long',pages:[2],revision:2},{id:'long',pages:[3],revision:3}]);
  assert.equal(result.state.revision,4);
  assert.equal(initial.state.revision,0);
});

test('saved Kimi pages and reference-only documents are not reread',async()=>{
  const done=document('done',1);done.extractionPipeline='kimi';done.aiProcessedPages=[1];done.pages[0].aiReadability='clear';
  const reference={...document('reference',1),referenceOnly:true};
  let calls=0;
  await runCaseKimi({workspace:workspace([done,reference]),caseId:'case',status},{run:async()=>{calls++;throw new Error('Must not call provider');}});
  assert.equal(calls,0);
});

test('abort stops processing before a provider call',async()=>{
  const controller=new AbortController();controller.abort();
  let calls=0;
  await assert.rejects(()=>runCaseKimi({workspace:workspace([document('pending',1)]),caseId:'case',status,signal:controller.signal},{run:async()=>{calls++;throw new Error('Must not call provider');}}),/Reading stopped/);
  assert.equal(calls,0);
});

test('a new run retries only rejected original pages once even when the earlier read was marked completed',async()=>{
  const source=document('partial-grounding',3);source.extractionPipeline='kimi';source.aiProcessedPages=[1,2,3];source.aiRejectedPages=[2];
  source.pages.forEach(page=>{page.aiReadability='clear';});
  const initial=workspace([source]);
  const calls:number[][]=[];
  await runCaseKimi({workspace:initial,caseId:'case',status},{run:async options=>{
    calls.push(options.pages!);
    return {workspace:options.workspace,added:0,rejected:1,processed:options.pages!.length};
  }});
  assert.deepEqual(calls,[[2]],'A remaining rejection does not create an unbounded retry loop.');
  source.aiRejectedPages=[];
  await runCaseKimi({workspace:initial,caseId:'case',status},{run:async()=>{throw new Error('Clean processed pages must not be retried.');}});
});
