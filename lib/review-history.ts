import { fieldLabel } from "./i18n-core.ts";
import { actionableReviewIssues } from "./review-questions.ts";
import { normalizedShipmentValue } from "./shipment-autofill.ts";
import type {
  Action,
  Actor,
  Candidate,
  Issue,
  ReviewedValue,
  ReviewHistoryEntry,
  ShipmentCase,
  WorkspaceState,
} from "./types.ts";

const directDecisions = new Set<Action["type"]>([
  "review_field",
  "review_goods",
  "resolve_issue",
  "confirm_grouping",
  "save_declaration_field",
]);
const sourceQuestionKinds = new Set<Issue["kind"]>([
  "missing",
  "uncertain",
  "conflict",
  "stale",
]);
function activeHeaderCandidates(
  state: WorkspaceState,
  caseId: string,
  field: string,
): Candidate[] {
  const documents = new Map(
    state.documents
      .filter((document) => document.active && document.caseId === caseId)
      .map((document) => [document.id, document]),
  );
  return state.candidates.filter(
    (candidate) =>
      candidate.caseId === caseId &&
      candidate.field === field &&
      !candidate.lineId &&
      documents.get(candidate.documentId)?.version ===
        candidate.documentVersion,
  );
}
function isReviewedValue(value: unknown): value is ReviewedValue {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ReviewedValue).value === "string" &&
    typeof (value as ReviewedValue).reviewedAt === "string"
  );
}
function sameSourceQuestion(a: Issue, b: Issue): boolean {
  return (
    a.id === b.id ||
    (!!a.field &&
      a.field === b.field &&
      a.goodsLineId === b.goodsLineId &&
      a.ecusFieldKey === b.ecusFieldKey &&
      sourceQuestionKinds.has(a.kind) &&
      sourceQuestionKinds.has(b.kind))
  );
}

/** Recover only decisions whose evidence and current review are still identifiable.
 * Old high-confidence facts never become invented historical questions. */
function legacyFieldHistory(
  state: WorkspaceState,
  shipment: ShipmentCase,
  issues: Issue[],
): ReviewHistoryEntry[] {
  const recovered: ReviewHistoryEntry[] = [];
  for (const audit of state.audit.filter(
    (entry) =>
      entry.caseId === shipment.id &&
      entry.action === "field_reviewed" &&
      entry.field,
  )) {
    if (!isReviewedValue(audit.after)) continue;
    const reviewed = shipment.fields[audit.field!];
    if (
      !reviewed ||
      reviewed.stale ||
      reviewed.reviewedAt !== audit.after.reviewedAt ||
      reviewed.reviewedBy !== audit.after.reviewedBy ||
      reviewed.value !== audit.after.value
    )
      continue;
    const candidates = activeHeaderCandidates(state, shipment.id, audit.field!);
    if (
      reviewed.source === "candidate" &&
      !candidates.some((candidate) => candidate.id === reviewed.candidateId)
    )
      continue;
    const sameFieldValues = new Set(
      candidates.map((candidate) =>
        normalizedShipmentValue(candidate.field, candidate.value),
      ),
    );
    const staleBefore = isReviewedValue(audit.before) && audit.before.stale;
    const knownConflict = sameFieldValues.size > 1;
    const knownUncertainty =
      candidates.length > 0 &&
      !candidates.some((candidate) => candidate.confidence === "high") &&
      new Set(
        candidates
          .filter((candidate) => candidate.confidence === "medium")
          .map((candidate) => candidate.documentId),
      ).size < 2;
    if (!knownConflict && !knownUncertainty && !staleBefore) continue;
    const kind: Issue["kind"] = staleBefore
      ? "stale"
      : knownConflict
        ? "conflict"
        : "uncertain";
    const suffix =
      kind === "stale" ? "stale" : kind === "conflict" ? "conflict" : "review";
    const issueId = `${shipment.id}:${suffix}-${audit.field}`;
    const current = issues.find((issue) => issue.id === issueId);
    const label = fieldLabel(audit.field!, "vi").toLocaleLowerCase("vi");
    const question: Issue = current
      ? { ...structuredClone(current), resolved: false, resolution: undefined }
      : {
          id: issueId,
          caseId: shipment.id,
          kind,
          severity: "error",
          field: audit.field,
          title: `${kind === "stale" ? "Rà soát lại" : kind === "conflict" ? "Mâu thuẫn" : "Rà soát"} ${label}`,
          description:
            kind === "conflict"
              ? "Nguồn ghi các giá trị khác nhau. Chọn giá trị hoặc nhập hiệu chỉnh và ghi căn cứ."
              : kind === "stale"
                ? "Bộ chứng từ đã thay đổi kể từ quyết định trước. Cần lưu lại quyết định trên nguồn hiện tại."
                : "Nguồn có giá trị chưa chắc chắn hoặc định dạng mơ hồ; cần kiểm tra và xác nhận.",
          candidateIds: candidates.map((candidate) => candidate.id),
          documentIds: [
            ...new Set(candidates.map((candidate) => candidate.documentId)),
          ],
          fingerprint: `legacy:${audit.id}`,
          resolved: false,
        };
    recovered.push({
      id: `legacy:${audit.id}`,
      issue: question,
      status: reviewed.source === "candidate" ? "confirmed" : "corrected",
      action: "review_field",
      actor: audit.actor,
      at: audit.at,
      reason: audit.reason,
      value: reviewed.value,
    });
  }
  return recovered;
}

