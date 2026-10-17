import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import {
  EN_TRANSLATIONS,
  auditActionLabel,
  auditReason,
  documentTypeLabel,
  fieldLabel,
  formatDate,
  normalizeLocale,
  translate,
  translateIssue,
  translateSystemText,
} from "../lib/i18n-core.ts";
import {
  createEmptyWorkspace,
  getIssues,
  FIELD_DEFINITIONS,
} from "../lib/engine.ts";
import { applyFixtureAction as applyAction } from './helpers/kimi-fixtures.ts';
import { syntheticShipments } from '../lib/demo.ts';
import type { AuditEntry, Issue } from "../lib/types.ts";

const actor = {
  id: "reviewer-i18n",
  name: "Nguyễn Mai",
  email: "mai@example.test",
};
const vietnamese =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

test("all UI dictionary translations preserve their interpolation parameters", () => {
  assert.ok(Object.keys(EN_TRANSLATIONS).length > 600);
  for (const [source, english] of Object.entries(EN_TRANSLATIONS)) {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(p\d+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(english), placeholders(source), source);
    assert.ok(english.trim().length > 0, source);
  }
});

test("Vietnamese is the fallback and English is an explicit valid preference", () => {
  assert.equal(normalizeLocale(null), "vi");
  assert.equal(normalizeLocale("fr"), "vi");
  assert.equal(normalizeLocale("vi"), "vi");
  assert.equal(normalizeLocale("en"), "en");
  assert.equal(translate("vi", "Dữ liệu giả lập"), "Dữ liệu giả lập");
  assert.equal(translate("en", "Dữ liệu giả lập"), "Synthetic data");
  assert.equal(fieldLabel("grossWeight", "en"), "Gross weight (kg)");
  assert.equal(
    documentTypeLabel("certificate_of_origin", "en"),
    "Certificate of origin",
  );
  assert.equal(formatDate("not-a-date", "en"), "not-a-date");
});

test("parameters keep evidence, punctuation and placeholder-like source text unchanged", () => {
  const filename = "Hóa đơn $& {p1}.pdf";
  const source = "TỔNG TIỀN: 12.450,50 USD";
  const translated = translate("en", "Đã đối chiếu {p0}, trang {p1}: {p2}", {
    p0: filename,
    p1: 3,
    p2: source,
  });
  assert.equal(translated, `Compared against ${filename}, page 3: ${source}`);
  assert.equal(translate("en", " Chứng từ "), " Documents ");
  assert.equal(translate("en", "UNKNOWN CLIENT VALUE"), "UNKNOWN CLIENT VALUE");
});

test('ECUS optional evidence questions translate each problem and preserve goods row identity and evidence', () => {
  for (const problem of ['conflict', 'invalid', 'uncertain'] as const) {
    const issue: Issue = {
      id: `case-ecus:ecus-evidence:["vatTaxAmount","goods-2"]:${problem}`,
      caseId: 'case-ecus', kind: 'declaration', severity: 'error',
      title: 'Vui lòng làm rõ Tiền thuế VAT — dòng hàng 2',
      description: 'Các nguồn cung cấp dữ liệu cần đối chiếu.',
      field: 'ecus.vatTaxAmount', ecusFieldKey: 'vatTaxAmount', goodsLineId: 'goods-2',
      candidateIds: ['candidate-original'], documentIds: ['source-original'], resolved: false,
      fingerprint: 'original-source-fingerprint',
    };
    const before = JSON.stringify(issue);
    const translated = translateIssue(issue, 'en');
    assert.match(translated.title, /Please clarify Goods list · VAT amount — goods row 2/);
    assert.ok(!vietnamese.test(translated.description));
    assert.match(translated.description, problem === 'conflict' ? /different values/ : problem === 'invalid' ? /format or supporting evidence/ : /could not be read clearly/);
    assert.strictEqual(translated.candidateIds, issue.candidateIds);
    assert.strictEqual(translated.documentIds, issue.documentIds);
    assert.equal(translated.goodsLineId, 'goods-2');
    assert.strictEqual(translateIssue(issue, 'vi'), issue);
    assert.equal(JSON.stringify(issue), before);
  }
});

