"""Synthetic tests for supplementary review; no customer answer data."""
import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("content", pathlib.Path(__file__).resolve().parents[1] / "scripts/evaluate-content-agreement.py")
content = importlib.util.module_from_spec(spec)
spec.loader.exec_module(content)


def row(actual="Equivalent phrase", status="mismatch", component="text", expected="Expected phrase"):
    return {"packetId": "packet", "scope": "goods:1", "fieldId": "1.78", "component": component,
            "expected": expected, "actual": actual, "status": status}


def reviewed(r, **changes):
    return {**{key: r[key] for key in ("packetId", "scope", "fieldId", "component")},
            "pairHash": content.pair_hash(r["expected"], r["actual"]), "status": "equivalent",
            "reason": "Synthetic explicit review with evidence.", "reviewer": "tester", "reviewedAt": "2026-10-19T23:00:00Z", **changes}


class ContentReviewTests(unittest.TestCase):
    def test_no_automatic_numeric_or_code_equivalence(self):
        for r in [row(actual="101", expected="100", component="amount"), row(actual="US", expected="DE", component="code")]:
            self.assertEqual(content.adjudicate(r, {})["contentStatus"], "unreviewed_mismatch")

    def test_exact_pair_and_component_binding(self):
        r = row()
        index, errors = content.review_index([reviewed(r)])
        self.assertFalse(errors)
        self.assertEqual(content.adjudicate(r, index)["contentStatus"], "reviewed_equivalent")
        changed = content.adjudicate({**r, "actual": "Different phrase"}, index)
        self.assertEqual(changed["contentStatus"], "unreviewed_mismatch")
        self.assertEqual(changed["staleReviewCount"], 1)
        self.assertEqual(content.adjudicate({**r, "scope": "goods:2"}, index)["contentStatus"], "unreviewed_mismatch")
        self.assertNotEqual(content.pair_hash("1", 1), content.pair_hash("1", "1"))

    def test_missing_never_receives_equivalence_credit(self):
        r = row(None, "missing")
        index, _ = content.review_index([reviewed(r)])
        self.assertEqual(content.adjudicate(r, index)["contentStatus"], "missing")

    def test_full_denominator_and_filled_metric_math(self):
        exact, equivalent, wrong, missing = row("Expected phrase", "match"), row(), row("Wrong"), row(None, "missing")
        index, _ = content.review_index([reviewed(equivalent)])
        m = content.metrics([content.adjudicate(r, index) for r in (exact, equivalent, wrong, missing)])
        self.assertEqual(m["eligible"], 4)
        self.assertEqual(m["exactAgreement"], 0.25)
        self.assertEqual(m["contentAgreement"], 0.5)
        self.assertEqual(m["filledContentAgreement"], 2 / 3)
        self.assertEqual(m["filledCoverage"], 0.75)
        self.assertEqual(m["unreviewedMismatches"], 1)

    def test_incomplete_and_duplicate_reviews_fail_closed(self):
        r = row()
        index, errors = content.review_index([reviewed(r, reason="")])
        self.assertTrue(errors)
        self.assertEqual(content.adjudicate(r, index)["contentStatus"], "unreviewed_mismatch")
        index, errors = content.review_index([reviewed(r), reviewed(r)])
        self.assertTrue(errors)
        self.assertEqual(content.adjudicate(r, index)["contentStatus"], "unreviewed_mismatch")

    def test_ui_scope_and_expected_denominator_change_guard(self):
        mapping = content.mapping_for([{"fieldId": "1.78", "component": "text", "tab": "goods"}])
        self.assertEqual(content.assign_tab(row(), mapping), "goods")
        self.assertEqual(content.assign_tab({**row(), "fieldId": "1.86", "component": "unitCode"}, mapping), "structured_goods_only")
        before = {"components": [row()]}
        after = copy.deepcopy(before)
        after["components"][0]["expected"] = "Changed answer"
        with self.assertRaises(ValueError):
            content.assert_same_answers(before, after)

    def test_holdout_values_are_excluded_and_duplicate_comparisons_rejected(self):
        comparison = row()
        report = {"generatedAt": "synthetic", "summary": {"allAttempted": {}}, "packets": [
            {"packetId": "packet", "folder": "development", "comparisons": [comparison], "status": "scored_provisional", "readingStatus": "incomplete"},
            {"packetId": "holdout", "folder": "unseen", "comparisons": [{**comparison, "expected": "HOLDOUT VALUE"}], "status": "scored_provisional"}]}
        evaluated = content.evaluate(report, {"packet"}, [{"fieldId": "1.78", "component": "text", "tab": "goods"}], [])
        self.assertEqual(evaluated["developmentOverall"]["eligible"], 1)
        self.assertNotIn("HOLDOUT VALUE", str(evaluated))
        with self.assertRaises(ValueError):
            content.assert_same_answers({"components": [row(), row()]}, {"components": [row()]})

    def test_explicit_population_selection_and_honest_labels(self):
        design = {"development": [{"id": "packet"}], "holdout": [{"id": "holdout"}]}
        self.assertEqual(content.select_population(design, "development"), {"packet"})
        self.assertEqual(content.select_population(design, "holdout"), {"holdout"})
        self.assertEqual(content.select_population(design, "combined"), {"packet", "holdout"})
        report = {"generatedAt": "synthetic", "summary": {"allAttempted": {}}, "packets": [
            {"packetId": "packet", "folder": "dev", "comparisons": [row("Expected phrase", "match")], "status": "scored_complete_reading"},
            {"packetId": "holdout", "folder": "unseen", "comparisons": [row(None, "missing")], "status": "scored_provisional"}]}
        evaluated = content.evaluate(report, {"holdout"}, [], [], "holdout")
        self.assertNotIn("developmentOverall", evaluated)
        self.assertEqual(evaluated["population"], "holdout")
        self.assertEqual(evaluated["populationOverall"]["eligible"], 1)
        self.assertEqual(evaluated["populationOverall"]["contentAgreement"], 0)
        combined = content.evaluate(report, {"packet", "holdout"}, [], [], "combined")
        self.assertEqual(combined["populationOverall"]["contentAgreement"], .5)
        report["packets"][1]["comparisons"] = []
        unmeasured = content.evaluate(report, {"holdout"}, [], [], "holdout")
        self.assertIsNone(unmeasured["populationOverall"]["contentAgreement"])
        self.assertEqual(unmeasured["populationCoverage"]["collectionsWithoutComparisons"], 1)


if __name__ == "__main__":
    unittest.main()
