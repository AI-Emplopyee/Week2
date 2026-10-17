import type { DeclarationCatalogField, DeclarationContext, DeclarationDraft, DeclarationInput, DeclarationValue } from './declaration-types.ts';
import type { Issue } from './types.ts';

/** Website capture fields transcribed from the supplied ECUS IDA screenshots.
 * Required markers describe this requested workflow, not a customs-law rule set. */
export type EcusFormField = {
  key: string; labelVi: string; labelEn: string;
  tab: 'general_1' | 'general_2' | 'goods';
  section: string; sectionVi: string; sectionEn: string;
  fieldId: string; component: string; input: DeclarationInput; required: boolean;
  rowIndex?: number; readOnly?: boolean; sourceField?: string;
};
type Section = Pick<EcusFormField, 'tab' | 'section' | 'sectionVi' | 'sectionEn'>;
const section = (tab: EcusFormField['tab'], key: string, vi: string, en: string): Section => ({ tab, section: key, sectionVi: vi, sectionEn: en });
const basics = section('general_1', 'basics', 'Thông tin tờ khai', 'Declaration information');
const importer = section('general_1', 'importer', 'Người nhập khẩu', 'Importer');
const entrustedImporter = section('general_1', 'entrusted_importer', 'Người ủy thác nhập khẩu', 'Entrusted importer');
const exporter = section('general_1', 'exporter', 'Người xuất khẩu', 'Exporter');
const parties = section('general_1', 'other_parties', 'Các bên liên quan', 'Other parties');
const bills = section('general_1', 'bills', 'Vận đơn', 'Bills of lading');
const transport = section('general_1', 'transport', 'Thông tin vận chuyển', 'Transport information');
const contract = section('general_2', 'contract', 'Hợp đồng', 'Contract');
const permits = section('general_2', 'permits', 'Thông tin văn bản và giấy phép', 'Documents and permits');
const invoice = section('general_2', 'invoice', 'Hóa đơn thương mại', 'Commercial invoice');
const valuation = section('general_2', 'valuation', 'Tờ khai trị giá', 'Valuation declaration');
const charges = section('general_2', 'charges', 'Các khoản điều chỉnh', 'Charges and adjustments');
const tax = section('general_2', 'tax', 'Thuế và bảo lãnh', 'Tax and guarantees');
const attachments = section('general_2', 'attachments', 'Thông tin đính kèm', 'Attachments');
const bonded = section('general_2', 'bonded', 'Thông tin vận chuyển', 'Bonded transport');
const other = section('general_2', 'other', 'Thông tin khác', 'Other information');
const goods = section('goods', 'goods', 'Danh sách hàng', 'Goods list');
const field = (group: Section, key: string, labelVi: string, labelEn: string, fieldId: string, component = 'text', input: DeclarationInput = 'text', required = false, extras: Partial<EcusFormField> = {}): EcusFormField => ({ ...group, key, labelVi, labelEn, fieldId, component, input, required, ...extras });
const extra = (group: Section, key: string, vi: string, en: string, input: DeclarationInput = 'text', required = false, extras: Partial<EcusFormField> = {}) => field(group, key, vi, en, `ecus.${key}`, input === 'code' ? 'code' : input === 'date' ? 'date' : input === 'year' ? 'year' : input === 'integer' ? 'count' : input === 'decimal' ? 'amount' : 'text', input, required, extras);
const numbered = (key: string, index: number) => index === 0 ? key : `${key}${index + 1}`;