test("dynamic generated issues translate labels while leaving source facts and resolutions intact", () => {
  const issue: Issue = {
    id: "case-1:conflict-invoiceTotal",
    caseId: "case-1",
    kind: "conflict",
    severity: "error",
    title: "Mâu thuẫn trị giá hóa đơn",
    description:
      "Nguồn ghi các giá trị khác nhau. Chọn giá trị hoặc nhập hiệu chỉnh và ghi căn cứ.",
    field: "invoiceTotal",
    candidateIds: ["candidate-1"],
    documentIds: ["invoice-1"],
    resolved: false,
    fingerprint: "abc",
    resolution: {
      issueId: "case-1:conflict-invoiceTotal",
      reason: "Đã hỏi chủ hàng: 12.450 USD",
      actor: "Nguyễn Mai",
      at: "2026-10-11",
      fingerprint: "abc",
    },
  };
  const before = JSON.stringify(issue);
  const english = translateIssue(issue, "en");
  assert.equal(english.title, "Conflicting invoice total");
  assert.ok(!vietnamese.test(english.description));
  assert.strictEqual(english.resolution, issue.resolution);
  assert.strictEqual(english.candidateIds, issue.candidateIds);
  assert.equal(JSON.stringify(issue), before);
  assert.strictEqual(translateIssue(issue, "vi"), issue);
  const goods = {
    ...issue,
    field: undefined,
    id: "case-1:line-conflict-hash-quantity",
    title: "Mâu thuẫn dòng hàng: quantity",
    description:
      "Vải lụa: các bảng chứng từ ghi khác nhau. Rà soát dòng hàng và ghi rõ quyết định xử lý.",
  };
  assert.equal(
    translateIssue(goods, "en").title,
    "Goods line conflict: quantity",
  );
  assert.equal(
    translateIssue(goods, "en").description,
    "Vải lụa: the document tables disagree. Review the goods line and explain your resolution.",
  );
});

test("all issue messages produced by the synthetic regression sets have English presentation", () => {
  const state = applyAction(
    createEmptyWorkspace("i18n-test"),
    { type: "intake", documents: syntheticShipments().flatMap(shipment => shipment.documents) },
    actor,
  );
  const original = JSON.stringify(state);
  const issues = getIssues(state);
  assert.ok(issues.length > 10);
  for (const issue of issues) {
    const translated = translateIssue(issue, "en");
    assert.ok(!vietnamese.test(translated.title), translated.title);
    assert.ok(!vietnamese.test(translated.description), translated.description);
  }
  assert.equal(
    JSON.stringify(state),
    original,
    "presentation must not mutate stored evidence or decisions",
  );
});

test("generated counts, OCR progress and errors translate while captured filenames remain original", () => {
  assert.equal(
    translateSystemText(
      "Còn 17 vấn đề chưa xử lý; chưa thể đóng băng bản rà soát.",
      "en",
    ),
    "17 unresolved issues remain; the reviewed version cannot be frozen yet.",
  );
  assert.equal(
    translateSystemText("Đang nhận dạng Hóa đơn.pdf · trang 2/6 · 85%", "en"),
    "Recognizing Hóa đơn.pdf · page 2/6 · 85%",
  );
  assert.equal(
    translateSystemText(
      "Cần kiểm tra / chép lại trang 1, 4. OCR chưa đọc đủ rõ.",
      "en",
    ),
    "Check / transcribe page 1, 4. OCR could not read it clearly enough.",
  );
  assert.equal(
    translateSystemText("Vận đơn.pdf: Tệp vượt quá giới hạn 20 MB.", "en"),
    "Vận đơn.pdf: The file exceeds the 20 MB limit.",
  );
  assert.equal(
    translateSystemText(
      "Received 3 files. Check the grouping and proposed data.",
      "vi",
    ),
    "Đã tiếp nhận 3 tệp. Kiểm tra phân nhóm và dữ liệu được đề xuất.",
  );
});

