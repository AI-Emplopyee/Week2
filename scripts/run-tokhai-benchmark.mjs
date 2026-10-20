/** Offline preparation and opt-in live evaluation. Never changes the live workspace.
 * node --experimental-strip-types scripts/run-tokhai-benchmark.mjs --prepare
 * node --experimental-strip-types scripts/run-tokhai-benchmark.mjs --run
 * Originals are hash-checked; employee declarations are held out by the manifest.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PDFiumLibrary } from '@hyzyla/pdfium';
import sharp from 'sharp';
import { rasterizePdfPage } from '../lib/pdf-raster.ts';
import { jpegDimensions, VISION_LIMITS } from '../lib/vision.ts';
import { extractWithKimi, kimiExtractionPrompt, kimiRepairPrompt, kimiPageImagePrompt, KIMI_LIMITS, DEFAULT_KIMI_MODEL } from '../lib/kimi.ts';
import { createEmptyWorkspace, applyAction, getIssues } from '../lib/engine.ts';
import { benchmarkSources, preparedMetadataError, readingMatches, packetReadiness, packetTimings, confirmBenchmarkGrouping, BENCHMARK_GROUPING_ASSUMPTION } from './tokhai-benchmark-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'outputs/private-tokhai-benchmark');
const args = process.argv.slice(2);
if (!['--prepare', '--run', '--assemble'].includes(args[0]) || args.length > 2 || (args.length === 2 && (args[0] !== '--run' || args[1] !== '--retry-failed'))) throw new Error('Choose --prepare (offline), --run [--retry-failed] (live Kimi), or --assemble (offline cached results).');
const mode = args[0];
const concurrency = Number(process.env.AICD_BENCHMARK_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Benchmark concurrency must be an integer from 1 to 8.');
// Report watchers assemble from saved readings into staging, never into a live run's output.
const assemblyDirectory = mode === '--assemble' && process.env.AICD_BENCHMARK_ASSEMBLY_OUTPUT
  ? path.resolve(process.env.AICD_BENCHMARK_ASSEMBLY_OUTPUT) : directory;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const save = async (filename, value) => { await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 }); await fs.writeFile(`${filename}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.rename(`${filename}.tmp`, filename); };
const exists = async filename => fs.access(filename).then(() => true, () => false);
const run = promisify(execFile);
const manifest = await json(path.join(directory, 'manifest.json'));
const { heldOut, sources } = benchmarkSources(manifest);
const workerPool = async (items, parallel, processItem) => {
  let cursor = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { for (;;) { const index = cursor++; if (index >= items.length) return; await processItem(items[index], index); } }));
};
const preparedPath = source => path.join(directory, 'rendered', source.sha256, 'metadata.json');

async function prepare(source, pdfium) {
  const target = path.dirname(preparedPath(source));
  const bytes = await fs.readFile(source.originalPath);
  if (hash(bytes) !== source.sha256) throw new Error(`Original hash mismatch: ${source.name}`);
  if (await exists(preparedPath(source))) {
    const cached = await json(preparedPath(source));
    if (!preparedMetadataError(source, cached, target) && (await Promise.all(cached.pages.map(async page => {
      try { const bytes = await fs.readFile(page.imagePath); const dimensions = jpegDimensions(bytes); return hash(bytes) === page.imageSha256 && dimensions.width === page.width && dimensions.height === page.height; } catch { return false; }
    }))).every(Boolean)) return cached;
  }
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  let pdfBytes;
  let conversion = 'original_pdf';
  if (source.extension === '.pdf') pdfBytes = bytes;
  else if (['.xls', '.xlsx', '.doc', '.docx'].includes(source.extension)) {
    // Use the native page layout; do not feed cell extraction or historical text to Kimi.
    const input = path.join(target, `original${source.extension}`);
    await fs.writeFile(input, bytes, { mode: 0o600 });
    await fs.rm(path.join(target, 'original.pdf'), { force: true });
    await run(process.env.AICD_SOFFICE || 'soffice', [`-env:UserInstallation=${pathToFileURL(path.join(target, 'office-profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', target, input], { timeout: 120_000, maxBuffer: 128 * 1024 });
    pdfBytes = await fs.readFile(path.join(target, 'original.pdf'));
    conversion = 'office_native_layout_to_pdf';
  }
  const pages = [];
  async function imagePage(page, encoder) {
    let encoded;
    for (const quality of [88, 75, 60, 45]) {
      encoded = await encoder.clone().jpeg({ quality }).toBuffer();
      if (encoded.length <= VISION_LIMITS.maxImageBytes) break;
    }
    const dimensions = jpegDimensions(encoded);
    const imagePath = path.join(target, `page-${page}.jpg`);
    await fs.writeFile(imagePath, encoded, { mode: 0o600 });
    pages.push({ page, imageSha256: hash(encoded), ...dimensions, imagePath });
  }
  if (pdfBytes) {
    const pdf = await pdfium.loadDocument(new Uint8Array(pdfBytes));
    try {
      const count = pdf.getPageCount();
      if (count < 1 || count > 200) throw new Error(`Rendered document has ${count} pages; requires review before extraction.`);
      for (let page = 1; page <= count; page++) {
        const raster = await rasterizePdfPage(pdf, page);
        await imagePage(page, sharp(raster.data, { raw: { width: raster.width, height: raster.height, channels: 4 } }).flatten({ background: '#ffffff' }));
      }
    } finally { pdf.destroy(); }
  } else {
    if (!source.mime.startsWith('image/')) throw new Error('Source format requires a supported native PDF export.');
    conversion = 'original_image';
    const info = await sharp(bytes).metadata();
    if ((info.pages || 1) > 200) throw new Error('Image document exceeds the 200-page limit.');
    for (let page = 0; page < (info.pages || 1); page++) {
      await imagePage(page + 1, sharp(bytes, { page, pages: 1 }).rotate().flatten({ background: '#ffffff' }).resize(2600, 2600, { fit: 'inside', withoutEnlargement: true }));
    }
  }
  const result = { sourceSha256: source.sha256, name: source.name, conversion, preparedAt: new Date().toISOString(), pages };
  await save(preparedPath(source), result);
  return result;
}

if (mode === '--prepare') {
  const pdfium = await PDFiumLibrary.init();
  let done = 0, failed = 0, pageCount = 0;
  try {
    // A single renderer also avoids racing native office application profiles.
    await workerPool(sources, 1, async source => {
      try { const result = await prepare(source, pdfium); pageCount += result.pages.length; }
      catch (error) { failed++; await save(preparedPath(source), { sourceSha256: source.sha256, name: source.name, error: error.message, pages: [] }); }
      console.log(JSON.stringify({ stage: 'prepare', done: ++done, total: sources.length, failed, pageCount }));
    });
  } finally { pdfium.destroy(); }
  await save(path.join(directory, 'preparation-summary.json'), { generatedAt: new Date().toISOString(), total: sources.length, ready: done - failed, failed, pageCount, heldOut: heldOut.size });
  process.exitCode = failed ? 1 : 0;
} else {
  const actor = { id: 'tokhai-benchmark', name: 'ToKhai benchmark', email: '' };
  const secrets = mode === '--run' ? parseEnv(await fs.readFile(path.join(root, '.aicd-local/.dev.vars'), 'utf8')) : {};
  const profilePath = path.join(directory, 'run-profile.json');
  const profile = await exists(profilePath) ? await json(profilePath) : {};
  const config = { apiKey: secrets.MOONSHOT_API_KEY, model: secrets.MOONSHOT_MODEL || profile.model || DEFAULT_KIMI_MODEL };
  if (mode === '--run' && !config.apiKey) throw new Error('Configure MOONSHOT_API_KEY in the private local configuration first.');
  const promptHash = hash(JSON.stringify([config.model, kimiExtractionPrompt(), kimiRepairPrompt('{diagnostic}'), kimiPageImagePrompt('{page}'), KIMI_LIMITS]));
  if (mode === '--assemble' && profile.promptHash && profile.promptHash !== promptHash) throw new Error('The current prompts differ from the last run. Preserve the previous run or run a new benchmark before assembling.');
  if (mode === '--run') {
    const resumedAt = new Date().toISOString();
    const sameRun = profile.promptHash === promptHash && profile.model === config.model;
    const attempts = sameRun ? (profile.attempts ?? (profile.startedAt ? [{ startedAt: profile.startedAt, concurrency: 2 }] : [])) : [];
    await save(profilePath, { model: config.model, promptHash, startedAt: sameRun ? profile.startedAt : resumedAt, attempts: [...attempts, { startedAt: resumedAt, concurrency, pid: process.pid }] });
  }
  const resultPath = (source, page) => path.join(directory, 'readings', promptHash, `${source.sha256}-${page.page}-${page.imageSha256}.json`);
  const requestTimes = [];
  let reservation = Promise.resolve(), systemicError = null, stopRequested = false;
  // A deliberate drain signal stops new requests while preserving in-flight results.
  if (mode === '--run') process.once('SIGUSR2', () => { stopRequested = true; console.log(JSON.stringify({ stage: 'draining' })); });
  async function takeRequestSlot() {
    const current = reservation.then(async () => {
      for (;;) {
        const now = Date.now();
        while (requestTimes.length && now - requestTimes[0] >= 60_100) requestTimes.shift();
        if (requestTimes.length < KIMI_LIMITS.requestsPerMinute) { requestTimes.push(Date.now()); return; }
        await new Promise(resolve => setTimeout(resolve, Math.max(1, 60_100 - (now - requestTimes[0]))));
      }
    });
    reservation = current.catch(() => {}); await current;
  }
  const allPrepared = new Map();
  for (const source of sources) {
    let prepared = await exists(preparedPath(source)) ? await json(preparedPath(source)) : { error: 'Source has not been rendered.', pages: [] };
    let error = preparedMetadataError(source, prepared, path.dirname(preparedPath(source)));
    if (!error && hash(await fs.readFile(source.originalPath)) !== source.sha256) error = 'Original hash mismatch.';
    if (error) prepared = { sourceSha256: source.sha256, error, pages: [] };
    allPrepared.set(source.sha256, prepared);
  }
  const jobs = sources.flatMap(source => allPrepared.get(source.sha256).pages.map(page => ({ source, page })));
  let completed = 0, failed = 0, cached = 0;
  const startedAt = new Date().toISOString();
  const started = Date.now();
  function documentFor(source, prepared) {
    return { id: `doc-${source.sha256.slice(0, 24)}`, caseId: '', name: source.name, mime: source.mime, size: source.size, sha256: source.sha256, pages: prepared.pages.map(page => ({ page: page.page, text: '' })), type: 'other', version: 1, active: true, extractionStatus: 'pending_ai', extractionPipeline: 'kimi', uploadedAt: startedAt, synthetic: false };
  }
  const processJob = async ({ source, page }) => {
    const target = resultPath(source, page);
    if (await exists(target)) {
      const previous = await json(target);
      if (readingMatches(previous, source, page, promptHash, config.model) && (!previous.error || !args.includes('--retry-failed'))) { if (previous.error) failed++; else cached++; return; }
    }
    if (systemicError || stopRequested) return;
    await takeRequestSlot();
    if (systemicError || stopRequested) return;
    const start = Date.now(), at = new Date().toISOString();
    try {
      const bytes = await fs.readFile(page.imagePath);
      const dimensions = jpegDimensions(bytes);
      if (hash(bytes) !== page.imageSha256 || dimensions.width !== page.width || dimensions.height !== page.height) throw new Error('Rendered image fingerprint or dimensions mismatch.');
      const image = { page: page.page, imageSha256: page.imageSha256, width: page.width, height: page.height, bytes };
      const result = await extractWithKimi(config, documentFor(source, allPrepared.get(source.sha256)), [page.page], {
        images: [image],
        // A repair is part of an already-started page. Finish it when draining;
        // otherwise a deliberate pause would become a false provider failure.
        beforeRepair: async () => { await takeRequestSlot(); return !systemicError; },
        fetch: async (...parameters) => {
          try { const response = await fetch(...parameters); if (!response.ok) systemicError = `Provider rejected the request (HTTP ${response.status}); remaining requests were not started.`; return response; }
          catch (error) { if (!parameters[1]?.signal?.aborted) systemicError = 'Provider network request failed; remaining requests were not started.'; throw error; }
        },
      });
      await save(target, { sourceSha256: source.sha256, page: page.page, inputImageSha256: page.imageSha256, promptHash, concurrency, at, elapsedMs: Date.now() - start, result, visionEvidence: [{ page: page.page, imageSha256: page.imageSha256, width: page.width, height: page.height }] });
      completed++;
    } catch (error) { failed++; await save(target, { sourceSha256: source.sha256, page: page.page, inputImageSha256: page.imageSha256, promptHash, concurrency, at, elapsedMs: Date.now() - start, error: error.message }); }
    console.log(JSON.stringify({ stage: 'kimi', completed, cached, failed, total: jobs.length, elapsedSeconds: Math.round((Date.now() - started) / 1000), ...(systemicError ? { systemicError } : {}) }));
  };
  if (mode === '--run' && jobs.length) {
    console.log(JSON.stringify({ stage: 'started', pid: process.pid, concurrency, total: jobs.length, requestsPerMinute: KIMI_LIMITS.requestsPerMinute }));
    // A single first request verifies provider access before the parallel workers start.
    await processJob(jobs[0]);
    if (!systemicError && !stopRequested) await workerPool(jobs.slice(1), concurrency, processJob);
  }
  const packetResults = [];
  for (const packet of manifest.packets) {
    let state = createEmptyWorkspace(packet.id);
    const documents = packet.sources.map(source => documentFor(source, allPrepared.get(source.sha256)));
    if (documents.length) state = applyAction(state, { type: 'intake', sourceCollection: { name: 'ToKhai isolated benchmark', folder: packet.folder, caseType: packet.caseType }, documents }, actor);
    const shipment = state.cases[0];
    const runs = [], failures = [];
    for (const source of packet.sources) {
      const prepared = allPrepared.get(source.sha256);
      if (prepared.error) failures.push({ sourceSha256: source.sha256, stage: 'render', error: prepared.error });
      for (const page of prepared.pages) {
        const target = resultPath(source, page);
        if (!await exists(target)) { failures.push({ sourceSha256: source.sha256, page: page.page, stage: 'kimi', error: 'Not run.' }); continue; }
        const reading = await json(target);
        if (!readingMatches(reading, source, page, promptHash, config.model)) { failures.push({ sourceSha256: source.sha256, page: page.page, stage: 'cache', error: 'Cached reading does not match the rendered input and prompt.' }); continue; }
        runs.push({ sourceSha256: source.sha256, page: page.page, elapsedMs: reading.elapsedMs, at: reading.at, success: !reading.error });
        if (reading.error) { failures.push({ sourceSha256: source.sha256, page: page.page, stage: 'kimi', error: reading.error }); continue; }
        const result = reading.result;
        try { state = applyAction(state, { type: 'add_ai_candidates', caseId: shipment.id, documentId: `doc-${source.sha256.slice(0, 24)}`, documentVersion: 1, model: result.model, pages: result.pages, proposals: result.proposals, pageReadings: result.pageReadings, visionEvidence: reading.visionEvidence }, actor); }
        catch (error) { failures.push({ sourceSha256: source.sha256, page: page.page, stage: 'apply', error: error.message }); }
      }
    }
    // Evaluate extraction/form filling under the audited input partition. This
    // fixture assumption does not assert that arbitrary folders are one shipment.
    state = confirmBenchmarkGrouping(state, actor);
    const outcome = { packetId: packet.id, folder: packet.folder, caseType: packet.caseType, groupingAssumption: BENCHMARK_GROUPING_ASSUMPTION, promptHash, model: config.model, generatedAt: new Date().toISOString(), sourceDocuments: documents.length, ...packetReadiness(state.documents, failures, packet.caseType), failures, timings: runs, ...packetTimings(runs), state, issues: shipment ? getIssues(state, shipment.id) : [] };
    await save(path.join(assemblyDirectory, 'results', `${packet.id}.json`), outcome);
    packetResults.push({ packetId: packet.id, folder: packet.folder, caseType: packet.caseType, status: outcome.status, readingStatus: outcome.readingStatus, formStatus: outcome.formStatus, blockedPages: outcome.blockedPages, blockedDocuments: outcome.blockedDocuments, failures: failures.length, successfulPages: runs.filter(r => r.success).length, processingMs: outcome.serviceMs, wallElapsedMs: outcome.wallElapsedMs });
  }
  const summary = { startedAt, finishedAt: new Date().toISOString(), mode, promptHash, model: config.model, concurrency, completed, cached, failed, totalPages: jobs.length, elapsedMs: Date.now() - started, systemicError, stopRequested, packetStatuses: Object.fromEntries([...new Set(packetResults.map(packet => packet.status))].map(status => [status, packetResults.filter(packet => packet.status === status).length])), packets: packetResults };
  await save(path.join(assemblyDirectory, 'run-summary.json'), summary);
  if (systemicError || packetResults.some(packet => packet.status !== 'complete')) process.exitCode = 1;
  console.log(JSON.stringify({ stage: 'done', completed, cached, failed, totalPages: jobs.length, packets: packetResults.length, systemicError, stopRequested }));
}