export const ECUS_FORM_FIELDS: readonly EcusFormField[] = [
  extra(basics, 'declarationGroup', 'Nhóm loại hình', 'Declaration group'),
  extra(basics, 'declarationNumber', 'Số tờ khai', 'Declaration number', 'text', false, { readOnly: true }),
  extra(basics, 'declarationSequence', 'STT', 'Declaration sequence', 'integer', false, { readOnly: true }),
  field(basics, 'firstDeclarationNumber', 'Số tờ khai đầu tiên', 'First declaration number', '1.2', 'reference'),
  field(basics, 'declarationBranch', 'Số nhánh', 'Branch number', '1.2', 'sequence', 'integer'),
  field(basics, 'declarationBranchTotal', 'Tổng số nhánh', 'Total branches', '1.2', 'total', 'integer'),
  field(basics, 'temporaryDeclarationNumber', 'Số tờ khai tạm nhập tái xuất tương ứng', 'Corresponding temporary import/re-export declaration', '1.3', 'reference'),
  field(basics, 'declarationType', 'Mã loại hình', 'Declaration type code', '1.4', 'code', 'code', true),
  field(basics, 'customsOffice', 'Cơ quan Hải quan', 'Customs office', '1.8', 'code', 'code', true),
  field(basics, 'declarationDate', 'Ngày khai báo (dự kiến)', 'Expected declaration date', '1.11', 'date', 'date'),
  field(basics, 'reExportDeadline', 'Thời hạn tái xuất', 'Re-export deadline', '1.10', 'date', 'date'),
  field(basics, 'goodsClassification', 'Mã phân loại hàng hóa', 'Goods classification code', '1.5', 'code', 'code'),
  field(basics, 'partyClassification', 'Phân loại cá nhân/tổ chức', 'Individual/organization classification', '1.7', 'code', 'code', true),
  field(basics, 'customsProcessingUnit', 'Mã bộ phận xử lý tờ khai', 'Declaration processing unit', '1.9', 'code', 'code'),
  field(basics, 'transportMode', 'Mã hiệu phương thức vận chuyển', 'Transport mode code', '1.6', 'code', 'code', true),
  field(importer, 'importerCode', 'Mã người nhập khẩu', 'Importer code', '1.12', 'code', 'code'),
  field(importer, 'importer', 'Tên người nhập khẩu', 'Importer name', '1.13', 'name'),
  field(importer, 'importerPostalCode', 'Mã bưu chính', 'Importer postal code', '1.14', 'code', 'code'),
  field(importer, 'importerAddress', 'Địa chỉ', 'Importer address', '1.15', 'text', 'long_text'),
  field(importer, 'importerTelephone', 'Điện thoại', 'Importer telephone', '1.16'),
  field(entrustedImporter, 'entrustedImporterCode', 'Mã', 'Entrusted importer code', '1.17', 'code', 'code'),
  field(entrustedImporter, 'entrustedImporter', 'Tên', 'Entrusted importer name', '1.18', 'name'),
  field(exporter, 'exporterCode', 'Mã', 'Exporter code', '1.19', 'code', 'code'),
  field(exporter, 'exporter', 'Tên người xuất khẩu', 'Exporter name', '1.20', 'name', 'text', true),
  field(exporter, 'exporterPostalCode', 'Mã bưu chính', 'Exporter postal code', '1.21', 'code', 'code'),
  field(exporter, 'exporterAddress', 'Địa chỉ người xuất khẩu', 'Exporter address', '1.22', 'line1', 'text', true),
  field(exporter, 'exporterAddressLine2', 'Địa chỉ (dòng 2)', 'Exporter address (line 2)', '1.22', 'line2'),
  field(exporter, 'exporterCity', 'Địa chỉ (dòng 3)', 'Exporter address (line 3)', '1.22', 'city'),
  field(exporter, 'exporterCountry', 'Địa chỉ (dòng 4)', 'Exporter address (line 4)', '1.22', 'country'),
  field(exporter, 'exporterCountryCode', 'Mã nước', 'Exporter country code', '1.23', 'code', 'code'),
  field(parties, 'entrustedExporter', 'Người ủy thác xuất khẩu', 'Entrusted exporter', '1.24', 'name'),
  field(parties, 'customsDeclarantCode', 'Mã người khai Hải quan', 'Customs declarant code', '1.25', 'code', 'code'),
  extra(bills, 'seaManifestDeclaration', 'Khai báo số định danh tại Cảng biển', 'Seaport cargo identification declaration', 'code'),
  extra(bills, 'airManifestDeclaration', 'Khai báo số định danh tại Cảng hàng không', 'Airport cargo identification declaration', 'code'),
  ...Array.from({ length: 5 }, (_, index) => [
    field(bills, numbered('billOfLading', index), `Số vận đơn ${index + 1}`, `Bill of lading ${index + 1}`, '1.26', 'reference', 'text', false, { rowIndex: index }),
    extra(bills, numbered('billOfLadingDate', index), `Ngày vận đơn ${index + 1}`, `Bill date ${index + 1}`, 'date'),
    extra(bills, numbered('houseAirWaybill', index), `Số HAWB ${index + 1}`, `HAWB number ${index + 1}`),
    extra(bills, numbered('masterAirWaybillYear', index), `Năm MAWB ${index + 1}`, `MAWB year ${index + 1}`, 'year'),
  ]).flat(),
  field(transport, 'packageCount', 'Số lượng kiện', 'Package count', '1.27', 'amount', 'integer', true),
  field(transport, 'packageUnit', 'Đơn vị số lượng kiện', 'Package unit', '1.27', 'unitCode', 'code'),
  field(transport, 'grossWeight', 'Tổng trọng lượng hàng (Gross)', 'Gross weight', '1.28', 'amount', 'decimal'),
  field(transport, 'grossWeightUnit', 'Đơn vị trọng lượng', 'Weight unit', '1.28', 'unitCode', 'code'),
  field(transport, 'storageLocation', 'Mã địa điểm lưu kho hàng chờ thông quan dự kiến', 'Expected customs storage location code', '1.29', 'code', 'code'),
  field(transport, 'packageMarks', 'Ký hiệu và số hiệu bao bì', 'Package marks and numbers', '1.30', 'text', 'long_text'),
  field(transport, 'vesselCode', 'Mã phương tiện vận chuyển', 'Transport identification', '1.31', 'callSign'),
  field(transport, 'vessel', 'Phương tiện vận chuyển', 'Means of transport', '1.31', 'name'),
  field(transport, 'arrivalDate', 'Ngày hàng đến', 'Arrival date', '1.32', 'date', 'date', true),
  field(transport, 'portOfDischargeCode', 'Mã địa điểm dỡ hàng', 'Unloading location code', '1.33', 'code', 'code'),
  field(transport, 'portOfDischarge', 'Địa điểm dỡ hàng', 'Unloading location', '1.33', 'name'),
  field(transport, 'portOfLoadingCode', 'Mã địa điểm xếp hàng', 'Loading location code', '1.34', 'code', 'code', true),
  field(transport, 'portOfLoading', 'Địa điểm xếp hàng', 'Loading location', '1.34', 'name'),
  field(transport, 'containerCount', 'Số lượng Container', 'Container count', '1.35', 'count', 'integer'),
  field(transport, 'inspectionResultCode', 'Mã kết quả kiểm tra nội dung', 'Inspection result code', '1.36', 'code', 'code'),
  extra(contract, 'contractNumber', 'Số hợp đồng', 'Contract number'),
  extra(contract, 'contractDate', 'Ngày hợp đồng', 'Contract date', 'date'),
  extra(contract, 'contractExpiryDate', 'Ngày hết hạn', 'Contract expiry date', 'date'),
  ...Array.from({ length: 5 }, (_, index) => field(permits, numbered('regulationCode', index), `Mã văn bản pháp quy khác ${index + 1}`, `Other regulation code ${index + 1}`, '1.37', 'code', 'code', false, { rowIndex: index })),
  ...Array.from({ length: 5 }, (_, index) => [
    field(permits, numbered('permitCategory', index), `Mã giấy phép nhập khẩu ${index + 1}`, `Import permit category ${index + 1}`, '1.38', 'categoryCode', 'code', false, { rowIndex: index }),
    field(permits, numbered('permitNumber', index), `Số giấy phép nhập khẩu ${index + 1}`, `Import permit number ${index + 1}`, '1.38', 'reference', 'text', false, { rowIndex: index }),
  ]).flat(),
  field(invoice, 'invoiceForm', 'Phân loại hình thức hóa đơn', 'Invoice form category', '1.39', 'code', 'code', true),
  field(invoice, 'electronicInvoiceReceipt', 'Số tiếp nhận hóa đơn điện tử', 'Electronic invoice receipt number', '1.40', 'reference'),
  field(invoice, 'invoiceNumber', 'Số hóa đơn', 'Invoice number', '1.41', 'reference'),
  field(invoice, 'invoiceDate', 'Ngày phát hành', 'Invoice issue date', '1.42', 'date', 'date'),
  field(invoice, 'paymentMethod', 'Phương thức thanh toán', 'Payment method', '1.43', 'code', 'code'),
  field(invoice, 'invoicePriceCategory', 'Mã phân loại giá hóa đơn', 'Invoice price category', '1.44', 'priceCategoryCode', 'code', true),
  field(invoice, 'invoiceTotal', 'Tổng trị giá hóa đơn', 'Total invoice value', '1.44', 'amount', 'decimal', true),
  field(invoice, 'incoterm', 'Điều kiện giá hóa đơn', 'Invoice terms', '1.44', 'incotermCode', 'code', true),
  field(invoice, 'currency', 'Mã đồng tiền của hóa đơn', 'Invoice currency', '1.44', 'currencyCode', 'code', true),
  field(valuation, 'valuationClassification', 'Mã phân loại khai trị giá', 'Valuation classification', '1.45', 'code', 'code'),
  extra(valuation, 'valuationDeclarationNumber', 'Số tiếp nhận tờ khai trị giá tổng hợp', 'General valuation declaration receipt'),
  extra(valuation, 'valuationCurrency', 'Mã tiền tệ', 'Valuation currency', 'code'),
  extra(valuation, 'valuationBasePrice', 'Giá cơ sở để hiệu chỉnh giá', 'Base price for adjustment', 'decimal'),
  field(charges, 'freightClassification', 'Phí vận chuyển — Mã loại', 'Freight classification', '1.47', 'classificationCode', 'code'),
  field(charges, 'freightCurrency', 'Phí vận chuyển — Mã tiền', 'Freight currency', '1.47', 'currencyCode', 'code'),
  field(charges, 'freightAmount', 'Phí vận chuyển', 'Freight amount', '1.47', 'amount', 'decimal'),
  field(charges, 'insuranceClassification', 'Phí bảo hiểm — Mã loại', 'Insurance classification', '1.48', 'classificationCode', 'code'),
  field(charges, 'insuranceCurrency', 'Phí bảo hiểm — Mã tiền', 'Insurance currency', '1.48', 'currencyCode', 'code'),
  field(charges, 'insuranceAmount', 'Phí bảo hiểm', 'Insurance amount', '1.48', 'amount', 'decimal'),
  extra(charges, 'insuranceRegistrationNumber', 'Số đăng ký', 'Insurance registration number'),
  ...Array.from({ length: 5 }, (_, index) => [
    field(charges, numbered('adjustmentCode', index), `Mã tên khoản điều chỉnh ${index + 1}`, `Adjustment code ${index + 1}`, '1.49', 'itemCode', 'code', false, { rowIndex: index }),
    field(charges, numbered('adjustmentClassification', index), `Mã phân loại điều chỉnh ${index + 1}`, `Adjustment classification ${index + 1}`, '1.49', 'classificationCode', 'code', false, { rowIndex: index }),
    field(charges, numbered('adjustmentCurrency', index), `Mã đồng tiền điều chỉnh ${index + 1}`, `Adjustment currency ${index + 1}`, '1.49', 'currencyCode', 'code', false, { rowIndex: index }),
    field(charges, numbered('adjustmentAmount', index), `Trị giá khoản điều chỉnh ${index + 1}`, `Adjustment value ${index + 1}`, '1.49', 'amount', 'decimal', false, { rowIndex: index }),
    field(charges, numbered('adjustmentAllocation', index), `Tổng hệ số phân bổ ${index + 1}`, `Allocation factor ${index + 1}`, '1.49', 'allocationFactor', 'decimal', false, { rowIndex: index }),
  ]).flat(),
  field(charges, 'valuationDetails', 'Chi tiết khai trị giá', 'Valuation details', '1.50', 'text', 'long_text'),
  field(charges, 'valuationAllocationTotal', 'Tổng hệ số phân bổ trị giá', 'Total valuation allocation factor', '1.51', 'amount', 'decimal'),
  field(tax, 'taxpayer', 'Người nộp thuế', 'Taxpayer', '1.52', 'code', 'code'),
  field(tax, 'bpReason', 'Mã lý do đề nghị BP', 'BP request reason', '1.53', 'code', 'code'),
  field(tax, 'taxBank', 'Mã ngân hàng trả thuế thay', 'Tax payment bank', '1.54', 'code', 'code'),
  field(tax, 'taxLimitYear', 'Năm phát hành hạn mức', 'Tax limit issue year', '1.55', 'year', 'year'),
  field(tax, 'taxLimitSymbol', 'Ký hiệu chứng từ hạn mức', 'Tax limit document symbol', '1.56', 'reference'),
  field(tax, 'taxLimitNumber', 'Số chứng từ hạn mức', 'Tax limit document number', '1.57', 'reference'),
  field(tax, 'taxPaymentDeadlineCode', 'Mã xác định thời hạn nộp thuế', 'Tax payment deadline code', '1.58', 'code', 'code'),
  field(tax, 'guaranteeBank', 'Mã ngân hàng bảo lãnh', 'Guarantee bank', '1.59', 'code', 'code'),
  field(tax, 'guaranteeYear', 'Năm phát hành bảo lãnh', 'Guarantee issue year', '1.60', 'year', 'year'),
  field(tax, 'guaranteeSymbol', 'Ký hiệu chứng từ bảo lãnh', 'Guarantee document symbol', '1.61', 'reference'),
  field(tax, 'guaranteeNumber', 'Số chứng từ bảo lãnh', 'Guarantee document number', '1.62', 'reference'),
  ...Array.from({ length: 3 }, (_, index) => [
    field(attachments, numbered('attachmentCategory', index), `Phân loại đính kèm ${index + 1}`, `Attachment category ${index + 1}`, index === 0 ? '1.63' : `ecus.attachment${index + 1}`, 'categoryCode', 'code'),
    field(attachments, numbered('attachmentNumber', index), `Số đính kèm ${index + 1}`, `Attachment number ${index + 1}`, index === 0 ? '1.63' : `ecus.attachment${index + 1}`, 'reference'),
  ]).flat(),
  field(bonded, 'firstWarehouseDate', 'Ngày được phép nhập kho đầu tiên', 'First permitted warehouse date', '1.64', 'date', 'date'),
  field(bonded, 'transportDepartureDate', 'Ngày khởi hành vận chuyển', 'Transport departure date', '1.65', 'date', 'date'),
  ...Array.from({ length: 3 }, (_, index) => [
    field(bonded, numbered('transitLocation', index), `Địa điểm trung chuyển ${index + 1}`, `Transit location ${index + 1}`, '1.66', 'locationCode', 'code', false, { rowIndex: index }),
    field(bonded, numbered('transitArrivalDate', index), `Ngày đến trung chuyển ${index + 1}`, `Transit arrival date ${index + 1}`, '1.66', 'arrivalDate', 'date', false, { rowIndex: index }),
    field(bonded, numbered('transitDepartureDate', index), `Ngày khởi hành trung chuyển ${index + 1}`, `Transit departure date ${index + 1}`, '1.66', 'departureDate', 'date', false, { rowIndex: index }),
  ]).flat(),
  field(bonded, 'bondedDestination', 'Địa điểm đích cho vận chuyển bảo thuế', 'Bonded transport destination', '1.67', 'locationCode', 'code'),
  field(bonded, 'bondedArrivalDate', 'Ngày đến địa điểm đích', 'Destination arrival date', '1.67', 'arrivalDate', 'date'),
  field(other, 'remarks', 'Phần ghi chú', 'Remarks', '1.68', 'text', 'long_text'),
  field(other, 'internalReference', 'Số quản lý của nội bộ doanh nghiệp', 'Company internal reference', '1.69', 'reference'),
  extra(goods, 'goodsSequence', 'STT', 'No.', 'integer', true, { readOnly: true }),
  extra(goods, 'goodsCode', 'Mã hàng', 'Goods code', 'text', true),
  field(goods, 'description', 'Tên hàng (mô tả chi tiết)', 'Goods description', '1.78', 'text', 'long_text', true),
  field(goods, 'hsCode', 'Mã HS', 'HS code', '1.74', 'code', 'code', true),
  field(goods, 'origin', 'Xuất xứ', 'Origin', '1.79', 'code', 'code', true),
  field(goods, 'quantity', 'Lượng', 'Quantity', '1.83', 'amount', 'decimal', true),
  field(goods, 'unit', 'Đơn vị tính', 'Unit', '1.83', 'unitCode', 'code', true),
  field(goods, 'quantity2', 'Lượng 2', 'Quantity 2', '1.84', 'amount', 'decimal', true),
  field(goods, 'unit2', 'Đơn vị tính 2', 'Unit 2', '1.84', 'unitCode', 'code', true),
  field(goods, 'unitPrice', 'Đơn giá hóa đơn', 'Invoice unit price', '1.86', 'amount', 'decimal', true),
  field(goods, 'amount', 'Trị giá hóa đơn', 'Invoice value', '1.85', 'amount', 'decimal', true),
  extra(goods, 'taxableUnitPrice', 'Đơn giá tính thuế', 'Taxable unit price', 'decimal', true),
  field(goods, 'taxableValue', 'Trị giá tính thuế', 'Taxable value', '1.87', 'amount', 'decimal', true),
  field(goods, 'importDutySchedule', 'Mã biểu thuế NK', 'Import duty schedule', '1.80', 'code', 'code', true),
  field(goods, 'dutyRate', 'TS NK (%)', 'Import duty rate (%)', '1.76', 'amount', 'decimal', true),
  extra(goods, 'importDutyAmount', 'Tiền thuế NK', 'Import duty amount', 'decimal', true),
  extra(goods, 'exciseTaxSchedule', 'Mã biểu thuế TTĐB', 'Excise tax schedule', 'code', true),
  extra(goods, 'exciseTaxRate', 'Thuế suất TTĐB (%)', 'Excise tax rate (%)', 'decimal', true),
  extra(goods, 'exciseTaxAmount', 'Tiền thuế TTĐB', 'Excise tax amount', 'decimal', true),
  extra(goods, 'environmentTaxSchedule', 'Mã biểu thuế môi trường', 'Environmental tax schedule', 'code', true),
  extra(goods, 'environmentTaxRate', 'Thuế suất môi trường', 'Environmental tax rate', 'decimal', true),
  extra(goods, 'environmentTaxAmount', 'Tiền thuế môi trường', 'Environmental tax amount', 'decimal', true),
  extra(goods, 'vatTaxSchedule', 'Mã biểu thuế VAT', 'VAT schedule', 'code', true),
  field(goods, 'vatRate', 'Thuế suất VAT (%)', 'VAT rate (%)', 'ecus.vatTaxRate', 'amount', 'decimal', true),
  extra(goods, 'vatTaxAmount', 'Tiền thuế VAT', 'VAT amount', 'decimal', true),
];

