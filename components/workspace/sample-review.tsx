"use client";

import { useEffect, useState } from 'react';
import { ArrowUpRight, CheckCheck, FileText, FlaskConical, Loader2 } from 'lucide-react';
import { ECUS_FORM_FIELDS, type EcusFormField } from '@/lib/ecus-form';
import { useLocale } from '@/lib/i18n';
import { sampleFieldComparison, sampleFormValue } from '@/lib/sample-review-client';
import type { SampleReviewAsset, SampleReviewComparison, SampleReviewData, SampleReviewMetric } from '@/lib/sample-review-types';

const tabs = [{id:'general_1',label:'Thông tin chung'}, {id:'general_2',label:'Thông tin chung 2'}, {id:'goods',label:'Danh sách hàng'}] as const;
const pct = (n:number|null|undefined)=>n==null?'—':`${(n*100).toFixed(2)}%`;
const display = (value:SampleReviewComparison['actual'])=>Array.isArray(value)?value.join(' · '):value ?? '—';
const assetUrl = (id:string)=>`/api/local-sample-review/assets/${encodeURIComponent(id)}`;

export function SampleReview() {
  const { locale }=useLocale();
  const say=(vi:string,en:string)=>locale==='en'?en:vi;
  const [data,setData]=useState<SampleReviewData|null>(null);
  const [error,setError]=useState('');
  const [variantId,setVariant]=useState('glm53-flash-low');
  const [packetId,setPacket]=useState('');
  const [tab,setTab]=useState<EcusFormField['tab']>('general_1');
  const [goodsIndex,setGoodsIndex]=useState(0);
  const [differencesOnly,setDifferencesOnly]=useState(false);
  const [expectedVisible,setExpectedVisible]=useState(true);
  const [focused,setFocused]=useState<SampleReviewComparison|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/local-sample-review',{signal:controller.signal,cache:'no-store'}).then(async response=>{
      if(!response.ok) throw new Error('Sample results are unavailable.');
      const result=await response.json() as SampleReviewData;
      if(result.schemaVersion!==1 || !Array.isArray(result.variants)) throw new Error('Invalid sample data.');
      setData(result);
    }).catch(e=>{if(e.name!=='AbortError')setError('The saved sample results could not be loaded.');});
    return ()=>controller.abort();
  },[]);
  const variant=data?.variants.find(v=>v.id===variantId) || data?.variants[0];
  const sample=variant?.samples.find(s=>s.packetId===packetId) || variant?.samples[0];
  const reset=()=>{setGoodsIndex(0);setFocused(null);};
  if(error) return <section className="sample-review"><div className="error-banner" role="alert">{say('Không tải được kết quả mẫu đã lưu.','The saved sample results could not be loaded.')}</div></section>;
  if(!data || !variant || !sample) return <section className="sample-review"><Loader2 className="spin"/><p>{say('Đang tải biểu mẫu đã điền…','Loading filled sample forms…')}</p></section>;
  const overall=variant.metrics.visible;
  const current=sample.metrics.visible;
  const goodsCount=Math.max(sample.shipment.goods.length,...sample.comparisons.map(c=>c.printRowIndex===null?0:c.printRowIndex+1),1);
  const fields=ECUS_FORM_FIELDS.filter(f=>f.tab===tab).filter(f=>{
    const comparison=sampleFieldComparison(sample,f,goodsIndex);
    return !differencesOnly || (!!comparison && !['exact_match','reviewed_equivalent'].includes(comparison.contentStatus));
  });
  const sections=[...new Set(fields.map(f=>f.section))];
  const statusText=(comparison?:SampleReviewComparison)=>{
    switch(comparison?.contentStatus){
      case 'exact_match':return say('Khớp chính xác','Exact match');
      case 'reviewed_equivalent':return say('Tương đương đã rà soát','Reviewed equivalent');
      case 'reviewed_not_equivalent':return say('Khác — đã rà soát','Different · reviewed');
      case 'unreviewed_mismatch':return say('Khác — cần rà soát','Different · needs review');
      case 'missing':return say('Thiếu giá trị AI','AI value missing');
      default:return say('Chưa đo lường','Not measured');
    }
  };
  const assets=(items:SampleReviewAsset[])=>items.map(asset=><a key={asset.id} href={assetUrl(asset.id)} target="_blank" rel="noreferrer" className="sample-asset"><FileText size={15}/><span>{asset.name}</span><ArrowUpRight size={14}/></a>);
  const score=(label:string,metric:SampleReviewMetric)=><span><strong>{pct(metric.contentAgreement)}</strong> {label}<small>{metric.contentCorrect}/{metric.eligible}</small></span>;
  const inventoryExcluded=data.inventory.filter(p=>!p.eligible);
  const exclusionLabel=(status:string)=>({
    non_import_collection:say('Không phải lô hàng nhập khẩu','Not an import collection'),
    no_primary_sources:say('Thiếu chứng từ nguồn chính','No primary source documents'),
    no_supported_import_answer_key:say('Chưa hỗ trợ mẫu đáp án nhập khẩu','Unsupported import answer format'),
  }[status] || status);
  const formField=(field:EcusFormField)=>{
    const value=sampleFormValue(sample,field,goodsIndex);
    const comparison=sampleFieldComparison(sample,field,goodsIndex);
    const state=comparison?.contentStatus || 'unmeasured';
    const id=`sample-${field.key}-${field.tab==='goods'?goodsIndex:'header'}`;
    return <div className={`sample-field sample-field-${state} ${field.input==='long_text'?'sample-field-wide':''}`} key={field.key} data-field-key={field.key}>
      <label htmlFor={id}>{field.labelVi}{locale==='en' && <small>{field.labelEn}</small>}</label>
      {field.input==='long_text'?<textarea id={id} value={value} readOnly rows={3} placeholder={say('Để trống — chưa có giá trị được hỗ trợ','Blank · no supported value')}/>:<input id={id} value={value} readOnly placeholder={say('Để trống','Blank')}/>}
      <div className="sample-field-status"><span className={`sample-status ${state}`}>{statusText(comparison)}</span>{comparison && <button type="button" onClick={()=>setFocused(comparison)} aria-label={`${say('Chi tiết so sánh','Compare')} ${field.labelEn}`}>{say('Chi tiết','Details')}</button>}</div>
      {comparison && expectedVisible && <div className="sample-expected"><b>ToKhai:</b> {display(comparison.expected)}{Array.isArray(comparison.expected) && <small>{say('So sánh toàn bộ danh sách một lần.','The complete list is scored once.')}</small>}</div>}
    </div>;
  };
  return <section className="sample-review">
    <header className="sample-heading"><div><div className="eyebrow"><FlaskConical size={16}/>{say('KIỂM THỬ MẪU · CHỨNG TỪ GỐC','SAMPLE TESTS · ORIGINAL DOCUMENTS')}</div><h1>{say('Biểu mẫu AI & đối chiếu ToKhai','AI-filled forms & ToKhai comparison')}</h1><p>{say('Xem ba biểu mẫu được điền từ kết quả AI đã lưu. Giá trị thiếu vẫn để trống; đáp án nhân viên chỉ dùng để đối chiếu.','Inspect all three forms filled from saved AI results. Missing values stay blank; employee answers are used only for comparison.')}</p></div><span className="sample-draft-label">{say('Bản nháp · chưa nộp','Drafts · not submitted')}</span></header>
    <div className="sample-selectors"><label>{say('Kết quả mô hình','Model results')}<select value={variant.id} onChange={e=>{setVariant(e.target.value);reset();}}>{data.variants.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label><label>{say('Lô hàng mẫu','Sample shipment')}<select value={sample.packetId} onChange={e=>{setPacket(e.target.value);reset();}}>{variant.samples.map(s=><option key={s.packetId} value={s.packetId}>{s.label}</option>)}</select></label></div>
    <div className="sample-score-grid">
      <article><span>{say('Độ khớp nội dung','Content agreement')}</span><strong>{pct(overall.contentAgreement)}</strong><small>{overall.contentCorrect}/{overall.eligible} {say('thành phần so sánh','comparable components')}</small></article>
      <article><span>{say('Độ khớp chính xác','Exact agreement')}</span><strong>{pct(overall.exactAgreement)}</strong><small>{overall.exactMatches}/{overall.eligible}</small></article>
      <article><span>{say('Tỷ lệ có giá trị','Filled coverage')}</span><strong>{pct(overall.filledCoverage)}</strong><small>{overall.filled} {say('có giá trị','filled')} · {overall.missing} {say('còn thiếu','missing')}</small></article>
      <article><span>{say('Phạm vi kết quả','Result scope')}</span><strong>{variant.sampleCount} {say('lô hàng','shipments')}</strong><small>{variant.id==='kimi-k26'?say('18 phát triển + 11 kiểm tra riêng','18 development + 11 held-out'):say('Thử nghiệm 4 mẫu liên quan','Pilot of 4 related samples')}</small></article>
    </div>
    <p className="sample-scope-note">{say('Các điểm trên tính trên những thành phần có thể so sánh của cả ba biểu mẫu, bao gồm giá trị còn thiếu. Mẫu GLM không đại diện cho toàn bộ 29 lô hàng. Mục tiêu 90% chưa đạt.','Scores cover comparable components across all three forms, including missing values. The GLM pilot does not represent all 29 shipments. The 90% target has not been met.')}</p>
    {variant.id!=='kimi-k26' && <p className="sample-scope-note">{say('Kimi trước đây trên cùng 4 mẫu','Earlier Kimi results on these same 4 samples')}: <strong>{pct(data.historicalPilotReference.visible.contentAgreement)}</strong>. {say('Đây là dữ liệu tham chiếu từ lần chạy trước; lượt Kimi đối chứng mới chưa chạy.','This is a historical reference; the fresh Kimi control has not run.')}</p>}
    <section className="sample-packet-summary"><div><h2>{sample.label}</h2><p>{say('Điểm lô hàng này','This shipment')}: <strong>{pct(current.contentAgreement)}</strong> · {current.contentCorrect}/{current.eligible} {say('khớp nội dung','content matches')} · {current.missing} {say('thiếu','missing')}</p></div><div className="sample-reading"><span>{sample.readingStatus==='complete'?say('Đọc nguồn: đã qua kiểm tra','Source reading: checks passed'):say('Đọc nguồn: còn thiếu / cần rà soát','Source reading: incomplete / needs review')}</span><small>{sample.failures.length} {say('lỗi trang đã lưu','saved page failures')} · {sample.population==='holdout'?say('Mẫu kiểm tra riêng','Held-out sample'):say('Mẫu phát triển','Development sample')}</small></div></section>
    <div className="sample-form-scores">{tabs.map(t=><div key={t.id}>{score(t.label,sample.metrics.byForm[t.id])}</div>)}</div>
    <details className="sample-documents"><summary>{say('Chứng từ gốc & đáp án ToKhai','Original documents & employee ToKhai')} <span>{sample.originalAssets.length} + {sample.employeeAssets.length} {say('tệp','files')}</span></summary><div className="sample-document-columns"><section><h3>{say('Chứng từ AI đã đọc','Supporting originals read by AI')}</h3>{assets(sample.originalAssets)}</section><section><h3>{say('ToKhai nhân viên · chỉ đối chiếu','Employee ToKhai · comparison only')}</h3>{assets(sample.employeeAssets)}</section></div></details>
    <div className="sample-form-toolbar"><div className="sample-tabs" role="tablist" aria-label="ECUS forms">{tabs.map(t=><button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>{setTab(t.id);setFocused(null);}}>{t.label}</button>)}</div><div className="sample-options"><label><input type="checkbox" checked={expectedVisible} onChange={e=>setExpectedVisible(e.target.checked)}/>{say('Hiện đáp án ToKhai','Show ToKhai answers')}</label><label><input type="checkbox" checked={differencesOnly} onChange={e=>setDifferencesOnly(e.target.checked)}/>{say('Chỉ hiện khác / thiếu','Differences / missing only')}</label></div></div>
    <div className="sample-form-caption"><CheckCheck size={16}/>{say('Giá trị trong ô là bản nháp AI đã lưu. Đáp án nhân viên nằm riêng bên dưới; không được chép vào biểu mẫu.','Inputs contain saved AI draft values. Employee answers appear separately below and are never copied into the form.')}</div>
    {tab==='goods' && <label className="sample-goods-select">{say('Dòng hàng','Goods row')}<select value={goodsIndex} onChange={e=>{setGoodsIndex(Number(e.target.value));setFocused(null);}}>{Array.from({length:goodsCount},(_,index)=><option key={index} value={index}>{index+1}. {sample.shipment.goods[index]?.description || say('Chưa có dòng hàng AI','AI goods row missing')}</option>)}</select><small>{sample.shipment.goods.length} {say('dòng hàng AI','AI goods rows')} · {sample.extraGoodsRows??'—'} {say('dòng thêm ngoài đáp án','extra rows beyond answers')}</small></label>}
    <div role="tabpanel" aria-label={tabs.find(t=>t.id===tab)?.label} className="sample-form">{sections.map(section=>{const group=fields.filter(f=>f.section===section);return <fieldset key={section}><legend>{locale==='en'?group[0].sectionEn:group[0].sectionVi}</legend><div className="sample-form-grid">{group.map(formField)}</div></fieldset>;})}{!sections.length && <p>{say('Không có giá trị khác hoặc thiếu trong phần này.','No differences or missing comparisons in this section.')}</p>}</div>
    {focused && <aside className="sample-comparison-detail" aria-label={say('Chi tiết đối chiếu','Comparison details')}><button className="sample-close-detail" onClick={()=>setFocused(null)}>{say('Đóng','Close')} ×</button><h3>{statusText(focused)} · {focused.fieldId}.{focused.component}</h3><dl><dt>{say('Bản nháp AI','AI draft')}</dt><dd>{display(focused.actual)}</dd><dt>ToKhai</dt><dd>{display(focused.expected)}</dd><dt>{say('Vị trí đáp án','Answer location')}</dt><dd>{focused.answerLocation.assetId?<a href={assetUrl(focused.answerLocation.assetId)} target="_blank" rel="noreferrer">{focused.answerLocation.sourceFile}</a>:focused.answerLocation.sourceFile} · {focused.answerLocation.sheet} · {focused.answerLocation.cell}</dd></dl>{focused.review && <p>{focused.review.reason}</p>}<small>{say('Tương đương nội dung là rà soát nội bộ có AI hỗ trợ, chưa phải xác nhận độc lập của con người.','Equivalent content uses AI-assisted internal review, not independent human validation.')}</small></aside>}
    <details className="sample-method"><summary>{say('Cách tính điểm & giới hạn','Scoring and limitations')}</summary><p>{say('Độ khớp nội dung = (khớp chính xác + tương đương đã rà soát) / tất cả thành phần có đáp án hợp lệ. Giá trị thiếu và khác chưa rà soát không được cộng điểm. Các ô “Chưa đo lường” không được tính là đúng.','Content agreement = (exact matches + reviewed equivalents) / all eligible answer components. Missing values and unreviewed differences receive no credit. “Not measured” controls are not counted as correct.')}</p><p>{say('Đối chiếu hàng hóa theo thứ tự dòng bản in; một số nhân viên gộp nhiều dòng hóa đơn. Bản nháp giữ dòng nguồn, nên khác dòng chưa chắc là lỗi đọc.','Goods use printed-row alignment; some employee declarations combine several invoice rows. Drafts retain source rows, so a row difference does not necessarily mean a reading error.')}</p><p>{say('Thành phần cấu trúc hàng hóa ngoài ba biểu mẫu','Structured goods components outside the three forms')}: {sample.metrics.byForm.structured_goods_only.contentCorrect}/{sample.metrics.byForm.structured_goods_only.eligible}. {sample.unscoredPopulatedComponents} {say('giá trị có dữ liệu nhưng chưa có đáp án hợp lệ để chấm.','populated components have no eligible scored answer.')}</p><p>{say('Không có giá trị mặc định hải quan nào được tự bịa. Các thông tin còn thiếu cần hướng dẫn công ty; mọi biểu mẫu vẫn là bản nháp.','No customs defaults are invented. Missing business decisions require company instructions; every form remains a draft.')}</p></details>
    <details className="sample-method"><summary>{say('Toàn bộ mẫu ToKhai','All ToKhai sample collections')} · {data.inventory.length} ({inventoryExcluded.length} {say('không đủ điều kiện chấm','excluded from scoring')})</summary><ul className="sample-inventory">{data.inventory.map(item=><li key={item.packetId}><span>{item.label}</span>{item.eligible?<button onClick={()=>{setVariant('kimi-k26');setPacket(item.packetId);reset();window.scrollTo({top:0,behavior:'smooth'});}}>{say('Mở biểu mẫu','Open forms')}</button>:<small>{exclusionLabel(item.status)}</small>}</li>)}</ul></details>
  </section>;
}
