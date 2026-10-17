import assert from 'node:assert/strict';
import test from 'node:test';
import { DECLARATION_CATALOG, getDeclarationField } from '../lib/declaration-catalog.ts';
import { declarationActionSchema, declarationEntryKey, declarationRemoveActionSchema, declarationValueSchema, emptyDeclarationValue, getDeclarationCoverage, getDeclarationEntry, getDeclarationIssues, invalidateDeclarationDraft, migrateDeclarationDraft, newDeclarationRow, removeDeclarationField, saveDeclarationField, validateDeclarationEntry } from '../lib/declaration.ts';
import type { DeclarationDraft, DeclarationSaveContext, DeclarationValue, SaveDeclarationFieldAction } from '../lib/declaration-types.ts';
import type { GoodsLine, ShipmentDocument } from '../lib/types.ts';

const goods = (id: string): GoodsLine => ({ id, description:'Synthetic item',quantity:'2',unit:'PCS',unitPrice:'50',amount:'100',hsCode:'',origin:'',dutyRate:'',vatRate:'',reviewed:false,manual:false });
const document: ShipmentDocument = { id:'document-1',caseId:'case-1',name:'Synthetic invoice.txt',type:'invoice',mime:'text/plain',size:80,sha256:'synthetic-only',version:1,active:true,uploadedAt:'2026-10-10T00:00:00.000Z',pages:[{page:1,text:'COMMERCIAL INVOICE\nInvoice total: 100.00 USD\nInvoice No: SYNTHETIC-1'}],extractionStatus:'extracted',synthetic:true };
const context: DeclarationSaveContext = { caseId:'case-1',documents:[document],goods:[goods('goods-1'),goods('goods-2')],actor:{id:'reviewer-1',name:'Synthetic Reviewer',email:'reviewer@example.invalid'},at:'2026-10-10T01:00:00.000Z' };
function action(fieldId: string, value: DeclarationValue = emptyDeclarationValue(fieldId), extra: Partial<SaveDeclarationFieldAction> = {}): SaveDeclarationFieldAction {
  return { type:'save_declaration_field',caseId:context.caseId,fieldId,...(getDeclarationField(fieldId)?.scope==='item'?{goodsLineId:'goods-1'}:{}),applicability:'applicable',basis:'Human-confirmed capture basis; legal applicability is not validated.',value,provenance:[{kind:'manual',note:'Checked synthetic source manually.'}],reason:'Record explicit reviewer decision.',review:true,...extra };
}
const save = (draft: DeclarationDraft | undefined, requested: SaveDeclarationFieldAction, ctx = context) => saveDeclarationField(draft,requested,ctx);

test('catalog models all safe source structures, keeps deferred/customs cells blocked and exposes ECUS-oriented grouping', () => {
  assert.equal(DECLARATION_CATALOG.length,96);
  assert.equal(DECLARATION_CATALOG.filter(field=>field.editable).length,90);
  assert.deepEqual(DECLARATION_CATALOG.filter(field=>!field.editable).map(field=>field.id),['1.1','1.46','1.70','1.71','1.72','1.73']);
  for (const field of DECLARATION_CATALOG) {
    assert.ok(field.sourceRefs.length);
    assert.ok(declarationValueSchema.safeParse(emptyDeclarationValue(field.id)).success);
    if (!field.editable) assert.ok(field.blockedReasonEn && field.blockedReasonVi);
  }
  assert.equal(getDeclarationField('1.15')!.kind,'text');
  assert.deepEqual(getDeclarationField('1.22')!.components.map(part=>part.key),['line1','line2','city','country']);
  assert.deepEqual(getDeclarationField('1.44')!.components.map(part=>part.key),['priceCategoryCode','incotermCode','currencyCode','amount']);
  assert.deepEqual(getDeclarationField('1.48')!.blockedComponents.map(part=>part.sourceCell),['Ô 4']);
  assert.equal(getDeclarationField('1.26')!.repeatable,true);
  assert.equal(getDeclarationField('1.49')!.repeatable,true);
  assert.equal(getDeclarationField('1.94')!.repeatable,true);
  assert.equal(getDeclarationField('1.13')!.tab,'general_1');
  assert.equal(getDeclarationField('1.44')!.tab,'general_2');
  assert.equal(getDeclarationField('1.86')!.tab,'goods');
});

