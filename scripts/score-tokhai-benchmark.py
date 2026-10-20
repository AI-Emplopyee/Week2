"""Score isolated pipeline drafts against held-out employee ECUS imports.

No provider is called. Missing runs are pending, not zero-accuracy results.
Conflicting label revisions and unsupported form types stay outside the score.
"""
from __future__ import annotations

import argparse
import collections
import datetime
from decimal import Decimal, InvalidOperation
import html
import json
import os
import pathlib
import statistics
import unicodedata
import uuid


def normalize_text(value):
    return " ".join(unicodedata.normalize("NFC", str(value)).casefold().split())


def normalize_value(value, value_type):
    if value_type == "reference_set":
        return tuple(sorted(normalize_text(v) for v in value))
    if value_type == "decimal":
        try:
            return str(Decimal(str(value)).normalize())
        except InvalidOperation:
            return normalize_text(value)
    return normalize_text(value)


def truth_components(truth):
    source = truth.get("source", {})
    def traced(field):
        return {**field, "sourceFile": source.get("name"), "sourceSha256": source.get("sha256")}
    components = {("header", f["fieldId"], f["component"]): traced(f) for f in truth["header"]}
    for goods in truth["goods"]:
        for field in goods["fields"]:
            components[(f"goods:{goods['index']}", field["fieldId"], field["component"])] = traced(field)
    return components


def consensus(labels):
    """Keep only components present and identical in every label revision."""
    maps = [truth_components(label) for label in labels]
    keys = set().union(*(set(mapping) for mapping in maps))
    values, conflicts = {}, []
    for key in sorted(keys):
        present = [mapping[key] for mapping in maps if key in mapping]
        if len(present) != len(maps) or len({normalize_value(p["value"], p["valueType"]) for p in present}) != 1:
            conflicts.append({"key": list(key), "reason": "Employee label revisions differ or omit this component.", "values": [p["value"] for p in present]})
        else:
            values[key] = present[0]
    return values, conflicts


def predictions(shipment):
    values = {}
    rows = {goods["id"]: f"goods:{i}" for i, goods in enumerate(shipment.get("goods", []), 1)}
    for entry in shipment.get("declarationDraft", {}).get("fields", []):
        if entry.get("applicability") != "applicable" or entry.get("stale"):
            continue
        scope = rows.get(entry.get("goodsLineId")) if entry.get("goodsLineId") else "header"
        if scope is None:
            continue
        value = entry["value"]
        if entry["fieldId"] == "1.26" and "rows" in value:
            values[(scope, "1.26", "reference")] = [row["reference"] for row in value["rows"] if row.get("reference", "").strip()]
        else:
            for component, content in value.items():
                if component not in ("kind", "rows") and str(content).strip():
                    values[(scope, entry["fieldId"], component)] = content
    return values


def compare(expected, actual):
    outcomes = []
    for key, field in sorted(expected.items()):
        value = actual.get(key)
        if value is None or value == []:
            status = "missing"
        elif normalize_value(value, field["valueType"]) == normalize_value(field["value"], field["valueType"]):
            status = "match"
        else:
            status = "mismatch"
        outcomes.append({"scope": key[0], "fieldId": key[1], "component": key[2], "status": status,
                         "expected": field["value"], "actual": value, "sheet": field["sheet"], "cell": field["cell"],
                         "sourceFile": field.get("sourceFile"), "sourceSha256": field.get("sourceSha256")})
    return outcomes


def counts(outcomes):
    result = {key: sum(row["status"] == key for row in outcomes) for key in ("match", "mismatch", "missing")}
    total = len(outcomes)
    filled = result["match"] + result["mismatch"]
    return {**result, "total": total, "accuracy": result["match"] / total if total else None,
            "filledPrecision": result["match"] / filled if filled else None,
            "coverage": filled / total if total else None}


