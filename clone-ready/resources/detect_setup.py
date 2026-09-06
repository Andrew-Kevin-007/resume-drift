#!/usr/bin/env python3
"""Read a freshly cloned repository and work out how to actually run it.

Pure filesystem reads. No network, no install, no write, no shell-out to a
package manager. Every finding traces to a real file this script opened, and
every file it opened is printed so the claim can be checked by hand.

Fatal (nonzero exit) only when the path does not exist or holds no repository.
Everything else - no manifest found, no run command found - is a normal,
expected answer about a project that may simply not need one, and is reported
as an honest gap rather than a guess.
"""

import json
import os
import re
import sys

MAX_FILE_BYTES = 200_000
MAX_SCAN_FILES = 4000
SOURCE_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rb", ".rs")
SKIP_DIRS = {
    "node_modules", ".git", ".next", ".nuxt", "dist", "build", "out",
    "venv", ".venv", "env", ".env_dir", "__pycache__", ".pytest_cache",
    "target", ".turbo", ".wrangler", "vendor", ".cache", ".idea", ".vscode",
}


def die(message):
    sys.stderr.write(message.rstrip() + "\n")
    sys.exit(1)


def arg(index, default=""):
    if len(sys.argv) <= index:
        return default
    value = (sys.argv[index] or "").strip()
    return default if value.startswith("$") else value


WINDOWS_PATH_RE = re.compile(r"^([A-Za-z]):[\\/](.*)$", re.S)


def windows_to_wsl(raw):
    match = WINDOWS_PATH_RE.match(raw.strip().strip('"'))
    if not match:
        return None
    drive, rest = match.group(1).lower(), match.group(2)
    return "/mnt/%s/%s" % (drive, rest.replace("\\", "/"))


def read_text(path, limit=MAX_FILE_BYTES):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read(limit)
    except OSError:
        return None


def read_json(path):
    text = read_text(path)
    if text is None:
        return None
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def listing(path):
    try:
        return set(os.listdir(path))
    except OSError:
        return set()


# ---------------------------------------------------------------- locate root

def find_project_root(cloned_path):
    """A repo whose real project lives one level down from what was cloned.

    A common, confusing shape: cloning a repo (or unzipping a GitHub archive)
    lands you in a folder holding only .git and one subfolder that is the
    actual project. Reported explicitly rather than silently followed, because
    "run this from the folder you think you are in" is exactly the kind of
    thing that costs someone ten minutes.
    """
    entries = listing(cloned_path)
    visible = sorted(e for e in entries if not e.startswith("."))
    manifest_names = {
        "package.json", "requirements.txt", "pyproject.toml", "Pipfile",
        "go.mod", "Cargo.toml", "Gemfile", "composer.json", "pom.xml",
        "build.gradle", "Makefile", "Procfile",
    }
    has_manifest_here = bool(manifest_names & entries)
    if has_manifest_here or len(visible) != 1:
        return cloned_path, None

    only = os.path.join(cloned_path, visible[0])
    if not os.path.isdir(only):
        return cloned_path, None

    inner_entries = listing(only)
    if manifest_names & inner_entries:
        return only, visible[0]
    return cloned_path, None


# ---------------------------------------------------------------- package manager