test('empty migration invents no values and keeps required ECUS questions without mutating supplied drafts or snapshots', () => {
  const empty = migrateDeclarationDraft();
  assert.deepEqual(empty,{schemaVersion:1,fields:[]});
  assert.equal(getDeclarationIssues(empty,context).filter(issue => issue.id.endsWith(':required')).length,62);
  const original = save(undefined,action('1.13',{kind:'entity',name:'Example Buyer'}));
  const snapshot = structuredClone(original);
  const migrated = migrateDeclarationDraft(original); migrated.fields[0].basis='changed';
  assert.deepEqual(original,snapshot);
  assert.throws(()=>migrateDeclarationDraft({schemaVersion:2,fields:[]} as unknown as DeclarationDraft),/version/);
});

test('strict public schemas exclude review actor/time, unknown shapes and arbitrary customs-system writes', () => {
  const valid = action('1.40',{kind:'reference',reference:'RECORDED-ONLY'});
  assert.ok(declarationActionSchema.safeParse(valid).success);
  for (const extra of [{reviewedBy:'forged'},{updatedAt:'forged'},{codeVerification:'verified'},{review:{actorName:'forged'}}]) assert.equal(declarationActionSchema.safeParse({...valid,...extra}).success,false);
  assert.equal(declarationActionSchema.safeParse({...valid,value:{...valid.value,extra:'unexpected'}}).success,false);
  assert.throws(()=>save(undefined,action('1.1',{kind:'blocked',note:'FAKE-SYSTEM-NUMBER'})),/customs/i);
  assert.throws(()=>save(undefined,action('1.46',{kind:'blocked',note:'invented'})),/guidance/i);
  assert.throws(()=>save(undefined,action('1.44',{kind:'text',text:'100 USD'})),/structure/);
  assert.throws(()=>save(undefined,{...valid,caseId:'another-case'}),/mismatch/);
});

test('unresolved and malformed values remain editable drafts but cannot be reviewed', () => {
  const draftAction = action('1.42',{kind:'date',date:'03/04/2026'},{applicability:'unresolved',basis:'',provenance:[],review:false});
  const draft = save(undefined,draftAction);
  assert.equal(draft.fields[0].value.kind==='date' && draft.fields[0].value.date,'03/04/2026');
  const problems = validateDeclarationEntry(draft.fields[0],context,draft);
  assert.ok(problems.some(problem=>problem.code==='date'));
  assert.ok(problems.some(problem=>problem.code==='applicability'));
  assert.ok(getDeclarationIssues(draft,context).every(issue=>issue.kind==='declaration'));
  assert.throws(()=>save(draft,{...draftAction,review:true}),/Applicability/);
  assert.throws(()=>save(draft,action('1.42',{kind:'date',date:'2026-02-29'})),/calendar/);
  const reviewed = save(draft,action('1.42',{kind:'date',date:'2028-02-29'}));
  assert.equal(reviewed.fields[0].review?.actorId,context.actor.id);
  assert.equal(reviewed.fields[0].updatedBy,context.actor.id);
  assert.deepEqual(getDeclarationIssues(reviewed,context).filter(issue => !issue.id.endsWith(':required')),[]);
});

test('exact number validation preserves source precision and refuses ambiguous counts, exponent notation and negative quantities', () => {
  const precise='9007199254740993.1234567890123456789';
  const reviewed = save(undefined,action('1.85',{kind:'decimal',amount:precise}));
  assert.equal(reviewed.fields[0].value.kind==='decimal' && reviewed.fields[0].value.amount,precise);
  for (const count of ['1,000','1e3','2.5','-1']) assert.throws(()=>save(undefined,action('1.35',{kind:'count',count})),/number/);
  assert.throws(()=>save(undefined,action('1.83',{kind:'quantity',amount:'-2',unitCode:'MANUAL-UNIT'})),/number/);
  assert.throws(()=>save(undefined,action('1.2',{kind:'first_declaration',reference:'F',sequence:'9007199254740994',total:'9007199254740993'})),/sequence/);
});

