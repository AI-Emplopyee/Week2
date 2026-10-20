"""Read ECUS employee answer keys locally, without opening Excel or running macros.

Only recognized import-print cells are mapped. Unknown layouts stay unscored.
This module is deliberately not imported by the AI extraction pipeline.
"""
from __future__ import annotations

import argparse
import collections
import datetime
from decimal import Decimal, InvalidOperation
import hashlib
import json
import pathlib
import re
import sys
import unicodedata


def text(value):
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip() if value is not None else ""


def normalized_label(value):
    return " ".join(unicodedata.normalize("NFC", text(value)).lower().split())


def decimal_value(value):
    if isinstance(value, (float, int)):
        return format(Decimal(str(value)).normalize(), "f")
    value = text(value).replace(" ", "")
    if "," in value:
        value = value.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"[+-]?\d{1,3}(?:\.\d{3})+", value):
        value = value.replace(".", "")
    try:
        return format(Decimal(value).normalize(), "f")
    except InvalidOperation:
        return None


def date_value(value):
    value = text(value)
    match = re.match(r"(\d{2})/(\d{2})/(\d{4})", value)
    if not match:
        return None
    try:
        return datetime.date(int(match[3]), int(match[2]), int(match[1])).isoformat()
    except ValueError:
        return None


def column_name(index):
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def read_xls(path, xlrd):
    book = xlrd.open_workbook(str(path), on_demand=True)
    sheets = []
    for sheet in book.sheets():
        cells = {}
        for r in range(sheet.nrows):
            for c in range(sheet.ncols):
                cell = sheet.cell(r, c)
                if cell.ctype not in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                    cells[f"{column_name(c + 1)}{r + 1}"] = cell.value
        sheets.append({"name": sheet.name, "cells": cells})
    book.release_resources()
    return sheets


