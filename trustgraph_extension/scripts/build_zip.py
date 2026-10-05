"""Builds the Chrome Web Store package. Standard library only.

    python3 trustgraph_extension/scripts/build_zip.py

Writes dist/trustgraph-<version>.zip (at the repo root) with manifest.json
at the top of the zip. Leaves out dev-only material:
  - test/, store/, scripts/, README.md, icons/icon.svg
  - adapters/stub.js and the localhost:5500 test-page content script
The local backend host permissions (127.0.0.1 / localhost) stay: they're how
the extension reaches the TrustGraph server on the user's own computer.
"""

import json
import sys
import zipfile
from pathlib import Path

EXT = Path(__file__).resolve().parent.parent
DIST = EXT.parent / "dist"

EXCLUDE_DIRS = {"test", "store", "scripts", "dist", "__pycache__", ".git"}
EXCLUDE_FILES = {"README.md", "adapters/stub.js", "icons/icon.svg", ".DS_Store"}
DEV_MATCH = "localhost:5500"


def production_manifest():
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    manifest["content_scripts"] = [
        entry for entry in manifest.get("content_scripts", [])
        if not any(DEV_MATCH in m for m in entry["matches"])
    ]
    return manifest


def files_to_ship():
    for path in sorted(EXT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(EXT).as_posix()
        if rel.split("/")[0] in EXCLUDE_DIRS or rel in EXCLUDE_FILES or path.name in EXCLUDE_FILES:
            continue
        if rel == "manifest.json":
            continue  # written separately (dev entries stripped)
        yield rel, path


def referenced_files(manifest):
    refs = {manifest["background"]["service_worker"], manifest["action"]["default_popup"], manifest["options_ui"]["page"]}
    refs.update(manifest.get("icons", {}).values())
    refs.update(manifest["action"].get("default_icon", {}).values())
    for entry in manifest.get("content_scripts", []):
        refs.update(entry.get("js", []))
        refs.update(entry.get("css", []))
    return refs


def check(manifest, shipped):
    problems = []
    for ref in sorted(referenced_files(manifest)):
        if ref not in shipped:
            problems.append(f"manifest references {ref}, which isn't in the package")
    text = json.dumps(manifest)
    if DEV_MATCH in text:
        problems.append("a localhost:5500 dev entry is still in the manifest")
    if len(manifest.get("description", "")) > 132:
        problems.append("manifest description is over 132 characters")
    for rel in shipped:
        if rel.endswith(".js"):
            source = (EXT / rel).read_text(encoding="utf-8")
            if "eval(" in source or "new Function(" in source:
                problems.append(f"{rel} uses eval/new Function (not allowed)")
    return problems


def main():
    manifest = production_manifest()
    shipped = dict(files_to_ship())
    problems = check(manifest, shipped)
    if problems:
        print("Build stopped:")
        for p in problems:
            print("  -", p)
        sys.exit(1)

    DIST.mkdir(exist_ok=True)
    out = DIST / f"trustgraph-{manifest['version']}.zip"
    fixed_time = (2026, 1, 1, 0, 0, 0)  # same input -> byte-identical zip
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        info = zipfile.ZipInfo("manifest.json", fixed_time)
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        for rel, path in shipped.items():
            info = zipfile.ZipInfo(rel, fixed_time)
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, path.read_bytes())

    print(f"Wrote {out.relative_to(EXT.parent)} ({out.stat().st_size // 1024} KB, {len(shipped) + 1} files)")
    for rel in ["manifest.json", *shipped]:
        print("  " + rel)


if __name__ == "__main__":
    main()