test("audit labels are translated but reviewer-authored decisions remain verbatim", () => {
  const entry: AuditEntry = {
    id: "audit-1",
    caseId: "case-1",
    actor: "Nguyễn Mai",
    action: "field_reviewed",
    at: "2026-10-11T11:00:00Z",
    reason: "Đã đối chiếu với chứng từ nguồn.",
    before: "12.000",
    after: "12.450",
  };
  assert.equal(auditActionLabel("field_reviewed", "en"), "Value reviewed");
  assert.equal(
    auditReason(entry, "en"),
    entry.reason,
    "even an exact dictionary match must preserve the reviewer’s wording",
  );
  assert.equal(
    auditReason(
      { ...entry, action: "case_created", reason: "Tạo hồ sơ để rà soát." },
      "en",
    ),
    "Case created for review.",
  );
  assert.equal(
    translateSystemText("Nguyễn Mai xác nhận 12.450 USD", "en"),
    "Nguyễn Mai xác nhận 12.450 USD",
  );
});

test("all static translated UI keys are registered and visible Vietnamese JSX is explicitly localized", () => {
  const missing = new Set<string>();
  const untranslated = new Set<string>();
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments[0]
    ) {
      const inspectKey = (expression: ts.Node): void => {
        if (ts.isStringLiteral(expression)) {
          const key = expression.text.trim();
          if (key && !Object.hasOwn(EN_TRANSLATIONS, key)) missing.add(key);
        } else if (ts.isConditionalExpression(expression)) {
          inspectKey(expression.whenTrue);
          inspectKey(expression.whenFalse);
        }
      };
      inspectKey(node.arguments[0]);
    }
    if (
      ts.isJsxText(node) &&
      vietnamese.test(node.text) &&
      node.text.trim() !== "Tiếng Việt"
    )
      untranslated.add(node.text.trim());
    ts.forEachChild(node, visit);
  }
  function inspectDirectory(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(
        entry.name + (entry.isDirectory() ? "/" : ""),
        directory,
      );
      if (entry.isDirectory()) inspectDirectory(path);
      else if (entry.name.endsWith(".tsx")) {
        visit(
          ts.createSourceFile(
            path.pathname,
            readFileSync(path, "utf8"),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
          ),
        );
      }
    }
  }
  inspectDirectory(new URL("../app/", import.meta.url));
  inspectDirectory(new URL("../components/", import.meta.url));
  assert.deepEqual(
    [...missing],
    [],
    "every UI translation key must have an English value",
  );
  assert.deepEqual(
    [...untranslated],
    [],
    "visible JSX must use explicit translation bindings",
  );
});

test("every declaration field and group has an explicit English label, including transport levels", () => {
  for (const field of FIELD_DEFINITIONS) {
    assert.equal(
      fieldLabel(field.key, "vi"),
      field.label,
      `${field.key}: source label drift`,
    );
    assert.ok(
      Object.hasOwn(EN_TRANSLATIONS, field.label),
      `${field.key}: no explicit English dictionary entry`,
    );
    const english = fieldLabel(field.key, "en");
    assert.equal(english, EN_TRANSLATIONS[field.label]);
    assert.ok(
      !vietnamese.test(english),
      `${field.key}: Vietnamese in English label`,
    );
    assert.ok(
      Object.hasOwn(EN_TRANSLATIONS, field.group),
      `${field.group}: group is not translated`,
    );
    const issue: Issue = {
      id: `case-transport:review-${field.key}`,
      caseId: "case-transport",
      kind: "uncertain",
      severity: "warning",
      title: `Rà soát ${field.label.toLowerCase()}`,
      description:
        "Giá trị mới chỉ là đề xuất từ nguồn; cần người rà soát xác nhận.",
      field: field.key,
      candidateIds: [],
      documentIds: [],
      resolved: false,
      fingerprint: field.key,
    };
    assert.equal(
      translateIssue(issue, "en").title,
      `Review ${english.toLocaleLowerCase("en")}`,
    );
  }
  assert.equal(fieldLabel("houseShipper", "en"), "House bill shipper");
  assert.equal(fieldLabel("masterShipper", "en"), "Master bill shipper");
  assert.equal(
    fieldLabel("transportReference", "en"),
    "Transport / booking reference",
  );
  assert.equal(fieldLabel("packingListDate", "en"), "Packing list date");
});

