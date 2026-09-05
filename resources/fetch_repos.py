#!/usr/bin/env python3
"""Read a GitHub account's repositories and return only the ones that postdate
the resume baseline.

Filtering happens HERE rather than in the presentation for a load-bearing
reason: rote caps a step's stdout at 65536 bytes, and an account with a few
hundred repositories serialises far past that. A truncated payload is not a
loud failure - it is invalid JSON that reads downstream as "no repositories",
which is a confident wrong answer. So this step emits aggregate counts plus a
bounded candidate list, and every bound it applies is reported.

No credentials required. GITHUB_TOKEN is honoured when present purely to raise
the rate limit and include private repositories; it is never required and
never printed.

Fatal (nonzero exit) only when the account does not exist. Rate limits and
network failures are expected optional degradations: available=false with a
warning, exit 0, so the run still says plainly what it could not read.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
PER_PAGE = 100
MAX_PAGES = 4          # bounded on purpose; reported, never silent
MAX_CANDIDATES = 60    # keeps stdout far below rote's 65536-byte cap
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def die(message):
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(1)


def degrade(warning, **extra):
    payload = {
        "ok": True, "available": False, "warning": warning,
        "candidates": [], "total_read": 0, "exclusions": {},
    }
    payload.update(extra)
    print(json.dumps(payload))
    sys.exit(0)


def arg(index, default=""):
    if len(sys.argv) <= index:
        return default
    value = (sys.argv[index] or "").strip()
    # An unresolved $token passes through as a literal; treat it as absent.
    return default if value.startswith("$") else value


def request(url, token):
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "rote-play-resume-drift",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = "Bearer " + token
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=25)


def resolve_baseline(resume_json, since_param):
    """since= wins when well-formed; otherwise the resume file's timestamp."""
    if DATE_RE.match(since_param or ""):
        return since_param, "since= override"
    try:
        chosen = (json.loads(resume_json) or {}).get("chosen") or {}
        mtime = chosen.get("mtime_iso") or ""
        if DATE_RE.match(mtime):
            return mtime, "resume file timestamp (proxy)"
    except (ValueError, TypeError, AttributeError):
        pass
    return "", "unresolved"


def main():
    user = arg(1)
    if not user:
        die("fetch_repos: github_user was not supplied. Pass github_user=<your-handle>")
    if "github.com/" in user:  # people paste profile URLs
        user = user.rstrip("/").split("github.com/")[-1].split("/")[0]

    baseline, baseline_source = resolve_baseline(arg(2), arg(3))
    include_forks = arg(4).lower() in ("true", "1", "yes")
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""

    raw = []
    page_truncated = False
    for page in range(1, MAX_PAGES + 1):
        url = "%s/users/%s/repos?per_page=%d&page=%d&sort=pushed&type=owner" % (
            API, urllib.parse.quote(user), PER_PAGE, page,
        )
        try:
            with request(url, token) as resp:
                batch = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                die("fetch_repos: GitHub has no user named '%s'.\n"
                    "Check the handle: it is the name in github.com/<handle>." % user)
            if exc.code in (403, 429):
                degrade("GitHub rate limit reached for this IP (60 requests/hour "
                        "unauthenticated). Wait, or set GITHUB_TOKEN to raise it.", user=user)
            degrade("GitHub API returned HTTP %d." % exc.code, user=user)
        except urllib.error.URLError as exc:
            degrade("GitHub API unreachable: %s" % str(exc.reason)[:80], user=user)
        except Exception as exc:  # noqa: BLE001 - optional degradation, reported as such
            degrade("GitHub API read failed: %s" % str(exc)[:80], user=user)

        if not isinstance(batch, list) or not batch:
            break
        raw.extend(batch)
        if len(batch) < PER_PAGE:
            break
        if page == MAX_PAGES:
            page_truncated = True

    exclusions = {
        "fork": 0, "archived": 0, "profile README": 0,
        "empty": 0, "not pushed since baseline": 0,
    }
    candidates = []

    for repo in raw:
        name = repo.get("name") or ""
        if not name:
            continue
        if repo.get("fork") and not include_forks:
            exclusions["fork"] += 1
            continue
        if repo.get("archived"):
            exclusions["archived"] += 1
            continue
        if name.lower() == user.lower():
            exclusions["profile README"] += 1
            continue
        if not repo.get("size", 0):
            exclusions["empty"] += 1
            continue

        pushed = (repo.get("pushed_at") or "")[:10]
        if not baseline or not pushed or pushed <= baseline:
            exclusions["not pushed since baseline"] += 1
            continue

        candidates.append({
            "name": name,
            "description": (repo.get("description") or "")[:180],
            "language": repo.get("language"),
            "topics": (repo.get("topics") or [])[:8],
            "pushed_at": pushed,
            "homepage": (repo.get("homepage") or "").strip()[:120],
            "html_url": repo.get("html_url"),
            "stars": repo.get("stargazers_count", 0),
        })

    candidate_truncated = len(candidates) > MAX_CANDIDATES
    if candidate_truncated:
        candidates = candidates[:MAX_CANDIDATES]

    warnings = []
    if page_truncated:
        warnings.append("Only the %d most recently pushed repositories were read."
                        % (MAX_PAGES * PER_PAGE))
    if candidate_truncated:
        warnings.append("More than %d repositories postdate the baseline; showing the "
                        "%d most recently pushed." % (MAX_CANDIDATES, MAX_CANDIDATES))

    print(json.dumps({
        "ok": True,
        "available": True,
        "user": user,
        "authenticated": bool(token),
        "baseline": baseline,
        "baseline_source": baseline_source,
        "total_read": len(raw),
        "candidate_count": len(candidates),
        "candidates": candidates,
        "exclusions": exclusions,
        "truncated": page_truncated or candidate_truncated,
        "warning": " ".join(warnings) or None,
        "visibility_note": (
            "Public repositories only; set GITHUB_TOKEN to include private ones."
            if not token else "GITHUB_TOKEN present: private repositories included."
        ),
    }))


if __name__ == "__main__":
    main()
