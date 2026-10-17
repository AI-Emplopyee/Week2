/** Historical deterministic-reader fixtures only. Never import this module from runtime code. */
import { normalizeValue } from '../../lib/extraction.ts';
export { normalizeValue };
import type { Candidate, Confidence, DocumentType, GoodsLine, ShipmentDocument, SourcePage } from '../../lib/types.ts';
import { ECUS_FORM_FIELDS } from '../../lib/ecus-form.ts';

/** Compatibility names identify the same source field, never a derived value. */
export function canonicalExtractionField(field: string): string {
  return field === 'customsProcedure' ? 'declarationType' : field;
}

const ecusSourceKey = (field: typeof ECUS_FORM_FIELDS[number]) => field.sourceField ?? field.key;
function ecusAliases(goods: boolean): Record<string, string[]> {
  const descriptors = ECUS_FORM_FIELDS.filter(field => !field.readOnly && (field.tab === 'goods') === goods);
  // Short repeated labels (such as “Mã”) need their section to be unambiguous.
  const labels = descriptors.flatMap(field => [field.labelVi.toLowerCase(), field.labelEn.toLowerCase()]);
  return Object.fromEntries(descriptors.map(field => [ecusSourceKey(field), [
    ecusSourceKey(field),
    `${field.sectionVi} ${field.labelVi}`, `${field.sectionEn} ${field.labelEn}`,
    ...[field.labelVi, field.labelEn].filter(label => labels.filter(value => value === label.toLowerCase()).length === 1),
  ]]));
}