test("server-authoritative OCR quality messages preserve page lists in English", () => {
  assert.equal(
    translateSystemText(
      "Trang 1, 4, 7 chưa có văn bản đủ rõ hoặc OCR có độ tin cậy thấp. Đối chiếu bản gốc và chép lại các trang này.",
      "en",
    ),
    "Page(s) 1, 4, 7 have insufficient text or low-confidence OCR. Check the original and transcribe these pages.",
  );
  assert.equal(
    translateSystemText(
      "Chưa có văn bản hoặc kết quả OCR dùng được. Đối chiếu bản gốc và thêm bản chép đã kiểm tra.",
      "en",
    ),
    "No usable text or OCR result is available. Check the original and add a verified transcription.",
  );
  assert.equal(
    translateSystemText(
      "Trích xuất chưa hoàn tất. Đối chiếu bản gốc và kiểm tra bản chép trước khi phê duyệt.",
      "en",
    ),
    "Extraction is incomplete. Check the original and verify the transcription before approval.",
  );
});

test("joined OCR diagnostics translate known lines and preserve unknown source diagnostics", () => {
  const original =
    "Chưa có văn bản hoặc kết quả OCR dùng được. Đối chiếu bản gốc và thêm bản chép đã kiểm tra.\nMã lỗi từ tệp Hóa đơn.pdf: CUSTOM-42";
  assert.equal(
    translateSystemText(original, "en"),
    "No usable text or OCR result is available. Check the original and add a verified transcription.\nMã lỗi từ tệp Hóa đơn.pdf: CUSTOM-42",
  );
});

test("automatic grouping explanations and uncertain goods questions are localized without changing source text", () => {
  const invoice = "Cùng số hóa đơn và thông tin đối chiếu của lô hàng.";
  const transport =
    "Cùng booking / tham chiếu vận chuyển và nhiều thông tin vận chuyển đối chiếu.";
  const combined = `${invoice} ${transport}`;
  assert.equal(
    translateSystemText(combined, "en"),
    `${EN_TRANSLATIONS[invoice]} ${EN_TRANSLATIONS[transport]}`,
  );
  assert.equal(
    translateSystemText(`${combined} Nội dung gốc của khách hàng.`, "en"),
    `${combined} Nội dung gốc của khách hàng.`,
    "unknown source text must not be partially translated",
  );
  for (const action of [
    "shipment_grouping_evaluated",
    "document_grouped",
    "merged_review_conflict",
    "merged_declaration_conflict",
    "shipment_declaration_synchronized",
    "email_questions_drafted",
    "email_draft_updated",
  ]) {
    assert.notEqual(auditActionLabel(action, "en"), action);
    assert.ok(!vietnamese.test(auditActionLabel(action, "en")));
  }
  for (const source of [
    "Nhóm có số vận đơn trái ngược; cần kiểm tra và tách chứng từ nếu thuộc nhiều lô hàng.",
    "Thông tin khớp nhiều lô hàng có vận đơn khác nhau; cần xác nhận lô hàng nhận chứng từ.",
    "Chưa có đủ định danh và thông tin đối chiếu duy nhất; chứng từ được giữ riêng để xác nhận.",
    "Rà soát dòng hàng chưa chắc chắn",
    "Một số dòng hàng được đọc từ nguồn chưa rõ. Kiểm tra mô tả, số lượng, đơn vị và trị giá tại nguồn rồi xác nhận bảng hàng.",
  ])
    assert.ok(!vietnamese.test(translateSystemText(source, "en")), source);
  assert.ok(
    vietnamese.test(
      translateSystemText(
        "Combined current shipment sources into draft fields; human decisions retained and affected evidence changes flagged.",
        "vi",
      ),
    ),
  );
});
