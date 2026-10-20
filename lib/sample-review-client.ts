import type { DeclarationDraft } from './declaration-types.ts';
import type { EcusFormField } from './ecus-form.ts';
import { ecusFormValue } from './ecus-form.ts';
import type { SampleReviewComparison, SampleReviewSample } from './sample-review-types.ts';

/** Project only saved AI entries into the existing ECUS form controls.
 * Employee comparison values never participate in this function. */
export function sampleFormValue(sample: SampleReviewSample, field: EcusFormField, goodsIndex: number): string {
  const goods = sample.shipment.goods[goodsIndex];
  if (field.tab === 'goods' && !goods) return '';
  if (field.key === 'goodsSequence') return String(goodsIndex + 1);
  const draft: DeclarationDraft = { schemaVersion:1, fields:sample.shipment.declarationDraft.fields.map(entry => ({
    ...entry, basis:'Frozen source-document draft', reason:'', provenance:[], review:null,
    updatedBy:'', updatedAt:'', codeVerification:'unverified',
  })) };
  const entry = draft.fields.find(e=>e.fieldId===field.fieldId && e.goodsLineId===(field.tab==='goods'?goods?.id:undefined));
  if (entry?.stale || entry?.applicability !== 'applicable') return '';
  return ecusFormValue(field,draft,goods?.id);
}

export function sampleFieldComparison(sample: SampleReviewSample, field: EcusFormField, goodsIndex: number): SampleReviewComparison | undefined {
  const scope = field.tab === 'goods' ? `goods:${goodsIndex+1}` : 'header';
  // A reference set is one measured component, not five independently scored controls.
  if (field.fieldId === '1.26' && (field.rowIndex || 0)>0) return undefined;
  return sample.comparisons.find(c=>c.scope===scope && c.fieldId===field.fieldId && c.component===field.component && c.tab===field.tab);
}
