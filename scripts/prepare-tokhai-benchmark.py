"""Build an isolated, hash-verified benchmark inventory from saved sample originals.

The employee declarations are labels only. No historical extracted page text,
candidate, human correction or saved draft is copied into benchmark inputs.
"""
from __future__ import annotations

import argparse
import collections
import datetime
import hashlib
import html
import json
import pathlib
import re
import sqlite3


def read_json(path):
    return json.loads(path.read_text())


def build_manifest(prepared, workspace, r2_database, blob_directory, output):
    inventory = read_json(prepared)
    saved = read_json(workspace)
    saved = saved.get("state", saved)
    by_hash = {document["sha256"]: document for document in saved["documents"]}
    by_folder = {case["sourceCollection"]["folder"]: case for case in saved["cases"]
                 if case.get("sourceCollection") and not case.get("mergedInto")}
    connection = sqlite3.connect(f"file:{r2_database.resolve()}?mode=ro", uri=True)
    blobs = dict(connection.execute("SELECT key, blob_id FROM _mf_objects"))
    connection.close()
    records = inventory["records"]
    is_tokhai = lambda record: any(re.search(r"to[ _-]*khai", pathlib.PurePosixPath(p).name, re.I)
                                  for p in record["metadata"]["sourcePaths"])
    folders = sorted({record["packet"] for record in records if is_tokhai(record)})
    verified = {}

    def original(record):
        sha = record["sha256"]
        if sha in verified:
            return dict(verified[sha])
        stored = by_hash.get(sha)
        blob_id = blobs.get(stored.get("blobKey")) if stored else None
        blob_path = blob_directory / blob_id if blob_id else None
        if not blob_path or not blob_path.is_file():
            raise RuntimeError(f"Missing original bytes: {record['relativePath']}")
        if hashlib.sha256(blob_path.read_bytes()).hexdigest() != sha:
            raise RuntimeError(f"Original hash mismatch: {record['relativePath']}")
        value = {"name": pathlib.PurePosixPath(record["relativePath"]).name,
                 "extension": record["extension"], "sha256": sha,
                 "originalPath": str(blob_path.resolve()),
                 "relativePath": record["relativePath"], "sourcePaths": record["metadata"]["sourcePaths"],
                 "mime": stored["mime"], "size": stored["size"],
                 "pageCount": len(record["metadata"].get("pages", [])),
                 "documentType": record["type"]}
        verified[sha] = value
        return dict(value)

    packets = []
    for folder in folders:
        packet_records = [record for record in records if record["packet"] == folder]
        sources, held_out, excluded, grounds = [], [], [], []
        for record in packet_records:
            item = original(record)
            label = is_tokhai(record)
            declaration = label or record["role"] in ("declaration_print_or_draft", "saved_ecus_declaration_export")
            if declaration:
                item["role"] = "employee_ecus_ground_truth" if label else "other_declaration_reference"
                held_out.append(item)
                if label:
                    grounds.append({**item, "parsedGroundTruthPath": str((output / "ground-truth" / f"{item['sha256']}.json").resolve())})
            elif record["metadata"]["referenceOnly"]:
                excluded.append({**item, "reason": "Audited reference/support file; not a primary commercial input."})
            else:
                sources.append(item)
        case = by_folder.get(folder, {})
        packets.append({"id": "tokhai-" + hashlib.sha256(folder.encode()).hexdigest()[:12],
                        "folder": folder, "caseType": case.get("caseType", "unknown"),
                        "sources": sources, "heldOut": held_out, "excludedSupportingFiles": excluded,
                        "grounds": grounds, "notes": []})
    summary = {"packets": len(packets), "sourceDocuments": sum(len(p["sources"]) for p in packets),
               "toKhaiDocuments": sum(len(p["grounds"]) for p in packets),
               "heldOutDocuments": sum(len(p["heldOut"]) for p in packets),
               "originalsHashVerified": len(verified),
               "caseTypes": dict(collections.Counter(p["caseType"] for p in packets)),
               "sourceExtensions": dict(collections.Counter(d["extension"] for p in packets for d in p["sources"]))}
    return {"schemaVersion": 1, "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "methodology": "Original bytes only; ToKhai and other declaration outputs are held out. Historical readings and saved draft values never enter AI inputs.",
            "summary": summary, "packets": packets}


def upload_inventory(manifest):
    """A local, reviewable disclosure of the precise prospective provider input."""
    esc = html.escape
    sections = []
    for packet in manifest["packets"]:
        rows = "".join(f"<tr><td>{esc(d['name'])}</td><td>{esc(d['extension'])}</td><td>{d['size']:,}</td></tr>" for d in packet["sources"])
        labels = "".join(f"<li>{esc(d['name'])}</li>" for d in packet["heldOut"])
        sections.append(f"<details><summary>{esc(packet['folder'])} — {len(packet['sources'])} source files, {len(packet['heldOut'])} held-out files</summary><p>Recorded direction: {esc(packet['caseType'])}</p><table><thead><tr><th>Original source file</th><th>Format</th><th>Bytes</th></tr></thead><tbody>{rows}</tbody></table><h3>Held out locally</h3><ul>{labels}</ul></details>")
    summary = manifest["summary"]
    no_sources = sum(not p["sources"] for p in manifest["packets"])
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ToKhai benchmark upload inventory</title><style>body{font:16px/1.55 system-ui;max-width:1050px;margin:40px auto;padding:0 24px;color:#202a33}h1{line-height:1.15}p{max-width:850px}details{border-top:1px solid #ccd2d8;padding:18px 0}summary{cursor:pointer;font-weight:600}table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px;border-bottom:1px solid #e3e8ed}code{overflow-wrap:anywhere}li{font-size:14px}</style><h1>ToKhai benchmark upload inventory</h1><p>Prospective destination: <code>https://api.moonshot.ai/v1/chat/completions</code> (Kimi / Moonshot International).</p>""" + f"<p>{summary['sourceDocuments']} original source documents across {summary['packets']} sample collections are selected. Page images will be rendered locally from the originals. Their business contents may include company names, addresses, invoices, transport references and transaction amounts. Originals have been verified against their saved SHA-256 fingerprints.</p><p>Employee declarations and other ECUS declaration outputs remain local as answer keys. They are excluded from AI requests. Historical extracted text, saved answers and reviewer corrections are also excluded. {no_sources} collections have no primary source documents and will be reported without AI accuracy scores.</p>" + "".join(sections) + "</html>"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=pathlib.Path, default=pathlib.Path("outputs/private-jobfile/prepared.json"))
    parser.add_argument("--workspace", type=pathlib.Path, default=pathlib.Path("outputs/private-jobfile/after-classification-repair.json"))
    parser.add_argument("--r2-database", type=pathlib.Path, default=pathlib.Path(".aicd-local/state/v3/r2/miniflare-R2BucketObject/7f2b90917544871e14538ac6918cc3e91d1f000342b125988f76b240b4ca5337.sqlite"))
    parser.add_argument("--blob-directory", type=pathlib.Path, default=pathlib.Path(".aicd-local/state/v3/r2/aicd-local-documents/blobs"))
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("outputs/private-tokhai-benchmark"))
    args = parser.parse_args()
    manifest = build_manifest(args.prepared, args.workspace, args.r2_database, args.blob_directory, args.output)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    (args.output / "upload-inventory.html").write_text(upload_inventory(manifest))
    print(json.dumps(manifest["summary"], ensure_ascii=False, indent=2))
