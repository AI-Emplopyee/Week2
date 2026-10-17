import type { UploadedDocument } from './types.ts';

const FIXTURE_SHA256: Record<string, string> = {
  "conflict-invoice": "3049dc06cb8e0f4384359b1fb77e1350e06b74885bf74e39d979e16ecab44559",
  "conflict-packing": "d8846f4d6a8ca74b28bf0e865417129f9789cc65df66ffedaae42957270e6bac",
  "conflict-bl": "a42c45e51c732423f53344d884465b384909e7fc98483b74aa236350db66660c",
  "ready-invoice": "e9cbad751420b3820c16f231df7987e2c76704cc1ac35e918ad54b3c41c181a3",
  "ready-packing": "c2b076fc6afca14359fdd4c8aa34b0b7a3dd5a21b35c591193520601943e37cd",
  "ready-bl": "269b5b279209442fb0c569e102fb9e97e74e169405b23c479ee409a1b57e0f40"
};

function document(id: string, name: string, text: string): UploadedDocument {
  return { id: `demo-${id}`, name, mime: 'text/plain', size: new TextEncoder().encode(text).length, sha256: FIXTURE_SHA256[id], pages: [{ page: 1, text }], extractionPipeline: 'kimi', extractionStatus: 'pending_ai', synthetic: true };
}
const heading = 'SYNTHETIC DEMO — FICTIONAL COMPANIES — NOT A REAL CLIENT SHIPMENT\n';
export function syntheticShipments(): { title: string; documents: UploadedDocument[] }[] {
  return [
    { title: 'Linh kiện điện • cần đối chiếu', documents: [
      document('conflict-invoice', 'DEMO-commercial-invoice-021.txt', `${heading}COMMERCIAL INVOICE\nInvoice Number: DEMO-INV-021\nInvoice Date: 2026-09-25\nB/L Number: DEMO-BL-021\nImporter: Công ty Minh An Demo\nExporter: Harbor Components Demo Ltd\nCurrency: usd\nInvoice Total: 12,500.00\nIncoterm: FOB\nDescription | Quantity | Unit | Unit Price | Amount\nElectronic housings | 500 | PCS | 25.00 | 12500.00`),
      document('conflict-packing', 'DEMO-packing-list-021.txt', `${heading}PACKING LIST\nInvoice Number: DEMO-INV-021\nB/L Number: DEMO-BL-021\nImporter: Công ty Minh An Demo\nExporter: Harbor Components Demo Ltd\nPackages: 25\nGross Weight: 850\nNet Weight: 800\nDescription | Quantity | Unit\nElectronic housings | 480 | PCS`),
      document('conflict-bl', 'DEMO-bill-of-lading-021.txt', `${heading}BILL OF LADING\nB/L Number: DEMO-BL-021\nImporter: Công ty Minh An Demo\nExporter: Harbor Components Demo Ltd\nVessel: DEMO OCEAN\nVoyage: D021\nPort of Loading: Shanghai\nPort of Discharge: Cat Lai\nContainer: DEMO0000021\nPackages: 24\nGross Weight: 850`),
    ] },
    { title: 'Vải dệt • sẵn sàng rà soát', documents: [
      document('ready-invoice', 'DEMO-commercial-invoice-022.txt', `${heading}COMMERCIAL INVOICE\nInvoice Number: DEMO-INV-022\nInvoice Date: 2026-09-26\nB/L Number: DEMO-BL-022\nImporter: Công ty Sợi Việt Demo\nExporter: North Loom Demo Co\nCurrency: USD\nInvoice Total: 8400.00\nIncoterm: CIF\nDescription | Quantity | Unit | Unit Price | Amount\nWoven fabric rolls | 1200 | M | 7.00 | 8400.00`),
      document('ready-packing', 'DEMO-packing-list-022.txt', `${heading}PACKING LIST\nInvoice Number: DEMO-INV-022\nB/L Number: DEMO-BL-022\nImporter: Công ty Sợi Việt Demo\nExporter: North Loom Demo Co\nPackages: 12\nGross Weight: 630\nNet Weight: 600\nDescription | Quantity | Unit\nWoven fabric rolls | 1200 | M`),
      document('ready-bl', 'DEMO-bill-of-lading-022.txt', `${heading}BILL OF LADING\nB/L Number: DEMO-BL-022\nImporter: Công ty Sợi Việt Demo\nExporter: North Loom Demo Co\nVessel: DEMO MERIDIAN\nVoyage: D022\nPort of Loading: Busan\nPort of Discharge: Hai Phong\nContainer: DEMO0000022\nPackages: 12\nGross Weight: 630`),
    ] },
    { title: 'Bản scan • cần bản gốc', documents: [{ id: 'demo-scan', name: 'DEMO-scanned-invoice.png', mime: 'image/png', size: 0, sha256: 'synthetic-fixture-scan-v1', pages: [], extractionPipeline: 'kimi', extractionStatus: 'unsupported', extractionError: 'Synthetic placeholder without image bytes. Supply an original PDF or image for Kimi to read.', synthetic: true }] },
  ];
}