export function getEcusFormField(key: string): EcusFormField | undefined { return ECUS_FORM_FIELDS.find(field => field.key === key); }
export function ecusFormValue(field: EcusFormField, draft: DeclarationDraft | undefined, goodsLineId?: string): string {
  const entry = draft?.fields.find(entry => entry.fieldId === field.fieldId && entry.goodsLineId === (field.tab === 'goods' ? goodsLineId : undefined));
  if (!entry) return '';
  const value = entry.value;
  const record = field.rowIndex !== undefined ? ('rows' in value ? value.rows[field.rowIndex] : undefined) : value;
  return record && typeof (record as Record<string, unknown>)[field.component] === 'string' ? String((record as Record<string, unknown>)[field.component]) : '';
}

/** Update one visible component while preserving all other cells and stable row IDs. */
export function ecusFormValueUpdate(field: EcusFormField, value: DeclarationValue, input: string): DeclarationValue {
  if (field.readOnly) return structuredClone(value);
  if (field.rowIndex === undefined) return { ...value, [field.component]: input } as DeclarationValue;
  if (!('rows' in value)) throw new Error('The ECUS field requires a repeated declaration value.');
  const rows = structuredClone(value.rows) as unknown as Record<string, string>[];
  const related = ECUS_FORM_FIELDS.filter(other => other.fieldId === field.fieldId && other.rowIndex !== undefined);
  while (rows.length <= field.rowIndex) rows.push({ id: `row-${crypto.randomUUID()}`, ...Object.fromEntries(related.filter(other => other.rowIndex === rows.length).map(other => [other.component, ''])) });
  rows[field.rowIndex][field.component] = input;
  return { ...value, rows } as DeclarationValue;
}

