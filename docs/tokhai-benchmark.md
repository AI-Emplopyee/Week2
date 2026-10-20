# ToKhai sample benchmark

Employee ECUS `ToKhai*.xls` files are held-out answer keys. They must never be
sent to the extraction model or copied into its prompts, page readings,
candidates, client memory or initial declaration draft. The filename search
also includes `To Khai` and `To-Khai` variants.

The benchmark uses an isolated workspace for each previously audited sample
collection. It does not overwrite the user's application records. Collection
membership and direction are reused from the sample audit. This evaluates
extraction and form filling within those collections, not automatic grouping of
unclassified incoming email.

After applying source readings, the isolated fixture explicitly confirms its
supplied folder partition so supported values can reach the declaration draft.
Each result records this as `groupingAssumption`; it is neither a live shipment
grouping decision nor declaration approval. Employee answer values never supply
this partition. A mixed folder still needs source-to-answer assignment before
it can receive a valid accuracy score.

## Prepare the sample inventory and labels

```sh
python3 scripts/prepare-tokhai-benchmark.py
python3 scripts/tokhai_ground_truth.py --xlrd-path /path/to/existing/xlrd/installation
```

The preparation script accepts explicit paths for the private inventory,
workspace snapshot, local R2 metadata database, original blob directory and
output directory. It checks the saved SHA-256 fingerprint of every selected
original. All outputs go to the ignored `outputs/private-tokhai-benchmark/`
directory. No customer document contents are committed with these scripts.

`manifest.json` gives every selected collection a stable ID, original source
filenames and paths, held-out declaration files, excluded supporting files and
parsed label paths. The local `upload-inventory.html` lists the precise source
files and intended Kimi endpoint for review.

`tokhai_ground_truth.py` uses read-only BIFF parsing. It never opens Office,
runs macros, follows external links or recalculates workbook formulas. Known
ECUS import-print layout anchors and goods-block labels must match before cells
are mapped to application components. Every answer retains its sheet, cell and
original file hash. Numeric cell values retain their original numeric meaning;
Vietnamese decimal/thousands separators are normalized only for text cells.

Export forms, fee notices, transport or legacy layouts and non-XLS labels are
counted explicitly. They are not misreported as import extraction failures.
Printed goods counts are checked against parsed blocks. Incomplete employee
goods layouts do not contribute goods accuracy until reviewed.

## Run and compare

The separate runner's `--prepare` mode renders originals locally into page
images. `--run` calls the configured Kimi endpoint; `--assemble` builds isolated
drafts from cached results without calling the provider. Hold-out fingerprints
are checked again at the runner boundary. The provider requests do not contain
historical extracted text or employee answer keys.

```sh
node --experimental-strip-types scripts/run-tokhai-benchmark.mjs --prepare
node --experimental-strip-types scripts/run-tokhai-benchmark.mjs --run
python3 scripts/score-tokhai-benchmark.py
```

`AICD_BENCHMARK_CONCURRENCY` selects one to eight simultaneous benchmark readers
(default two); every reader and repair shares the six-request-per-minute cap.
The run profile records the concurrency used by each attempt. The application's
local production reader remains at two. `SIGUSR2` deliberately drains a running
benchmark: new calls stop, in-flight responses are saved, then a final marker
records `stopRequested: true`. A drained run is stopped, not completed.
`run-profile.json` preserves the original start and records each resumed
attempt's start, concurrency and PID. Cached successes and failures are retained;
`--retry-failed` is an explicit opt-in for retrying saved failures.

The sample measurement reuses cached responses across the two-, four- and
eight-reader attempts; it is **not first-attempt-only accuracy**. The saved
`administrative-interruptions.json` records three pages whose normal repair was
suppressed during an administrative drain. Their exact failure records are
retained separately under `interrupted-readings/`, allowing their reading and
repair to resume. An earlier abrupt restart may have repeated up to two
in-flight calls whose outcomes were not saved. Genuine provider failures remain
in the active cache. The JSON and HTML report expose this audit and attempt
history without changing scoring. Summed work from the current cache excludes
archived interruption records and unsaved calls, so it is not total billed work.

An optional one-shot offline watcher refreshes the local report during the
current attempt:

```sh
node --experimental-strip-types scripts/watch-tokhai-report.mjs --pid RUN_PID
```