def score_packet(packet, result=None, labels=None):
    row = {"packetId": packet["id"], "folder": packet["folder"], "caseType": packet["caseType"],
           "sourceDocuments": len(packet["sources"]), "status": "not_run", "comparisons": [], "labelConflicts": [], "warnings": [], "metrics": None, "timing": None,
           "scoreProvisional": False, "eligibleComponents": 0, "benchmarkEligible": False,
           "successfulPageCalls": 0, "recordedPageCalls": 0}
    if result is not None:
        row["pipelineStatus"] = result["status"]
        row["readingStatus"] = result.get("readingStatus", result["status"])
        row["formStatus"] = result.get("formStatus", "unavailable")
        row["pipelineFailureCount"] = len(result.get("failures", []))
        row["pipelineFailures"] = result.get("failures", [])
        row["blockedPages"] = result.get("blockedPages")
        row["blockedDocuments"] = result.get("blockedDocuments")
        row["resultGeneratedAt"] = result.get("generatedAt")
        row["groupingAssumption"] = result.get("groupingAssumption")
        timings = result.get("timings", [])
        row["recordedPageCalls"] = len(timings)
        row["successfulPageCalls"] = sum(bool(t["success"]) for t in timings)
        if timings:
            starts = [datetime.datetime.fromisoformat(t["at"].replace("Z", "+00:00")).timestamp() * 1000 for t in timings]
            last_finish = max(start + t["elapsedMs"] for start, t in zip(starts, timings))
            row["timing"] = {"providerWorkMs": sum(t["elapsedMs"] for t in timings),
                             "firstStartToLastFinishMs": last_finish - min(starts),
                             "firstRequestAt": datetime.datetime.fromtimestamp(min(starts) / 1000, datetime.timezone.utc).isoformat(),
                             "lastResponseAt": datetime.datetime.fromtimestamp(last_finish / 1000, datetime.timezone.utc).isoformat(),
                             "recordedPageCalls": len(timings), "successfulPageCalls": row["successfulPageCalls"]}
    if labels is None:
        labels = [json.loads(pathlib.Path(d["parsedGroundTruthPath"]).read_text()) for d in packet["grounds"]]
    row["labelStatuses"] = dict(collections.Counter(t["status"] for t in labels))
    import_labels = [t for t in labels if t["status"] == "parsed_import"]
    row["warnings"] = list(dict.fromkeys(w for t in import_labels for w in t.get("warnings", [])))
    if not packet["sources"]:
        row["status"] = "no_primary_sources"
        return row
    if packet["caseType"] != "import":
        row["status"] = "non_import_collection"
        return row
    if not import_labels:
        row["status"] = "no_supported_import_answer_key"
        return row
    invoices = {normalize_text(next((f["value"] for f in t["header"] if f["fieldId"] == "1.41" and f["component"] == "reference"), "")) for t in import_labels}
    if len(invoices) > 1:
        row["status"] = "multiple_shipments_need_label_assignment"
        row["warnings"].append("This sample folder contains distinct invoice answer keys. Score requires confirmed source-to-declaration grouping.")
        return row
    expected, conflicts = consensus(import_labels)
    row["labelConflicts"] = conflicts
    if any("goods completeness requires review" in warning for warning in row["warnings"]):
        expected = {key: field for key, field in expected.items() if key[0] == "header"}
        row["warnings"].append("Goods score excluded until the missing employee-print block is reviewed.")
    row["eligibleComponents"] = len(expected)
    if not expected:
        row["status"] = "no_consensus_answer_components"
        return row
    row["benchmarkEligible"] = True
    if result is None:
        return row
    if row["successfulPageCalls"] == 0:
        row["status"] = "provider_failed_without_results" if row["recordedPageCalls"] else "not_run"
        return row
    cases = [case for case in result["state"]["cases"] if not case.get("mergedInto")]
    if len(cases) != 1:
        row["status"] = "multiple_shipments_need_label_assignment"
        return row
    row["comparisons"] = compare(expected, predictions(cases[0]))
    row["metrics"] = counts(row["comparisons"])
    row["headerMetrics"] = counts([c for c in row["comparisons"] if c["scope"] == "header"])
    row["goodsMetrics"] = counts([c for c in row["comparisons"] if c["scope"] != "header"])
    row["parsedEmployeeGoodsRows"] = sorted({len(label["goods"]) for label in import_labels})
    row["declaredEmployeeGoodsRows"] = sorted({label["declaredGoodsCount"] for label in import_labels if label.get("declaredGoodsCount") is not None})
    row["expectedGoodsRows"] = row["declaredEmployeeGoodsRows"] or row["parsedEmployeeGoodsRows"]
    row["actualGoodsRows"] = len(cases[0].get("goods", []))
    expected_count = row["expectedGoodsRows"][0] if len(row["expectedGoodsRows"]) == 1 else None
    row["extraGoodsRows"] = max(0, row["actualGoodsRows"] - expected_count) if expected_count is not None else None
    row["missingGoodsRows"] = max(0, expected_count - row["actualGoodsRows"]) if expected_count is not None else None
    row["extraFilledComponents"] = len(set(predictions(cases[0])) - set(expected))
    if row["extraGoodsRows"]:
        row["warnings"].append(f"AI has {row['extraGoodsRows']} additional goods rows beyond the employee row count. Component agreement does not validate these rows.")
    row["scoreProvisional"] = row["readingStatus"] != "complete"
    row["status"] = "scored_provisional" if row["scoreProvisional"] else "scored_complete_reading"
    return row