/** Add only screenshot-specific fields; historical VNACCS identifiers retain their shape. */
export const ECUS_ADDITIONAL_CATALOG: readonly DeclarationCatalogField[] = [...new Set(ECUS_FORM_FIELDS.filter(field => field.fieldId.startsWith('ecus.')).map(field => field.fieldId))].map(id => {
  const fields = ECUS_FORM_FIELDS.filter(field => field.fieldId === id);
  const first = fields[0];
  const kind: DeclarationValue['kind'] = fields.length > 1 ? 'code_reference' : first.input === 'code' ? 'code' : first.input === 'date' ? 'date' : first.input === 'year' ? 'year' : first.input === 'integer' ? 'count' : first.input === 'decimal' ? 'decimal' : 'text';
  return { id, labelVi: first.labelVi, labelEn: first.labelEn, scope: first.tab === 'goods' ? 'item' : 'header', tab: first.tab, section: first.section, sectionVi: first.sectionVi, sectionEn: first.sectionEn, kind,
    components: fields.map(field => ({ key: field.component, labelVi: field.labelVi, labelEn: field.labelEn, input: field.input, sourceCell: field.key, ...(['decimal','integer'].includes(field.input) ? { nonNegative: true } : {}) })),
    repeatable: false, editable: !first.readOnly,
    ...(first.readOnly ? { blockedReasonVi: 'Giá trị do hệ thống xác định.', blockedReasonEn: 'This value is assigned by the system.' } : {}),
    blockedComponents: [], structureVi: 'Trường biểu mẫu ECUS IDA từ ảnh tham chiếu.', structureEn: 'ECUS IDA form field from the supplied reference images.', sourceRefs: [],
  };
});