It pins the run's model, prompt fingerprint, original start and current attempt
PID. About every 30 seconds, changed cache/log evidence triggers offline assembly
in a separate staging directory, scoring, then atomic report replacement. The
`AICD_BENCHMARK_ASSEMBLY_OUTPUT` override applies only to `--assemble`; it keeps
watcher snapshots away from the live runner's result files. A lock prevents two
watchers publishing concurrently. Manual report refresh should not run while
the watcher owns this lock. No provider request, scheduled automation, or live
workspace update is made by this watcher.

The report shows successful, failed and pending pages, timestamps and process
status. Ten minutes without activity is labeled stale, never finished. A
matching final marker ends the watcher; an exited process without that marker
is stopped with completion unconfirmed. A changed run profile ends this watcher
rather than silently following a new attempt. Refresh failures preserve the
last good comparisons and expose the error. Provider-run completion still does
not imply that page readings or shipment forms are complete.

The scorer reads `results/<packet-id>.json` and writes
`accuracy-report.json` and a compact `accuracy-report.html`. It never calls a
provider. A collection with at least one successful provider response receives
a score against its **full eligible answer denominator**, even when some pages
are failed, unread, uncertain or rejected. That score is labeled provisional
until all readings complete. Missing draft values count as missing answers.
Collections with no successful provider response remain unscored, including
unrun collections and wholly failed calls.

The main aggregate includes all attempted, score-eligible import collections
with results. Separate aggregates show completed readings and provisional
readings. The report also shows how much of the full eligible sample answer set
has been scored, so an early or easy subset cannot appear to represent the
entire collection. Reading completion does not mean declaration approval or
full-form completion.

For scored import runs:

- **Exact answer agreement** is matching components divided by all eligible
  nonblank employee answer components. Missing AI output counts as non-agreement.
- **Comparable filled-value exact agreement** is matches divided by populated
  components that have an eligible employee answer. Populated fields without a
  comparable answer are counted separately and are not validated by this score.
  **Coverage** is populated comparable components divided by eligible answers.
- Header and goods scores are separate. Text comparison normalizes case and
  whitespace, but does not silently accept different wording. Numeric values
  are compared exactly after formatting normalization. Transport references
  are compared as complete sets.
- Duplicate employee revisions contribute one consensus answer per component.
  Conflicts and omissions between revisions are exposed and excluded, rather
  than choosing whichever revision gives the AI a better score.
- Distinct invoice answer keys in one collection require confirmed source-to-
  declaration assignment before scoring. Goods use printed row order; there
  is no fuzzy matching that could inflate results.
- Additional AI goods rows beyond the employee's printed count are counted and
  flagged separately. A 100% component agreement score does not validate them.
  Declared and parsed employee row counts are shown separately when a print is
  incomplete. A collection with no unambiguous answer components is unscored.

This is a component benchmark, not certification that the entire form is
complete. It does not score unparsed fields, fields blank in the employee print,
or legal validity. Translated or paraphrased descriptions can differ under the
strict comparison even when they express similar meaning.
Employee customs decisions or information absent from the source documents can
also differ without establishing a model error. The metric is an exact answer
comparison, not independent factual correctness. The JSON retains the
`accuracy` and `filledPrecision` keys for compatibility; those keys denote the
two exact-agreement measures above.

Timing includes total provider work and elapsed time from the first recorded
request to the last response for a collection. The latter can include shared
queue waits and long gaps between resumed runs that reuse cached requests.
It excludes rendering and human review. First/last timestamps are preserved.
The resumed test span is an observed batch measurement, not a
production speed guarantee for the application's two-reader configuration.
`medianObservedResponseSpanMs` names the measured span; the older
`medianObservedProcessingMs` key is a compatibility alias. Neither is a measure
of full-form completion time or a guaranteed turnaround.
The HTML report shows timing per collection and expandable tables of mismatched
or missing components, employee answers, AI draft values and exact answer cells.
Excluded answer conflicts and pipeline failures remain inspectable there.

## Offline checks

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p '*benchmark_test.py'
```

Synthetic checks cover locale-sensitive numbers, unsupported labels, incomplete
runs, missing predictions, conflicting revisions, stale drafts and ambiguous
shipment labels. Passing them establishes benchmark behavior, not Kimi accuracy.
