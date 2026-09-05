#!/usr/bin/env python3
"""Judge every project on measured evidence and rank what belongs on a resume.

This step answers a harder question than "what is missing": it asks what each
project can actually PROVE about itself, and therefore whether it earns a place
in a resume's project section at all. Projects already named on the resume are
judged by the same rubric as the rest - being listed already is not evidence of
being worth listing.

Two modes, because GitHub allows 60 unauthenticated requests an hour and a naive
deep scan of twenty repositories exhausts that in one run:

  shortlist  score every repository from the metadata already returned by the
             repository listing (free), then spend evidence calls only on the
             strongest candidates. Two calls each: README and the recursive file
             tree. The bound is a parameter and is always printed.

  deep_dive  the user has confirmed a handful of projects. Spend the budget on
             those alone and gather what a resume bullet actually needs.

Every score is the sum of named signals, and every signal is printed with the
evidence that earned it. There is no generated or model-derived number anywhere
in this file: a reader can recompute the total by hand from the printed list.

Rate limiting and network failure are optional degradations: they emit
available=false with a warning and exit 0, so the run still reports what it
could not read. Only a missing account is fatal.
"""

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.github.com"
PER_PAGE = 100
MAX_PAGES = 3
STDOUT_SAFETY = 60000  # rote caps step stdout at 65536 bytes

# Manifests that reveal a real dependency set.
MANIFESTS = (
    "package.json", "requirements.txt", "pyproject.toml", "go.mod",
    "Cargo.toml", "pom.xml", "build.gradle", "Gemfile", "composer.json",
)

TEST_HINTS = ("test/", "tests/", "__tests__/", "spec/", "_test.", ".test.", ".spec.", "test_")
DOC_HINTS = ("docs/", "documentation/", "doc/")
INFRA_HINTS = ("dockerfile", "docker-compose", "k8s/", "kubernetes/", "terraform/", "helm/")


def die(message):
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(1)


def degrade(warning, **extra):
    payload = {"ok": True, "available": False, "warning": warning,
               "projects": [], "deep": [], "api_calls": 0}
    payload.update(extra)
    print(json.dumps(payload))
    sys.exit(0)


def arg(index, default=""):
    if len(sys.argv) <= index:
        return default
    value = (sys.argv[index] or "").strip()
    return default if value.startswith("$") else value


class Gh:
    """Tiny GitHub client that counts its own calls and never exceeds a budget."""

    def __init__(self, token, budget):
        self.token = token
        self.budget = budget
        self.calls = 0
        self.rate_limited = False
        self.exhausted = False


    def remaining(self):
        """Ask GitHub how much quota is left. This call is free: the rate limit
        endpoint is explicitly not counted against the rate limit."""
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "rote-play-project-shortlist",
        }
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        try:
            req = urllib.request.Request(API + "/rate_limit", headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                core = json.loads(resp.read().decode("utf-8"))["resources"]["core"]
            return int(core.get("remaining", -1)), int(core.get("reset", 0))
        except Exception:  # noqa: BLE001 - preflight is advisory, never fatal
            return -1, 0

    def get(self, path):
        if self.calls >= self.budget:
            self.exhausted = True
            return None
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "rote-play-project-shortlist",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        self.calls += 1
        try:
            req = urllib.request.Request(API + path, headers=headers)
            with urllib.request.urlopen(req, timeout=25) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 429):
                self.rate_limited = True
            if exc.code == 404:
                return None
            return None
        except Exception:  # noqa: BLE001 - a missing optional read, reported in aggregate
            return None


def days_between(a, b):
    """Whole days between two ISO date strings, or None."""
    from datetime import date
    try:
        ya, ma, da = (int(x) for x in a[:10].split("-"))
        yb, mb, db = (int(x) for x in b[:10].split("-"))
        return (date(yb, mb, db) - date(ya, ma, da)).days
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------- metadata pass


