/**
 * Clone Ready
 *
 * @rote-frontmatter
 * ---
 * name: clone-ready
 * description: 'You just cloned a repo. What do you actually run? Reads the repository on disk and hands back the exact commands, in order, so the first run after a clone is one paste instead of twenty minutes of trial and error. Picks the right package manager when more than one lockfile is present, by an actual check (packageManager field, or newest lockfile mtime, both stated) rather than a guess, and names the conflict when npm and pnpm or yarn lockfiles disagree. Diffs declared env vars in .env.example against the ones your own source code actually reads, so a var used in code but missing from the example - the one that crashes you at runtime with no clue why - is caught before you hit it. Detects Python, Go, Rust and Ruby manifests alongside Node, reports when a project has a venv but no requirements.txt at all rather than guessing a command, and reports when the project you cloned into is not the project itself - a common shape when the real code sits one folder down. Follows docker-compose.yml build contexts into a monorepo backend/frontend split and finds each services manifest where a root-only scan would report nothing to install. Recognises pnpm/npm/yarn workspaces (pnpm-workspace.yaml or a package.json workspaces field) and lists each member''s own run command in that manager''s real syntax, because a workspace installs once at the root and a root-only scan would otherwise show an install with no way to run anything. Notes when Postgres, MySQL, Redis, MongoDB or similar are declared as compose services. Pure filesystem reads: no network call, no package manager invoked, no file written, no credentials. Run with demo=true against a bundled fixture to see it work with no setup at all. Needs only python3.'
 * source: https://github.com/Andrew-Kevin-007/resume-drift
 * tags:
 * - audience-developers
 * - effect-read-only
 * - domain-dev-workflow
 * - onboarding
 * discoverability:
 *   tags:
 *   - audience-developers
 *   - effect-read-only
 *   - domain-dev-workflow
 *   - onboarding
 * metadata:
 *   rote_version: 0.78.0
 *   version: 0.1.3
 *   status: released
 *   kind: atomic
 *   flow_type: parallel
 *   execution_model: steps_with_presentation
 *   format: typescript
 *   requires_endpoints: []
 *   requires_sessions: false
 *   contract:
 *     atomic: true
 *     input:
 *       type: none
 *     output:
 *       format: json
 *       destination: stdout
 *     composable: true
 *   discoverability:
 *     tags:
 *     - audience-developers
 *     - effect-read-only
 *     - domain-dev-workflow
 * parameters:
 * - name: root
 *   param_type: string
 *   required: false
 *   description: Path to a freshly cloned repository. On Windows a C:\ path is translated to its WSL /mnt form automatically when it resolves.
 * - name: demo
 *   param_type: string
 *   required: false
 *   description: 'Set to true to run against a bundled fixture repo with no setup at all: a lockfile conflict, an undeclared env var and a database service, all in one small example.'
 * steps:
 *   detect_setup:
 *     type: process.exec
 *     timeout_ms: 30000
 *     argv:
 *     - python3
 *     - '@resource{detect_setup.py}'
 *     - $root
 *     - $demo
 * ---
 *
 * Usage:
 *   rote play run clone-ready root=/home/you/code/some-repo
 *   rote play run clone-ready demo=true
 *
 * Design notes:
 *  - Deliberately the shortest report of the three plays in this repository.
 *    The job here is "what do I paste", not an audit; a long report would be
 *    the wrong shape for the actual task.
 *  - Every claim traces to one file this script actually opened. The lockfile
 *    choice is justified by a real mtime check or a real packageManager field,
 *    never a hardcoded guess dressed up as a reason.
 *  - A project with no dependency manifest is reported as exactly that, not
 *    papered over with a guessed install command.
 */

const presentationSdk = await import("__ROTE_PRESENTATION_SDK__").catch((cause) => {
  throw new Error(
    "This is a rote steps presentation program. Run it with `rote play run <name>`.",
    { cause },
  );
});
const { FlowOutput, loadPresentationContext, stepName } = presentationSdk;

