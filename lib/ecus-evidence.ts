import type { Candidate } from "./types.ts";
import type { DeclarationProvenance } from "./declaration-types.ts";
import { ECUS_FORM_FIELDS, type EcusFormField } from "./ecus-form.ts";
import { canonicalExtractionField } from "./extraction.ts";
import { normalizedShipmentValue } from "./shipment-autofill.ts";

/** A component of a combined declaration entry must not borrow another component's evidence or score. */
export function ecusEvidenceReadings(
  field: EcusFormField,
  provenance: DeclarationProvenance[],
  candidates: Candidate[],
  fieldCandidates: Candidate[] = [],
  referenceValue = "",
) {
  const key = canonicalExtractionField(field.sourceField ?? field.key);
  const sharedEntry =
    ECUS_FORM_FIELDS.filter((item) => item.fieldId === field.fieldId).length >
    1;
  return provenance.flatMap<{
    source: DeclarationProvenance;
    index: number;
    candidate?: Candidate;
    scoreEligible: boolean;
  }>((source, index) => {
    if (source.kind === "manual")
      return [{ source, index, scoreEligible: false }];
    const sourceCandidateId =
      source.visualEvidence?.candidateId ?? source.candidateId;
    const matchesSource = (candidate: Candidate) =>
      candidate.documentId === source.documentId &&
      candidate.documentVersion === source.documentVersion &&
      candidate.page === source.page &&
      (sourceCandidateId
        ? candidate.id === sourceCandidateId
        : candidate.originalText === source.quote);
    const available = [...fieldCandidates, ...candidates].filter(matchesSource);
    const relevant = available.filter(
      (candidate) =>
        canonicalExtractionField(candidate.field) === key ||
        fieldCandidates.some((item) => item.id === candidate.id),
    );
    const matching = relevant.filter(
      (candidate) =>
        field.rowIndex === undefined ||
        normalizedShipmentValue(key, candidate.value) ===
          normalizedShipmentValue(key, referenceValue),
    );
    // A quoted value can recur on multiple goods rows. Without a recorded ID,
    // document/page/quote alone cannot decide whose score belongs to this field.
    const unique = new Map<string, Candidate>();
    for (const candidate of matching)
      if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
    const candidate = sourceCandidateId
      ? matching[0]
      : unique.size === 1
        ? [...unique.values()][0]
        : undefined;
    if (sharedEntry && !candidate) return [];
    return [
      {
        source,
        index,
        candidate,
        scoreEligible:
          !!candidate ||
          (!available.length && !!sourceCandidateId && !sharedEntry),
      },
    ];
  });
}

/** CSS crop coordinates are relative to the crop, not the original full-page box. */
export function visionCropGeometry(
  bounds: [number, number, number, number],
  padding = 0.015,
) {
  const [x, y, width, height] = bounds;
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1.000001 ||
    y + height > 1.000001
  )
    return undefined;
  const left = Math.max(0, x - padding),
    top = Math.max(0, y - padding);
  const right = Math.min(1, x + width + padding),
    bottom = Math.min(1, y + height + padding);
  const cropWidth = right - left,
    cropHeight = bottom - top;
  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight,
    imageWidthPercent: 100 / cropWidth,
    imageLeftPercent: (-100 * left) / cropWidth,
    imageTopPercent: (-100 * top) / cropHeight,
  };
}
