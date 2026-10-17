import { VNACCS_FIELDS } from './vnaccs.ts';
import { ECUS_ADDITIONAL_CATALOG } from './ecus-form.ts';
import type { DeclarationCatalogField, DeclarationComponent, DeclarationInput, DeclarationValue } from './declaration-types.ts';

const component = (key: string, labelVi: string, labelEn: string, input: DeclarationInput = 'text', sourceCell = 'Chỉ tiêu / Indicator'): DeclarationComponent => ({ key, labelVi, labelEn, input, sourceCell });
const amount = () => component('amount', 'Trị số', 'Amount / value', 'decimal');
const code = (key: string, vi: string, en: string, cell?: string) => component(key, vi, en, 'code', cell);
const currency = () => code('currencyCode', 'Mã đồng tiền — chưa xác minh', 'Currency code — unverified');
const unit = () => code('unitCode', 'Mã đơn vị — chưa xác minh', 'Unit code — unverified');
const reference = () => component('reference', 'Số / nội dung tham chiếu', 'Reference');
const link = (key: string, field: string, vi: string, en: string) => ({ ...component(key, vi, en, 'row_reference', 'Liên kết nội bộ AICD / AICD relationship, not a vendor field'), referenceFieldId: field });
const COMPONENTS: Record<DeclarationValue['kind'], DeclarationComponent[]> = {
  text: [component('text', 'Nội dung', 'Text', 'long_text')],
  code: [code('code', 'Mã — chưa xác minh', 'Code — unverified')],
  date: [component('date', 'Ngày (YYYY-MM-DD)', 'Date (YYYY-MM-DD)', 'date')],
  year: [component('year', 'Năm (YYYY)', 'Year (YYYY)', 'year')],
  count: [{ ...component('count', 'Số lượng / số thứ tự', 'Count / sequence', 'integer'), nonNegative: true }],
  decimal: [amount()], reference: [reference()], entity: [component('name', 'Tên chủ thể', 'Party name')],
  address: [component('line1', 'Đường, số nhà / hộp thư', 'Street, building / PO box', 'text', 'Ô 1'), component('line2', 'Địa chỉ tiếp', 'Address continuation', 'text', 'Ô 2'), component('city', 'Thành phố', 'City', 'text', 'Ô 3'), component('country', 'Tên nước', 'Country name', 'text', 'Ô 4')],
  first_declaration: [reference(), component('sequence', 'Thứ tự tờ khai', 'Declaration sequence', 'integer', 'Ô 2'), component('total', 'Tổng số tờ khai', 'Total declarations', 'integer', 'Ô 3')],
  quantity: [{ ...amount(), nonNegative: true }, unit()],
  location: [code('code', 'Mã địa điểm — chưa xác minh', 'Location code — unverified', 'Ô 1'), component('name', 'Tên địa điểm', 'Location name', 'text', 'Ô 2')],
  transport: [component('callSign', 'Hô hiệu', 'Call sign', 'text', 'Ô 1'), component('name', 'Tên / chuỗi phương tiện vận chuyển', 'Means of transport name / string', 'text', 'Ô 2')],
  invoice: [code('priceCategoryCode', 'Mã phân loại giá — chưa xác minh', 'Price category code — unverified', 'Ô 1'), code('incotermCode', 'Điều kiện giao hàng — chưa xác minh', 'Delivery terms — unverified', 'Ô 2'), currency(), amount()],
  money: [currency(), amount()],
  unit_price: [amount(), currency(), unit()],
  charge: [code('classificationCode', 'Mã phân loại phí — chưa xác minh', 'Charge classification code — unverified', 'Ô 1'), currency(), amount()],
  specific_tax: [amount(), unit(), currency()],
  destination: [code('locationCode', 'Mã địa điểm đích — chưa xác minh', 'Destination code — unverified', 'Ô 1'), component('arrivalDate', 'Ngày dự kiến đến', 'Expected arrival date', 'date', 'Ô 2')],
  code_reference: [code('categoryCode', 'Mã phân loại — chưa xác minh', 'Category code — unverified', 'Ô 1'), { ...reference(), sourceCell: 'Ô 2' }],
  adjustment_reference: [link('adjustmentRowId', '1.49', 'Dòng khoản điều chỉnh trong AICD', 'AICD adjustment row'), reference()],
  reference_rows: [reference()], code_rows: [code('code', 'Mã — chưa xác minh', 'Code — unverified')],
  permit_rows: [code('categoryCode', 'Mã giấy phép — chưa xác minh', 'Permit category code — unverified', 'Ô 1'), component('reference', 'Số / ngày / chuỗi tham chiếu theo nguồn', 'Source number / date / reference string', 'text', 'Ô 2')],
  adjustments: [code('itemCode', 'Mã khoản điều chỉnh — chưa xác minh', 'Adjustment item code — unverified', 'Ô 1'), code('classificationCode', 'Mã phân loại điều chỉnh — chưa xác minh', 'Adjustment classification code — unverified', 'Ô 2'), currency(), amount(), component('allocationFactor', 'Tổng hệ số phân bổ', 'Total allocation factor', 'decimal', 'Ô 5')],
  transit_rows: [code('locationCode', 'Mã trung chuyển — chưa xác minh', 'Transit location code — unverified', 'Ô 1'), component('arrivalDate', 'Ngày đến', 'Arrival date', 'date', 'Ô 2'), component('departureDate', 'Ngày đi', 'Departure date', 'date', 'Ô 3')],
  tax_rows: [code('taxCode', 'Mã sắc thuế — chưa xác minh', 'Tax category code — unverified'), code('rateCode', 'Mã mức thuế — chưa xác minh', 'Tax rate code — unverified')],
  tax_relief_rows: [link('taxRowId', '1.94', 'Dòng sắc thuế trong AICD', 'AICD tax row'), code('reliefCode', 'Mã miễn / giảm / không chịu thuế — chưa xác minh', 'Relief / non-taxable code — unverified')],
  tax_amount_rows: [link('taxRowId', '1.94', 'Dòng sắc thuế trong AICD', 'AICD tax row'), amount()],
  blocked: [],
};
const KINDS: DeclarationValue['kind'][] = [
  'blocked','first_declaration','reference','code','code','code','code','code','code','date','date',
  'code','entity','code','text','text','code','entity','code','entity','code','address','code','entity','code',
  'reference_rows','quantity','quantity','code','text','transport','date','location','location','count','code',
  'code_rows','permit_rows','code','reference','reference','date','code','invoice','code','blocked','charge','charge','adjustments','text','decimal',
  'code','code','code','year','reference','reference','code','code','year','reference','reference','code_reference','date','date','transit_rows','destination','text','reference',
  'blocked','blocked','blocked','blocked','code','count','decimal','specific_tax','text','code','code','code','code','quantity','quantity','decimal','unit_price','money','adjustment_reference','count','reference','count','code','decimal','tax_rows','tax_relief_rows','tax_amount_rows',
];
const repeated = new Set<DeclarationValue['kind']>(['reference_rows','code_rows','permit_rows','adjustments','transit_rows','tax_rows','tax_relief_rows','tax_amount_rows']);
function grouping(n: number): Pick<DeclarationCatalogField, 'tab' | 'section' | 'sectionVi' | 'sectionEn'> {
  const group = n <= 11 ? ['basic','Thông tin khai báo','Declaration basics'] : n <= 25 ? ['parties','Các bên','Parties'] : n <= 36 ? ['transport','Vận đơn và vận chuyển','Transport documents'] : n <= 38 ? ['permits','Giấy phép và quản lý','Permits and controls'] : n <= 44 ? ['invoice','Hóa đơn','Invoice'] : n <= 51 ? ['valuation','Trị giá, phí và điều chỉnh','Valuation, charges and adjustments'] : n <= 62 ? ['tax_guarantee','Thuế và bảo lãnh','Tax payment and guarantees'] : n <= 69 ? ['attachments_transport','Đính kèm, vận chuyển và ghi chú','Attachments, transport and remarks'] : n <= 73 ? ['customs','Thông tin của hải quan','Customs-owned information'] : ['goods','Chi tiết hàng hóa','Goods details'];
  return { tab: n <= 36 ? 'general_1' : n <= 73 ? 'general_2' : 'goods', section: group[0], sectionVi: group[1], sectionEn: group[2] };
}
/** Presentation groups mirror the vendor's broad General 1 / General 2 / Goods organization, not an ECUS import schema. */
export const DECLARATION_CATALOG: readonly DeclarationCatalogField[] = VNACCS_FIELDS.map(field => {
  const kind = KINDS[field.ordinal - 1];
  if (!kind) throw new Error(`Missing declaration structure: ${field.id}`);
  const components = structuredClone(COMPONENTS[kind]);
  if ([2,22,27,28,31,33,34,38,44,47,48,49,63,66,67,77,83,84,86,87].includes(field.ordinal)) components.forEach((part, index) => { if (part.sourceCell === 'Chỉ tiêu / Indicator') part.sourceCell = `Ô ${index + 1}`; });
  if (field.id === '1.27') { components[0].input = 'integer'; components[0].labelVi = 'Số kiện'; components[0].labelEn = 'Package count'; }
  const system = field.scope === 'system';
  const blocked = kind === 'blocked';
  const deferredVi = 'Nguồn mô tả ba ô nhưng đều yêu cầu chưa nhập cho đến khi có hướng dẫn. Chưa xác minh hướng dẫn mới hoặc ý nghĩa từng ô; không tạo cấu trúc giả định.';
  const deferredEn = 'The source lists three cells but defers all entry pending guidance. New guidance and individual cell meanings are unverified; no structure is invented.';
  return {
    id: field.id, labelVi: field.labelVi, labelEn: field.labelEn, scope: field.scope, ...grouping(field.ordinal), kind, components,
    repeatable: repeated.has(kind), editable: !blocked,
    ...(blocked ? { blockedReasonVi: system ? 'Chỉ tiêu do hệ thống / công chức hải quan quản lý; AICD chỉ tham chiếu, không cho người khai ghi giá trị.' : deferredVi, blockedReasonEn: system ? 'Owned by the customs system or officers; AICD references this indicator without allowing declarant-entered values.' : deferredEn } : {}),
    blockedComponents: field.id === '1.48' ? [{ sourceCell: 'Ô 4', reasonVi: 'Nguồn yêu cầu chưa nhập đến khi có hướng dẫn mới; chưa xác minh ý nghĩa và khả năng sử dụng ô này.', reasonEn: 'The source defers this cell pending new guidance; its meaning and current availability are unverified.' }] : [],
    structureVi: blocked ? (system ? 'Chỉ đọc — thuộc hải quan.' : deferredVi) : `Cấu trúc nhập liệu tham chiếu ${field.id}; ô trống không tự xác định không áp dụng. Mã và yêu cầu pháp lý chưa xác minh.`,
    structureEn: blocked ? (system ? 'Read-only — customs owned.' : deferredEn) : `Reference capture structure for ${field.id}; an empty component does not determine inapplicability. Codes and legal requirements remain unverified.`,
    sourceRefs: [field.provenance.baseline, ...field.provenance.amendments].map(source => ({ sourceId: source.sourceId, section: source.section, pages: source.pages ?? [], effectiveFrom: source.effectiveFrom })),
  };
});
export const DECLARATION_FIELDS: readonly DeclarationCatalogField[] = [...DECLARATION_CATALOG, ...ECUS_ADDITIONAL_CATALOG];
export function getDeclarationField(id: string): DeclarationCatalogField | undefined { return DECLARATION_FIELDS.find(field => field.id === id); }