def score_metadata(repo):
    """Signals readable from the repository listing alone. No extra API calls."""
    signals = []
    flags = []

    home = (repo.get("homepage") or "").strip()
    if home:
        signals.append((3, "deployed", "homepage is set: " + home[:80]))
    elif repo.get("has_pages"):
        signals.append((2, "deployed", "GitHub Pages is enabled"))

    stars = repo.get("stargazers_count", 0)
    if stars >= 10:
        signals.append((3, "attention", "%d stars" % stars))
    elif stars >= 3:
        signals.append((2, "attention", "%d stars" % stars))
    elif stars >= 1:
        signals.append((1, "attention", "%d star(s)" % stars))

    if repo.get("forks_count", 0) >= 1:
        signals.append((1, "attention", "%d fork(s)" % repo["forks_count"]))
    if repo.get("open_issues_count", 0) >= 1:
        signals.append((1, "activity", "%d open issue(s)" % repo["open_issues_count"]))

    size = repo.get("size", 0)
    if size >= 1000:
        signals.append((2, "substance", "%d KB of code" % size))
    elif size >= 200:
        signals.append((1, "substance", "%d KB of code" % size))
    elif size < 30:
        flags.append("thin: only %d KB in the repository" % size)

    span = days_between(repo.get("created_at", ""), repo.get("pushed_at", ""))
    if span is not None:
        if span >= 90:
            signals.append((3, "sustained", "worked on across %d days" % span))
        elif span >= 30:
            signals.append((2, "sustained", "worked on across %d days" % span))
        elif span >= 7:
            signals.append((1, "sustained", "worked on across %d days" % span))
        elif span <= 1:
            flags.append("one-day scaffold: created and last pushed within %d day(s)" % span)

    if (repo.get("description") or "").strip():
        signals.append((1, "described", "has a repository description"))
    else:
        flags.append("no description: nothing states what it is")

    if repo.get("topics"):
        signals.append((1, "described", "topics: " + ", ".join(repo["topics"][:5])))
    if repo.get("license"):
        signals.append((1, "polish", "has a licence"))

    return signals, flags


# ---------------------------------------------------------------- evidence pass


BADGE_RE = re.compile(r"^\s*\[?!\[")
HEADING_RE = re.compile(r"^\s*#")
HTML_RE = re.compile(r"^\s*<")


def readme_first_prose(text):
    """First prose SENTENCE, cleaned of markdown so it can go straight into a bullet.

    A whole README paragraph is not a resume bullet. One sentence is, and a
    reader can always open the repository for the rest.
    """
    for raw in text.splitlines():
        line = raw.strip()
        if not line or BADGE_RE.match(line) or HEADING_RE.match(line) or HTML_RE.match(line):
            continue
        # Drop blockquote, bullet and emphasis marks that would otherwise be
        # pasted verbatim into a bullet ("Built > Task management ...").
        line = re.sub(r"^[>\-\*\s]+", "", line)
        line = re.sub(r"[*_`\[\]]", "", line)
        line = re.sub(r"\((https?://[^)]+)\)", "", line)
        if len(line) < 25:
            continue
        first = re.split(r"(?<=[.!?])\s+", line)[0].strip()
        if len(first) < 25:
            first = line
        if len(first) > 170:
            first = first[:170].rsplit(" ", 1)[0] + "..."
        return first.rstrip(" ,;:")
    return None


# Numbers that could serve as a measured outcome. Deliberately narrow: a version
# number or a year is not an achievement, so those shapes are excluded.
METRIC_RE = re.compile(
    r"(\d[\d,]*(?:\.\d+)?\s?%"                       # 40%
    r"|\d[\d,]*(?:\.\d+)?\s?(?:ms|milliseconds?|seconds?|minutes?|hours?)\b"
    r"|\d[\d,]*(?:\.\d+)?\s?(?:MB|GB|TB)\b"
    r"|\d[\d,]*\+?\s+(?:users|requests|records|rows|images|files|queries|"
    r"downloads|students|papers|customers|transactions|documents|articles)\b"
    r"|\d+(?:\.\d+)?x\s+(?:faster|slower|more|less|improvement|speedup))",
    re.I,
)

# A line of configuration or code is not a claim about outcomes. "MATCH_TOLERANCE
# = 0.06  # 94% confidence" is a constant, and offering it as a measured result
# invites exactly the fabrication this play exists to prevent.
def _is_prose(line):
    if "=" in line or "`" in line or "|" in line:
        return False
    if line.startswith(("#", ">", "$", "```")):
        return False
    if re.match(r"^[-*]\s*[A-Za-z0-9_.\-]+\s+v?\d", line):   # "- SQLAlchemy 2.x"
        return False
    return len(line.split()) >= 4