FIELD_LABELS = {
    "1.4": "Procedure", "1.6": "Transport mode", "1.7": "Party classification", "1.9": "Processing division",
    "1.12": "Importer code", "1.13": "Importer name", "1.14": "Importer postal code", "1.15": "Importer address", "1.16": "Importer phone",
    "1.17": "Entrusting importer code", "1.18": "Entrusting importer", "1.19": "Exporter code", "1.20": "Exporter name", "1.21": "Exporter postal code", "1.23": "Consignment country",
    "1.26": "Transport reference", "1.27": "Packages", "1.28": "Gross weight", "1.29": "Storage location", "1.31": "Transport", "1.32": "Arrival date", "1.33": "Unloading location", "1.34": "Loading location", "1.35": "Containers",
    "1.39": "Invoice classification", "1.40": "Electronic invoice reference", "1.41": "Invoice reference", "1.42": "Invoice date", "1.43": "Payment method", "1.44": "Invoice total", "1.45": "Valuation classification", "1.51": "Allocation factor", "1.52": "Taxpayer", "1.58": "Tax deadline category",
    "1.74": "HS code", "1.78": "Goods description", "1.79": "Origin country", "1.80": "Tariff schedule", "1.83": "Quantity 1", "1.84": "Quantity 2", "1.85": "Item invoice amount", "1.86": "Unit price",
}


def aggregate_packets(packets):
    scored = [p for p in packets if p["metrics"] is not None]
    metrics = counts([c for packet in scored for c in packet["comparisons"]])
    timing = [p["timing"]["firstStartToLastFinishMs"] for p in scored if p["timing"]]
    return {"packets": len(scored), **metrics,
            "header": counts([c for p in scored for c in p["comparisons"] if c["scope"] == "header"]),
            "goods": counts([c for p in scored for c in p["comparisons"] if c["scope"] != "header"]),
            "extraGoodsRows": sum(p.get("extraGoodsRows") or 0 for p in scored),
            "packetsWithExtraGoodsRows": sum(bool(p.get("extraGoodsRows")) for p in scored),
            "unscoredPopulatedComponents": sum(p.get("extraFilledComponents", 0) for p in scored),
            "medianObservedResponseSpanMs": statistics.median(timing) if timing else None,
            "medianObservedProcessingMs": statistics.median(timing) if timing else None}