const out = new FlowOutput();
const ctx = await loadPresentationContext();

const STEP_HANDLES = { detect_setup: ctx.step(stepName("detect_setup")) };

function bodyOf(step: ReturnType<typeof ctx.step>): Record<string, unknown> | null {
  const outcome = step.outcome;
  if (outcome.status !== "completed" && outcome.status !== "restored") return null;
  const text = (outcome.output.body as { stdout?: { text?: string } })?.stdout?.text;
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const data = bodyOf(STEP_HANDLES.detect_setup);

const params = (ctx.params ?? {}) as Record<string, unknown>;
const asParam = (key: string): string => {
  const raw = params[key];
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return value.startsWith("$") ? "" : value;
};
const demoMode = ["true", "1", "yes"].includes(asParam("demo").toLowerCase());

const lines: string[] = [];
const RULE = "─".repeat(70);

// ---------------------------------------------------------------- failure path

if (data === null) {
  const missing: string[] = [];
  if (!demoMode && !asParam("root")) missing.push("root — the path to a cloned repo, e.g. root=~/code/some-repo");
  out.human([
    "CLONE READY",
    "",
    "  ▸ Cannot report — the repository could not be read",
    "",
    ...(missing.length ? ["MISSING INPUT", ...missing.map((m) => `  ${m}`), "",
      "  or pass demo=true to see it run with no setup at all", ""] : []),
    "The failing step printed the reason above.",
    "On Windows, use the WSL path form: /mnt/c/Users/<you>/code/some-repo",
  ].join("\n"));
  out.summary("Clone ready: cannot report — the repository could not be read");
  out.result({ run_id: ctx.run.run_id, verdict: "cannot_report", missing_required_parameters: missing });
} else {

// ---------------------------------------------------------------- assemble

type Eco = Record<string, unknown>;
const ecosystems = (data["ecosystems"] as Eco[] | undefined) ?? [];
const env = (data["env"] as Record<string, unknown> | undefined) ?? {};
const services = (data["services"] as Record<string, unknown> | undefined) ?? {};
const preflight = (data["preflight"] as Array<Record<string, unknown>> | undefined) ?? [];
const nestedIn = data["nested_in"] as string | null;
const translatedFrom = data["translated_from_windows_path"] as string | null;
const declaredServices = (services["services"] as string[] | undefined) ?? [];
const composeFile = services["compose_file"] as string | null;
const projectRoot = String(data["project_root"] ?? "");
const projectName = projectRoot.split(/[\\/]/).filter(Boolean).pop() || "this project";

const byLocation = new Map<string, Eco[]>();
for (const e of ecosystems) {
  const loc = String(e["location"] ?? "");
  if (!byLocation.has(loc)) byLocation.set(loc, []);
  byLocation.get(loc)!.push(e);
}
// Root first, then subdirectories in the order they were discovered.
const locations = [...byLocation.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));

const runnable = ecosystems.filter((e) => e["install_cmd"] || e["run_cmd"]);
const noManifest = ecosystems.filter((e) => !e["install_cmd"] && !e["run_cmd"]);

// ---------------------------------------------------------------- headline

const kindLabel: Record<string, string> = {
  node: "Node", python: "Python", go: "Go", rust: "Rust", ruby: "Ruby",
};
// A "service" is a location with something to actually run. A stray venv at
// the repo root with no manifest is a finding worth surfacing below, not a
// third service in a two-service monorepo.
const runnableLocations = [...new Set(runnable.map((e) => String(e["location"] ?? "")))];
const summary = runnableLocations.length > 1
  ? `${runnableLocations.length} services (${runnableLocations.filter((l) => l).join(", ")})`
  : ecosystems.length
    ? ecosystems.map((e) => kindLabel[String(e["kind"])] ?? String(e["kind"])).join(" + ")
    : "no dependency manifest found";

lines.push("CLONE READY");
lines.push("");
if (demoMode) {
  lines.push("  DEMO RUN. A bundled fixture repo ships with this play, so this shows the");
  lines.push("  shape of the answer without any setup. For your own answer:");
  lines.push("  root=<path to a cloned repo>");
  lines.push("");
}
lines.push(`  ▸ ${projectName} · ${summary}`);
if (nestedIn) {
  lines.push(`    your project lives one folder down, in ${nestedIn}/ — run everything`);
  lines.push(`    below from inside that folder, not the one you cloned into`);
}
if (translatedFrom) {
  lines.push(`    (Windows path translated to WSL automatically)`);
}
lines.push("");

// ---------------------------------------------------------------- run this

lines.push("RUN THIS");
if (runnable.length === 0) {
  lines.push("  No install or run command could be determined.");
  if (noManifest.length) {
    for (const e of noManifest) {
      const kind = String(e["kind"]);
      if (kind === "python") {
        const venvs = (e["venvs_present"] as string[] | undefined) ?? [];
        lines.push(`  This looks like a Python project (${venvs.join(", ") || "no venv either"}),`);
        lines.push("  but no requirements.txt, pyproject.toml or Pipfile was found.");
        lines.push("  Check the README, or ask the author what to install.");
      }
    }
  } else {
    lines.push("  No package manager, lockfile or manifest was recognised in this repository.");
  }
} else {
  // A location whose only finding is "nothing runnable here" is noise in the
  // copy-paste block once at least one other location IS runnable - it is
  // covered instead in WOULD HAVE BITTEN YOU, where the stale-venv finding
  // already lives.
  const anyRunnableElsewhere = runnableLocations.length > 0;
  for (const loc of locations) {
    const group = byLocation.get(loc) ?? [];
    const groupRunnable = group.some((e) => e["install_cmd"] || e["run_cmd"]);
    if (!groupRunnable && anyRunnableElsewhere && locations.length > 1) continue;

    if (locations.length > 1) {
      lines.push("");
      lines.push(`  # ${loc || "(repo root)"}`);
      if (loc) lines.push(`  cd ${loc}`);
    }
    for (const e of group) {
      const install = e["install_cmd"] as string | null;
      const run = e["run_cmd"] as string | null;
      if (install) lines.push(`  ${install}`);
      if (run) lines.push(`  ${run}`);
      if (!install && !run) {
        const kind = String(e["kind"]);
        if (kind === "python") {
          lines.push("  (no requirements.txt/pyproject.toml/Pipfile found here either)");
        }
      }
    }
  }
  if (env["example_file"] && !env["already_configured"]) {
    const vars = (env["declared_vars"] as string[] | undefined) ?? [];
    lines.push(
      `  cp ${String(env["example_file"])} .env` +
      (vars.length ? `   # then fill in: ${vars.slice(0, 6).join(", ")}${vars.length > 6 ? ", …" : ""}` : ""),
    );
  }
  for (const step of preflight) {
    lines.push(`  ${String(step["cmd"])}`);
  }

  // A workspace installs once at the root — that is the entire point of one
  // lockfile and hoisted dependencies — so members never get their own
  // install line. What they need is the one thing a root-only scan cannot
  // show: which command runs which package, and in this manager's syntax.
  const members = (data["workspace_members"] as Array<Record<string, unknown>> | undefined) ?? [];
  const withScript = members.filter((m) => m["run_script_name"]);
  if (withScript.length) {
    const rootNode = ecosystems.find((e) => e["kind"] === "node" && e["location"] === "");
    const mgr = String(rootNode?.["manager"] ?? "npm");
    const filterCmd = (name: string, script: string): string => {
      if (mgr === "pnpm") return `pnpm --filter ${name} ${script}`;
      if (mgr === "yarn") return `yarn workspace ${name} ${script}`;
      if (mgr === "bun") return `bun --filter ${name} ${script}`;
      return `npm run ${script} --workspace=${name}`;
    };
    lines.push("");
    lines.push(`  # this is a workspace (${String(data["workspace_source"] ?? "")}) — one install,`);
    lines.push("  # then run whichever package you actually need:");
    for (const m of withScript) {
      lines.push(`  ${filterCmd(String(m["name"]), String(m["run_script_name"]))}`);
    }
  }
}
lines.push("");

// ---------------------------------------------------------------- would have bitten you

const bites: string[] = [];
for (const e of ecosystems) {
  if (e["conflict"]) bites.push(String(e["conflict"]));
}
const undeclared = (env["used_in_source_but_undeclared"] as string[] | undefined) ?? [];
// The true count, not the length of whatever sample was kept for display -
// slicing first and reporting the slice's length would silently understate
// how many are actually missing.
const undeclaredTotal = Number(env["used_in_source_but_undeclared_total"] ?? undeclared.length);
if (undeclaredTotal) {
  const shown = undeclared.slice(0, 12);
  const more = undeclaredTotal - shown.length;
  bites.push(
    `${undeclaredTotal} env var${undeclaredTotal === 1 ? "" : "s"} read in the code but missing ` +
    `from ${String(env["example_file"] ?? "the example file")}: ${shown.join(", ")}` +
    `${more > 0 ? `, and ${more} more` : ""}. ` +
    `This is the kind of thing that only shows up once the app is already running.`,
  );
}
if (declaredServices.length) {
  bites.push(
    `needs ${declaredServices.join(", ")} running (declared in ${composeFile}). ` +
    `Start it first, e.g. \`docker compose up -d\`, or the app will fail to connect.`,
  );
} else if (composeFile && (services["build_contexts"] as string[] | undefined)?.length) {
  bites.push(
    `${composeFile} defines multiple services built from local Dockerfiles. ` +
    `You can run each manually as shown above, or \`docker compose up\` to run them together.`,
  );
}
if (env["already_configured"]) {
  const files = (env["local_files_present"] as string[] | undefined) ?? [];
  bites.push(
    `${files.join(", ")} already present. This clone may already be configured — ` +
    `check it holds real values, not placeholders, before assuming it works.`,
  );
}
if (noManifest.length && runnable.length) {
  for (const e of noManifest) {
    const venvs = (e["venvs_present"] as string[] | undefined) ?? [];
    if (venvs.length) {
      bites.push(
        `${venvs.join(", ")} present at the repo root with no dependency file there. ` +
        `Likely stale or leftover from an old layout — the real one is elsewhere in this repo.`,
      );
    }
  }
}

if (bites.length) {
  lines.push("WOULD HAVE BITTEN YOU");
  for (const b of bites) lines.push(`  • ${b}`);
  lines.push("");
}

// ---------------------------------------------------------------- details (folded)

lines.push(RULE);
lines.push("DETAILS");
lines.push(`  scanned    ${projectRoot}`);
if (ecosystems.length) {
  lines.push(
    `  found      ${ecosystems.map((e) => `${kindLabel[String(e["kind"])] ?? e["kind"]}${e["location"] ? ` (${e["location"]})` : ""}`).join(", ")}`,
  );
}
lines.push("  method     filesystem reads only — no network call, no install run, nothing written");
if (env["source_scan_truncated"] === true) {
  lines.push("  note       this repository has more source files than one scan checks;");
  lines.push("             the env var list above may be incomplete, not exhaustive");
}

const verdict = ecosystems.length
  ? `${summary} — run the commands above`
  : "no dependency manifest recognised";

out.human(lines.join("\n"));
out.summary(`Clone ready: ${verdict}`);
out.result({
  run_id: ctx.run.run_id,
  verdict,
  project_root: projectRoot,
  nested_in: nestedIn,
  ecosystems,
  env,
  services,
  preflight,
  would_have_bitten_you: bites,
});
}