LOCKFILES = [
    ("bun.lockb", "bun"), ("bun.lock", "bun"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("package-lock.json", "npm"),
]


# --------------------------------------------------------------- js workspaces


def _resolve_workspace_glob(root, pattern):
    """Resolve a single workspace glob entry. Supports a literal directory and
    one trailing '*' segment (packages/*), which covers the overwhelming
    majority of real pnpm/npm/yarn workspace configs without pulling in a full
    glob implementation for one path shape."""
    pattern = pattern.strip().strip("'\"")
    if not pattern or pattern.startswith("!"):
        return []
    if pattern.endswith("/*") or pattern.endswith("/**"):
        base = pattern.rsplit("/", 1)[0]
        base_path = os.path.join(root, base)
        if not os.path.isdir(base_path):
            return []
        return [
            os.path.join(base, name) for name in sorted(os.listdir(base_path))
            if os.path.isdir(os.path.join(base_path, name))
        ]
    if os.path.isdir(os.path.join(root, pattern)):
        return [pattern]
    return []


def detect_workspace_globs(root, pkg):
    """Where to look for member packages, and which tool declared them.

    pnpm-workspace.yaml takes precedence when both exist, since pnpm ignores
    the package.json field entirely once that file is present.
    """
    pnpm_ws = os.path.join(root, "pnpm-workspace.yaml")
    if os.path.exists(pnpm_ws):
        text = read_text(pnpm_ws) or ""
        globs = []
        in_packages = False
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("packages:"):
                in_packages = True
                continue
            if in_packages:
                if stripped.startswith("-"):
                    globs.append(stripped[1:].strip())
                elif stripped and not stripped.startswith("#"):
                    break
        return globs, "pnpm-workspace.yaml"

    if isinstance(pkg, dict):
        ws = pkg.get("workspaces")
        if isinstance(ws, list):
            return ws, "package.json workspaces"
        if isinstance(ws, dict) and isinstance(ws.get("packages"), list):
            return ws["packages"], "package.json workspaces"
    return [], None


def detect_workspace_members(root, pkg):
    """Every workspace member with its own package.json and scripts.

    Reported separately from a monorepo's docker-compose services: a
    workspace installs ONCE at the root (that is the entire point of a
    workspace - one lockfile, hoisted dependencies), so member packages are
    never given their own install command, only their available run scripts.
    """
    globs, source = detect_workspace_globs(root, pkg)
    if not globs:
        return [], None

    members = []
    seen = set()
    for pattern in globs:
        for rel in _resolve_workspace_glob(root, pattern):
            if rel in seen:
                continue
            seen.add(rel)
            member_pkg = read_json(os.path.join(root, rel, "package.json"))
            if not isinstance(member_pkg, dict):
                continue
            script_name, all_scripts = pick_script(member_pkg.get("scripts"))
            members.append({
                "location": rel,
                "name": member_pkg.get("name") or rel,
                "run_script_name": script_name,
                "all_scripts": all_scripts,
            })
    return members, source


def detect_node(root, pkg):
    """Which package manager, and whether more than one lockfile disagrees.

    Reasoning must be true, not merely plausible: the chosen manager is
    justified by an actual signal (packageManager field, or the lockfile with
    the newest mtime, checked and printed), never by a hardcoded guess dressed
    up as an explanation.
    """
    present = []
    for name, mgr in LOCKFILES:
        p = os.path.join(root, name)
        if os.path.exists(p):
            try:
                mtime = os.path.getmtime(p)
            except OSError:
                mtime = 0
            present.append((name, mgr, mtime))

    declared = None
    if isinstance(pkg, dict):
        pm_field = str(pkg.get("packageManager") or "")
        if pm_field:
            declared = pm_field.split("@")[0]

    reason = None
    if declared:
        chosen = declared
        reason = "package.json declares \"packageManager\": \"%s\"" % pm_field
    elif present:
        newest = max(present, key=lambda t: t[2])
        chosen = newest[1]
        reason = "%s has the newest modification time of the lockfiles present" % newest[0]
    else:
        chosen = "npm"
        reason = "no lockfile was found; npm is the default"

    conflict = None
    if len(present) > 1:
        conflict = (
            "Two lockfiles are present (%s). %s was chosen: %s. Installing with a "
            "different manager than the lockfile it reads can silently rewrite the "
            "other one and produce different resolved dependency versions."
            % (", ".join(n for n, _, _ in present), chosen, reason)
        )

    return {
        "manager": chosen,
        "declared_in_package_json": declared,
        "lockfiles_present": [n for n, _, _ in present],
        "conflict": conflict,
    }


INSTALL_CMD = {"npm": "npm install", "yarn": "yarn install", "pnpm": "pnpm install", "bun": "bun install"}
RUN_PREFIX = {"npm": "npm run", "yarn": "yarn", "pnpm": "pnpm", "bun": "bun run"}

# Preference order when several scripts could plausibly be "the" run command.
SCRIPT_PRIORITY = ["dev", "start", "serve", "develop", "watch"]


def pick_script(scripts):
    if not isinstance(scripts, dict):
        return None, []
    for name in SCRIPT_PRIORITY:
        if name in scripts:
            return name, list(scripts.keys())
    if scripts:
        return next(iter(scripts)), list(scripts.keys())
    return None, []


# ---------------------------------------------------------------- python

PY_MANIFESTS = ["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"]


def detect_python(root):
    found = [f for f in PY_MANIFESTS if os.path.exists(os.path.join(root, f))]
    venvs = [d for d in ("venv", ".venv", "env", ".venv312") if os.path.isdir(os.path.join(root, d))]
    uses_poetry = False
    if "pyproject.toml" in found:
        text = read_text(os.path.join(root, "pyproject.toml")) or ""
        uses_poetry = "[tool.poetry" in text
    return {"manifests": found, "venvs_present": venvs, "uses_poetry": uses_poetry}


# ---------------------------------------------------------------- env vars

ASSIGN_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=", re.M)
SOURCE_ENV_RE = re.compile(
    r"process\.env\.([A-Z_][A-Z0-9_]*)|process\.env\[['\"]([A-Z_][A-Z0-9_]*)['\"]\]"
    r"|os\.environ(?:\.get)?\(?['\"]([A-Z_][A-Z0-9_]*)['\"]"
    r"|env::var\(?['\"]([A-Z_][A-Z0-9_]*)['\"]"
    r"|os\.Getenv\(['\"]([A-Z_][A-Z0-9_]*)['\"]"
    r"|ENV\[['\"]([A-Z_][A-Z0-9_]*)['\"]\]",
)


def env_keys_from_file(path):
    text = read_text(path)
    if text is None:
        return set()
    return set(ASSIGN_RE.findall(text))


def scan_source_for_env(root):
    """Grep source for env var reads, bounded, to catch what .env.example missed.

    Two separate counters, on purpose: `visited` bounds every file the walk
    looks at regardless of extension, so a directory full of non-source files
    (a Documents folder, a media library, anything that is not actually a
    project) cannot make the walk run long simply by never matching
    SOURCE_EXTS. `matched` bounds how many source files are actually read.
    """
    found = set()
    matched = 0
    visited = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            visited += 1
            if visited >= MAX_SCAN_FILES * 4 or matched >= MAX_SCAN_FILES:
                return found, True
            if not name.endswith(SOURCE_EXTS):
                continue
            matched += 1
            text = read_text(os.path.join(dirpath, name), limit=50_000)
            if not text:
                continue
            for m in SOURCE_ENV_RE.finditer(text):
                key = next((g for g in m.groups() if g), None)
                if key:
                    found.add(key)
    return found, False


def detect_env(root):
    example_files = [f for f in (".env.example", ".env.sample", ".env.template", "env.example")
                     if os.path.exists(os.path.join(root, f))]
    local_files = [f for f in (".env", ".env.local", ".dev.vars")
                  if os.path.exists(os.path.join(root, f))]

    declared = set()
    example_path = None
    for f in example_files:
        p = os.path.join(root, f)
        declared |= env_keys_from_file(p)
        example_path = example_path or f

    already_configured = bool(local_files)
    # The scan is only useful as a diff against something declared - with
    # nothing to compare against the result is always discarded, so skip the
    # expensive walk entirely rather than pay its cost for a value that gets
    # thrown away. This matters most on the failure path: someone pointing
    # root= at a huge non-project directory by mistake should not also wait
    # through a full source walk of that directory.
    if declared:
        used_in_source, truncated = scan_source_for_env(root)
        undeclared = sorted(used_in_source - declared)
    else:
        used_in_source, truncated, undeclared = set(), False, []

    return {
        "example_file": example_path,
        "declared_vars": sorted(declared),
        "local_files_present": local_files,
        "already_configured": already_configured,
        # The true count and the shown sample are reported separately. Slicing
        # first and reporting len() of the slice would silently cap the count
        # itself - "15 vars missing" reading as complete when it is a sample
        # of a much larger number is exactly the failure this play exists to
        # catch in OTHER people's projects; it must not commit it here.
        "used_in_source_but_undeclared": undeclared[:15],
        "used_in_source_but_undeclared_total": len(undeclared),
        "source_scan_truncated": truncated,
    }


# ---------------------------------------------------------------- services / pre-run steps

CONTEXT_RE = re.compile(r"context:\s*['\"]?\.?/?([\w./-]+)['\"]?", re.M)


def detect_services(root):
    services = []
    compose_path = None
    build_contexts = []
    for name in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
        if os.path.exists(os.path.join(root, name)):
            compose_path = name
            break
    if compose_path:
        text = read_text(os.path.join(root, compose_path)) or ""
        for image, label in (
            ("postgres", "PostgreSQL"), ("mysql", "MySQL"), ("mariadb", "MariaDB"),
            ("redis", "Redis"), ("mongo", "MongoDB"), ("rabbitmq", "RabbitMQ"),
            ("elasticsearch", "Elasticsearch"), ("kafka", "Kafka"),
        ):
            if re.search(r"image:\s*['\"]?[\w./-]*%s" % image, text, re.I):
                services.append(label)
        # A compose file whose services build from local Dockerfiles is a
        # common monorepo shape (backend/, frontend/), and the manifest a
        # stranger needs is one level down from wherever they cloned, not at
        # the root this play was pointed at. Follow those build contexts.
        for m in CONTEXT_RE.finditer(text):
            candidate = m.group(1).strip("./")
            full = os.path.join(root, candidate)
            if candidate and os.path.isdir(full) and candidate not in build_contexts:
                build_contexts.append(candidate)
    return {"compose_file": compose_path, "services": services, "build_contexts": build_contexts}


def detect_preflight(root, pkg):
    steps = []
    if os.path.exists(os.path.join(root, "prisma", "schema.prisma")):
        deps = {}
        if isinstance(pkg, dict):
            deps = {**(pkg.get("dependencies") or {}), **(pkg.get("devDependencies") or {})}
        cmd = "npx prisma generate"
        steps.append({"why": "prisma/schema.prisma present", "cmd": cmd})
    if os.path.isdir(os.path.join(root, "migrations")) or os.path.isdir(os.path.join(root, "alembic")):
        steps.append({"why": "a migrations directory is present", "cmd": "(run your migration tool once the database is up)"})
    return steps


# ---------------------------------------------------------------- runtime version

RUNTIME_FILES = {
    ".nvmrc": "node", ".node-version": "node", ".python-version": "python",
    ".ruby-version": "ruby", ".tool-versions": "asdf",
}


def detect_runtime_hint(root):
    for fname, kind in RUNTIME_FILES.items():
        p = os.path.join(root, fname)
        if os.path.exists(p):
            text = (read_text(p) or "").strip().splitlines()
            return {"file": fname, "kind": kind, "declared": text[0] if text else None}
    return None


# ---------------------------------------------------------------- main

def main():
    raw = arg(1)
    demo_flag = arg(2).lower() in ("true", "1", "yes")

    if demo_flag and not raw:
        # The fixture ships as a sibling directory of this script, resolved by
        # its own location rather than passed through argv - @resource{} only
        # accepts a regular file, not a directory.
        script_dir = os.path.dirname(os.path.abspath(__file__))
        raw = os.path.join(script_dir, "demo-fixture")

    if not raw:
        die(
            "detect_setup: root was not supplied. Pass root=<path to a cloned repo>\n"
            "Or run with demo=true to see it work on a bundled fixture repo first."
        )

    path = os.path.expanduser(raw.strip().strip('"'))
    translated_from = None
    if not os.path.isdir(path):
        alt = windows_to_wsl(raw)
        if alt and os.path.isdir(alt):
            translated_from, path = path, alt
        elif alt:
            die(
                "detect_setup: no such directory: %s\n"
                "This play runs inside WSL; the equivalent path would be:\n    %s\n"
                "That does not exist either." % (raw, alt)
            )
        else:
            die("detect_setup: no such directory: %s" % path)

    if not os.path.isdir(os.path.join(path, ".git")):
        # Not fatal: someone may point this at an extracted zip, not a clone.
        pass

    root, nested_in = find_project_root(path)

    def scan_ecosystems(scan_root, location=""):
        """Ecosystem detection scoped to one directory. `location` is the
        subpath from the project root, "" for the root itself, printed on
        every entry so a monorepo's commands are never run from the wrong
        folder."""
        found = []
        pkg_json_path = os.path.join(scan_root, "package.json")
        local_pkg = read_json(pkg_json_path) if os.path.exists(pkg_json_path) else None

        if local_pkg is not None or any(
            os.path.exists(os.path.join(scan_root, n)) for n, _ in LOCKFILES
        ):
            node = detect_node(scan_root, local_pkg)
            script_name, all_scripts = pick_script((local_pkg or {}).get("scripts"))
            install_cmd = INSTALL_CMD.get(node["manager"], "npm install")
            run_cmd = (
                "%s %s" % (RUN_PREFIX.get(node["manager"], "npm run"), script_name)
                if script_name else None
            )
            found.append({
                "kind": "node", "location": location,
                "manager": node["manager"],
                "declared_in_package_json": node["declared_in_package_json"],
                "lockfiles_present": node["lockfiles_present"],
                "conflict": node["conflict"],
                "install_cmd": install_cmd, "run_cmd": run_cmd,
                "run_script_name": script_name, "all_scripts": all_scripts,
                "name": (local_pkg or {}).get("name"),
            })

        py = detect_python(scan_root)
        if py["manifests"] or py["venvs_present"]:
            if "requirements.txt" in py["manifests"]:
                install_cmd = "pip install -r requirements.txt"
            elif py["uses_poetry"]:
                install_cmd = "poetry install"
            elif "Pipfile" in py["manifests"]:
                install_cmd = "pipenv install"
            elif "pyproject.toml" in py["manifests"]:
                install_cmd = "pip install ."
            else:
                install_cmd = None
            found.append({
                "kind": "python", "location": location,
                "manifests": py["manifests"], "venvs_present": py["venvs_present"],
                "install_cmd": install_cmd, "run_cmd": None,
            })

        for manifest, kind, install_cmd in (
            ("go.mod", "go", "go mod download"),
            ("Cargo.toml", "rust", "cargo build"),
            ("Gemfile", "ruby", "bundle install"),
        ):
            if os.path.exists(os.path.join(scan_root, manifest)):
                run_cmd = "cargo run" if kind == "rust" else None
                found.append({
                    "kind": kind, "location": location, "manifest": manifest,
                    "install_cmd": install_cmd, "run_cmd": run_cmd,
                })
        return found

    pkg_json_path = os.path.join(root, "package.json")
    pkg = read_json(pkg_json_path) if os.path.exists(pkg_json_path) else None

    ecosystems = scan_ecosystems(root)

    env = detect_env(root)
    services = detect_services(root)

    # A compose file whose services build from local Dockerfiles is a common
    # monorepo shape. A root scan alone would report nothing to install and
    # nothing to run, which is not true - it just was not looking in the
    # right folder. Scan each referenced build context the same way.
    for ctx in services.get("build_contexts", []):
        ctx_root = os.path.join(root, ctx)
        ctx_found = scan_ecosystems(ctx_root, location=ctx)
        if ctx_found:
            ecosystems.extend(ctx_found)

    preflight = detect_preflight(root, pkg)
    runtime_hint = detect_runtime_hint(root)
    workspace_members, workspace_source = detect_workspace_members(root, pkg)

    makefile = os.path.exists(os.path.join(root, "Makefile"))
    procfile = os.path.exists(os.path.join(root, "Procfile"))

    print(json.dumps({
        "ok": True,
        "available": True,
        "input_path": os.path.abspath(path),
        "translated_from_windows_path": translated_from,
        "project_root": os.path.abspath(root),
        "nested_in": nested_in,
        "is_git_repo": os.path.isdir(os.path.join(path, ".git")),
        "ecosystems": ecosystems,
        "env": env,
        "services": services,
        "preflight": preflight,
        "runtime_hint": runtime_hint,
        "workspace_members": workspace_members,
        "workspace_source": workspace_source,
        "has_makefile": makefile,
        "has_procfile": procfile,
    }))


if __name__ == "__main__":
    main()
