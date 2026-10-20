"""Offline benchmark invariants; synthetic inputs only."""
import copy
import importlib.util
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import tokhai_ground_truth as ground

spec = importlib.util.spec_from_file_location("scorer", ROOT / "scripts/score-tokhai-benchmark.py")
scorer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scorer)


def field(field_id="1.44", component="amount", value="1000", kind="decimal"):
    return {"fieldId": field_id, "component": component, "value": value,
            "valueType": kind, "sheet": "synthetic", "cell": "P45"}


def label():
    return {"status": "parsed_import", "header": [field()], "goods": [], "warnings": []}


def pipeline_result(status="incomplete", success=True, amount="1000"):
    fields = [{"fieldId": "1.44", "applicability": "applicable", "value": {"kind": "invoice", "amount": amount}}] if amount is not None else []
    return {"status": status, "readingStatus": status, "blockedPages": 1 if status != "complete" else 0,
            "formStatus": "draft", "failures": [],
            "timings": [{"at": "2026-10-19T18:00:00Z", "elapsedMs": 2500, "success": success}],
            "state": {"cases": [{"goods": [], "declarationDraft": {"fields": fields}}]}}


class GroundTruthTests(unittest.TestCase):
    def test_native_number_is_not_reinterpreted_as_locale_grouping(self):
        self.assertEqual(ground.decimal_value(15.322), "15.322")
        self.assertEqual(ground.decimal_value("15.322"), "15322")
        self.assertEqual(ground.decimal_value("15.322,05"), "15322.05")
        self.assertEqual(ground.decimal_value("24294.96"), "24294.96")

    def test_fee_notice_does_not_become_zero_accuracy_import(self):
        result = ground.parse_sheets([{"name": "LePhi", "cells": {"A1": "Fee"}}])
        self.assertEqual(result["status"], "fee_notice_only")
        self.assertEqual(result["header"], [])

    def test_export_print_does_not_map_to_import_fields(self):
        result = ground.parse_sheets([{"name": "export", "cells": {"C1": "<EXP>", "E4": 12345.0}}])
        self.assertEqual(result["status"], "export_form_not_implemented")
        self.assertEqual(result["header"], [])

    def test_unrecognized_grid_is_not_silently_read(self):
        result = ground.parse_sheets([{"name": "changed", "cells": {"C1": "<IMP>", "H10": "private"}}])
        self.assertEqual(result["status"], "unsupported_layout")
        self.assertEqual(result["header"], [])


