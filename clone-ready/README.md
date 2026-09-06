# clone-ready

**You just cloned a repo. What do you actually run?**

```
rote play run andrew-kevin-007/clone-ready root=~/code/some-repo
```

```
CLONE READY

  ▸ some-repo · Node

RUN THIS
  pnpm install
  pnpm dev
  cp .env.example .env   # then fill in: DATABASE_URL, API_KEY

WOULD HAVE BITTEN YOU
  • Two lockfiles are present (pnpm-lock.yaml, package-lock.json). pnpm was
    chosen: pnpm-lock.yaml has the newest modification time of the lockfiles
    present. Installing with a different manager can silently rewrite the
    other one and produce different resolved versions.
  • 1 env var read in the code but missing from .env.example: SESSION_SECRET.
    This is the kind of thing that only shows up once the app is running.
  • needs PostgreSQL running (declared in docker-compose.yml). Start it
    first, or the app will fail to connect.
```

**No setup for a first run:**

```
rote play run andrew-kevin-007/clone-ready demo=true
```

## Why this exists

Cloning a repo is instant. Working out what to run after is not: which package
manager, which env vars, which services need to be up first, whether the README
still matches `package.json`. That gap is the actual ten minutes, and it repeats
every single clone, on every project, forever — the highest-frequency task in
this whole toolkit.

## What it actually checks

- **Package manager**, when more than one lockfile is present. The choice is
  justified by something real (a `packageManager` field in `package.json`, or
  the lockfile with the newest modification time, checked and stated) rather
  than a guess dressed up as a reason. Two lockfiles present is flagged as a
  real conflict: installing with the wrong one can silently rewrite the other.
- **Env vars your code actually reads, that `.env.example` never declared.**
  Source is scanned for `process.env.X`, `os.environ`, `env::var`, `os.Getenv`
  and `ENV[]`, and anything used but undeclared is the exact class of bug that
  only surfaces once the app is already running and something crashes for no
  visible reason.
- **Python, Go, Rust and Ruby**, alongside Node. A project with a `venv/` but
  no `requirements.txt`, `pyproject.toml` or `Pipfile` anywhere is reported as
  exactly that — no manifest found — rather than guessing a `pip install`
  that doesn't exist.
- **A nested project root.** Cloning (or unzipping) sometimes lands you one
  folder above the actual project. If the folder you pointed this at holds
  only `.git` and one subfolder that is the real project, it says so and runs
  everything from there instead of silently failing at the wrong path.
- **A monorepo split.** When `docker-compose.yml` builds services from local
  Dockerfiles (a `backend/` and a `frontend/`, say), a root-only scan finds
  nothing to install. This follows each build context and reports each
  service's own install and run commands separately, in order.
- **pnpm/npm/yarn workspaces.** A workspace installs once at the root — that
  is the entire point of one lockfile and hoisted dependencies — so a
  root-only scan finds an install command and then nothing to run. Reads
  `pnpm-workspace.yaml` or a `package.json` `workspaces` field, resolves each
  member package, and lists each one's own run command in that manager's real
  syntax (`pnpm --filter <name> dev`, `yarn workspace <name> dev`,
  `npm run dev --workspace=<name>`).
- **Declared services**, Postgres/MySQL/Redis/MongoDB/RabbitMQ/Elasticsearch/
  Kafka, read from `docker-compose.yml`, so "why can't it connect" is answered
  before it happens.

## How it stays honest

Every claim in this play traces to one file it actually opened. The lockfile
choice states which signal decided it. A project with no manifest is reported
as having no manifest, not silently skipped or guessed at. A folder full of
unrelated files (someone pointing `root=` at the wrong path) is recognised
quickly rather than walked file by file until a timeout.

A displayed list is never confused with its own count. On a repository with
thousands of undeclared env vars, the report says "4000 env vars ... and 3988
more" rather than silently capping the sample and reporting *that* length as
if it were the total — the exact class of confidently-wrong answer this play
exists to catch in other people's projects.

## Privacy and effects

Pure filesystem reads. No network call, no package manager is ever invoked,
nothing is installed, nothing is written anywhere, no credentials are read.

## Parameters

| name | required | description |
|---|---|---|
| `demo` | no | `true` runs against a bundled fixture with no setup at all. |
| `root` | unless `demo` | Path to a cloned repository. On Windows, a `C:\...` path is translated to its `/mnt/c/...` WSL form automatically. |

## Requirements

`python3` only. No pip installs, no other dependency.

## License

MIT