/** Missing required cells are explicit questions; optional empty cells are not. */
export function getEcusRequiredIssues(draft: DeclarationDraft | undefined, context: DeclarationContext): Issue[] {
  return ECUS_FORM_FIELDS.filter(field => field.required && !field.readOnly).flatMap(field => {
    const targets = field.tab === 'goods' ? context.goods.map(line => line.id) : [undefined];
    return targets.flatMap(goodsLineId => {
      const entry = draft?.fields.find(entry => entry.fieldId === field.fieldId && entry.goodsLineId === goodsLineId);
      if (entry?.applicability === 'applicable' && ecusFormValue(field, draft, goodsLineId).trim()) return [];
      const lineIndex = goodsLineId ? context.goods.findIndex(line => line.id === goodsLineId) + 1 : undefined;
      const label = `${field.labelVi}${lineIndex ? ` — dòng hàng ${lineIndex}` : ''}`;
      return [{ id: `${context.caseId}:ecus:${JSON.stringify([field.key, goodsLineId ?? null])}:required`, caseId: context.caseId, kind: 'declaration' as const, severity: 'error' as const,
        title: `Vui lòng bổ sung ${label}`, description: `Chưa có ${label}. Vui lòng bổ sung thông tin bắt buộc cho biểu mẫu ECUS IDA.`, field: field.fieldId, ecusFieldKey: field.key, ...(goodsLineId ? { goodsLineId } : {}), candidateIds: [], documentIds: [], resolved: false, fingerprint: `ecus-required:${field.key}:${goodsLineId ?? ''}` }];
    });
  });
}
