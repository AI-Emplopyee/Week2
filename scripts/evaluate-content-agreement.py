"""Supplementary, offline content review of frozen draft comparisons.

This never changes the exact scorer, labels, application output, or provider
cache. Exact matches receive credit; a non-exact value receives credit only from
an explicit review bound to its packet/component and exact expected/actual pair.
Missing and unreviewed values stay in every relevant denominator.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import hashlib
import html
import json
import pathlib
import subprocess


TABS = {"general_1": "Thông tin chung", "general_2": "Thông tin chung 2", "goods": "Danh sách hàng",
        "structured_goods_only": "Structured goods components outside visible controls", "unmapped": "Unmapped components"}
STATUSES = {"equivalent", "not_equivalent", "unreviewed"}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def pair_hash(expected, actual):
    return hashlib.sha256(canonical({"expected": expected, "actual": actual}).encode("utf8")).hexdigest()


def component_key(row):
    return tuple(row[key] for key in ("packetId", "scope", "fieldId", "component"))


def review_index(entries):
    index, errors = {}, []
    for number, entry in enumerate(entries, 1):
        try:
            key = (*component_key(entry), entry["pairHash"])
            if any(not isinstance(value, str) or not value for value in key):
                raise ValueError("Review key/hash must be nonempty strings.")
            if entry.get("status") not in STATUSES:
                raise ValueError("Review status must be equivalent, not_equivalent, or unreviewed.")
            if entry["status"] != "unreviewed":
                if any(not str(entry.get(field, "")).strip() for field in ("reason", "reviewer", "reviewedAt")):
                    raise ValueError("A completed review requires reason, reviewer, and reviewedAt.")
                datetime.datetime.fromisoformat(entry["reviewedAt"].replace("Z", "+00:00"))
            if key in index:
                index[key] = None  # Duplicate decisions never produce automatic credit.
                errors.append({"entry": number, "reason": "Duplicate review key/pair; all duplicates are invalid."})
            else:
                index[key] = entry
        except (KeyError, TypeError, ValueError) as error:
            errors.append({"entry": number, "reason": str(error)})
    return index, errors


def mapping_for(catalog):
    mapping = collections.defaultdict(set)
    for field in catalog:
        mapping[(field["fieldId"], field["component"])].add(field["tab"])
    return mapping


def assign_tab(row, mapping):
    tabs = mapping.get((row["fieldId"], row["component"]), set())
    if len(tabs) == 1:
        return next(iter(tabs))
    if not tabs and row["scope"].startswith("goods:") and row["fieldId"] == "1.86" and row["component"] in ("currencyCode", "unitCode"):
        return "structured_goods_only"
    return "unmapped"


def adjudicate(row, index):
    result = {**row, "pairHash": pair_hash(row["expected"], row["actual"])}
    key = (*component_key(row), result["pairHash"])
    review = index.get(key)
    result["review"] = review
    result["staleReviewCount"] = sum(candidate[:4] == key[:4] and candidate[4] != key[4] for candidate in index)
    if row["status"] == "match":
        result["contentStatus"] = "exact_match"
    elif row["status"] == "missing" or row["actual"] is None or row["actual"] == [] or row["actual"] == "":
        result["contentStatus"] = "missing"
        if review and review["status"] == "equivalent":
            result["reviewIgnoredReason"] = "A missing value cannot receive equivalence credit."
    elif review and review["status"] == "equivalent":
        result["contentStatus"] = "reviewed_equivalent"
    elif review and review["status"] == "not_equivalent":
        result["contentStatus"] = "reviewed_not_equivalent"
    else:
        result["contentStatus"] = "unreviewed_mismatch"
    return result


def metrics(rows):
    n = len(rows)
    counts = collections.Counter(row["contentStatus"] for row in rows)
    exact = counts["exact_match"]
    correct = exact + counts["reviewed_equivalent"]
    filled = n - counts["missing"]
    return {"eligible": n, "exactMatches": exact, "reviewedEquivalent": counts["reviewed_equivalent"],
            "reviewedNotEquivalent": counts["reviewed_not_equivalent"], "unreviewedMismatches": counts["unreviewed_mismatch"],
            "missing": counts["missing"], "filled": filled, "contentCorrect": correct,
            "exactAgreement": exact / n if n else None,
            "contentAgreement": correct / n if n else None,
            "filledContentAgreement": correct / filled if filled else None,
            "filledCoverage": filled / n if n else None,
            "assessedCoverage": (correct + counts["reviewed_not_equivalent"]) / n if n else None}


def select_population(design, population):
    names = ("development", "holdout") if population == "combined" else (population,)
    return {packet["id"] for name in names for packet in design[name]}


def evaluate(report, population_ids, catalog, adjudications, population="development"):
    index, errors = review_index(adjudications)
    mapping = mapping_for(catalog)
    rows, packets = [], []
    for packet in report["packets"]:
        if packet["packetId"] not in population_ids:
            continue  # Default development selection never inspects holdout comparisons.
        packet_rows = []
        for comparison in packet["comparisons"]:
            row = adjudicate({**comparison, "packetId": packet["packetId"], "folder": packet["folder"],
                              "readingStatus": packet.get("readingStatus", "unavailable")}, index)
            row["tab"] = assign_tab(row, mapping)
            rows.append(row)
            packet_rows.append(row)
        packets.append({"packetId": packet["packetId"], "folder": packet["folder"],
                        "readingStatus": packet.get("readingStatus", "unavailable"),
                        "scoreStatus": packet["status"], "metrics": metrics(packet_rows),
                        "extraGoodsRows": packet.get("extraGoodsRows"),
                        "unscoredPopulatedComponents": packet.get("extraFilledComponents")})
    complete = [row for row in rows if row["readingStatus"] == "complete"]
    visible = [row for row in rows if row["tab"] in ("general_1", "general_2", "goods")]
    evaluated = {"sourceReportGeneratedAt": report["generatedAt"],
            "originalExactSummaryUnchanged": report["summary"]["allAttempted"],
            "population": population, "populationOverall": metrics(rows), "visibleUiComparableSubset": metrics(visible),
            "byForm": {tab: metrics([row for row in rows if row["tab"] == tab]) for tab in TABS},
            "completeReadingOnly": {"overall": metrics(complete),
                                    "byForm": {tab: metrics([row for row in complete if row["tab"] == tab]) for tab in TABS}},
            "packets": packets, "components": rows, "reviewValidationErrors": errors,
            "stalePairBindings": sum(row["staleReviewCount"] for row in rows)}
    if population == "development":
        evaluated["developmentOverall"] = evaluated["populationOverall"]  # Compatibility with existing development artifacts.
    evaluated["populationCoverage"] = {
        "selectedCollections": len(population_ids), "collectionsInSourceReport": len(packets),
        "collectionsWithComparisons": sum(p["metrics"]["eligible"] > 0 for p in packets),
        "collectionsWithoutComparisons": len(population_ids) - sum(p["metrics"]["eligible"] > 0 for p in packets),
    }
    return evaluated


def assert_same_answers(baseline, candidate):
    def answers(version):
        result = {component_key(row): canonical(row["expected"]) for row in version["components"]}
        if len(result) != len(version["components"]):
            raise ValueError("Duplicate selected-population component keys would inflate the denominator.")
        return result
    if answers(baseline) != answers(candidate):
        raise ValueError("Baseline and candidate selected-population answer keys/denominators differ; no paired comparison is valid.")


def worksheet(version, evaluated):
    return [{"version": version, **{key: row[key] for key in ("packetId", "folder", "scope", "fieldId", "component", "tab", "expected", "actual", "pairHash")},
             "exactStatus": row["status"], "contentStatus": row["contentStatus"],
             "answerLocation": {key: row.get(key) for key in ("sourceFile", "sheet", "cell")},
             "adjudicationTemplate": {**{key: row[key] for key in ("packetId", "scope", "fieldId", "component", "pairHash")},
                                      "status": "unreviewed", "reason": "", "reviewer": "", "reviewedAt": "", "evidence": ""}}
            for row in evaluated["components"] if row["status"] != "match"]


def render_html(report):
    esc = html.escape
    pct = lambda value: "—" if value is None else f"{100 * value:.2f}%"
    def table(versions, get):
        out = "<div class='scroll'><table><thead><tr><th>Version</th><th>Exact / eligible</th><th>Exact agreement</th><th>Content correct / eligible</th><th>Content agreement</th><th>Filled content agreement</th><th>Filled coverage</th><th>Unreviewed mismatches</th><th>Missing</th></tr></thead><tbody>"
        for name, version in versions:
            m = get(version)
            out += f"<tr><td>{esc(name)}</td><td>{m['exactMatches']} / {m['eligible']}</td><td>{pct(m['exactAgreement'])}</td><td>{m['contentCorrect']} / {m['eligible']}</td><td>{pct(m['contentAgreement'])}</td><td>{pct(m['filledContentAgreement'])}</td><td>{pct(m['filledCoverage'])}</td><td>{m['unreviewedMismatches']}</td><td>{m['missing']}</td></tr>"
        return out + "</tbody></table></div>"
    versions = [(name, report[name]) for name in ("baseline", "candidate") if report.get(name)]
    out = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Supplementary content agreement review</title><style>body{font:15px/1.55 system-ui;max-width:1250px;margin:36px auto;padding:0 22px;color:#22303a}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px;text-align:left;border-bottom:1px solid #d8dfe5;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2f4}.scroll{overflow:auto}.notice{background:#fff4d9;padding:16px}details{margin:18px 0;padding:12px;background:#f6f8fa}summary{cursor:pointer;font-weight:600}code{overflow-wrap:anywhere}pre{white-space:pre-wrap}small{color:#5a6873}</style><h1>Supplementary content agreement review</h1>"""
    out += f"<p>Generated {esc(report['generatedAt'])}. Population: {esc(report.get('population', 'development'))}; {report.get('populationCollectionCount', report.get('developmentCollectionCount'))} selected collections. Original exact scores remain unchanged.</p>"
    out += "<p class='notice'>Content credit = exact matches + explicitly reviewed equivalent content. Every missing and unreviewed mismatch stays in the denominator. There is no fuzzy, translation, numeric-tolerance or code-equivalence auto-credit. A review applies only to its named component and SHA-256-bound expected/actual pair. Changed pairs require a fresh review.</p>"
    out += "<p>Equivalence decisions are AI-assisted internal review, not independent human validation. The review record includes the reviewer, time, reason and evidence. An isolated component review does not establish customs validity or approve a shipment.</p>"
    if not report.get("candidate"):
        out += "<p class='notice'>Candidate report is not available yet. Baseline results are not presented as candidate improvement.</p>"
    out += "<h2>Comparable components in the three visible tabs</h2>" + table(versions, lambda v: v["visibleUiComparableSubset"])
    out += "<p>This is the mapped comparison subset for the three visible forms, not complete coverage of all 191 catalog controls or approval of complete forms. It excludes the separately reported structured-only goods components. Rates are weighted by eligible components, not averaged across tabs.</p>"
    out += "<h2>Full original benchmark including structured goods components</h2>" + table(versions, lambda v: v["populationOverall"])
    out += "<p>This overall line retains every existing comparison in the selected population, including structured goods currency/unit components outside the visible controls. The exact column is the frozen metric; content review does not rewrite it. Collections with no scored comparisons are unmeasured, not zero-error results.</p>"
    for name, version in versions:
        coverage = version['populationCoverage']
        out += f"<p>{esc(name)}: {coverage['collectionsWithComparisons']} of {coverage['selectedCollections']} selected collections have comparisons; {coverage['collectionsWithoutComparisons']} are unmeasured.</p>"
    for tab in ("general_1", "general_2", "goods"):
        out += f"<h2>{esc(TABS[tab])}</h2>" + table(versions, lambda v, tab=tab: v["byForm"][tab])
    out += "<h2>Structured goods components outside visible controls</h2>" + table(versions, lambda v: v["byForm"]["structured_goods_only"])
    out += "<p>These are unit-price currency and unit components printed in ToKhai and stored in the draft, but not separate controls in the three-tab form catalog. They are retained separately rather than silently removed from the original exact score.</p>"
    if any(version["byForm"]["unmapped"]["eligible"] for _, version in versions):
        out += "<h2>Other unmapped components</h2>" + table(versions, lambda v: v["byForm"]["unmapped"])
    out += "<h2>Completed-reading subset</h2>" + table(versions, lambda v: v["completeReadingOnly"]["overall"])
    out += "<p>Completed readings do not establish form approval. The overall comparison above still includes partial drafts; this subset must not replace it as the headline.</p>"
    out += f"<h2>Coverage limits</h2><p>The catalog contains {report['catalogControlCount']} controls across the three tabs, including repeated structured entries. The scored component subset does not establish complete coverage of these controls, taxes, generated IDs, or all employee information.</p>"
    audit = report.get("coverageAudit") or {}
    candidates = audit.get("candidatesForCoverageReview", {})
    if candidates:
        out += "<p>The attached coverage audit is a separate development-only inventory. Its cell and row counts do not describe held-out collections or expand this report's selected-population denominator.</p>"
        out += "<details><summary>Populated employee-print areas outside the current comparison</summary><table><thead><tr><th>Area</th><th>Tab</th><th>Collections</th><th>Populated cell/row occurrences</th><th>Interpretation</th></tr></thead><tbody>"
        for key, item in candidates.items():
            out += f"<tr><td>{esc(key)}</td><td>{esc(TABS.get(item['tab'], item['tab']))}</td><td>{item['collectionsWithNonblankCells']}</td><td>{item['distinctPacketCellOrRowOccurrences']}</td><td>{esc(item['meaning'])}</td></tr>"
        out += "</tbody></table><p>These are audit candidates, not an expanded score denominator. Source facts, employee decisions, customs outputs and calculations need distinct input and validation definitions.</p></details>"
    for name, version in versions:
        out += f"<details><summary>{esc(name)} review audit: {version['stalePairBindings']} stale pair bindings; {len(version['reviewValidationErrors'])} invalid records</summary><pre>{esc(json.dumps(version['reviewValidationErrors'], ensure_ascii=False, indent=2))}</pre></details>"
    out += "<h2>Review worksheet</h2><p>Each discrepancy below has a pair-bound review template in <code>content-review-worksheet.json</code>. Only completed records deliberately added to the adjudications input can earn equivalence credit. Missing rows cannot earn credit.</p>"
    for name, version in versions:
        for packet in version["packets"]:
            rows = [r for r in version["components"] if r["packetId"] == packet["packetId"] and r["status"] != "match"]
            if not rows:
                continue
            out += f"<details><summary>{esc(name)} · {esc(packet['folder'])} · {len(rows)} discrepancies</summary><div class='scroll'><table><thead><tr><th>Component</th><th>Employee answer</th><th>Draft</th><th>Content status / review</th></tr></thead><tbody>"
            for row in rows:
                show = lambda v: "Missing" if v is None or v == [] else json.dumps(v, ensure_ascii=False) if isinstance(v, list) else str(v)
                review = row.get("review") or {}
                out += f"<tr><td>{esc(row['scope'])} · {esc(row['fieldId'])} · {esc(row['component'])}<br><small>{esc(row['pairHash'])}</small></td><td>{esc(show(row['expected']))}</td><td>{esc(show(row['actual']))}</td><td>{esc(row['contentStatus'])}<br>{esc(review.get('reason', ''))}</td></tr>"
            out += "</tbody></table></div></details>"
    return out + "</html>"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=pathlib.Path, required=True)
    parser.add_argument("--candidate", type=pathlib.Path)
    parser.add_argument("--design", type=pathlib.Path, required=True)
    parser.add_argument("--adjudications", type=pathlib.Path, required=True)
    parser.add_argument("--coverage-audit", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--population", choices=("development", "holdout", "combined"), default="development",
                        help="Explicit comparison population; development is the default and excludes holdout answer values.")
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parents[1]
    catalog_url = (repo / "lib/ecus-form.ts").as_uri()
    catalog = json.loads(subprocess.check_output(["node", "--experimental-strip-types", "--input-type=module", "-e",
        f"import {{ECUS_FORM_FIELDS}} from {json.dumps(catalog_url)}; console.log(JSON.stringify(ECUS_FORM_FIELDS));"], text=True))
    design = json.loads(args.design.read_text())
    population_ids = select_population(design, args.population)
    if not args.adjudications.exists():
        raise SystemExit("Create an explicit adjudications input, such as {\"schemaVersion\":1,\"entries\":[]}; the evaluator never invents reviews.")
    adjudication_bytes = args.adjudications.read_bytes()
    adjudication_document = json.loads(adjudication_bytes)
    adjudications = adjudication_document["entries"]
    baseline_bytes = args.baseline.read_bytes()
    baseline_source = json.loads(baseline_bytes)
    candidate_bytes = args.candidate.read_bytes() if args.candidate and args.candidate.exists() else None
    baseline = evaluate(baseline_source, population_ids, catalog, adjudications, args.population)
    candidate = evaluate(json.loads(candidate_bytes), population_ids, catalog, adjudications, args.population) if candidate_bytes else None
    if candidate:
        assert_same_answers(baseline, candidate)
    report = {"schemaVersion": 1, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "scope": f"Explicit {args.population} population; unchanged exact labels and scorer. Content agreement is supplementary explicit review.",
              "population": args.population, "populationCollectionCount": len(population_ids), "catalogControlCount": len(catalog),
              "baselineSourceSha256": hashlib.sha256(baseline_bytes).hexdigest(),
              "candidateSourceSha256": hashlib.sha256(candidate_bytes).hexdigest() if candidate_bytes else None,
              "adjudicationsSha256": hashlib.sha256(adjudication_bytes).hexdigest(),
              "reviewMethod": adjudication_document.get("reviewMethod", {"kind": "Explicit pair-bound review", "independentHumanValidation": False}),
              "adjudicationCount": len(adjudications),
              "baseline": baseline, "candidate": candidate,
              "coverageAudit": json.loads(args.coverage_audit.read_text()) if args.coverage_audit else None}
    if args.population == "development":
        report["developmentCollectionCount"] = len(population_ids)
    args.output.mkdir(parents=True, exist_ok=True)
    payloads = {"content-agreement-report.json": json.dumps(report, ensure_ascii=False, indent=2),
                "content-agreement-report.html": render_html(report),
                "content-review-worksheet.json": json.dumps({"schemaVersion": 1,
                    "instructions": "Review original evidence. Copy only deliberately adjudicated templates into the adjudications entries. Missing values cannot receive credit. Wrong numeric/code values are not automatically equivalent. Keep the exact pairHash; a changed pair needs fresh review.",
                    "rows": worksheet("baseline", baseline) + (worksheet("candidate", candidate) if candidate else [])}, ensure_ascii=False, indent=2)}
    for name, content in payloads.items():
        target = args.output / name
        target.write_text(content)
        target.chmod(0o600)
    print(json.dumps({"population": args.population, "baseline": baseline["populationOverall"], "candidate": candidate["populationOverall"] if candidate else None,
                      "output": str(args.output)}, indent=2))


if __name__ == "__main__":
    main()