test('compound coherence is checked without inventing mandatory legal components or code enums', () => {
  assert.doesNotThrow(()=>save(undefined,action('1.48',{kind:'charge',classificationCode:'MANUAL-CLASS',currencyCode:'',amount:''})));
  assert.doesNotThrow(()=>save(undefined,action('1.44',{kind:'invoice',priceCategoryCode:'',incotermCode:'UNVERIFIED-TERM',currencyCode:'',amount:''})));
  assert.doesNotThrow(()=>save(undefined,action('1.49',{kind:'adjustments',rows:[{id:'adjustment-1',itemCode:'',classificationCode:'MANUAL-CLASS',currencyCode:'ABC',amount:'0.00001',allocationFactor:''}]})));
  assert.doesNotThrow(()=>save(undefined,action('1.94',{kind:'tax_rows',rows:[{id:'tax-1',taxCode:'UNVERIFIED-TAX',rateCode:''}]})));
  assert.throws(()=>save(undefined,action('1.44',{kind:'invoice',priceCategoryCode:'',incotermCode:'',currencyCode:'',amount:'100'})),/currency/);
  assert.throws(()=>save(undefined,action('1.47',{kind:'charge',classificationCode:'',currencyCode:'USD',amount:''})),/currency/);
  assert.throws(()=>save(undefined,action('1.83',{kind:'quantity',amount:'2',unitCode:''})),/measurement/);
  const invalid = save(undefined,action('1.44',{kind:'invoice',priceCategoryCode:'',incotermCode:'',currencyCode:'',amount:'100'},{review:false}));
  assert.ok(getDeclarationIssues(invalid,context).some(issue=>issue.description.includes('đồng tiền')));
});

test('not-applicable review needs an explicit basis and preserves entered context without silently clearing it', () => {
  const requested=action('1.39',{kind:'code',code:'REFERENCE-CONTEXT'},{applicability:'not_applicable'});
  const draft=save(undefined,requested);
  assert.deepEqual(draft.fields[0].value,requested.value);
  assert.equal(draft.fields[0].applicability,'not_applicable');
  assert.throws(()=>save(draft,{...requested,basis:''}),/basis/);
  assert.equal(draft.fields[0].codeVerification,'unverified');
});

test('document provenance must match case, active version, selected page and literal quote even for unreviewed saves', () => {
  const provenance={kind:'document' as const,documentId:document.id,documentVersion:1,page:1,quote:'Invoice total: 100.00 USD'};
  const requested=action('1.44',{kind:'invoice',priceCategoryCode:'',incotermCode:'',currencyCode:'USD',amount:'100.00'},{provenance:[provenance]});
  const draft=save(undefined,requested);
  assert.equal(getDeclarationCoverage(draft,context).evidenceBacked,1);
  for (const wrong of [{...provenance,quote:'Invoice total: 1000.00 USD'},{...provenance,documentVersion:2},{...provenance,page:2},{...provenance,documentId:'foreign-document'}]) assert.throws(()=>save(draft,{...requested,provenance:[wrong],review:false}),/Evidence/);
  assert.throws(()=>save(undefined,requested,{...context,documents:[{...document,caseId:'foreign-case'}]}),/Evidence/);
  assert.throws(()=>save(undefined,requested,{...context,documents:[{...document,active:false}]}),/Evidence/);
  const changed={...context,documents:[{...document,version:2}]};
  assert.ok(getDeclarationIssues(draft,changed).some(issue=>issue.description.includes('phiên bản')));
});

test('stable repeating IDs survive reorder and duplicate IDs are rejected before persistence', () => {
  const first=newDeclarationRow('1.26'),second=newDeclarationRow('1.26');assert.notEqual(first.id,second.id);
  const rows=[{id:first.id,reference:'BL-ONE'},{id:second.id,reference:'BL-TWO'}];
  let draft=save(undefined,action('1.26',{kind:'reference_rows',rows}));
  draft=save(draft,action('1.26',{kind:'reference_rows',rows:[rows[1],rows[0]]}));
  assert.equal(draft.fields[0].value.kind==='reference_rows' && draft.fields[0].value.rows[1].id,first.id);
  assert.throws(()=>save(draft,action('1.26',{kind:'reference_rows',rows:[rows[0],rows[0]]},{review:false})),/unique/);
  assert.throws(()=>newDeclarationRow('1.44'),/repeating/);
});

