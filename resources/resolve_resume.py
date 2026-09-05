#!/usr/bin/env python3
"""Resolve which resume file to measure drift against.

Accepts a file path or a directory. When given a directory, the newest
resume-shaped file at the top level wins. Emits the chosen file plus every
candidate it considered, so the caller can see what it did not pick.

Fatal (nonzero exit) when the path does not exist or holds no resume-shaped
file: the play cannot answer its question without a baseline date.
"""

import json
import os
import sys
import time

RESUME_EXTS = {".pdf", ".docx", ".doc", ".md", ".txt", ".rtf", ".odt", ".tex", ".pages"}

# Files that look like resumes but are almost never THE resume.
NOISE_TOKENS = ("cover", "letter", "reference", "transcript", "certificate")


def die(message):
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(1)


def describe(path):
    st = os.stat(path)
    return {
        "path": os.path.abspath(path),
        "name": os.path.basename(path),
        "ext": os.path.splitext(path)[1].lower(),
        "mtime_epoch": st.st_mtime,
        "mtime_iso": time.strftime("%Y-%m-%d", time.localtime(st.st_mtime)),
        "size_bytes": st.st_size,
        "age_days": round((time.time() - st.st_mtime) / 86400, 1),
        "looks_like_cover_letter": any(t in path.lower() for t in NOISE_TOKENS),
    }


def main():
    if len(sys.argv) < 2:
        die("resolve_resume: missing resume_path argument")

    raw = sys.argv[1]
    if not raw or raw.startswith("$"):
        die(
            "resolve_resume: resume_path was not supplied.\n"
            "Pass an absolute path, e.g. resume_path=/home/you/Documents/resume.pdf"
        )

    path = os.path.expanduser(raw)

    if not os.path.exists(path):
        die(
            "resolve_resume: no such path: %s\n"
            "Pass an absolute path to a resume file, or to a folder containing one." % path
        )

    skipped_dirs = []
    if os.path.isdir(path):
        candidates = []
        for entry in sorted(os.listdir(path)):
            full = os.path.join(path, entry)
            if os.path.isdir(full):
                skipped_dirs.append(entry)
                continue
            if os.path.splitext(entry)[1].lower() in RESUME_EXTS:
                try:
                    candidates.append(describe(full))
                except OSError:
                    continue
        if not candidates:
            die(
                "resolve_resume: %s contains no resume-shaped file.\n"
                "Looked for: %s\n"
                "Subfolders are not searched; point resume_path at the file directly if it is nested."
                % (path, ", ".join(sorted(RESUME_EXTS)))
            )
        source = "directory"
    else:
        candidates = [describe(path)]
        source = "file"

    # Prefer a real resume over a cover letter, then newest wins.
    ranked = sorted(
        candidates,
        key=lambda c: (not c["looks_like_cover_letter"], c["mtime_epoch"]),
        reverse=True,
    )
    chosen = ranked[0]

    print(json.dumps({
        "ok": True,
        "available": True,
        "source": source,
        "today_iso": time.strftime("%Y-%m-%d", time.localtime()),
        "input_path": os.path.abspath(path),
        "chosen": chosen,
        "candidate_count": len(candidates),
        "candidates": [
            {k: c[k] for k in ("name", "mtime_iso", "age_days", "ext")}
            for c in ranked
        ],
        "skipped_subdirectories": skipped_dirs,
        # Stated, not hidden: this is the single weakest input in the play.
        "baseline_caveat": (
            "File modification time is a PROXY for when you last updated this resume. "
            "Cloud sync, a copy, or a re-download can reset it. "
            "Pass since=YYYY-MM-DD to override."
        ),
    }))


if __name__ == "__main__":
    main()
