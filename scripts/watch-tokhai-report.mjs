/** One-shot local report watcher. Reads the pinned run's saved cache only.
 * It invokes --assemble and the offline scorer; never invokes --run, a provider,
 * scheduled automation, or the live application workspace. One watcher owns
 * report publication, using separate staging and atomic file replacement.
 * node --experimental-strip-types scripts/watch-tokhai-report.mjs --pid <run-pid>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { benchmarkSources, preparedMetadataError, readingMatches } from './tokhai-benchmark-utils.mjs';
import { currentAttempt, samePinnedRun, attemptLog, classifyProgress } from './tokhai-report-watch-utils.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'outputs/private-tokhai-benchmark');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--pid' || !/^\d+$/.test(args[1]) || Number(args[1]) <= 1) throw new Error('Supply the currently active benchmark process as --pid <run-pid>.');
const pid = Number(args[1]);
const run = promisify(execFile);
const readJson = async filename => JSON.parse(await fs.readFile(filename, 'utf8'));
const profilePath = path.join(directory, 'run-profile.json');
const profile = await readJson(profilePath);
const attempt = currentAttempt(profile);
if (attempt.pid !== pid) throw new Error('The requested PID is not the current benchmark attempt.');
const pin = { startedAt: profile.startedAt, promptHash: profile.promptHash, model: profile.model, attemptStartedAt: attempt.startedAt, pid };
const intervalMs = 30_000, staleAfterMs = 10 * 60_000;
const lock = path.join(directory, '.report-watch.lock');
const staging = path.join(directory, `report-watch-${process.pid}`);
const manifest = await readJson(path.join(directory, 'manifest.json'));
const { sources } = benchmarkSources(manifest);
const jobs = [];
let preparationFailures = 0;
for (const source of sources) {
  const target = path.join(directory, 'rendered', source.sha256);
  const prepared = await readJson(path.join(target, 'metadata.json'));
  if (preparedMetadataError(source, prepared, target)) { preparationFailures++; continue; }
  for (const page of prepared.pages) jobs.push({ source, page, filename: path.join(directory, 'readings', pin.promptHash, `${source.sha256}-${page.page}-${page.imageSha256}.json`) });
}
const python = process.env.AICD_BENCHMARK_PYTHON || 'python3';
// Do not forward provider credentials to offline child processes, even if exported.
const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)));
childEnv.PYTHONDONTWRITEBYTECODE = '1';
await fs.mkdir(staging, { mode: 0o700 });
await fs.mkdir(lock, { mode: 0o700 }); // Existing lock is deliberately never overridden.
await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ watcherPid: process.pid, ...pin }), { mode: 0o600 });
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; });
process.once('SIGTERM', () => { interrupted = true; });

async function atomicWrite(filename, content) {
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, content, { mode: 0o600 }); await fs.rename(temporary, filename); }
  finally { await fs.rm(temporary, { force: true }); }
}

async function processState() {
  try {
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'command='], { timeout: 5000, maxBuffer: 8192 });
    return /(?:^|\s)(?:\S*\/)?run-tokhai-benchmark\.mjs\s+--run(?:\s|$)/.test(stdout) ? 'running' : 'stopped';
  } catch (error) {
    // An empty successful process lookup means exit; permission denial is unknown.
    if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) return 'stopped';
    return 'unknown';
  }
}

async function snapshot() {
  const current = await readJson(profilePath);
  const interruptions = await readJson(path.join(directory, 'administrative-interruptions.json')).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
  const logPath = path.join(directory, 'run.log');
  const logText = await fs.readFile(logPath, 'utf8').catch(() => '');
  const logStat = await fs.stat(logPath).catch(() => null);
  const log = attemptLog(logText, pid);
  let successfulPages = 0, failedPages = 0, invalidCachedPages = 0;
  let lastActivityMs = Date.parse(pin.attemptStartedAt);
  const signature = [JSON.stringify(interruptions)];
  if (logStat && log.matches) { lastActivityMs = Math.max(lastActivityMs, logStat.mtimeMs); signature.push(`log:${logStat.size}:${logStat.mtimeMs}`); }
  for (const job of jobs) {
    let stat;
    try { stat = await fs.stat(job.filename); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    signature.push(`${path.basename(job.filename)}:${stat.size}:${stat.mtimeMs}`);
    lastActivityMs = Math.max(lastActivityMs, stat.mtimeMs);
    try {
      const reading = await readJson(job.filename);
      if (!readingMatches(reading, job.source, job.page, pin.promptHash, pin.model)) invalidCachedPages++;
      else if (reading.error) failedPages++;
      else successfulPages++;
    } catch { invalidCachedPages++; }
  }
  const observedAt = new Date().toISOString();
  const evidence = await processState();
  const status = classifyProgress({ pinned: samePinnedRun(current, pin), log, processState: evidence, lastActivityMs, nowMs: Date.now(), staleAfterMs, successfulPages, failedPages, totalPages: jobs.length });
  const progress = { ...pin, ...status, observedAt, lastActivityAt: new Date(lastActivityMs).toISOString(), processState: evidence,
    successfulPages, failedPages, pendingPages: jobs.length - successfulPages - failedPages,
    totalPages: jobs.length, invalidCachedPages, preparationFailures, staleAfterMs,
    attempts: current.attempts ?? [], benchmarkConcurrency: currentAttempt(current).concurrency,
    firstAttemptOnly: (current.attempts?.length > 1 || interruptions.benchmarkIsNotAFirstAttemptOnlyMeasure) ? false : null,
    administrativelyInterruptedPages: interruptions.pages?.length ?? 0,
    earlierAbruptRestartInFlightAtMost: interruptions.earlierAbruptRestartInFlightAtMost ?? 0,
    doneMarker: log.done, groupingEvaluated: false, formCompletionEvaluated: false };
  return { progress, signature: signature.join('|') + `|${status.status}` };
}

async function refresh(progress) {
  if (!samePinnedRun(await readJson(profilePath), pin)) throw new Error('Pinned run changed before offline refresh.');
  await fs.rm(path.join(staging, 'run-summary.json'), { force: true });
  const env = { ...childEnv, AICD_BENCHMARK_ASSEMBLY_OUTPUT: staging };
  let assemblyError;
  try { await run(process.execPath, ['--experimental-strip-types', 'scripts/run-tokhai-benchmark.mjs', '--assemble'], { cwd: root, env, timeout: 120_000, maxBuffer: 256 * 1024 }); }
  catch (error) { assemblyError = error; }
  // Incomplete readings intentionally make --assemble exit 1; require a fresh,
  // coherent summary before accepting that exit rather than swallowing errors.
  const summary = await readJson(path.join(staging, 'run-summary.json'));
  if (summary.mode !== '--assemble' || summary.promptHash !== pin.promptHash || summary.model !== pin.model
    || summary.packets?.length !== manifest.packets.length || (assemblyError && assemblyError.code !== 1)) throw new Error('Offline assembly did not produce a complete matching snapshot.');
  await atomicWrite(path.join(staging, 'run-progress.json'), JSON.stringify(progress, null, 2));
  await run(python, ['scripts/score-tokhai-benchmark.py', '--directory', directory, '--results-directory', path.join(staging, 'results'), '--output-directory', staging, '--progress-file', path.join(staging, 'run-progress.json')], { cwd: root, env: childEnv, timeout: 60_000, maxBuffer: 256 * 1024 });
  if (!samePinnedRun(await readJson(profilePath), pin)) throw new Error('Pinned run changed during offline refresh; no report was published.');
  for (const filename of ['accuracy-report.json', 'accuracy-report.html', 'run-progress.json']) {
    await atomicWrite(path.join(directory, filename), await fs.readFile(path.join(staging, filename)));
  }
}

async function publishRefreshFailure(progress) {
  await atomicWrite(path.join(staging, 'run-progress.json'), JSON.stringify(progress, null, 2));
  try {
    await run(python, ['scripts/score-tokhai-benchmark.py', '--existing-report', path.join(directory, 'accuracy-report.json'), '--output-directory', staging, '--progress-file', path.join(staging, 'run-progress.json')], { cwd: root, env: childEnv, timeout: 60_000, maxBuffer: 256 * 1024 });
    for (const filename of ['accuracy-report.json', 'accuracy-report.html']) await atomicWrite(path.join(directory, filename), await fs.readFile(path.join(staging, filename)));
  } catch { /* Without a previous report, keep the explicit progress error alone. */ }
  await atomicWrite(path.join(directory, 'run-progress.json'), JSON.stringify(progress, null, 2));
}

let previousSignature = '';
try {
  for (;;) {
    const { progress, signature } = await snapshot();
    if (signature !== previousSignature || interrupted) {
      if (interrupted) Object.assign(progress, { watcherStopped: true, message: `${progress.message} The report watcher was stopped; further updates are not automatic.` });
      try {
        await refresh(progress);
        previousSignature = signature;
        console.log(JSON.stringify({ stage: 'report_refreshed', status: progress.status, successfulPages: progress.successfulPages, failedPages: progress.failedPages, pendingPages: progress.pendingPages, totalPages: progress.totalPages, at: progress.observedAt }));
      } catch (error) {
        progress.refreshError = error.message;
        // Preserve the last good comparisons and their timestamp while exposing
        // the failed refresh prominently, including a replacement-run stop.
        await publishRefreshFailure(progress);
        console.error(JSON.stringify({ stage: 'report_refresh_failed', error: error.message, at: progress.observedAt }));
        if (progress.terminal || interrupted) process.exitCode = 1;
      }
    }
    if (progress.terminal || interrupted) break;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
} finally {
  await fs.rm(lock, { recursive: true });
}