def find_metrics(text):
    """Candidate measured outcomes, quoted with the line they came from."""
    found = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or BADGE_RE.match(line) or len(line) > 300 or not _is_prose(line):
            continue
        for match in METRIC_RE.finditer(line):
            value = match.group(1).strip()
            if re.match(r"^\d{4}$", value):  # a bare year is not a result
                continue
            found.append({"value": value, "line": re.sub(r"[*_`]", "", line)[:160]})
            if len(found) >= 6:
                return found
    return found


def has_section(text, *words):
    low = text.lower()
    return any(("# " + w) in low or ("## " + w) in low or ("###" + w) in low for w in words)


def deps_from_manifest(name, content):
    """Dependency names, quoted from the manifest, never inferred."""
    try:
        if name == "package.json":
            data = json.loads(content)
            deps = list((data.get("dependencies") or {}).keys())
            deps += list((data.get("devDependencies") or {}).keys())[:4]
            return deps[:80]
        if name in ("requirements.txt",):
            out = []
            for line in content.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    out.append(re.split(r"[=<>\[;]", line)[0].strip())
            return out[:80]
        if name == "go.mod":
            return re.findall(r"^\s+([\w.\-/]+)\s+v", content, re.M)[:80]
        if name == "Cargo.toml":
            block = content.split("[dependencies]")[-1]
            return re.findall(r"^([\w\-]+)\s*=", block, re.M)[:80]
        if name == "pyproject.toml":
            return re.findall(r"^\s*([\w\-]+)\s*=", content.split("dependencies")[-1], re.M)[:80]
    except (ValueError, TypeError, IndexError):
        return []
    return []


# A resume bullet names the stack, not the component library. These are real
# dependencies, but they describe nothing a reader cares about, and ten radix
# primitives bury the two frameworks that actually say what the project is.
DEP_NOISE = (
    "@radix-ui/", "@types/", "eslint", "prettier", "@babel/", "postcss",
    "autoprefixer", "clsx", "classnames", "tailwind-merge", "lucide-react",
    "class-variance-authority", "@eslint/", "typescript-eslint", "vite-plugin",
    "@vitejs/", "rimraf", "cross-env", "dotenv", "nodemon", "concurrently",
)

# Named first, because these say what the project IS.
DEP_HEADLINE = (
    "next", "react", "vue", "svelte", "angular", "astro", "nuxt", "express",
    "fastapi", "django", "flask", "nestjs", "prisma", "mongoose", "sqlalchemy",
    "psycopg2", "pg", "redis", "socket.io", "tailwindcss", "torch", "pytorch",
    "tensorflow", "keras", "scikit-learn", "pandas", "numpy", "transformers",
    "langchain", "openai", "anthropic", "stripe", "firebase", "supabase",
    "boto3", "aws-sdk", "graphql", "apollo", "trpc", "drizzle-orm", "zod",
    "opencv-python", "celery", "pytest", "jest", "vitest", "flask-sqlalchemy",
)


def rank_deps(deps):
    """Drop noise, put the naming dependencies first, cap the list."""
    kept = [d for d in deps if not any(d.lower().startswith(n) for n in DEP_NOISE)]
    headline = [d for d in kept if d.lower() in DEP_HEADLINE]
    rest = [d for d in kept if d.lower() not in DEP_HEADLINE]
    return (headline + rest)[:8]


def categorise(repo, paths, deps):
    """A category from observed files and dependencies, never from the name alone."""
    blob = " ".join(deps).lower()
    lowered = [p.lower() for p in paths]
    joined = " ".join(lowered)
    lang = (repo.get("language") or "").lower()
    home = (repo.get("homepage") or "").strip()

    def any_dep(*names):
        return any(n in blob for n in names)

    if any_dep("torch", "tensorflow", "keras", "scikit", "sklearn", "transformers", "xgboost"):
        return "ML / data science"
    if any_dep("express", "fastapi", "django", "flask", "nestjs", "gin-gonic", "spring"):
        return "Backend / API"
    if any_dep("next", "react", "vue", "svelte", "astro", "nuxt") or lang in ("typescript", "javascript"):
        return "Web app (deployed)" if home else "Web app"
    if any(h in joined for h in ("terraform/", "helm/", "k8s/", "kubernetes/")):
        return "Infrastructure / DevOps"
    if any_dep("click", "argparse", "typer", "cobra", "clap"):
        return "CLI tool"
    if lang in ("python",):
        return "Python project"
    if not paths:
        return "Unknown"
    if all(p.endswith((".md", ".txt", ".pdf")) for p in lowered[:20]):
        return "Notes / writing"
    return (repo.get("language") or "Other") + " project"