/** Completed questions are presentation/history only. They never resolve or approve current issues. */
export function getReviewHistory(
  state: WorkspaceState,
  caseId: string,
  currentIssues: Issue[],
): ReviewHistoryEntry[] {
  const shipment = state.cases.find((item) => item.id === caseId);
  if (!shipment) return [];
  const pending = currentIssues.filter(
    (issue) => issue.caseId === caseId && !issue.resolved,
  );
  const byQuestion = new Map<string, ReviewHistoryEntry>();
  const recorded = shipment.reviewHistory ?? [];
  const entries = [
    ...legacyFieldHistory(state, shipment, currentIssues).filter(
      (entry) => !recorded.some((saved) => saved.issue.id === entry.issue.id),
    ),
    ...recorded,
  ];
  for (const entry of entries.sort((a, b) => a.at.localeCompare(b.at))) {
    if (
      entry.issue.caseId !== caseId ||
      pending.some((issue) => sameSourceQuestion(entry.issue, issue))
    )
      continue;
    byQuestion.set(entry.issue.id, entry);
  }
  return [...byQuestion.values()].sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
}

function decisionFor(
  action: Action,
  issue: Issue,
  before: WorkspaceState,
): { status: ReviewHistoryEntry["status"]; value?: string } {
  if (action.type === "review_field" && action.field === issue.field) {
    const candidate = before.candidates.find(
      (item) => item.id === action.candidateId,
    );
    return {
      status:
        candidate && candidate.value === action.value.trim()
          ? "confirmed"
          : "corrected",
      value: action.value.trim(),
    };
  }
  if (
    action.type === "save_declaration_field" &&
    action.fieldId === issue.field &&
    action.review
  )
    return { status: "confirmed" };
  if (action.type === "confirm_grouping" && issue.kind === "grouping")
    return { status: "confirmed" };
  if (action.type === "review_goods") {
    const selected = new Set(action.reviewedLineIds ?? []);
    const sourceLines = issue.candidateIds.flatMap((id) =>
      before.candidates
        .filter((candidate) => candidate.id === id && candidate.lineId)
        .map((candidate) => candidate.lineId!),
    );
    const priorGoods =
      before.cases.find((shipment) => shipment.id === action.caseId)?.goods ??
      [];
    const scopedLine = priorGoods.find((line) =>
      issue.id.endsWith(`-${line.id}`),
    );
    const explicitlyConfirmed =
      (!!scopedLine && selected.has(scopedLine.id)) ||
      sourceLines.some((id) => selected.has(id));
    return { status: explicitlyConfirmed ? "confirmed" : "corrected" };
  }
  return { status: "resolved" };
}

/** Persist before/after transitions, not a blanket 'confirm group' flag.
 * Every captured question existed and was actionable before this authenticated action. */
export function recordReviewHistory(
  before: WorkspaceState,
  state: WorkspaceState,
  action: Action,
  actor: Actor,
  beforeIssues: Issue[],
  afterIssues: Issue[],
): void {
  if (!directDecisions.has(action.type) || !("caseId" in action)) return;
  const shipment = state.cases.find(
    (item) => item.id === action.caseId && !item.mergedInto,
  );
  if (!shipment) return;
  if (action.type === "save_declaration_field" && !action.review) return;
  const completed = actionableReviewIssues(before, beforeIssues).filter(
    (issue) =>
      issue.caseId === shipment.id &&
      !afterIssues.some(
        (current) => !current.resolved && sameSourceQuestion(issue, current),
      ),
  );
  if (!completed.length) return;
  const at = new Date().toISOString();
  const reason = "reason" in action ? action.reason?.trim() || "" : "";
  shipment.reviewHistory ??= [];
  for (const issue of completed) {
    const decision = decisionFor(action, issue, before);
    shipment.reviewHistory.push({
      id: `question-${crypto.randomUUID()}`,
      issue: structuredClone(issue),
      ...decision,
      action: action.type,
      actor: actor.name,
      at,
      reason,
    });
  }
}

/** Single purpose predicate keeps issue scans off unrelated mutations. */
export function recordsReviewHistory(action: Action): boolean {
  return directDecisions.has(action.type);
}