def build_report(packets):
    attempted = aggregate_packets(packets)
    completed = aggregate_packets([p for p in packets if p["metrics"] is not None and not p["scoreProvisional"]])
    provisional = aggregate_packets([p for p in packets if p["scoreProvisional"]])
    eligible = [p for p in packets if p["benchmarkEligible"]]
    eligible_components = sum(p["eligibleComponents"] for p in eligible)
    return {"schemaVersion": 2, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "methodology": "Exact employee-answer agreement, not independently established model correctness. Whitespace/case normalized, numeric formatting normalized, otherwise exact. Translations, customs decisions and employee information absent from the sources can differ without establishing an AI error. Any successful provider result permits a provisional score against the full eligible answer denominator. Missing output counts as non-agreement, including unread pages. Unrun or wholly failed provider requests have no score. All-attempted and completed-reading-only metrics are separate. Blank/conflicting labels are excluded. Goods use print row order. Filled-value agreement covers only components with a comparable answer; unscored populated fields and extra goods rows are counted separately and are not validated by the agreement score. Timing is the first-request-to-last-response span, including waits/resumed caches, not time to form completion. No unscored field or draft is claimed complete.",
            "summary": {"packets": len(packets), "scoredPackets": attempted["packets"],
                        "provisionalPackets": provisional["packets"], "completedReadingPackets": completed["packets"],
                        "providerAttemptedPackets": sum(p["recordedPageCalls"] > 0 for p in packets),
                        "eligiblePackets": len(eligible), "eligibleComponents": eligible_components,
                        "scoredSampleComponentCoverage": attempted["total"] / eligible_components if eligible_components else None,
                        "statusCounts": dict(collections.Counter(p["status"] for p in packets)),
                        "allAttempted": attempted, "completedOnly": completed, "provisionalOnly": provisional,
                        **{key: value for key, value in attempted.items() if key not in ("packets", "header", "goods")}},
            "packets": packets}


def attach_run_audit(report, profile, interruptions):
    """Describe resumed measurement without changing any score or cached response."""
    attempts = profile.get("attempts", [])
    if not attempts and profile.get("startedAt"):
        attempts = [{"startedAt": profile["startedAt"]}]
    pages = interruptions.get("pages", [])
    resumed = len(attempts) > 1 or bool(pages) or bool(interruptions.get("benchmarkIsNotAFirstAttemptOnlyMeasure"))
    report["runAudit"] = {
        "measurementBasis": "resumed_cached_pipeline_outputs" if resumed else "saved_pipeline_outputs",
        "firstAttemptOnly": False if resumed else None,
        "originalStartedAt": profile.get("startedAt"), "attempts": attempts,
        "administrativeInterruptions": interruptions,
        "administrativelyInterruptedPages": len(pages),
        "earlierAbruptRestartInFlightAtMost": interruptions.get("earlierAbruptRestartInFlightAtMost", 0),
        "timingIncludesArchivedInterruptedCalls": False,
        "timingMayOmitUnrecordedInterruptedCalls": bool(interruptions.get("earlierAbruptRestartInFlightAtMost")),
    }
    note = " The evaluated outputs reuse saved pipeline responses across resumed attempts; this is not a first-attempt-only measurement." if resumed else " Saved pipeline responses may include the normal validation-repair step; raw first-response accuracy is not measured."
    if pages:
        note += f" {len(pages)} administratively interrupted page failures were archived separately so normal reading and repair could resume. They are not silently treated as successful first attempts."
    if interruptions.get("earlierAbruptRestartInFlightAtMost"):
        note += f" An earlier abrupt restart may have repeated up to {interruptions['earlierAbruptRestartInFlightAtMost']} in-flight calls without saved outcomes."
    if resumed:
        note += " Reported provider work sums the current saved readings only; it excludes archived interruption records and cannot include calls without saved outcomes. Genuine provider failures remain in the evaluated cache."
    report["methodology"] += note