def gather_evidence(gh, owner, repo, deep):
    """README plus the recursive file tree. Two calls; deep adds a manifest read."""
    name = repo["name"]
    ev = {"readme": False, "readme_chars": 0, "paths": [], "signals": [], "flags": [],
          "x": None, "metrics": [], "deps": [], "manifest": None, "manifest_path": None, "highlights": [],
          "incomplete": False}

    blocked_before = gh.rate_limited or gh.exhausted
    readme = gh.get("/repos/%s/%s/readme" % (owner, urllib.parse.quote(name)))
    read_blocked = readme is None and (blocked_before or gh.rate_limited or gh.exhausted)
    text = ""
    if readme and readme.get("content"):
        try:
            text = base64.b64decode(readme["content"]).decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            text = ""
    if text:
        ev["readme"] = True
        ev["readme_chars"] = len(text)
        ev["x"] = readme_first_prose(text)
        ev["metrics"] = find_metrics(text)
        ev["signals"].append((2, "documented", "has a README (%d characters)" % len(text)))
        if len(text) >= 800:
            ev["signals"].append((2, "documented", "README is substantial"))
        if has_section(text, "install", "setup", "getting started", "usage", "quick start"):
            ev["signals"].append((2, "usable", "README documents install or usage"))
        if re.search(r"!\[[^\]]*\]\([^)]+\)", text):
            ev["signals"].append((1, "documented", "README includes an image or demo"))
    elif read_blocked:
        # Never convert a rate limit into a finding about the repository.
        ev["incomplete"] = True
        ev["flags"].append(
            "not examined: the API budget or rate limit was reached before this "
            "project could be read, so no verdict is offered")
    else:
        ev["flags"].append("no README: a reader cannot tell what it does")

    tree_blocked_before = gh.rate_limited or gh.exhausted
    tree = gh.get("/repos/%s/%s/git/trees/%s?recursive=1"
                  % (owner, urllib.parse.quote(name), repo.get("default_branch") or "main"))
    if tree is None and (tree_blocked_before or gh.rate_limited or gh.exhausted):
        ev["incomplete"] = True
    if tree and isinstance(tree.get("tree"), list):
        paths = [t.get("path", "") for t in tree["tree"] if t.get("type") == "blob"]
        ev["paths"] = paths[:400]
        ev["incomplete"] = bool(tree.get("truncated"))
        low = [p.lower() for p in paths]
        joined = " ".join(low)

        if any(any(h in p for h in TEST_HINTS) for p in low):
            ev["signals"].append((3, "tested", "contains test files"))
            ev["highlights"].append("has tests")
        if ".github/workflows" in joined:
            ev["signals"].append((2, "automated", "has a CI workflow"))
            ev["highlights"].append("CI configured")
        if any(h in joined for h in INFRA_HINTS):
            ev["signals"].append((1, "packaged", "has container or infrastructure files"))
            ev["highlights"].append("containerised")
        if any(h in joined for h in DOC_HINTS):
            ev["signals"].append((1, "documented", "has a docs directory"))
        manifest_path = None
        for candidate in MANIFESTS:
            for path in paths:
                if path.split("/")[-1].lower() == candidate.lower() and path.count("/") <= 2:
                    manifest_path = path
                    break
            if manifest_path:
                break
        if manifest_path:
            ev["signals"].append((1, "structured", "has %s" % manifest_path.split("/")[-1]))
            ev["manifest"] = manifest_path.split("/")[-1]
            ev["manifest_path"] = manifest_path
        ev["highlights"].append("%d files" % len(paths))

    if deep and ev.get("manifest_path"):
        blob = gh.get("/repos/%s/%s/contents/%s"
                      % (owner, urllib.parse.quote(name),
                         urllib.parse.quote(ev["manifest_path"])))
        if blob and blob.get("content"):
            try:
                content = base64.b64decode(blob["content"]).decode("utf-8", "ignore")
                ev["deps"] = rank_deps(deps_from_manifest(ev["manifest"], content))
            except Exception:  # noqa: BLE001
                pass

    return ev