/** Layout-independent aliases. Company names, document IDs and supplier-specific coordinates never belong here. */
export const FIELD_ALIASES: Record<string, string[]> = {
  declarationType: ['customsProcedure', 'customs procedure', 'declaration type', 'loại hình', 'loai hinh', 'mã loại hình', 'ma loai hinh'],
  importer: ['importer', 'buyer', 'consignee', 'người nhập khẩu', 'nguoi nhap khau', 'người mua'],
  exporter: ['exporter', 'seller', 'shipper', 'người xuất khẩu', 'nguoi xuat khau', 'người bán'],
  invoiceNumber: ['invoice number', 'invoice no', 'invoice no.', 'invoice #', 'số hóa đơn', 'so hoa don'],
  invoiceDate: ['invoice date', 'ngày hóa đơn', 'ngay hoa don'],
  packingListDate: ['packing list date'], contractNumber: ['contract no', 'contract no.', 'contract number', 'số hợp đồng'],
  billOfLading: ['b/l number', 'b/l no', 'b/l no.', 'bl number', 'bill of lading number', 'bill of lading no', 'bill of lading no.', 'awb number', 'air waybill number', 'số vận đơn', 'so van don'],
  houseBillOfLading: ['hbl no', 'hbl number', 'house b/l no', 'house bill of lading number'],
  masterBillOfLading: ['mbl no', 'mbl number', 'master b/l no', 'master bill of lading number'],
  transportReference: ['manifest no', 'manifest no.', 's/o no', 's/o no.', 's/0 no', 'booking no', 'booking no.'],
  transportShipper: ['shipper/exporter', 'shipper/exporter (complete name/street address)'],
  transportConsignee: ['consignee (not negotiable unless consigned to order)'], notifyParty: ['notify party'],
  vessel: ['vessel', 'tàu', 'ten tau', 'ocean vessel/voyage', 'ocean vessel/voy no.', 'vessel/voyage', "vessel's name / aircraft etc."],
  voyage: ['voyage', 'chuyến', 'chuyen'],
  portOfLoading: ['port of loading', 'loading port', 'port of shipment', 'cảng xếp hàng', 'cang xep hang'],
  portOfDischarge: ['port of discharge', 'discharge port', 'cảng dỡ hàng', 'cang do hang'],
  container: ['container', 'container number', 'container no', 'container no.', 'số container'],
  currency: ['currency', 'đồng tiền', 'dong tien', 'tiền tệ'],
  invoiceTotal: ['invoice total', 'total amount', 'grand total', 'tổng tiền', 'tong tien', 'trị giá hóa đơn'],
  incoterm: ['incoterm', 'incoterms', 'delivery term', 'trade term', 'điều kiện giao hàng'],
  packageCount: ['packages', 'package count', 'number of packages', 'package', 'số kiện', 'so kien'],
  grossWeight: ['gross weight', 'gross weight (kg)', 'g.w.', 'g.w. (kg)', 'trọng lượng cả bì', 'trong luong ca bi'],
  netWeight: ['net weight', 'net weight (kg)', 'n.w.', 'n.w. (kg)', 'trọng lượng tịnh', 'trong luong tinh'],
};
for (const [field, aliases] of Object.entries(ecusAliases(false))) FIELD_ALIASES[field] = [...new Set([...(FIELD_ALIASES[field] ?? []), ...aliases])];
const numerical = new Set(['invoiceTotal', 'packageCount', 'containerCount', 'grossWeight', 'netWeight', 'quantity', 'unitPrice', 'amount', ...ECUS_FORM_FIELDS.filter(field => ['decimal', 'integer'].includes(field.input)).map(ecusSourceKey)]);
const keyText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.:]+$/, '').trim();
const aliasMap = new Map(Object.entries(FIELD_ALIASES).flatMap(([key, aliases]) => aliases.map(alias => [keyText(alias), key])));
const goodsAliases: Record<string, string[]> = {
  description: ['description', 'goods description', 'description of goods', 'item', 'mô tả', 'mo ta', 'tên hàng', 'ten hang'],
  quantity: ['quantity', 'qty', 'số lượng', 'so luong'], unit: ['unit', 'uom', 'đơn vị', 'don vi'],
  unitPrice: ['unit price', 'unitprice', 'price', 'đơn giá', 'don gia'], amount: ['amount', 'total', 'thành tiền', 'thanh tien'],
  packageCount: ['qty (package)', 'qty (packages)', 'quantity (package)', 'package qty', 'packages', 'package count'],
  grossWeight: ['g.w.', 'g.w. (kg)', 'gw', 'gw (kg)', 'gross weight', 'gross weight (kg)'], netWeight: ['n.w.', 'n.w. (kg)', 'nw', 'nw (kg)', 'net weight', 'net weight (kg)'],
  hsCode: ['hs code', 'hs', 'mã hs'], origin: ['origin', 'country of origin', 'xuất xứ'], dutyRate: ['duty rate'], vatRate: ['vat rate'],
};
for (const [field, aliases] of Object.entries(ecusAliases(true))) goodsAliases[field] = [...new Set([...(goodsAliases[field] ?? []), ...aliases])];
const goodsAliasMap = new Map(Object.entries(goodsAliases).flatMap(([key, aliases]) => aliases.map(alias => [keyText(alias), key])));
function columnField(value: string): string | undefined {
  const key = keyText(value);
  const exact = goodsAliasMap.get(key); if (exact) return exact;
  if (/^(?:unit price|amount)\s*\([a-z]{3}\)$/.test(key)) return key.startsWith('unit') ? 'unitPrice' : 'amount';
  return undefined;
}
function headingType(text: string): DocumentType | undefined {
  const value = text.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  if (/^(?:commercial\s+)?invoice$|^hóa đơn(?: thương mại)?$|^hoa don$/.test(value.trim())) return 'invoice';
  if (/^(?:detailed\s+)?packing\s*list$|^phiếu đóng gói$|^phieu dong goi$/.test(value.trim())) return 'packing_list';
  if (/^(?:house\s+|master\s+|ocean\s+)?bill\s*of\s*lading$/.test(value.trim())) return 'bill_of_lading';
  if (/^air\s*waybill$|^vận đơn hàng không$/.test(value.trim())) return 'air_waybill';
  if (/^certificate\s*of\s*origin$|^chứng nhận xuất xứ$/.test(value.trim())) return 'certificate_of_origin';
  if (/^(?:sales\s+|purchase\s+)?contract$|^hợp đồng$/.test(value.trim())) return 'contract';
}
export function classifyPage(text: string): DocumentType {
  for (const line of text.slice(0, 4500).split(/\r?\n/).slice(0, 65)) {
    for (const part of line.split(/\t| {2,}/)) { const type = headingType(part.trim()); if (type) return type; }
  }
  return 'other';
}
export function classifyDocument(name: string, text: string): DocumentType {
  const n = name.toLowerCase().replace(/[_-]/g, ' ');
  if (/packing\s*list|\bpkl\b/.test(n)) return 'packing_list';
  if (/\b(?:hbl|mbl)\b|bill\s*of\s*lading/.test(n)) return 'bill_of_lading';
  if (/air\s*waybill|\bawb\b/.test(n)) return 'air_waybill';
  if (/certificate\s*of\s*origin|\bco\s*(?:fe|form\s*e)\b/.test(n)) return 'certificate_of_origin';
  if (/contract|hợp đồng/.test(n)) return 'contract';
  if (/invoice|hóa đơn|hoa don|\bci\s*[+&]\s*pl\b/.test(n)) return 'invoice';
  return classifyPage(text);
}
export function pageDocumentType(document: ShipmentDocument, page: SourcePage): DocumentType {
  if (document.extractionPipeline === 'kimi') return page.documentType ?? document.type;
  return page.documentType && page.documentType !== 'other' ? page.documentType : classifyPage(page.text) !== 'other' ? classifyPage(page.text) : document.type;
}
export function documentHasType(document: ShipmentDocument, type: DocumentType): boolean {
  return document.type === type || document.pages.some(page => pageDocumentType(document, page) === type);
}
export function derivePageTypes(document: ShipmentDocument): void {
  document.pages = document.pages.map(page => ({ ...page, documentType: classifyPage(page.text) }));
}
function transportRole(document: ShipmentDocument): 'house' | 'master' | 'unspecified' {
  const value = `${document.name}\n${document.pages.map(p => p.text.slice(0, 300)).join('\n')}`;
  if (/\bhbl\b|house\s+(?:bill|b\/l)/i.test(value)) return 'house';
  if (/\bmbl\b|master\s+(?:bill|b\/l)/i.test(value)) return 'master';
  return 'unspecified';
}