def report_html(report):
    esc = html.escape
    def percent(value):
        return "—" if value is None else f"{value * 100:.1f}%"
    def duration(milliseconds):
        if milliseconds is None:
            return "—"
        seconds = milliseconds / 1000
        return f"{seconds:.1f} sec" if seconds < 60 else f"{seconds / 60:.1f} min"
    def display(value):
        if value is None or value == []:
            return "<span class='muted'>Missing</span>"
        if isinstance(value, list):
            return "<br>".join(esc(str(v)) for v in value)
        return esc(str(value))
    def field_name(scope, field, component):
        prefix = "Header" if scope == "header" else "Goods row " + scope.split(":", 1)[-1]
        return esc(f"{prefix} · {FIELD_LABELS.get(field, field)} · {component} ({field})")
    rows, details = [], []
    for index, packet in enumerate(report["packets"], 1):
        metrics = packet["metrics"] or {}
        timing = packet["timing"] or {}
        status = "Provisional · reading incomplete" if packet["scoreProvisional"] else "Reading complete · draft scored" if metrics else packet["status"].replace("_", " ")
        rows.append(f"<tr><td><a href='#packet-{index}'>{esc(packet['folder'])}</a></td><td>{esc(status)}</td><td>{percent(metrics.get('accuracy'))}</td><td>{metrics.get('match', '—')} / {metrics.get('total', '—')}</td><td>{percent(metrics.get('coverage'))}</td><td>{duration(timing.get('firstStartToLastFinishMs'))}</td></tr>")
        content = f"<p>Status: <strong>{esc(status)}</strong>. {packet['sourceDocuments']} source files; {packet['successfulPageCalls']} successful provider page calls out of {packet['recordedPageCalls']} recorded calls.</p>"
        if "readingStatus" in packet:
            content += f"<p>Reading: {esc(packet['readingStatus'])}. Unresolved pages: {packet.get('blockedPages') if packet.get('blockedPages') is not None else 'unavailable'}. Unresolved documents: {packet.get('blockedDocuments') if packet.get('blockedDocuments') is not None else 'unavailable'}. Recorded pipeline failures: {packet.get('pipelineFailureCount', 0)}. Form: {esc(packet.get('formStatus', 'unavailable'))}.</p>"
        if packet.get("groupingAssumption"):
            content += f"<p>Grouping basis: {esc(str(packet['groupingAssumption']))}</p>"
        if timing:
            content += f"<p>Elapsed from first request to last response: <strong>{duration(timing['firstStartToLastFinishMs'])}</strong>. Summed provider work: {duration(timing['providerWorkMs'])}. This excludes preparation and human review and may include queue waits or gaps between resumed runs. It is not time to complete the form.</p>"
            content += f"<p class='muted'>First request: {esc(timing['firstRequestAt'])}. Last recorded response: {esc(timing['lastResponseAt'])}.</p>"
        if metrics:
            content += f"<p>Matches: {metrics['match']}. Mismatches: {metrics['mismatch']}. Missing: {metrics['missing']}. Eligible answers: {metrics['total']}. Exact answer agreement: {percent(metrics['accuracy'])}; comparable filled-value exact agreement: {percent(metrics['filledPrecision'])}; filled coverage: {percent(metrics['coverage'])}.</p>"
            if packet["scoreProvisional"]:
                content += "<p class='notice'>This provisional score uses the full eligible answer denominator. Answers still missing because of unread or failed pages count as missing; the draft is not complete.</p>"
            content += f"<p>Header exact agreement: {percent(packet['headerMetrics']['accuracy'])} ({packet['headerMetrics']['match']}/{packet['headerMetrics']['total']}). Goods exact agreement: {percent(packet['goodsMetrics']['accuracy'])} ({packet['goodsMetrics']['match']}/{packet['goodsMetrics']['total']}). Declared employee goods rows: {esc(', '.join(str(n) for n in packet['declaredEmployeeGoodsRows'])) or 'not printed'}; parsed employee goods rows: {esc(', '.join(str(n) for n in packet['parsedEmployeeGoodsRows']))}; AI goods rows: {packet['actualGoodsRows']}. Additional AI goods rows: {packet['extraGoodsRows'] if packet['extraGoodsRows'] is not None else 'ambiguous employee count'}. Populated components outside the comparable answer denominator: {packet['extraFilledComponents']}; their correctness is unmeasured.</p>"
        if packet["warnings"]:
            content += "<ul class='notice'>" + "".join(f"<li>{esc(warning)}</li>" for warning in packet["warnings"]) + "</ul>"
        differences = [item for item in packet["comparisons"] if item["status"] != "match"]
        if differences:
            content += f"<details><summary>{len(differences)} mismatched or missing components</summary><div class='scroll'><table class='differences'><thead><tr><th>Field</th><th>Result</th><th>Employee answer</th><th>AI draft</th><th>Answer location</th></tr></thead><tbody>"
            for item in differences:
                source_name = esc(item.get("sourceFile") or "Employee answer key")
                content += f"<tr><td>{field_name(item['scope'], item['fieldId'], item['component'])}</td><td>{esc(item['status'])}</td><td>{display(item['expected'])}</td><td>{display(item['actual'])}</td><td>{source_name}<br>{esc(item['sheet'])}!{esc(item['cell'])}</td></tr>"
            content += "</tbody></table></div></details>"
        if packet["labelConflicts"]:
            content += f"<details><summary>{len(packet['labelConflicts'])} employee revision conflicts excluded</summary><ul>"
            for conflict in packet["labelConflicts"]:
                content += f"<li>{field_name(*conflict['key'])}: {display(conflict['values'])}</li>"
            content += "</ul></details>"
        if packet.get("pipelineFailures"):
            content += f"<details><summary>{len(packet['pipelineFailures'])} pipeline failures or missing readings</summary><ul>"
            for failure in packet["pipelineFailures"]:
                content += f"<li>{esc(failure.get('stage', 'pipeline'))}, page {esc(str(failure.get('page', 'unknown')))}: {esc(failure.get('error', 'Unspecified error'))}</li>"
            content += "</ul></details>"
        details.append(f"<details class='packet' id='packet-{index}'><summary>{esc(packet['folder'])} — {percent(metrics.get('accuracy'))} · {esc(status)}</summary>{content}</details>")
    total = report["summary"]
    groups = ""
    for title, key in [("All attempted with results", "allAttempted"), ("Reading complete only", "completedOnly"), ("Incomplete reading only", "provisionalOnly")]:
        group = total[key]
        groups += f"<tr><td>{title}</td><td>{group['packets']}</td><td>{percent(group['accuracy'])}</td><td>{group['match']} / {group['total']}</td><td>{percent(group['filledPrecision'])}</td><td>{percent(group['coverage'])}</td><td>{group['mismatch']}</td><td>{group['missing']}</td></tr>"
    document = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ToKhai benchmark results</title><style>body{font:15px/1.6 system-ui;max-width:1200px;margin:40px auto;padding:0 24px;color:#202a33}h1{line-height:1.2}p{max-width:1000px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:10px;text-align:left;border-bottom:1px solid #d8dfe5;vertical-align:top}th{background:#f2f5f7}td{overflow-wrap:anywhere}a{color:#175f84}.scroll{overflow-x:auto}.differences{min-width:800px;table-layout:fixed}.differences th:nth-child(1){width:23%}.differences th:nth-child(2){width:10%}.differences th:nth-child(3),.differences th:nth-child(4){width:25%}.differences th:nth-child(5){width:17%}.packet{padding:18px 0;border-bottom:1px solid #bfc9d2}summary{cursor:pointer;font-weight:600}.packet details{margin:14px 0;padding:12px;background:#f7f9fa}.notice{background:#fff8e6;padding:14px 18px;border-radius:5px}.notice li{margin-left:15px}.muted{color:#66737d}button{padding:8px 12px;margin-right:8px;background:white;border:1px solid #bac6cf;border-radius:5px;cursor:pointer}</style><h1>ToKhai benchmark results</h1>"""
    progress = report.get("progress")
    if progress:
        document += f"<div class='notice'><strong>Provider run: {esc(progress['status'].replace('_', ' '))}.</strong> {esc(progress['message'])}<br>Cached successful pages: {progress['successfulPages']}; failed pages: {progress['failedPages']}; without a valid saved response: {progress['pendingPages']}; total prepared pages: {progress['totalPages']}.<br>Progress observed: {esc(progress['observedAt'])}. Comparisons generated: {esc(report['generatedAt'])}."
        if progress.get("lastActivityAt"):
            document += f" Last cache/log activity: {esc(progress['lastActivityAt'])}."
        if progress.get("refreshError"):
            document += f"<br>Report refresh problem: {esc(progress['refreshError'])}. Previous assembled draft comparisons are preserved."
        document += "</div>"
    audit = report.get("runAudit")
    if audit:
        attempts = audit["attempts"]
        if audit["firstAttemptOnly"] is False:
            document += "<div class='notice'><strong>Resumed pipeline measurement.</strong> The scores use saved responses across resumed attempts and are not first-attempt-only accuracy. Normal validation repair is part of the pipeline."
            document += f" {audit['administrativelyInterruptedPages']} page failure records were archived after administrative interruption so their reading and repair could resume. Genuine provider failures remain counted."
            if audit["earlierAbruptRestartInFlightAtMost"]:
                document += f" An earlier abrupt restart may have repeated up to {audit['earlierAbruptRestartInFlightAtMost']} in-flight calls whose outcomes were not saved."
            document += " Summed provider work excludes any archived or unsaved interrupted calls and may undercount total work. Elapsed spans include gaps between attempts and are not production turnaround guarantees.</div>"
        else:
            document += "<p>These are saved pipeline outputs, which may include normal validation repair. Raw first-response accuracy is not measured.</p>"
        if attempts:
            document += "<details><summary>Run attempts and administrative interruption audit</summary><div class='scroll'><table><thead><tr><th>Attempt</th><th>Started at</th><th>Benchmark readers</th></tr></thead><tbody>"
            for index, attempt in enumerate(attempts, 1):
                document += f"<tr><td>{index}</td><td>{esc(str(attempt.get('startedAt', 'unavailable')))}</td><td>{esc(str(attempt.get('concurrency', 'unavailable')))}</td></tr>"
            document += "</tbody></table></div><p>The reader count is benchmark concurrency. The application configuration may differ. Shared provider rate limits still apply.</p>"
            pages = audit["administrativeInterruptions"].get("pages", [])
            if pages:
                document += "<ul>"
                for page in pages:
                    document += f"<li>Source fingerprint {esc(str(page.get('sourceSha256', 'unavailable')))}, page {esc(str(page.get('page', 'unavailable')))}; request started {esc(str(page.get('at', 'unavailable')))}. {esc(str(page.get('reason', 'Administrative interruption')))} Archived record: {esc(str(page.get('record', 'unavailable')))}.</li>"
                document += "</ul>"
            document += "</details>"
    document += f"<p>{total['packets']} sample collections. {total['eligiblePackets']} score-eligible import collections. {total['scoredPackets']} have provider results and a score: {total['completedReadingPackets']} with complete readings, {total['provisionalPackets']} provisional. The scored collections cover {percent(total['scoredSampleComponentCoverage'])} of all eligible answer components.</p>"
    document += f"<p>Across scored collections: {total['allAttempted']['extraGoodsRows']} additional AI goods rows beyond the employee counts; {total['allAttempted']['unscoredPopulatedComponents']} populated components outside the comparable answer denominator. These outputs are not validated by the agreement score.</p>"
    if not total["scoredPackets"]:
        document += "<p class='notice'><strong>No successful provider results have been scored yet. Exact answer agreement and shipment completion time have not been measured.</strong></p>"
    document += "<p>Exact answer agreement uses every eligible employee answer component. Missing AI values count as non-agreement, including answers on unread pages. The main score includes incomplete collections with any successful provider result; the completed-reading score is shown separately. Wholly failed or unrun collections have no score and remain visible. Exact comparison normalizes case, whitespace and number formatting. Goods compare in printed row order. Filled-value agreement covers only components with an eligible employee answer; a 100% agreement score does not validate extra or otherwise unscored output.</p><p class='notice'>A mismatch is a difference to review, not an independently verified model error. Employee descriptions may be Vietnamese translations of English source text. Customs decisions or information available to the employee may be absent from the supplied sources. This strict comparison does not assess semantic equivalence or whether every answer could be inferred from the documents.</p><p>These are draft component comparisons, not full-form completion. Audited sample-folder grouping and direction are supplied test inputs; this does not measure automatic email grouping accuracy.</p><div class='scroll'><table><thead><tr><th>Score population</th><th>Collections</th><th>Exact answer agreement</th><th>Matches / eligible</th><th>Comparable filled-value exact agreement</th><th>Filled coverage</th><th>Mismatched</th><th>Missing</th></tr></thead><tbody>" + groups + "</tbody></table></div>"
    document += "<h2>Collections</h2><div class='scroll'><table><thead><tr><th>Sample collection</th><th>Status</th><th>Exact answer agreement</th><th>Matches / eligible</th><th>Filled coverage</th><th>Observed elapsed</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table></div><h2>Review details</h2><p>Expand a collection to inspect timing, missing fields, mismatches and excluded answer conflicts.</p><p><button id='expand'>Expand all</button><button id='collapse'>Collapse all</button></p>" + "".join(details)
    document += f"<p class='muted'>Report generated {esc(report['generatedAt'])}. Timing covers recorded provider requests and responses, including gaps between them; it is not a guarantee of shipment completion time.</p><script>document.getElementById('expand').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=true);document.getElementById('collapse').onclick=()=>document.querySelectorAll('details').forEach(d=>d.open=false);document.querySelectorAll('a[href^=\"#packet-\"]').forEach(a=>a.onclick=()=>{{document.querySelector(a.getAttribute('href')).open=true;}});</script></html>"
    return document


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=pathlib.Path, default=pathlib.Path("outputs/private-tokhai-benchmark"))
    parser.add_argument("--results-directory", type=pathlib.Path, help="Offline assembly results to score; defaults to <directory>/results.")
    parser.add_argument("--output-directory", type=pathlib.Path, help="Write reports here; defaults to directory.")
    parser.add_argument("--progress-file", type=pathlib.Path, help="Pinned-run watcher progress metadata, read only.")
    parser.add_argument("--existing-report", type=pathlib.Path, help="Preserve prior comparisons and only rerender their progress/error notice.")
    args = parser.parse_args()
    if args.existing_report:
        report = json.loads(args.existing_report.read_text())
    else:
        manifest = json.loads((args.directory / "manifest.json").read_text())
        packets = []
        for packet in manifest["packets"]:
            result_path = (args.results_directory or args.directory / "results") / f"{packet['id']}.json"
            result = json.loads(result_path.read_text()) if result_path.exists() else None
            packets.append(score_packet(packet, result))
        report = build_report(packets)
        profile_path = args.directory / "run-profile.json"
        interruptions_path = args.directory / "administrative-interruptions.json"
        if profile_path.exists() or interruptions_path.exists():
            attach_run_audit(report,
                             json.loads(profile_path.read_text()) if profile_path.exists() else {},
                             json.loads(interruptions_path.read_text()) if interruptions_path.exists() else {})
    progress_path = args.progress_file or args.directory / "run-progress.json"
    if progress_path.exists():
        report["progress"] = json.loads(progress_path.read_text())
    output = args.output_directory or args.directory
    atomic_write(output / "accuracy-report.json", json.dumps(report, ensure_ascii=False, indent=2))
    atomic_write(output / "accuracy-report.html", report_html(report))
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
