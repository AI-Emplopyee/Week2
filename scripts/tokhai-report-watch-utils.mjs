/** Pure, offline progress classification. A saved response is not a completed form. */
export function currentAttempt(profile) {
  return profile.attempts?.at(-1) ?? { startedAt: profile.startedAt };
}

export function samePinnedRun(profile, pin) {
  const attempt = currentAttempt(profile);
  return profile.startedAt === pin.startedAt && profile.promptHash === pin.promptHash
    && profile.model === pin.model && attempt.startedAt === pin.attemptStartedAt
    && attempt.pid === pin.pid;
}

/** Ignore old/restarted attempts and partial log lines. */
export function attemptLog(text, pid) {
  const lines = text.split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const start = lines.findLastIndex(line => line.stage === 'started');
  if (start < 0 || lines[start].pid !== pid) return { matches: false, done: null, draining: false };
  const current = lines.slice(start + 1);
  return { matches: true, done: current.findLast(line => line.stage === 'done') ?? null,
    draining: current.some(line => line.stage === 'draining') };
}

export function classifyProgress({ pinned, log, processState, lastActivityMs, nowMs, staleAfterMs, successfulPages, failedPages, totalPages }) {
  if (!pinned) return { status: 'superseded', terminal: true, message: 'The run profile changed. This watcher stopped; it has not followed the replacement run.' };
  if (log.done?.stopRequested) return { status: 'stopped', terminal: true, message: 'The provider run was deliberately drained and stopped. Remaining pages have not completed.' };
  if (log.done) {
    const pending = totalPages - successfulPages - failedPages;
    if (failedPages || pending || log.done.systemicError) return { status: 'finished_with_issues', terminal: true,
      message: 'The provider run ended with failed or unprocessed pages. Readings and form drafts may still be incomplete.' };
    return { status: 'finished', terminal: true, message: 'The provider run ended and every prepared page has a saved successful response. This does not establish complete readings or approved forms.' };
  }
  if (processState === 'stopped') return { status: 'stopped', terminal: true, message: 'The pinned provider process is no longer running and no matching final marker was recorded. Completion is unconfirmed.' };
  if (nowMs - lastActivityMs >= staleAfterMs) return { status: 'stale', terminal: false,
    message: 'No new cache or log activity has been observed for the stale interval. Completion is unconfirmed; the watcher is still checking.' };
  if (log.draining) return { status: 'draining', terminal: false, message: 'The provider is finishing requests already in flight before stopping. No full-run completion is claimed.' };
  if (processState === 'running') return { status: 'in_progress', terminal: false, message: 'The pinned provider process is running. Partial exact-answer comparisons below will change as responses arrive.' };
  return { status: 'activity_observed', terminal: false, message: 'Recent cache or log activity was observed, but process status is unavailable. Completion is unconfirmed.' };
}
