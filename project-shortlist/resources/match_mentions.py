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


# ---------------------------------------------------------------- house style
#
# A generated bullet that does not look like the rest of the page is obviously
# generated. So the resume's own bullet style is measured here and handed
# forward as a SHAPE, never as content.
#
# The privacy contract is unchanged and is the reason this lives in this step:
# what leaves is a set of counts, ratios and verbs drawn from a fixed allowlist
# below. No sentence, no fragment, no employer, no contact detail, and no word
# that is not already written in this file can escape through it.

ACTION_VERBS = (
    "built", "developed", "designed", "implemented", "created", "engineered",
    "led", "architected", "optimized", "optimised", "reduced", "improved",
    "automated", "deployed", "integrated", "migrated", "refactored", "launched",
    "delivered", "scaled", "streamlined", "established", "configured",
    "maintained", "analyzed", "analysed", "researched", "collaborated",
    "managed", "spearheaded", "programmed", "constructed", "enhanced",
    "achieved", "increased", "decreased", "generated", "trained", "orchestrated",
    "modelled", "modeled", "wrote", "shipped", "owned", "drove", "coordinated",
    "assembled", "prototyped", "benchmarked", "tested", "documented",
)

BULLET_GLYPHS = "\u2022\u25cf\u25aa\u2023\u2043\u00b7-*\u25e6\u2219"


def extract_style(text):
    """Measure how this resume writes its bullets. Returns shape, never content."""
    bullets = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        glyph = None
        if line[0] in BULLET_GLYPHS and len(line) > 3:
            glyph = line[0]
            line = line[1:].strip()
        words = line.split()
        if not (4 <= len(words) <= 60):
            continue
        first = re.sub(r"[^a-z]", "", words[0].lower())
        # A bullet is either marked with a glyph, or opens with an action verb.
        if glyph or first in ACTION_VERBS:
            bullets.append({"line": line, "words": words, "glyph": glyph, "first": first})

    if len(bullets) < 2:
        return {
            "detected": False,
            "reason": "fewer than two bullet-shaped lines were found, so the "
                      "existing style could not be measured; a neutral default is used",
        }

    lengths = sorted(len(b["words"]) for b in bullets)
    median_words = lengths[len(lengths) // 2]

    verbs = {}
    verb_opened = 0
    for b in bullets:
        if b["first"] in ACTION_VERBS:
            verb_opened += 1
            verbs[b["first"]] = verbs.get(b["first"], 0) + 1
    top_verbs = [v for v, _ in sorted(verbs.items(), key=lambda kv: -kv[1])[:5]]

    ends_period = sum(1 for b in bullets if b["line"].rstrip().endswith("."))
    with_digits = sum(1 for b in bullets if any(c.isdigit() for c in b["line"]))
    paren_tech = sum(1 for b in bullets if re.search(r"\([A-Za-z0-9 ,.+/#-]{4,60}\)\s*\.?$", b["line"]))
    using_tech = sum(1 for b in bullets
                     if re.search(r"\b(using|with|via|in)\b[^.]{0,60}\.?\s*$", b["line"], re.I))
    glyphs = [b["glyph"] for b in bullets if b["glyph"]]
    glyph = max(set(glyphs), key=glyphs.count) if glyphs else None

    n = len(bullets)
    return {
        "detected": True,
        "bullets_seen": n,
        "median_words": median_words,
        "min_words": lengths[0],
        "max_words": lengths[-1],
        "opens_with_verb_pct": round(100 * verb_opened / n),
        "top_verbs": top_verbs,
        "ends_with_period_pct": round(100 * ends_period / n),
        "includes_number_pct": round(100 * with_digits / n),
        "tech_in_parentheses_pct": round(100 * paren_tech / n),
        "tech_after_using_pct": round(100 * using_tech / n),
        "bullet_glyph": glyph,
    }


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

    repos = repos_payload.get("projects") or repos_payload.get("candidates") or []
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
        # The likely cause, and the fix, depend on which extractor actually ran.
        # "Run OCR on it" is sound advice for a scanned PDF and nonsense for an
        # RTF or plaintext file that is simply short or a placeholder.
        if method == "pdftotext":
            likely = (
                "This file is almost certainly image-only or scanned, so its text "
                "was never read. Run OCR on it, or export a text-based copy "
                "(.docx/.md), then re-run."
            )
        else:
            likely = (
                "For a %s file this usually means the document is a placeholder, "
                "nearly empty, or holds little more than a name and a date. "
                "Add real content, or export a text-based copy (.docx/.md), then "
                "re-run." % method
            )
        method = (
            "%s ran but recovered only %d alphanumeric characters (a readable "
            "resume has far more than %d). %s"
            % (method, alnum, MIN_ALNUM, likely)
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
            "style": {"detected": False,
                      "reason": "the resume could not be read, so its bullet style "
                                "could not be measured"},
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
        "style": extract_style(text),
        "privacy_note": (
            "Resume text was read in this step and discarded. What leaves it is "
            "per-repository booleans plus a style profile of counts, ratios and "
            "verbs drawn from a fixed allowlist: no snippet, no contact detail, "
            "and no document content."
        ),
    }))


if __name__ == "__main__":
    main()
