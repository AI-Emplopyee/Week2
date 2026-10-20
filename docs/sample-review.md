# Local sample form review

Open **Sample tests** in the local website, or `http://127.0.0.1:5173/?view=samples`.
The three ECUS form tabs use the existing `ECUS_FORM_FIELDS` catalog and saved AI
declaration values. Employee ToKhai values are separate comparison evidence;
they never supply form values. Missing, stale and unsupported values stay blank.
The forms are read-only snapshots, not approved or submitted declarations.

The view includes 29 eligible Kimi collections and four development collections
for each GLM reasoning setting. The 44-collection inventory explains the 15
scoring exclusions. Exact, reviewed content and coverage metrics retain the
frozen denominators. Extra goods rows and structured components are separate.
Equivalent-content credit is AI-assisted internal review, not independent human
validation. The earlier Kimi result on the same four pilot collections is labeled
as a historical reference; no fresh Kimi control is claimed.

Run `python3 scripts/export-sample-review.py` to regenerate the local export from
the pinned immutable evidence. It checks input hashes, original-file hashes,
all exported form values against the frozen drafts, every comparison's actual
value, and aggregate scores. It makes no provider requests and changes no live
workspace records or frozen evaluation files.

Private generated data and original-byte copies live in the ignored directory
`.aicd-local/sample-review/`. Nothing is placed in `public/` or a browser bundle.
Only the local Vite listener exposes the read-only endpoints, after its existing
loopback/socket/host/origin gate. Originals are selected by opaque asset ID and
their hashes are verified before serving. The filesystem asset index is never
returned to the browser. Production builds do not install this middleware.

Validation: `node --experimental-strip-types --test tests/sample-review.test.ts
tests/local.test.ts`, TypeScript checking, and browser checks of all three forms,
model/sample switching, the differences filter and comparison details.