class ScoreTests(unittest.TestCase):
    def test_unrun_and_wholly_failed_results_have_no_accuracy(self):
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        pending = scorer.score_packet(packet, labels=[label()])
        failed = scorer.score_packet(packet, pipeline_result(success=False), [label()])
        self.assertEqual(pending["status"], "not_run")
        self.assertIsNone(pending["metrics"])
        self.assertEqual(failed["status"], "provider_failed_without_results")
        self.assertIsNone(failed["metrics"])

    def test_partial_reading_scores_against_the_full_answer_denominator(self):
        answer = label()
        answer["header"].append(field("1.44", "currencyCode", "USD", "text"))
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        partial = scorer.score_packet(packet, pipeline_result(), [answer])
        self.assertEqual(partial["status"], "scored_provisional")
        self.assertTrue(partial["scoreProvisional"])
        self.assertEqual(partial["metrics"]["total"], 2)
        self.assertEqual(partial["metrics"]["accuracy"], 0.5)
        self.assertEqual(partial["metrics"]["missing"], 1)
        self.assertEqual(partial["readingStatus"], "incomplete")

    def test_successful_but_rejected_reading_is_scored_as_missing(self):
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        rejected = scorer.score_packet(packet, pipeline_result(amount=None), [label()])
        self.assertEqual(rejected["metrics"]["accuracy"], 0)
        self.assertEqual(rejected["metrics"]["missing"], 1)
        self.assertEqual(rejected["status"], "scored_provisional")

    def test_attempted_and_completed_aggregates_do_not_hide_partial_errors(self):
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        partial = scorer.score_packet(packet, pipeline_result(amount="2000"), [label()])
        complete = scorer.score_packet(packet, pipeline_result(status="complete"), [label()])
        pending = scorer.score_packet(packet, labels=[label()])
        report = scorer.build_report([partial, complete, pending])
        self.assertEqual(report["summary"]["allAttempted"]["accuracy"], 0.5)
        self.assertEqual(report["summary"]["completedOnly"]["accuracy"], 1)
        self.assertEqual(report["summary"]["provisionalOnly"]["accuracy"], 0)
        self.assertEqual(report["summary"]["scoredSampleComponentCoverage"], 2 / 3)
        self.assertEqual(report["summary"]["allAttempted"]["mismatch"], 1)
        output = scorer.report_html(report)
        self.assertIn("mismatched or missing components", output)
        self.assertIn("2.5 sec", output)
        self.assertIn("Employee answer", output)
        self.assertIn("<td>2000</td>", output)

    def test_exact_component_matches_do_not_validate_additional_goods_rows(self):
        answer = label()
        answer["declaredGoodsCount"] = 1
        answer["goods"] = [{"index": 1, "fields": [field("1.74", "code", "12345678", "text")]}]
        result = pipeline_result(status="complete")
        shipment = result["state"]["cases"][0]
        shipment["goods"] = [{"id": "goods-1"}, {"id": "goods-2"}]
        shipment["declarationDraft"]["fields"].extend([
            {"fieldId": "1.74", "goodsLineId": goods_id, "applicability": "applicable", "value": {"kind": "code", "code": "12345678"}}
            for goods_id in ("goods-1", "goods-2")])
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        scored = scorer.score_packet(packet, result, [answer])
        self.assertEqual(scored["metrics"]["accuracy"], 1)
        self.assertEqual(scored["extraGoodsRows"], 1)
        self.assertEqual(scored["extraFilledComponents"], 1)
        report = scorer.build_report([scored])
        self.assertEqual(report["summary"]["allAttempted"]["extraGoodsRows"], 1)
        self.assertIn("additional AI goods rows", scorer.report_html(report))
        self.assertTrue(any("does not validate" in warning for warning in scored["warnings"]))

    def test_incomplete_employee_print_uses_declared_count_for_row_count_comparison(self):
        answer = label()
        answer["declaredGoodsCount"] = 10
        answer["goods"] = [{"index": n, "fields": []} for n in range(1, 10)]
        answer["warnings"] = ["Printed goods count 10 differs from parsed blocks 9; goods completeness requires review."]
        result = pipeline_result(status="complete")
        result["state"]["cases"][0]["goods"] = [{"id": str(n)} for n in range(10)]
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        scored = scorer.score_packet(packet, result, [answer])
        self.assertEqual(scored["expectedGoodsRows"], [10])
        self.assertEqual(scored["parsedEmployeeGoodsRows"], [9])
        self.assertEqual(scored["extraGoodsRows"], 0)

    def test_no_consensus_does_not_count_as_a_scored_collection(self):
        one, two = label(), label()
        two["header"][0]["value"] = "2000"
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        row = scorer.score_packet(packet, pipeline_result(status="complete"), [one, two])
        self.assertEqual(row["status"], "no_consensus_answer_components")
        self.assertFalse(row["benchmarkEligible"])
        self.assertEqual(scorer.build_report([row])["summary"]["scoredPackets"], 0)

    def test_elapsed_response_span_includes_gaps_and_is_not_summed_work(self):
        result = pipeline_result(status="complete")
        result["timings"] = [
            {"at": "2026-10-19T18:00:00Z", "elapsedMs": 5000, "success": True},
            {"at": "2026-10-19T18:02:00Z", "elapsedMs": 4000, "success": True}]
        result["groupingAssumption"] = "Folder partition supplied; grouping accuracy not evaluated."
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        row = scorer.score_packet(packet, result, [label()])
        self.assertEqual(row["timing"]["providerWorkMs"], 9000)
        self.assertEqual(row["timing"]["firstStartToLastFinishMs"], 124000)
        self.assertEqual(row["groupingAssumption"], result["groupingAssumption"])

    def test_missing_value_counts_against_accuracy(self):
        expected = scorer.truth_components(label())
        metrics = scorer.counts(scorer.compare(expected, {}))
        self.assertEqual(metrics["accuracy"], 0)
        self.assertEqual(metrics["missing"], 1)
        self.assertIsNone(metrics["filledPrecision"])

    def test_conflicting_revisions_are_never_best_of_scored(self):
        one = label()
        two = copy.deepcopy(one)
        two["header"][0]["value"] = "2000"
        expected, conflicts = scorer.consensus([one, two])
        self.assertFalse(expected)
        self.assertEqual(len(conflicts), 1)

    def test_omission_in_a_label_revision_is_ambiguous(self):
        empty = label()
        empty["header"] = []
        expected, conflicts = scorer.consensus([label(), empty])
        self.assertFalse(expected)
        self.assertEqual(len(conflicts), 1)

    def test_stale_and_not_applicable_predictions_cannot_match(self):
        entry = {"fieldId": "1.44", "applicability": "applicable", "value": {"kind": "invoice", "amount": "1000"}}
        for mutation in ({"stale": True}, {"applicability": "unresolved"}, {"applicability": "not_applicable"}):
            ship = {"goods": [], "declarationDraft": {"fields": [{**entry, **mutation}]}}
            self.assertEqual(scorer.predictions(ship), {})

    def test_reference_sets_ignore_order_but_not_missing_bill(self):
        expected = {("header", "1.26", "reference"): field("1.26", "reference", ["HBL1", "MBL2"], "reference_set")}
        self.assertEqual(scorer.compare(expected, {("header", "1.26", "reference"): ["MBL2", "HBL1"]})[0]["status"], "match")
        self.assertEqual(scorer.compare(expected, {("header", "1.26", "reference"): ["HBL1"]})[0]["status"], "mismatch")

    def test_different_invoices_require_source_label_assignment(self):
        one, two = label(), label()
        one["header"] = [field("1.41", "reference", "INV1", "text")]
        two["header"] = [field("1.41", "reference", "INV2", "text")]
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        result = scorer.score_packet(packet, labels=[one, two])
        self.assertEqual(result["status"], "multiple_shipments_need_label_assignment")
        self.assertIsNone(result["metrics"])

    def test_progress_notice_distinguishes_run_status_and_comparison_timestamp(self):
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        report = scorer.build_report([scorer.score_packet(packet, pipeline_result(), [label()])])
        report["progress"] = {"status": "stopped", "message": "No final marker <observed>",
                              "successfulPages": 1, "failedPages": 2, "pendingPages": 3,
                              "totalPages": 6, "observedAt": "2026-10-19T23:00:00Z",
                              "refreshError": "Assembly <failed>"}
        rendered = scorer.report_html(report)
        self.assertIn("Provider run: stopped", rendered)
        self.assertIn("Cached successful pages: 1; failed pages: 2", rendered)
        self.assertIn("without a valid saved response: 3", rendered)
        self.assertIn("Comparisons generated:", rendered)
        self.assertIn("Previous assembled draft comparisons are preserved", rendered)
        self.assertIn("Assembly &lt;failed&gt;", rendered)

    def test_resume_audit_exposes_interruption_without_changing_scores(self):
        packet = {"id": "test", "folder": "test", "caseType": "import", "sources": [{}]}
        report = scorer.build_report([scorer.score_packet(packet, pipeline_result(), [label()])])
        before = copy.deepcopy(report["summary"])
        profile = {"startedAt": "first", "attempts": [{"startedAt": "first", "concurrency": 2},
                                                        {"startedAt": "second", "concurrency": 8}]}
        interruptions = {"pages": [{"sourceSha256": "synthetic", "page": 1, "at": "first",
                                    "reason": "repair stopped", "record": "archive.json"}],
                         "earlierAbruptRestartInFlightAtMost": 2,
                         "benchmarkIsNotAFirstAttemptOnlyMeasure": True}
        scorer.attach_run_audit(report, profile, interruptions)
        self.assertEqual(report["summary"], before)
        self.assertFalse(report["runAudit"]["firstAttemptOnly"])
        self.assertEqual(report["runAudit"]["administrativelyInterruptedPages"], 1)
        self.assertFalse(report["runAudit"]["timingIncludesArchivedInterruptedCalls"])
        rendered = scorer.report_html(report)
        self.assertIn("not first-attempt-only accuracy", rendered)
        self.assertIn("up to 2 in-flight calls", rendered)
        self.assertIn("repair stopped", rendered)
        self.assertIn("Genuine provider failures remain counted", rendered)


if __name__ == "__main__":
    unittest.main()