# ---------------------------------------------------------------- verdict


def verdict_for(total, flags):
    """A printed threshold, not a judgement call."""
    hard = [f for f in flags if f.startswith(("one-day scaffold", "no README"))]
    if total >= 12 and not hard:
        return "STRONG"
    if total >= 7 and not hard:
        return "SOLID"
    if total >= 4:
        return "WEAK"
    return "OMIT"


def main():
    user = arg(1)
    demo = arg(5).lower() in ("true", "1", "yes")
    if not user and demo:
        user = "Andrew-Kevin-007"
    if not user:
        die("scan_and_score: github_user was not supplied. Pass github_user=<your-handle>\n"
            "Or run with demo=true to see it work on a sample account first.")
    if "github.com/" in user:
        user = user.rstrip("/").split("github.com/")[-1].split("/")[0]

    include_forks = arg(2).lower() in ("true", "1", "yes")
    deep_names = [n.strip().lower() for n in arg(3).split(",") if n.strip()]
    try:
        budget = max(4, min(50, int(arg(4) or "24")))
    except ValueError:
        budget = 24
    if demo:
        # Enough to show a real shortlist, while leaving most of an
        # unauthenticated hourly quota (60) for the viewer's own runs.
        budget = min(budget, 20)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    gh = Gh(token, budget)

    # Look before spending. A run that discovers halfway through that it never
    # had the quota has already burned what was left and half-built a report.
    quota, reset_epoch = gh.remaining()
    reset_in_min = None
    if quota >= 0:
        import time as _time
        reset_in_min = max(0, int((reset_epoch - _time.time()) / 60))
        if quota < 3:
            degrade(
                "GitHub quota is already spent (%d of 60 left, resets in about %d "
                "minutes). Nothing was requested, so nothing was wasted. Wait, or "
                "set GITHUB_TOKEN in your environment to raise the limit to 5000."
                % (quota, reset_in_min),
                user=user, quota_remaining=quota, quota_resets_in_minutes=reset_in_min)
        # Leave two calls of headroom so the run ends on a complete report
        # rather than a truncated one.
        if quota - 2 < budget:
            budget = max(3, quota - 2)
            gh.budget = budget

    raw = []
    for page in range(1, MAX_PAGES + 1):
        batch = gh.get("/users/%s/repos?per_page=%d&page=%d&sort=pushed&type=owner"
                       % (urllib.parse.quote(user), PER_PAGE, page))
        if batch is None:
            if gh.rate_limited:
                degrade("GitHub rate limit reached (60 requests/hour unauthenticated). "
                        "Wait an hour, or set GITHUB_TOKEN to raise it to 5000.", user=user)
            if not raw:
                die("scan_and_score: could not read repositories for '%s'.\n"
                    "Check the handle: it is the name in github.com/<handle>." % user)
            break
        if not isinstance(batch, list) or not batch:
            break
        raw.extend(batch)
        if len(batch) < PER_PAGE:
            break

    excluded = {"fork": 0, "archived": 0, "profile README": 0, "empty": 0}
    live = []
    for repo in raw:
        name = repo.get("name") or ""
        if not name:
            continue
        if repo.get("fork") and not include_forks:
            excluded["fork"] += 1
            continue
        if repo.get("archived"):
            excluded["archived"] += 1
            continue
        if name.lower() == user.lower():
            excluded["profile README"] += 1
            continue
        if not repo.get("size", 0):
            excluded["empty"] += 1
            continue
        live.append(repo)

    # Metadata scoring for everything, free.
    scored = []
    for repo in live:
        signals, flags = score_metadata(repo)
        scored.append({"repo": repo, "signals": signals, "flags": flags,
                       "meta_total": sum(s[0] for s in signals)})
    scored.sort(key=lambda r: (-r["meta_total"], r["repo"].get("pushed_at", "")), reverse=False)
    scored.sort(key=lambda r: -r["meta_total"])

    mode = "deep_dive" if deep_names else "shortlist"
    if deep_names:
        targets = [s for s in scored if s["repo"]["name"].lower() in deep_names]
        unmatched = [n for n in deep_names
                     if n not in [s["repo"]["name"].lower() for s in scored]]
    else:
        affordable = max(0, (gh.budget - gh.calls) // 2)
        targets = scored[:affordable]
        unmatched = []

    for entry in targets:
        entry["evidence"] = gather_evidence(gh, user, entry["repo"], deep=bool(deep_names))

    projects = []
    for entry in scored:
        repo = entry["repo"]
        ev = entry.get("evidence")
        signals = list(entry["signals"])
        flags = list(entry["flags"])
        if ev:
            signals += ev["signals"]
            flags += ev["flags"]
        total = sum(s[0] for s in signals)
        projects.append({
            "name": repo["name"],
            "pushed_at": (repo.get("pushed_at") or "")[:10],
            "language": repo.get("language"),
            "homepage": (repo.get("homepage") or "").strip()[:120],
            "url": repo.get("html_url"),
            "description": (repo.get("description") or "")[:160],
            "topics": (repo.get("topics") or [])[:6],
            "stars": repo.get("stargazers_count", 0),
            "examined": bool(ev) and not ev.get("incomplete"),
            "category": categorise(repo, ev["paths"], ev["deps"]) if ev else "not examined",
            "score": total,
            "signals": [{"points": p, "kind": k, "evidence": e} for p, k, e in signals],
            "flags": flags,
            "verdict": ("NOT EXAMINED" if (not ev or ev.get("incomplete"))
                        else verdict_for(total, flags)),
            "highlights": ev["highlights"] if ev else [],
        })

    deep = []
    if deep_names:
        for entry in targets:
            ev = entry.get("evidence") or {}
            repo = entry["repo"]
            metrics = list(ev.get("metrics") or [])
            # Repository counters are real measurements too, and they are cited.
            # A single star is usually the author. Only offer counts a reader
            # would accept as evidence that other people used the thing.
            stars = repo.get("stargazers_count", 0)
            forks = repo.get("forks_count", 0)
            if stars >= 3:
                metrics.append({"value": "%d stars" % stars,
                                "line": "GitHub repository metadata"})
            if forks >= 2:
                metrics.append({"value": "%d forks" % forks,
                                "line": "GitHub repository metadata"})
            deep.append({
                "name": repo["name"],
                "category": categorise(repo, ev.get("paths") or [], ev.get("deps") or []),
                "x": ev.get("x") or (repo.get("description") or "").strip() or None,
                "x_source": "README" if ev.get("x") else ("repository description"
                                                          if repo.get("description") else None),
                "y_candidates": metrics[:6],
                "z_stack": ([repo.get("language")] if repo.get("language") else [])
                           + (ev.get("deps") or [])[:10],
                "z_source": ev.get("manifest"),
                "highlights": ev.get("highlights") or [],
                "homepage": (repo.get("homepage") or "").strip()[:120],
                "url": repo.get("html_url"),
                "file_count": len(ev.get("paths") or []),
            })

    payload = {
        "ok": True,
        "available": True,
        "mode": mode,
        "user": user,
        "demo": demo,
        "authenticated": bool(token),
        "api_calls": gh.calls,
        "api_budget": gh.budget,
        "quota_remaining_before": quota,
        "quota_resets_in_minutes": reset_in_min,
        "budget_capped_by_quota": quota >= 0 and quota - 2 <= budget,
        "budget_exhausted": gh.exhausted,
        "rate_limited": gh.rate_limited,
        "total_repos": len(raw),
        "live_repos": len(live),
        "examined": len(targets),
        "unmatched_deep_names": unmatched,
        "exclusions": excluded,
        "projects": projects,
        "deep": deep,
        "warning": (
            "Rate limited part-way through; some projects were not examined."
            if gh.rate_limited else
            "Evidence budget reached; the lowest-ranked projects were not examined."
            if gh.exhausted else None
        ),
    }

    text = json.dumps(payload)
    if len(text) > STDOUT_SAFETY:
        # Never let a large account truncate the payload into unparseable JSON.
        for p in payload["projects"]:
            p["signals"] = p["signals"][:6]
            p["description"] = p["description"][:80]
        payload["projects"] = payload["projects"][:40]
        payload["output_trimmed"] = True
        text = json.dumps(payload)
    print(text)


if __name__ == "__main__":
    main()