test('tax and adjustment links are bound to stable row IDs and the correct goods line', () => {
  let draft=save(undefined,action('1.94',{kind:'tax_rows',rows:[{id:'tax-1',taxCode:'MANUAL-TAX',rateCode:''}]}));
  draft=save(draft,action('1.95',{kind:'tax_relief_rows',rows:[{id:'relief-1',taxRowId:'tax-1',reliefCode:'MANUAL-RELIEF'}]}));
  assert.throws(()=>save(draft,action('1.95',{kind:'tax_relief_rows',rows:[{id:'relief-2',taxRowId:'tax-1',reliefCode:'MANUAL-RELIEF'}]},{goodsLineId:'goods-2'})),/referenced row/);
  const changed=save(draft,action('1.94',{kind:'tax_rows',rows:[{id:'tax-2',taxCode:'OTHER-TAX',rateCode:''}]}));
  assert.equal(getDeclarationEntry(changed,'1.95','goods-1')!.stale,true);
  assert.ok(validateDeclarationEntry(getDeclarationEntry(changed,'1.95','goods-1')!,context,changed).some(problem=>problem.code==='reference'));
  draft=save(draft,action('1.49',{kind:'adjustments',rows:[{id:'adjustment-1',itemCode:'',classificationCode:'MANUAL',currencyCode:'USD',amount:'10',allocationFactor:''}]}));
  draft=save(draft,action('1.88',{kind:'adjustment_reference',adjustmentRowId:'adjustment-1',reference:'1'}));
  const removed=removeDeclarationField(draft,{type:'remove_declaration_field',caseId:context.caseId,fieldId:'1.49',reason:'Removed after source review.'},context);
  assert.equal(getDeclarationEntry(removed,'1.88','goods-1')!.stale,true);
  assert.ok(getDeclarationIssues(removed,context).some(issue=>issue.field==='1.88'));
});

test('goods identity is preserved across reorder and orphaned entries can be explicitly removed', () => {
  const draft=save(undefined,action('1.83',{kind:'quantity',amount:'2',unitCode:'MANUAL-UNIT'}));
  assert.deepEqual(getDeclarationIssues(draft,{...context,goods:[context.goods[1],context.goods[0]]}).filter(issue => !issue.id.endsWith(':required')),[]);
  const orphanContext={...context,goods:[context.goods[1]]};
  assert.equal(getDeclarationCoverage(draft,orphanContext).orphaned,1);
  assert.ok(getDeclarationIssues(draft,orphanContext).some(issue=>issue.description.includes('không còn')));
  assert.throws(()=>save(draft,action('1.83',{kind:'quantity',amount:'3',unitCode:'MANUAL-UNIT'}),orphanContext),/identity/);
  const remove={type:'remove_declaration_field' as const,caseId:context.caseId,fieldId:'1.83',goodsLineId:'goods-1',reason:'Source goods line intentionally removed.'};
  assert.ok(declarationRemoveActionSchema.safeParse(remove).success);
  const cleared=removeDeclarationField(draft,remove,orphanContext);
  assert.deepEqual(getDeclarationIssues(cleared,orphanContext).filter(issue => !issue.id.endsWith(':required')),[]);
  assert.equal(draft.fields.length,1);
  assert.throws(()=>removeDeclarationField(draft,{...remove,reason:' '},orphanContext),/reason/);
});

test('applicable row references require an applicable populated target, while not-applicable context stays preserved', () => {
  const dependencies: { parent: SaveDeclarationFieldAction; dependent: SaveDeclarationFieldAction; blank: DeclarationValue }[] = [
    { parent: action('1.49',{kind:'adjustments',rows:[{id:'target',itemCode:'',classificationCode:'MANUAL',currencyCode:'',amount:'',allocationFactor:''}]}), dependent: action('1.88',{kind:'adjustment_reference',adjustmentRowId:'target',reference:'1'}), blank: {kind:'adjustments',rows:[{id:'target',itemCode:'',classificationCode:' ',currencyCode:'',amount:'',allocationFactor:''}]} },
    { parent: action('1.94',{kind:'tax_rows',rows:[{id:'target',taxCode:'MANUAL',rateCode:''}]}), dependent: action('1.95',{kind:'tax_relief_rows',rows:[{id:'dependent',taxRowId:'target',reliefCode:'MANUAL'}]}), blank: {kind:'tax_rows',rows:[{id:'target',taxCode:' ',rateCode:''}]} },
    { parent: action('1.94',{kind:'tax_rows',rows:[{id:'target',taxCode:'MANUAL',rateCode:''}]}), dependent: action('1.96',{kind:'tax_amount_rows',rows:[{id:'dependent',taxRowId:'target',amount:'10'}]}), blank: {kind:'tax_rows',rows:[{id:'target',taxCode:'',rateCode:''}]} },
  ];
  for (const {parent,dependent,blank} of dependencies) {
    for (const applicability of ['not_applicable','unresolved'] as const) {
      const draft=save(undefined,{...parent,applicability,review:applicability==='not_applicable'});
      assert.throws(()=>save(draft,dependent),/populated row in an applicable indicator/);
      const unreviewed=save(draft,{...dependent,review:false});
      assert.ok(validateDeclarationEntry(getDeclarationEntry(unreviewed,dependent.fieldId,dependent.goodsLineId)!,context,unreviewed).some(finding=>finding.code==='reference'));
      assert.deepEqual(draft.fields[0].value,parent.value);
      assert.doesNotThrow(()=>save(draft,{...dependent,applicability:'not_applicable'}));
    }
    const emptyTarget=save(undefined,{...parent,value:blank,review:false});
    assert.throws(()=>save(emptyTarget,dependent),/populated row/);
    const populated=save(undefined,parent);
    assert.deepEqual(getDeclarationIssues(save(populated,dependent),context).filter(issue => !issue.id.endsWith(':required')),[]);
  }
});

