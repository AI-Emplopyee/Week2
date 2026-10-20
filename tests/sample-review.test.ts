import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localSampleResponse } from '../lib/local-sample-review.ts';
import { sampleFormValue, sampleFieldComparison } from '../lib/sample-review-client.ts';
import { getEcusFormField } from '../lib/ecus-form.ts';
import type { SampleReviewSample } from '../lib/sample-review-types.ts';

test('employee answers never populate AI fields; missing/stale fields remain blank',()=>{
  const sample={shipment:{goods:[],declarationDraft:{schemaVersion:1,fields:[{fieldId:'1.41',applicability:'applicable',stale:false,value:{kind:'reference',reference:'AI-INVOICE'}}]}},comparisons:[{scope:'header',fieldId:'1.41',component:'reference',tab:'general_2',expected:'EMPLOYEE-ANSWER',actual:'AI-INVOICE'}]} as unknown as SampleReviewSample;
  assert.equal(sampleFormValue(sample,getEcusFormField('invoiceNumber')!,0),'AI-INVOICE');
  sample.comparisons[0].expected='CHANGED-GOLD';
  assert.equal(sampleFormValue(sample,getEcusFormField('invoiceNumber')!,0),'AI-INVOICE');
  assert.equal(sampleFormValue(sample,getEcusFormField('customsOffice')!,0),'');
  sample.shipment.declarationDraft.fields[0].stale=true;
  assert.equal(sampleFormValue(sample,getEcusFormField('invoiceNumber')!,0),'');
});

test('goods comparisons follow the frozen printed row, including missing AI rows',()=>{
  const sample={shipment:{goods:[{id:'g1'}],declarationDraft:{schemaVersion:1,fields:[]}},comparisons:[{scope:'goods:2',fieldId:'1.78',component:'text',tab:'goods',expected:'Missing second line',actual:null}]} as unknown as SampleReviewSample;
  const field=getEcusFormField('goodsDescription') || getEcusFormField('description');
  assert.ok(field);
  assert.equal(sampleFieldComparison(sample,field,0),undefined);
  assert.equal(sampleFieldComparison(sample,field,1)?.actual,null);
  assert.equal(sampleFormValue(sample,field,1),'');
});

test('private original endpoint serves verified bytes and denies mutations, traversal, changed files and escaped symlinks',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sample-review-'));
  const directory=path.join(root,'.aicd-local/sample-review');
  const originals=path.join(directory,'originals');
  const bytes=Buffer.from('%PDF-synthetic-original');
  const sha=createHash('sha256').update(bytes).digest('hex');
  const id='source-'+sha;
  try {
    await mkdir(originals,{recursive:true});
    const filename=path.join(originals,sha+'.pdf');
    await writeFile(filename,bytes);
    await writeFile(path.join(directory,'data.json'),JSON.stringify({schemaVersion:1,variants:[]}));
    const asset={path:filename,name:'Original invoice.pdf',mime:'application/pdf',size:bytes.length,sha256:sha,role:'source'};
    const saveIndex=()=>writeFile(path.join(directory,'asset-index.json'),JSON.stringify({schemaVersion:1,assets:{[id]:asset}}));
    await saveIndex();
    const response=await localSampleResponse(root,'GET','/api/local-sample-review/assets/'+id);
    assert.equal(response?.status,200);assert.deepEqual(response?.body,bytes);
    assert.equal(response?.headers['Cache-Control'],'private, no-store');
    assert.equal(response?.headers['Cross-Origin-Resource-Policy'],'same-origin');
    assert.equal((await localSampleResponse(root,'HEAD','/api/local-sample-review/assets/'+id))?.body.length,0);
    assert.equal((await localSampleResponse(root,'POST','/api/local-sample-review'))?.status,405);
    assert.equal((await localSampleResponse(root,'GET','/api/local-sample-review/asset-index.json'))?.status,404);
    assert.equal((await localSampleResponse(root,'GET','/api/local-sample-review/assets/../../.model-comparison.vars'))?.status,404);
    await writeFile(filename,Buffer.alloc(bytes.length,1));
    assert.equal((await localSampleResponse(root,'GET','/api/local-sample-review/assets/'+id))?.status,409);
    const outside=path.join(root,'outside.pdf');await writeFile(outside,bytes);
    const link=path.join(originals,'escape.pdf');await symlink(outside,link);asset.path=link;await saveIndex();
    assert.equal((await localSampleResponse(root,'GET','/api/local-sample-review/assets/'+id))?.status,404);
    assert.equal(await localSampleResponse(root,'GET','/api/workspace'),null);
  } finally { await rm(root,{recursive:true,force:true}); }
});