def parse_sheets(sheets):
    result = {"schemaVersion": 1, "status": "unsupported_layout", "direction": "unknown",
              "declarationNumber": "", "header": [], "goods": [], "warnings": [],
              "method": "Read-only BIFF cells; no recalculation, macros, external links or AI interpretation."}
    primary = next((sheet for sheet in sheets if text(sheet["cells"].get("C1")) in ("<IMP>", "<EXP>")), None)
    if not primary:
        names = {normalized_label(s["name"]) for s in sheets}
        result["status"] = "fee_notice_only" if "lephi" in names else "unsupported_layout"
        result["warnings"].append("No recognized ECUS import/export print layout; retained for manual label review.")
        return result
    cells, sheet_name = primary["cells"], primary["name"]
    result["direction"] = "import" if text(cells.get("C1")) == "<IMP>" else "export"
    result["declarationNumber"] = text(cells.get("E4"))
    result["formTitle"] = text(cells.get("F2") or cells.get("E2"))
    if result["direction"] == "export":
        result["status"] = "export_form_not_implemented"
        result["warnings"].append("The application currently implements an import form. Export labels are not scored as import failures.")
        return result
    guards = {"C4": "số tờ khai", "C9": "người nhập khẩu", "C21": "người xuất khẩu", "C41": "số hóa đơn", "C45": "tổng trị giá hóa đơn"}
    if any(normalized_label(cells.get(cell)) != expected for cell, expected in guards.items()):
        result["warnings"].append("Import layout anchors differ from the audited grid; no guessed mappings were produced.")
        return result

    def add(target, field, component, cell, kind="text", override=None):
        raw = cells.get(cell, "") if override is None else override
        value = text(raw)
        if not value or re.fullmatch(r"[\s/\-\[\]]+", value):
            return
        if kind == "decimal":
            value = decimal_value(raw)
        elif kind == "date":
            value = date_value(raw)
        if value is None:
            result["warnings"].append(f"Unparsed {kind} at {sheet_name}!{cell}; excluded from denominator.")
            return
        target.append({"fieldId": field, "component": component, "value": value,
                       "rawValue": text(cells.get(cell, raw)), "valueType": kind, "sheet": sheet_name, "cell": cell})

    header = result["header"]
    fixed = [
        ("1.12", "code", "H10"), ("1.13", "name", "H11"), ("1.14", "code", "H13"),
        ("1.15", "text", "H14"), ("1.16", "text", "H16"), ("1.17", "code", "H18"),
        ("1.18", "name", "H19"), ("1.19", "code", "H22"), ("1.20", "name", "H23"),
        ("1.21", "code", "H24"), ("1.23", "code", "H27"), ("1.29", "code", "U30"),
        ("1.33", "code", "U31"), ("1.33", "name", "Z31"), ("1.34", "code", "U32"),
        ("1.34", "name", "Z32"), ("1.31", "callSign", "T34"), ("1.31", "name", "Z34"),
        ("1.27", "unitCode", "P36"), ("1.28", "unitCode", "P37"),
        ("1.40", "reference", "J42"), ("1.43", "code", "J44"), ("1.45", "code", "I52"),
        ("1.9", "code", "AE7"), ("1.52", "code", "AF73"), ("1.58", "code", "X73"),
    ]
    for field, component, cell in fixed:
        add(header, field, component, cell)
    # Address cells are deliberately not compared component-wise: the ECUS print
    # grid's four address cells do not promise the same semantic split as AICD.
    result["unscoredAddress"] = {"sheet": sheet_name, "cells": {c: text(cells.get(c)) for c in ("H25", "U25", "H26", "U26")}}
    for field, component, cell in [("1.27", "amount", "K36"), ("1.28", "amount", "K37"), ("1.35", "count", "K38"), ("1.44", "amount", "P45"), ("1.51", "amount", "J47")]:
        add(header, field, component, cell, "decimal")
    for field, cell in [("1.32", "U35"), ("1.42", "J43")]:
        add(header, field, "date", cell, "date")
    invoice = re.match(r"^([A-Z])\s*-\s*(.+)$", text(cells.get("J41")))
    if invoice:
        add(header, "1.39", "code", "J41", override=invoice[1])
        add(header, "1.41", "reference", "J41", override=invoice[2])
    elif text(cells.get("J41")):
        result["warnings"].append("Invoice classification/reference cell did not match the audited print pattern.")
    totals = re.match(r"^([A-Z])\s*-\s*([A-Z]{3})\s*-\s*([A-Z]{3})\s*-", text(cells.get("J45")))
    if totals:
        for component, value in zip(("priceCategoryCode", "incotermCode", "currencyCode"), totals.groups()):
            add(header, "1.44", component, "J45", override=value)
    else:
        result["warnings"].append("Invoice classification/term/currency cell did not match the audited print pattern.")
    procedure = re.match(r"^([A-Z]\d{2})\s+(\d)\s*\[\s*(\d)\s*\]", text(cells.get("P6")))
    if procedure:
        for field, value in zip(("1.4", "1.6", "1.7"), procedure.groups()):
            add(header, field, "code", "P6", override=value)
    bills = [{"value": text(cells.get(f"D{row}")), "sheet": sheet_name, "cell": f"D{row}"} for row in range(31, 36) if text(cells.get(f"D{row}"))]
    if bills:
        header.append({"fieldId": "1.26", "component": "reference", "value": [b["value"] for b in bills], "valueType": "reference_set", "sheet": sheet_name, "cell": ",".join(b["cell"] for b in bills)})

    # Locate every goods block by its explicit label, rather than assuming a
    # fixed page length. ECUS continuation and compact pages vary in length.
    anchors = sorted(int(cell[1:]) for cell, value in cells.items() if re.fullmatch(r"C\d+", cell) and normalized_label(value) == "mã số hàng hóa")
    for index, row in enumerate(anchors, 1):
        fields = []
        goods_guards = {f"C{row + 1}": "mô tả hàng hóa", f"S{row + 4}": "số lượng (1)",
                        f"C{row + 6}": "trị giá hóa đơn", f"S{row + 11}": "nước xuất xứ"}
        if any(normalized_label(cells.get(cell)) != expected for cell, expected in goods_guards.items()):
            result["warnings"].append(f"Goods block {index} has an unrecognized layout.")
            continue
        for field, component, col, offset, kind in [
            ("1.74", "code", "G", 0, "text"), ("1.78", "text", "G", 1, "text"),
            ("1.83", "amount", "V", 4, "decimal"), ("1.83", "unitCode", "AE", 4, "text"),
            ("1.84", "amount", "V", 5, "decimal"), ("1.84", "unitCode", "AE", 5, "text"),
            ("1.85", "amount", "I", 6, "decimal"), ("1.86", "amount", "V", 6, "decimal"),
            ("1.86", "currencyCode", "AC", 6, "text"), ("1.86", "unitCode", "AE", 6, "text"),
            ("1.79", "code", "X", 11, "text"), ("1.80", "code", "AC", 11, "text"),
        ]:
            add(fields, field, component, f"{col}{row + offset}", kind)
        result["goods"].append({"index": index, "fields": fields})
    expected_count = decimal_value(cells.get("AF75", ""))
    result["declaredGoodsCount"] = int(Decimal(expected_count)) if expected_count is not None else None
    if result["declaredGoodsCount"] is not None and result["declaredGoodsCount"] != len(result["goods"]):
        result["warnings"].append(f"Printed goods count {result['declaredGoodsCount']} differs from parsed blocks {len(result['goods'])}; goods completeness requires review.")
    result["status"] = "parsed_import"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=pathlib.Path, default=pathlib.Path("outputs/private-tokhai-benchmark/manifest.json"))
    parser.add_argument("--xlrd-path", type=pathlib.Path)
    args = parser.parse_args()
    if args.xlrd_path:
        sys.path.insert(0, str(args.xlrd_path.resolve()))
    try:
        import xlrd
    except ImportError:
        parser.error("Read-only XLS parsing requires xlrd. Supply --xlrd-path for an existing trusted installation.")
    manifest = json.loads(args.manifest.read_text())
    statuses = collections.Counter()
    parsed = []
    for packet in manifest["packets"]:
        for document in packet["grounds"]:
            raw_path = pathlib.Path(document["originalPath"])
            if hashlib.sha256(raw_path.read_bytes()).hexdigest() != document["sha256"]:
                raise RuntimeError("Ground-truth original hash changed: " + document["name"])
            if document["extension"] != ".xls":
                truth = {"schemaVersion": 1, "status": "non_xls_answer_key", "direction": "unknown", "header": [], "goods": [], "warnings": ["Retained original; automatic label parser supports recognized ECUS XLS layouts only."]}
            else:
                truth = parse_sheets(read_xls(raw_path, xlrd))
            truth["source"] = {key: document[key] for key in ("name", "sha256", "relativePath", "originalPath")}
            output = pathlib.Path(document["parsedGroundTruthPath"])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(truth, ensure_ascii=False, indent=2))
            statuses[truth["status"]] += 1
            parsed.append(truth)
    summary = {"labelFiles": len(parsed), "statuses": dict(statuses),
               "headerComponents": sum(len(t["header"]) for t in parsed),
               "goodsRows": sum(len(t["goods"]) for t in parsed),
               "goodsComponents": sum(len(g["fields"]) for t in parsed for g in t["goods"]),
               "labelsWithWarnings": sum(bool(t["warnings"]) for t in parsed),
               "accuracyMeasured": False}
    (args.manifest.parent / "ground-truth-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