function cells(line: string): string[] {
  if (line.includes('|')) return line.split('|').filter((x, i, a) => x.trim() || (i !== 0 && i !== a.length - 1));
  if (line.includes('\t')) return line.split('\t');
  if (/ {2,}/.test(line.trim())) return line.trim().split(/ {2,}/);
  const result: string[] = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ',' && !quoted) { result.push(value); value = ''; }
    else value += line[i];
  }
  result.push(value); return result;
}
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const allAliases = [...aliasMap.keys()].sort((a, b) => b.length - a.length);
const labelPattern = new RegExp(`^(?:${allAliases.map(escaped).join('|')})(?:[.:=\\s]|$)`, 'i');
const isLabel = (text: string) => labelPattern.test(text.trim()) || !!headingType(text.trim());
const numericToken = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';

type AddCandidate = (field: string, original: string, page: SourcePage, location: string, originalText: string, lineId?: string, method?: string, confidence?: Confidence) => string;

/** Explicit row parser: delimited columns first, optional wrapped description lines. */
function extractTables(document: ShipmentDocument, page: SourcePage, add: AddCandidate): GoodsLine[] {
  const lines = page.text.split(/\r?\n/); const goods: GoodsLine[] = [];
  let columns: (string | undefined)[] | undefined; let headerAt = -1; let packing = false;
  let lastGoods: GoodsLine | undefined;
  for (let i = 0; i < lines.length; i++) {
    let row = cells(lines[i]); let mapped = row.map(columnField);
    // Header continuations retain semantics: QTY + (PACKAGE) is packages, not commercial quantity.
    if (mapped.includes('description') && (mapped.includes('quantity') || mapped.includes('packageCount'))) {
      const next = cells(lines[i + 1] || '');
      if (next.some(x => /\((?:PACKAGE[S]?|KG|USD|EUR|VND|CNY)\)/i.test(x))) {
        if (next.length === row.length) { row = row.map((x, n) => `${x.trim()} ${next[n].trim()}`.trim()); mapped = row.map(columnField); }
        else if (mapped.includes('quantity') && /\(packages?\)/i.test(lines[i + 1] || '')) mapped[mapped.indexOf('quantity')] = 'packageCount';
      }
      const previousHeader = lines[i - 1] || '';
      if (mapped.includes('quantity') && mapped.includes('unit') && /unit\s*price/i.test(previousHeader) && /amount/i.test(previousHeader) && row.slice(-2).every(x => /^\([A-Z]{3}\)$/i.test(x.trim()))) { mapped[mapped.length - 2] = 'unitPrice'; mapped[mapped.length - 1] = 'amount'; }
      columns = mapped; headerAt = i; packing = mapped.includes('packageCount'); lastGoods = undefined;
      const money = lines.slice(Math.max(0, i - 1), i + 3).join(' ').match(/(?:Unit\s*Price|Amount)[^\n]{0,30}?\(([A-Z]{3})\)/i);
      if (money) add('currency', money[1], page, `Table header, line ${i + 1}`, lines.slice(i, i + 3).join('\n'), undefined, 'layout_table_header', 'medium');
      continue;
    }
    if (!columns) continue;
    if (i <= headerAt + 2 && /^\s*(?:\([A-Z]+\)[\s|,]*)+$/i.test(lines[i])) continue;
    const descAt = columns.indexOf('description'), quantityAt = columns.indexOf('quantity'), packageAt = columns.indexOf('packageCount');
    const totals = /^\s*(?:TOTAL|GRAND TOTAL|TOTAL AMOUNT)\b/i.test(lines[i]) || row.some((x, n) => n <= descAt && /^(?:TOTAL|TOTAL AMOUNT)$/i.test(x.trim()));
    if (totals) {
      if (row.length === columns.length) columns.forEach((field, n) => { if (field && ['packageCount', 'grossWeight', 'netWeight'].includes(field) && row[n]?.trim()) add(field, row[n], page, `Total row, line ${i + 1}`, lines[i], undefined, 'layout_packing_totals', 'medium'); });
      if (pageDocumentType(document, page) === 'invoice') { const amount = row.at(-1)?.trim(); if (amount && /^[\d,.]+$/.test(amount)) add('invoiceTotal', amount, page, `Total row, line ${i + 1}`, lines[i], undefined, 'layout_invoice_total', 'medium'); }
      columns = undefined; lastGoods = undefined; continue;
    }
    if (row.length === columns.length && row[descAt]?.trim() && (row[quantityAt]?.trim() || row[packageAt]?.trim())) {
      const number = (row[quantityAt] || row[packageAt] || '').trim();
      if (!/^[\d,.]+$/.test(number)) continue;
      const lineId = `${document.id}:p${page.page}:l${i + 1}`;
      let evidence = lines[i];
      if (/^quantity\s*:/i.test(row[descAt].trim()) && lines[i - 1]?.trim() && !/description|unit price|amount|^\s*total/i.test(lines[i - 1])) { row[descAt] = lines[i - 1].trim(); evidence = `${lines[i - 1]}\n${lines[i]}`; }
      const line: GoodsLine = { id: lineId, description: '', quantity: '', unit: '', unitPrice: '', amount: '', hsCode: '', origin: '', dutyRate: '', vatRate: '', sourceDocumentId: document.id, sourcePage: page.page, originalText: evidence, reviewed: false, manual: false };
      columns.forEach((field, n) => {
        if (!field || !row[n]?.trim()) return;
        const value = add(field, row[n], page, `Line ${i + 1}, column ${n + 1}`, evidence, lineId, 'deterministic_delimited_table');
        if (['description', 'quantity', 'unit', 'unitPrice', 'amount'].includes(field)) (line as unknown as Record<string, string>)[field] = value;
      });
      if (!packing) { goods.push(line); lastGoods = line; } else lastGoods = undefined;
      continue;
    }
    // A wrapped description cell may occupy its own row. Preserve the exact source lines.
    if (lastGoods && row.length === columns.length && row[descAt]?.trim() && row.every((x, n) => n === descAt || !x.trim())) {
      const continuation = row[descAt].trim();
      if (!isLabel(continuation) && !/^quantity\s*:/i.test(continuation)) {
        lastGoods.description += ` ${continuation}`; lastGoods.originalText += `\n${lines[i]}`;
        // Candidate replacement is applied by the caller using the final GoodsLine below.
      }
      continue;
    }
    if (/^\s*(?:trade term|origin|terms of payment|port of|total|signature)\b/i.test(lines[i])) { columns = undefined; lastGoods = undefined; }
  }
  return goods;
}

