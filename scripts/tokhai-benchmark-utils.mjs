import path from 'node:path';
import { applyAction } from '../lib/engine.ts';

export const BENCHMARK_GROUPING_ASSUMPTION = 'Benchmark fixture assumption: the audited sample folder supplies the document partition and direction. Grouping accuracy is not evaluated. No employee declaration values were used to establish this partition.';

/** Only for the isolated benchmark fixture, never a live grouping decision. */
export function confirmBenchmarkGrouping(state, actor) {
  for (const shipment of state.cases.filter(shipment => !shipment.mergedInto && shipment.documentIds.length)) {
    state = applyAction(state, { type: 'confirm_grouping', caseId: shipment.id, reason: BENCHMARK_GROUPING_ASSUMPTION }, actor);
  }
  return state;
}

const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const declarationName = value => /to[\s_-]*khai/i.test(path.basename(String(value).normalize('NFD').replace(/\p{M}/gu, '')));

/** Validate every alias before deduplicating so a renamed answer key cannot enter AI inputs. */
export function benchmarkSources(manifest) {
  const heldOut = new Set(manifest.packets.flatMap(packet => [...packet.heldOut, ...(packet.grounds ?? [])].map(source => source.sha256)));
  const sources = new Map();
  for (const source of manifest.packets.flatMap(packet => packet.sources)) {
    if (!fingerprint(source.sha256)) throw new Error('A benchmark source has an invalid fingerprint.');
    if (heldOut.has(source.sha256) || [source.name, source.relativePath, ...(source.sourcePaths ?? [])].some(declarationName)
      || /declaration|ground_truth/.test(source.role ?? '')) throw new Error('A held-out declaration entered the source manifest.');
    sources.set(source.sha256, source);
  }
  return { heldOut, sources: [...sources.values()] };
}

export function preparedMetadataError(source, prepared, targetDirectory) {
  if (prepared?.error) return prepared.error;
  if (prepared?.sourceSha256 !== source.sha256) return 'Rendered metadata does not match the original fingerprint.';
  if (!Array.isArray(prepared.pages) || !prepared.pages.length || prepared.pages.length > 200) return 'Source has no valid rendered pages.';
  for (const [index, page] of prepared.pages.entries()) {
    if (page.page !== index + 1 || !fingerprint(page.imageSha256)
      || !Number.isInteger(page.width) || !Number.isInteger(page.height)
      || page.width < 1 || page.height < 1 || page.width > 2600 || page.height > 2600
      || typeof page.imagePath !== 'string' || path.resolve(page.imagePath) !== path.join(path.resolve(targetDirectory), `page-${page.page}.jpg`)) {
      return 'Rendered page metadata is invalid or outside this source directory.';
    }
  }
  return null;
}

export function readingMatches(reading, source, page, promptHash, model) {
  if (reading?.sourceSha256 !== source.sha256 || reading.page !== page.page || reading.promptHash !== promptHash
    || reading.inputImageSha256 !== page.imageSha256 || !Number.isFinite(reading.elapsedMs) || reading.elapsedMs < 0
    || !Number.isFinite(Date.parse(reading.at))) return false;
  if (reading.error) return true;
  return reading.result?.model === model && reading.result.pages?.length === 1 && reading.result.pages[0] === page.page
    && reading.visionEvidence?.length === 1 && reading.visionEvidence[0].page === page.page
    && reading.visionEvidence[0].imageSha256 === page.imageSha256
    && reading.visionEvidence[0].width === page.width && reading.visionEvidence[0].height === page.height;
}

/** Empty/unread documents and unresolved model evidence must not be reported as ready. */
export function packetReadiness(documents, failures, caseType) {
  if (!documents.length) return { status: 'no_primary_sources', readingStatus: 'not_run', formStatus: 'unavailable', blockedPages: 0, blockedDocuments: 0 };
  const blockedDocuments = documents.filter(document => !document.pages.length || document.extractionStatus !== 'extracted'
    || document.aiStatus !== 'completed' || document.aiRejectedPages?.length
    || document.pages.some(page => page.aiReadability !== 'clear'));
  const blockedPages = blockedDocuments.reduce((sum, document) => sum + document.pages.filter(page => page.aiReadability !== 'clear'
    || !document.aiProcessedPages?.includes(page.page) || document.aiRejectedPages?.includes(page.page)).length, 0);
  const readingStatus = failures.length || blockedDocuments.length ? 'incomplete' : 'complete';
  return { status: readingStatus, readingStatus, formStatus: caseType === 'import' ? 'draft' : 'unsupported_direction', blockedPages, blockedDocuments: blockedDocuments.length };
}

export function packetTimings(runs) {
  const started = runs.map(run => Date.parse(run.at)).filter(Number.isFinite);
  const finished = runs.map(run => Date.parse(run.at) + run.elapsedMs).filter(Number.isFinite);
  return {
    serviceMs: runs.reduce((sum, run) => sum + (Number.isFinite(run.elapsedMs) ? run.elapsedMs : 0), 0),
    // This includes gaps/rate-limit waits between pages and parallel execution, unlike the summed service time.
    wallElapsedMs: started.length && finished.length ? Math.max(...finished) - Math.min(...started) : null,
    firstRequestAt: started.length ? new Date(Math.min(...started)).toISOString() : null,
    lastResponseAt: finished.length ? new Date(Math.max(...finished)).toISOString() : null,
  };
}