test('header identity never aliases a literal goods ID named header during lookup or removal', () => {
  assert.notEqual(declarationEntryKey('1.40'),declarationEntryKey('1.40','header'));
  const draft=save(undefined,action('1.40',{kind:'reference',reference:'KEEP-THIS-HEADER'}));
  const original=structuredClone(draft);
  assert.equal(getDeclarationEntry(draft,'1.40','header'),undefined);
  assert.throws(()=>removeDeclarationField(draft,{type:'remove_declaration_field',caseId:context.caseId,fieldId:'1.40',goodsLineId:'header',reason:'Wrong scope.'},context),/not found/);
  assert.deepEqual(draft,original);
  const withGoods=save(draft,action('1.83',{kind:'quantity',amount:'2',unitCode:'PCS'},{goodsLineId:'header'}),{...context,goods:[goods('header')]});
  assert.ok(getDeclarationEntry(withGoods,'1.83','header'));
  assert.equal(getDeclarationEntry(withGoods,'1.83'),undefined);
});

test('long valid legacy goods IDs remain addressable and cannot be confused with header fields', () => {
  const longId='goods-'+ 'x'.repeat(250);
  const ctx={...context,goods:[goods(longId)]};
  const draft=save(undefined,action('1.83',{kind:'quantity',amount:'2',unitCode:'PCS'},{goodsLineId:longId}),ctx);
  assert.equal(draft.fields[0].goodsLineId,longId);
  assert.throws(()=>save(undefined,action('1.13',{kind:'entity',name:'Party'},{goodsLineId:longId}),ctx),/scope/);
});

test('invalidation preserves historic review details and never mutates the previous draft or supplied values', () => {
  const requested=action('1.22',{kind:'address',line1:'Street',line2:'',city:'City',country:'Country'});
  const draft=save(undefined,requested);
  const original=structuredClone(draft);
  if (requested.value.kind==='address') requested.value.line1='MUTATED INPUT';
  const invalidated=invalidateDeclarationDraft(draft,'Source replaced.');
  assert.deepEqual(draft,original);
  assert.equal(invalidated.fields[0].stale,true);
  assert.deepEqual(invalidated.fields[0].review,original.fields[0].review);
  assert.ok(getDeclarationIssues(invalidated,context).some(issue=>issue.description.includes('rà soát lại')));
  assert.equal(getDeclarationCoverage(invalidated,context).reviewed,0);
});

test('coverage distinguishes data modeling, captured/reviewed evidence and unverified legal/vendor dimensions', () => {
  const draft=save(undefined,action('1.74',{kind:'code',code:'ANY-MANUAL-CODE'}));
  const coverage=getDeclarationCoverage(draft,context);
  assert.equal(coverage.total,96);assert.equal(coverage.modeled,90);assert.equal(coverage.editable,90);assert.equal(coverage.blocked,6);assert.equal(coverage.partial,1);
  assert.equal(coverage.sourceSupported,15);assert.equal(coverage.entries,1);assert.equal(coverage.manualReviewed,1);assert.equal(coverage.evidenceBacked,0);
  assert.equal(coverage.currentLawVerified,0);assert.equal(coverage.ecusMapped,0);assert.equal(draft.fields[0].codeVerification,'unverified');
});
