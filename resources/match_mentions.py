#!/usr/bin/env python3
"""Decide which repositories the resume already mentions.

Reads the resume the previous step chose and emits ONE BOOLEAN PER REPOSITORY.
It never prints the resume's text, a snippet of it, a character count of any
line, or any contact detail. The document is a personal one and the only thing
this play needs from it is whether a project name appears; that is all that
leaves this step.

Extraction is tiered and degrades honestly. Plain text and Markdown are read
directly, .docx and .odt are unzipped with the standard library, and PDF needs
`pdftotext` on PATH. When no extractor applies the step reports
available=false and every repository comes back mentioned=null (UNKNOWN)
rather than false, because "not found" and "could not look" are different
answers and only one of them is honest here.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

# Repository names that are also ordinary words. A hit on one of these is
# reported as weak evidence, because a resume can contain the word "studio"
# without ever meaning the repository called Studio.
AMBIGUOUS = {
    "studio", "atom", "portfolio", "talos", "quorum", "aegis", "vega", "core",
    "api", "app", "web", "site", "test", "demo", "docs", "blog", "server",
    "client", "data", "ml", "ai", "bot", "tools", "utils", "config", "main",
    "project", "sample", "example", "template", "starter", "dashboard",
}


def norm(text):
    """Lowercase and reduce to single-spaced alphanumeric tokens."""
    return " " + re.sub(r"[^a-z0-9]+", " ", text.lower()).strip() + " "


def read_text(path, ext):
    """Return (text, method) or (None, reason)."""
    try:
        if ext in (".txt", ".md", ".tex", ".rtf"):
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                return fh.read(), "plaintext"

        if ext == ".docx":
            with zipfile.ZipFile(path) as zf:
                xml = zf.read("word/document.xml").decode("utf-8", "ignore")
            return re.sub(r"<[^>]+>", " ", xml), "docx-stdlib"

        if ext == ".odt":
            with zipfile.ZipFile(path) as zf:
                xml = zf.read("content.xml").decode("utf-8", "ignore")
            return re.sub(r"<[^>]+>", " ", xml), "odt-stdlib"

        if ext == ".pdf":
            exe = shutil.which("pdftotext")
            if not exe:
                return None, (
                    "PDF text extraction needs `pdftotext` (poppler-utils) on PATH. "
                    "Install it (apt install poppler-utils / brew install poppler) for "
                    "mention detection, or export your resume to .docx or .md."
                )
            with tempfile.TemporaryDirectory() as tmp:
                dest = os.path.join(tmp, "out.txt")
                proc = subprocess.run(
                    [exe, "-q", "-layout", path, dest],
                    capture_output=True, timeout=20,
                )
                if proc.returncode != 0 or not os.path.exists(dest):
                    return None, "pdftotext could not read this PDF (it may be image-only/scanned)."
                with open(dest, "r", encoding="utf-8", errors="ignore") as fh:
                    return fh.read(), "pdftotext"

        return None, "No text extractor for '%s' files." % (ext or "unknown")
    except Exception as exc:  # noqa: BLE001 - optional degradation, reported as such
        return None, "Extraction failed: %s" % str(exc)[:100]


def load_arg(index, label):
    if len(sys.argv) <= index:
        sys.stderr.write("match_mentions: missing %s payload\n" % label)
        sys.exit(1)
    try:
        return json.loads(sys.argv[index])
    except (ValueError, TypeError) as exc:
        sys.stderr.write("match_mentions: %s payload was not valid JSON: %s\n" % (label, exc))
        sys.exit(1)


def main():
    resume = load_arg(1, "resolve_resume")
    repos_payload = load_arg(2, "fetch_repos")

    repos = repos_payload.get("candidates") or []
    chosen = resume.get("chosen") or {}
    path, ext = chosen.get("path"), (chosen.get("ext") or "").lower()

    text, method = (None, "resume step produced no file")
    if path and os.path.exists(path):
        text, method = read_text(path, ext)

    # An extractor can succeed and still recover nothing usable. pdftotext exits
    # 0 on a scanned or image-only PDF and writes a file of form feeds; a .docx
    # whose prose lives outside word/document.xml unzips to markup with no
    # words. Empty text matches no repository name, so every repository would be
    # reported "mentioned: false" - a confident wrong answer about a document
    # that was never actually read, printed under a line claiming it was. Treat
    # it as could-not-look, which is the honest answer.
    MIN_ALNUM = 100
    alnum = sum(1 for c in (text or "") if c.isalnum())
    if text is not None and alnum < MIN_ALNUM:
        method = (
            "%s ran but recovered only %d alphanumeric characters (a readable "
            "resume has far more than %d). This file is almost certainly "
            "image-only or scanned, so its text was never read. Run OCR on it, "
            "or export a text-based copy (.docx/.md), then re-run."
            % (method, alnum, MIN_ALNUM)
        )
        text = None

    if text is None:
        # Could not look. Say so; do not answer "not mentioned".
        print(json.dumps({
            "ok": True,
            "available": False,
            "warning": method,
            "method": None,
            "matches": {r.get("name"): {"mentioned": None, "evidence": None, "confidence": None}
                        for r in repos if r.get("name")},
        }))
        return

    haystack = norm(text)
    matches = {}
    for repo in repos:
        name = repo.get("name")
        if not name:
            continue

        needle = norm(name).strip()
        mentioned, evidence, confidence = False, None, None

        if needle and (" " + needle + " ") in haystack:
            mentioned = True
            evidence = "repository name"
            confidence = "weak" if needle.replace(" ", "") in AMBIGUOUS else "strong"

        if not mentioned:
            home = (repo.get("homepage") or "").strip()
            if home:
                host = re.sub(r"^https?://", "", home).split("/")[0]
                if host and norm(host).strip() in haystack:
                    mentioned, evidence, confidence = True, "live URL", "strong"

        matches[name] = {
            "mentioned": mentioned,
            "evidence": evidence,
            "confidence": confidence,
        }

    print(json.dumps({
        "ok": True,
        "available": True,
        "method": method,
        "matches": matches,
        "privacy_note": (
            "Resume text was read in this step and discarded. Only per-repository "
            "booleans leave it: no snippet, no contact detail, no document content."
        ),
    }))


if __name__ == "__main__":
    main()