/** Text is evidence, never a customs decision. Every strategy can decline an uncertain layout. */
export const EXTRACTION_STRATEGIES = ['bilingual_labels', 'adjacent_label_values', 'delimited_tables', 'invoice_numeric_tail', 'transport_blocks'] as const;
export function extractDocument(document: ShipmentDocument): { candidates: Candidate[]; goods: GoodsLine[] } {
  const candidates: Candidate[] = []; const goods: GoodsLine[] = [];
  // This legacy reader must not become a fallback through regrouping, refresh,
  // or another caller. Kimi-only sources are interpreted exclusively by Kimi.
  if (document.extractionPipeline === 'kimi' || document.referenceOnly || ['unsupported', 'failed'].includes(document.extractionStatus)) return { candidates, goods };
  const add: AddCandidate = (field, original, page, location, originalText, lineId, method = 'deterministic_bilingual_label', confidence) => {
    const normalized = normalizeValue(field, original);
    let certainty = confidence || normalized.confidence;
    if (normalized.confidence === 'low') certainty = 'low'; else if (normalized.confidence === 'medium' && certainty === 'high') certainty = 'medium';
    let provenance = method;
    if (page.textSource === 'ocr') { provenance = `browser_local_ocr + ${method}`; certainty = page.ocrConfidence !== undefined && page.ocrConfidence < .8 ? 'low' : certainty === 'high' ? 'medium' : certainty; }
    if (page.textSource === 'manual' || document.transcribedPages?.includes(page.page)) { provenance = `manual_transcription + ${method}`; certainty = 'low'; }
    if (!normalized.value) return '';
    const duplicate = candidates.find(x => x.page === page.page && x.field === field && x.lineId === lineId && x.value === normalized.value && x.originalText === originalText);
    if (!duplicate) candidates.push({ id: `${document.id}:v${document.version}:${page.page}:${candidates.length + 1}`, caseId: document.caseId, documentId: document.id, documentVersion: document.version, field, lineId, value: normalized.value, originalText, page: page.page, location, method: provenance, confidence: certainty, normalizations: normalized.normalizations });
    return normalized.value;
  };
  const role = transportRole(document);
  for (const page of document.pages) {
    if (page.textSource === 'office' && /(?:^|\n)[A-Z]{1,3}\d+:/.test(page.text)) {
      // A worksheet cell map is not a PDF reading order. Only use an explicit
      // label/value inside one cell or an adjacent cell on that same row.
      // In particular, never take the next row's fax/address as a party name.
      for (const row of page.text.split(/\r?\n/)) {
        const cells = [...row.matchAll(/(?:^| \| )([A-Z]{1,3}\d+): ([\s\S]*?)(?= \| [A-Z]{1,3}\d+: |$)/g)];
        for (let i = 0; i < cells.length; i++) {
          const content = cells[i][2].trim();
          const inline = content.match(/^([^:]+):\s*(.+)$/);
          const field = aliasMap.get(keyText(inline ? inline[1] : content));
          if (!field) continue;
          const value = inline?.[2]?.trim() || cells[i + 1]?.[2]?.trim();
          if (!value || aliasMap.has(keyText(value)) || /^(?:fax|phone|tel|address|email|website)\s*:/i.test(value)) continue;
          add(field, value, page, `${page.label || 'Worksheet'} · ${cells[i][1]}`, row, undefined, 'office_explicit_cell_label', 'medium');
        }
      }
      continue;
    }
    const pageType = pageDocumentType(document, page); const transport = ['bill_of_lading', 'air_waybill'].includes(pageType);
    const lines = page.text.split(/\r?\n/); const tableGoods = extractTables(document, page, add);
    goods.push(...tableGoods);
    for (const g of tableGoods) { const desc = candidates.find(c => c.lineId === g.id && c.field === 'description'); if (desc && g.description !== desc.value) { desc.value = g.description; desc.originalText = g.originalText!; desc.method = desc.method.replace('deterministic_delimited_table', 'delimited_table_wrapped_description'); desc.confidence = 'medium'; } }
    const scopedField = (field: string, label: string) => {
      if (field === 'billOfLading' && transport) return role === 'house' ? 'houseBillOfLading' : role === 'master' ? 'masterBillOfLading' : field;
      if (transport && /^(?:consignee|consignce)\b/.test(label)) return role === 'house' ? 'houseConsignee' : role === 'master' ? 'masterConsignee' : 'transportConsignee';
      if (transport && /^shipper\b/.test(label)) return role === 'house' ? 'houseShipper' : role === 'master' ? 'masterShipper' : 'transportShipper';
      if (transport && field === 'notifyParty') return role === 'house' ? 'houseNotifyParty' : role === 'master' ? 'masterNotifyParty' : field;
      return field;
    };
    for (let i = 0; i < lines.length; i++) {
      const originalText = lines[i];
      const inlineLabels = new RegExp(`(?=\\b(?:${allAliases.map(escaped).join('|')}|to|sold to)[.]?\\s*[:=])`, 'gi');
      const segments = originalText.replace(inlineLabels, '\t').split(/\t| {2,}/).map(s => s.trim()).filter(Boolean);
      for (let partIndex = 0; partIndex < segments.length; partIndex++) {
        const part = segments[partIndex];
        let label = ''; let field: string | undefined; let raw = '';
        const exact = aliasMap.get(keyText(part));
        if (exact) { label = keyText(part); field = exact; }
        else {
          for (const alias of allAliases) {
            const re = new RegExp(`^${escaped(alias)}[.：:]?\\s*(?:[:=]\\s*|(?=\\S))(.*)$`, 'i');
            const m = re.exec(part);
            if (m && m[1] && (part.slice(alias.length).match(/^[.：:=\s]/) || /(?:no|number)$/.test(alias))) { label = alias; field = aliasMap.get(alias); raw = m[1]; break; }
          }
        }
        // Commercial addressee is a proposal, not a proven importer identity.
        if (!field && /^(?:to|buyer|sold to)\s*:/i.test(part) && ['invoice', 'packing_list', 'contract'].includes(pageType)) { label = 'to'; field = 'importer'; raw = part.replace(/^[^:]+:\s*/, ''); }
        if (!field) continue;
        field = scopedField(field, label);
        if (['transportShipper', 'transportConsignee', 'notifyParty', 'houseShipper', 'masterShipper', 'houseConsignee', 'masterConsignee', 'houseNotifyParty', 'masterNotifyParty'].includes(field) && /^\(/.test(raw)) raw = '';
        if (!raw) {
          const nextSegment = segments[partIndex + 1];
          if (nextSegment && !isLabel(nextSegment)) raw = nextSegment;
          else { const next = lines.slice(i + 1, i + 4).find(line => line.trim() && !isLabel(line)); if (next && !isLabel(next) && !/\b(?:description|quantity|qty|total)\b/i.test(next)) raw = next.split(/\t| {2,}/)[0].trim(); }
        }
        if (!raw || isLabel(raw)) continue;
        if (['portOfLoading', 'portOfDischarge'].includes(field) && /place of|pre-carriage|tax id|port of/i.test(raw)) continue;
        if (['portOfLoading', 'portOfDischarge'].includes(field) && raw.trim().endsWith(',') && segments[partIndex + 1] && /^[A-Z ]{2,35}$/i.test(segments[partIndex + 1]) && !isLabel(segments[partIndex + 1])) raw += ` ${segments[partIndex + 1]}`;
        if (field === 'container' && !/^(?:[A-Z]{4}\d{7})(?:\s*[,;/]\s*[A-Z]{4}\d{7})*$/i.test(raw)) continue;
        if (field === 'invoiceTotal' && label !== 'invoice total' && pageType !== 'invoice' && document.type !== 'invoice') continue;
        if (numerical.has(field) && !/^[\d,.]+(?:\s*(?:KGS?|KG|PACKAGES?|PKGS?))?$/i.test(raw.trim())) continue;
        if (numerical.has(field)) raw = raw.replace(/\s*(?:KGS?|PACKAGES?|PKGS?)$/i, '');
        if (field === 'incoterm') { const token = raw.match(/^([A-Z]{3})(?:\s|$)/i); if (token) raw = token[1]; }
        if (['billOfLading', 'houseBillOfLading', 'masterBillOfLading', 'invoiceNumber', 'contractNumber', 'transportReference'].includes(field) && !/^[A-Z0-9][A-Z0-9._/-]{2,50}$/i.test(raw.trim())) continue;
        const confidence: Confidence = label === 'to' ? 'low' : raw === part || !/[=:]/.test(part) ? 'medium' : 'high';
        const evidence = originalText.includes(raw) ? originalText : `${originalText}\n${lines[i + 1] || ''}`;
        add(field, raw, page, `Line ${i + 1}${segments.length > 1 ? `, segment ${partIndex + 1}` : ''}`, evidence, undefined, raw === part ? 'adjacent_label_value' : 'contextual_bilingual_label', ['grossWeight', 'netWeight'].includes(field) && !/kg/i.test(part) ? 'medium' : confidence);
      }
      if (transport && /MANIFEST NO\.?\s+BILL OF LADING NO\.?\s*$/i.test(originalText)) {
        const identifiers = lines.slice(i + 1, i + 6).flatMap(line => line.split(/\t| {2,}/)).filter(line => /^[A-Z0-9][A-Z0-9._/-]{3,50}$/i.test(line.trim()));
        if (identifiers.length >= 2) {
          const evidence = lines.slice(i, i + 6).join('\n');
          add('transportReference', identifiers[0].trim(), page, `Adjacent identifier block, line ${i + 1}`, evidence, undefined, 'adjacent_transport_identifiers', 'low');
          add(role === 'house' ? 'houseBillOfLading' : role === 'master' ? 'masterBillOfLading' : 'billOfLading', identifiers[1].trim(), page, `Adjacent identifier block, line ${i + 1}`, evidence, undefined, 'adjacent_transport_identifiers', 'low');
        }
      }
      if (pageType === 'packing_list' && /\bDATE\s*:/i.test(originalText) && /packing list/i.test(lines.slice(Math.max(0, i - 2), i + 1).join(' '))) {
        const date = /\bDATE\s*:\s*(.+)$/i.exec(originalText); if (date) add('packingListDate', date[1], page, `Line ${i + 1}`, originalText, undefined, 'contextual_packing_date', 'medium');
      }
      // Named-form C/O parties: only the first company line, never eligibility/origin conclusions.
      const coParty = /products consigned (from|to)\b/i.exec(originalText);
      if (coParty && pageType === 'certificate_of_origin') {
        const following = lines.slice(i + 1, i + 4).find(x => /\b(?:CO\b|LTD\b|COMPANY\b|CONG TY\b|LIMITED\b)/i.test(x));
        if (following) add(coParty[1].toLowerCase() === 'from' ? 'exporter' : 'importer', following.trim(), page, `Block following line ${i + 1}`, `${originalText}\n${following}`, undefined, 'certificate_party_block', 'low');
      }
      if (transport) {
        const packages = /\b(\d+)\s*(?:PACKAGES|PKGS)\b/i.exec(originalText);
        if (packages) add('packageCount', packages[1], page, `Line ${i + 1}`, originalText, undefined, 'transport_package_statement', 'medium');
        // Multiple containers are a set, not contradictory scalar candidates.
        const containerIds = [...originalText.matchAll(/\b[A-Z]{4}\d{7}\b/g)].map(m => m[0]);
        if (containerIds.length) add('container', containerIds.join(', '), page, `Line ${i + 1}`, originalText, undefined, 'transport_container_identifiers', 'medium');
      }
    }
    // Letterhead identification is deliberately low-confidence and always reviewable.
    if (['invoice', 'packing_list'].includes(pageType) && !candidates.some(c => c.page === page.page && c.field === 'exporter')) {
      const headerAt = lines.findIndex(x => headingType(x.trim()) === pageType);
      if (headerAt > 0) {
        const possible = lines.slice(0, headerAt).map((text, index) => ({ text, index })).find(x => /\b(?:CO[., ]*LTD|CO\.,?\s*LTD|LIMITED|CORPORATION|COMPANY)\b/i.test(x.text) && !/^(?:TO|BUYER|IMPORTER)\b/i.test(x.text));
        if (possible) add('exporter', possible.text.trim(), page, `Letterhead, line ${possible.index + 1}`, possible.text, undefined, 'commercial_letterhead_proposal', 'low');
      }
    }
    if (pageType === 'packing_list') {
      const header = lines.findIndex((line, i) => /(?:QTY|QUANTITY)/i.test(line) && /G[. ]?W[.]?/i.test(line) && /N[. ]?W[.]?/i.test(line) && /\(PACKAGES?\)/i.test(lines.slice(i, i + 3).join(' ')));
      if (header >= 0) {
        for (let i = header + 1; i < Math.min(lines.length, header + 12); i++) {
          const row = new RegExp(`^\\s*TOTAL\\s+(${numericToken})[ |\\t]+(${numericToken})[ |\\t]+(${numericToken})(?:[ |\\t]+${numericToken})?\\s*$`, 'i').exec(lines[i]);
          if (row) ['packageCount', 'grossWeight', 'netWeight'].forEach((field, n) => add(field, row[n + 1], page, `Packing total, line ${i + 1}`, `${lines[header]}\n${lines[header + 1]}\n${lines[i]}`, undefined, 'packing_numeric_totals_proposal', 'low'));
        }
      }
    }
    // Unruled/OCR invoice row fallback. Anchored on the four explicit trailing columns;
    // no row is emitted without a preceding Description + Quantity + Amount header.
    if (pageType === 'invoice' && !tableGoods.length) {
      const headerAt = lines.findIndex((line, index) => /description/i.test(line) && /(?:qty|quantity)/i.test(lines.slice(Math.max(0, index - 1), index + 3).join(' ')) && /amount/i.test(lines.slice(Math.max(0, index - 1), index + 3).join(' ')));
      if (headerAt >= 0) {
        const headerText = lines.slice(Math.max(0, headerAt - 1), headerAt + 3).join('\n');
        const headerCurrency = /(?:unit\s*price|amount)[\s\S]{0,120}\(([A-Z]{3})\)/i.exec(headerText);
        if (headerCurrency) add('currency', headerCurrency[1], page, `Table header near line ${headerAt + 1}`, headerText, undefined, 'invoice_currency_header', 'medium');
        const pattern = new RegExp(`^\\s*(?:\\d+\\s+)?(.+?)\\s+(${numericToken})\\s+([A-Z][A-Z /-]{0,12})\\s+(${numericToken})\\s+(${numericToken})\\s*$`, 'i');
        for (let i = headerAt + 1; i < Math.min(lines.length, headerAt + 15); i++) {
          if (/^\s*(?:total|trade term|terms of payment)\b/i.test(lines[i])) break;
          const row = pattern.exec(lines[i].replace(/\t/g, ' ')); if (!row || /(?:unit price|amount|quantity|qty)$/i.test(row[1])) continue;
          const lineId = `${document.id}:p${page.page}:l${i + 1}`;
          let evidence = lines[i];
          if (/^quantity\s*:/i.test(row[1]) && lines[i - 1]?.trim() && !/description|unit price|amount/i.test(lines[i - 1])) { row[1] = lines[i - 1].trim(); evidence = `${lines[i - 1]}\n${lines[i]}`; }
          const line: GoodsLine = { id: lineId, description: '', quantity: '', unit: '', unitPrice: '', amount: '', hsCode: '', origin: '', dutyRate: '', vatRate: '', sourceDocumentId: document.id, sourcePage: page.page, originalText: evidence, reviewed: false, manual: false };
          for (const [n, field] of ['description', 'quantity', 'unit', 'unitPrice', 'amount'].entries()) (line as unknown as Record<string, string>)[field] = add(field, row[n + 1], page, `Invoice row, line ${i + 1}`, evidence, lineId, 'invoice_numeric_tail_proposal', 'low');
          goods.push(line);
        }
      }
    }
    if (pageType === 'invoice') {
      for (let i = 0; i < lines.length; i++) {
        const total = new RegExp(`^\\s*(?:TOTAL AMOUNT|INVOICE TOTAL|GRAND TOTAL)\\s*[:|\\t ]+(${numericToken})\\s*$`, 'i').exec(lines[i].replace(/^\s*[|—-]+\s*/, ''));
        if (total) add('invoiceTotal', total[1], page, `Line ${i + 1}`, lines[i], undefined, 'invoice_total_statement', 'medium');
        const currency = /(?:UNIT PRICE|AMOUNT)\s*\(([A-Z]{3})\)/i.exec(lines[i]);
        if (currency) add('currency', currency[1], page, `Line ${i + 1}`, lines[i], undefined, 'invoice_currency_header', 'medium');
      }
    }
  }
  // Aggregate explicit container tokens from one document into one source fact.
  const containers = candidates.filter(c => c.field === 'container');
  if (containers.length > 1 && containers.every(c => c.method.includes('transport_container_identifiers'))) {
    const first = containers[0]; first.value = [...new Set(containers.flatMap(c => c.value.split(', ')))].sort().join(', '); first.originalText = containers.map(c => c.originalText).join('\n'); first.location = `Container list, pages ${[...new Set(containers.map(c => c.page))].join(', ')}`;
    for (const c of containers.slice(1)) candidates.splice(candidates.indexOf(c), 1);
  }
  const invoicePages = new Set(document.pages.filter(page => pageDocumentType(document, page) === 'invoice').map(page => page.page));
  return { candidates, goods: invoicePages.size ? goods.filter(line => invoicePages.has(line.sourcePage!)) : goods };
}
