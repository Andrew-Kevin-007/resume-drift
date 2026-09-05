/**
 * Resume Drift
 *
 * @rote-frontmatter
 * ---
 * name: resume-drift
 * description: "What have you shipped that your resume does not know about? Compares a GitHub account against the date of your most recent resume file and reports the gap: which repositories were pushed after the resume was last written, which of those the resume never names, and which have a live deployment URL that appears nowhere in it. The baseline is the resume file's own modification time, reported as a PROXY and overridable with since=YYYY-MM-DD, because cloud sync or a re-download can reset it. Mention detection reads the resume locally and emits one boolean per repository: no snippet, no contact detail and no document text ever leaves that step. A repository whose name is also an ordinary English word (studio, portfolio, core) is reported as WEAK evidence rather than asserted, and when no text extractor applies every repository returns UNKNOWN instead of not-mentioned, because could-not-look and did-not-find are different answers. Pass role= to rank the gap by fit against a named track (backend, frontend, fullstack, ml, devops, mobile, data) using printed keyword evidence, never a generated score. Every excluded repository is reported with its reason and an exact count: forks, archived repositories, the profile README and empty repositories are named, never silently dropped. Offline except for one public GitHub call, read-only, writes nothing, needs no credentials; GITHUB_TOKEN is honoured only to raise the rate limit. Needs python3; pdftotext enables PDF mention detection."
 * source: "https://github.com/Andrew-Kevin-007/resume-drift"
 * tags:
 * - audience-developers
 * - effect-read-only
 * - domain-career
 * - job-resume-maintenance
 * - github
 * - resume
 * discoverability:
 *   tags:
 *   - audience-developers
 *   - effect-read-only
 *   - domain-career
 *   - job-resume-maintenance
 *   - github
 *   - resume
 * metadata:
 *   rote_version: 0.78.0
 *   version: 0.1.0
 *   status: draft
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
 *     - domain-career
 *     - job-resume-maintenance
 * parameters:
 * - name: github_user
 *   param_type: string
 *   required: true
 *   description: "GitHub handle to scan, e.g. octocat (a full profile URL is also accepted)"
 * - name: resume_path
 *   param_type: string
 *   required: true
 *   description: "Absolute path to a resume file, or to a folder of resumes (the newest wins)"
 * - name: role
 *   param_type: string
 *   required: false
 *   description: "Rank the gap for a track: backend, frontend, fullstack, ml, devops, mobile, data"
 * - name: since
 *   param_type: string
 *   required: false
 *   description: "Override the baseline date as YYYY-MM-DD instead of using the resume file's timestamp"
 * - name: include_forks
 *   param_type: string
 *   required: false
 *   description: "Set to true to include forked repositories (default false)"
 * steps:
 *   resolve_resume:
 *     type: process.exec
 *     timeout_ms: 20000
 *     argv: [python3, "@resource{resolve_resume.py}", $resume_path]
 *   fetch_repos:
 *     type: process.exec
 *     timeout_ms: 60000
 *     depends_on: [resolve_resume]
 *     argv:
 *     - python3
 *     - "@resource{fetch_repos.py}"
 *     - $github_user
 *     - "@resolve_resume{.stdout.text}"
 *     - $since
 *     - $include_forks
 *   match_mentions:
 *     type: process.exec
 *     timeout_ms: 45000
 *     depends_on: [resolve_resume, fetch_repos]
 *     argv:
 *     - python3
 *     - "@resource{match_mentions.py}"
 *     - "@resolve_resume{.stdout.text}"
 *     - "@fetch_repos{.stdout.text}"
 * ---
 *
 * Usage:
 *   rote play run resume-drift github_user=octocat resume_path=/home/you/Documents/resume.pdf
 *   rote play run resume-drift github_user=octocat resume_path=~/Documents/Resumes role=backend
 *
 * Design notes:
 *  - Steps gather, the presentation decides. No step needs another step's
 *    classification, so layer 1 (resume + GitHub) runs in parallel.
 *  - match_mentions depends on both so the resume's TEXT never has to travel:
 *    it resolves names to booleans inside the step that read the document.
 *  - Exclusions are counted and named. A repository dropped without a printed
 *    reason is indistinguishable from one that was never seen.
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

// ---------- step access (defensive: a degraded step must not crash the report) ----------

// Literal stepName("...") handles so lint can verify them against `steps:`.
const STEP_HANDLES = {
  resolve_resume: ctx.step(stepName("resolve_resume")),
  fetch_repos: ctx.step(stepName("fetch_repos")),
  match_mentions: ctx.step(stepName("match_mentions")),
};

function bodyOf(step: ReturnType<typeof ctx.step>): Record<string, unknown> | null {
  const outcome = step.outcome;
  if (outcome.status !== "completed" && outcome.status !== "restored") return null;
  const text = (outcome.output.body as { stdout?: { text?: string } })?.stdout?.text;
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

const resume = bodyOf(STEP_HANDLES.resolve_resume);
const reposData = bodyOf(STEP_HANDLES.fetch_repos);
const mentions = bodyOf(STEP_HANDLES.match_mentions);

// ---------- parameters ----------

const params = (ctx.params ?? {}) as Record<string, unknown>;
const asParam = (key: string): string => {
  const raw = params[key];
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  // An unresolved $token passes through as a literal; treat it as absent.
  return value.startsWith("$") ? "" : value;
};

const roleParam = asParam("role").toLowerCase();
const sinceParam = asParam("since");
const includeForks = ["true", "1", "yes"].includes(asParam("include_forks").toLowerCase());

// ---------- role profiles (deterministic keyword evidence, never a generated score) ----------

const ROLE_PROFILES: Record<string, string[]> = {
  backend: ["python", "go", "golang", "java", "rust", "node", "express", "fastapi", "django",
    "flask", "spring", "postgres", "mysql", "mongodb", "redis", "api", "rest", "grpc",
    "microservice", "backend", "server", "sql", "queue", "kafka"],
  frontend: ["react", "next", "nextjs", "vue", "svelte", "angular", "typescript", "javascript",
    "tailwind", "css", "html", "ui", "vite", "frontend", "webpack", "responsive", "design"],
  fullstack: ["react", "next", "nextjs", "node", "express", "typescript", "python", "django",
    "postgres", "mongodb", "api", "fullstack", "full-stack", "supabase", "firebase", "prisma"],
  ml: ["python", "pytorch", "tensorflow", "keras", "sklearn", "scikit", "pandas", "numpy",
    "jupyter", "llm", "nlp", "transformers", "huggingface", "ml", "machine-learning",
    "deep-learning", "cv", "opencv", "rag", "embedding"],
  devops: ["docker", "kubernetes", "k8s", "terraform", "ansible", "aws", "gcp", "azure",
    "ci", "cd", "github-actions", "jenkins", "helm", "prometheus", "grafana", "devops",
    "infrastructure", "cloud", "nginx"],
  mobile: ["flutter", "dart", "react-native", "swift", "swiftui", "kotlin", "android",
    "ios", "mobile", "expo", "jetpack"],
  data: ["sql", "spark", "airflow", "dbt", "etl", "pandas", "numpy", "bigquery", "snowflake",
    "warehouse", "pipeline", "analytics", "tableau", "powerbi", "data"],
};

const roleKnown = roleParam !== "" && Object.hasOwn(ROLE_PROFILES, roleParam);
const roleKeywords = roleKnown ? ROLE_PROFILES[roleParam] : [];

// ---------- baseline ----------

const chosen = (resume?.["chosen"] as Record<string, unknown> | undefined) ?? {};
const resumeDate = String(chosen["mtime_iso"] ?? "");
const todayIso = String(resume?.["today_iso"] ?? "");
const sinceValid = /^\d{4}-\d{2}-\d{2}$/.test(sinceParam);
// fetch_repos resolved the baseline it actually filtered on; trust that over
// re-deriving it here, so the report can never describe a different cut-off
// than the one the data was selected with.
const baseline = String(reposData?.["baseline"] ?? (sinceValid ? sinceParam : resumeDate));
const baselineSource = String(
  reposData?.["baseline_source"] ?? (sinceValid ? "since= override" : "resume file timestamp (proxy)"),
);

function daysBetween(fromIso: string, toIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) return null;
  const ms = Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z");
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
}
const baselineAge = daysBetween(baseline, todayIso);

// ---------- classify ----------

type Repo = Record<string, unknown>;
// A null body means the step failed or its output was unparseable. That is NOT
// "available with zero results" — conflating the two turns a broken read into a
// confident "no repositories found".
const reposAvailable = reposData !== null && reposData["available"] !== false;
const candidates = (reposData?.["candidates"] as Repo[] | undefined) ?? [];
const totalRead = Number(reposData?.["total_read"] ?? 0);
const matchMap = (mentions?.["matches"] as Record<string, Record<string, unknown>> | undefined) ?? {};
const mentionsAvailable = mentions?.["available"] === true;
const githubUser = String(reposData?.["user"] ?? asParam("github_user"));

// Exclusions are counted in the step that saw every repository.
const exclusions = (reposData?.["exclusions"] as Record<string, number> | undefined) ?? {};

type Scored = {
  repo: Repo;
  name: string;
  score: number;
  matched: string[];
  mentioned: boolean | null;
  evidence: string | null;
  confidence: string | null;
};

const shipped: Scored[] = [];

for (const repo of candidates) {
  const name = String(repo["name"] ?? "");
  if (!name) continue;

  const haystack = [
    name,
    String(repo["description"] ?? ""),
    String(repo["language"] ?? ""),
    ((repo["topics"] as string[] | undefined) ?? []).join(" "),
  ].join(" ").toLowerCase();

  const matched = roleKeywords.filter((kw) => haystack.includes(kw));
  const m = matchMap[name] ?? {};

  shipped.push({
    repo,
    name,
    score: matched.length,
    matched,
    mentioned: (m["mentioned"] ?? null) as boolean | null,
    evidence: (m["evidence"] ?? null) as string | null,
    confidence: (m["confidence"] ?? null) as string | null,
  });
}

// Rank: role fit first when a role was given, then recency, then stars.
shipped.sort((a, b) => {
  if (roleKnown && b.score !== a.score) return b.score - a.score;
  const pa = String(a.repo["pushed_at"] ?? ""), pb = String(b.repo["pushed_at"] ?? "");
  if (pa !== pb) return pb.localeCompare(pa);
  return Number(b.repo["stars"] ?? 0) - Number(a.repo["stars"] ?? 0);
});

const missing = shipped.filter((s) => s.mentioned === false);
const weak = shipped.filter((s) => s.mentioned === true && s.confidence === "weak");
const unknown = shipped.filter((s) => s.mentioned === null);
const liveUnlisted = missing.filter((s) => String(s.repo["homepage"] ?? "").trim() !== "");

// ---------- verdict ----------

let verdict: string;
if (!reposAvailable) {
  verdict = "INCOMPLETE — GitHub could not be read";
} else if (shipped.length === 0) {
  verdict = "IN SYNC — nothing pushed since the resume baseline";
} else if (!mentionsAvailable) {
  verdict = `${shipped.length} repo(s) pushed since the baseline — mention state UNKNOWN`;
} else if (missing.length === 0) {
  verdict = `IN SYNC — all ${shipped.length} repo(s) pushed since the baseline are already named`;
} else {
  verdict = `${missing.length} project(s) missing from your resume`;
}

// ---------- render ----------

const lines: string[] = [];
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);

// A step that died leaves a null body. Rendering the normal report over that
// produces confident nonsense — "install pdftotext" when the real problem was a
// mistyped handle. Say what actually broke instead.
const brokenSteps: string[] = [];
if (resume === null) brokenSteps.push(`resolve_resume (${STEP_HANDLES.resolve_resume.outcome.status})`);
if (reposData === null) brokenSteps.push(`fetch_repos (${STEP_HANDLES.fetch_repos.outcome.status})`);

const abortedReport = brokenSteps.length
  ? [
    "RESUME DRIFT",
    "",
    "VERDICT  CANNOT REPORT — a required step did not complete",
    "",
    "FAILED",
    ...brokenSteps.map((s) => `  ${s}`),
    "",
    "This play needs both a resume baseline and a repository list to say anything",
    "truthful about drift. It reports nothing rather than guessing.",
    "",
    "The failing step printed the reason to stderr — see the step output above.",
    "Most common causes: a mistyped github_user, or a resume_path that does not exist.",
  ].join("\n")
  : "";

lines.push("RESUME DRIFT");
lines.push("");
lines.push(`VERDICT  ${verdict}`);
lines.push("");

lines.push("BASELINE");
if (resumeDate) {
  lines.push(`  resume     ${String(chosen["name"] ?? "?")}`);
  lines.push(`  dated      ${resumeDate}${baselineAge !== null ? `  (${baselineAge} days ago)` : ""}`);
}
lines.push(`  comparing  everything pushed after ${baseline || "?"}`);
lines.push(`  source     ${baselineSource}`);
if (baselineSource.startsWith("since=")) {
  // rote remembers a play's parameters between runs, so an override set once
  // silently governs every later run. Say how to undo it rather than letting a
  // stale cut-off quietly decide the answer.
  lines.push("             ↳ an override is in effect and rote remembers parameters");
  lines.push("               between runs. Pass an empty since= to return to the");
  lines.push("               resume file's own date.");
}
if (!sinceValid && !baselineSource.startsWith("since=")) {
  lines.push("             ↳ a file timestamp is a PROXY for when you last wrote the resume;");
  lines.push("               cloud sync or a re-download resets it. Override with since=YYYY-MM-DD.");
}
if (sinceParam && !sinceValid) {
  lines.push(`  ⚠ since="${sinceParam}" is not YYYY-MM-DD and was ignored.`);
}
const otherCandidates = (resume?.["candidates"] as Array<Record<string, unknown>> | undefined) ?? [];
if (otherCandidates.length > 1) {
  lines.push(`  considered ${otherCandidates.length} resume files; used the newest non-cover-letter`);
}
lines.push("");

lines.push("GITHUB");
lines.push(`  account    ${githubUser}`);
if (!reposAvailable) {
  lines.push(`  ⚠ ${String(reposData?.["warning"] ?? "repositories unavailable")}`);
} else {
  lines.push(`  read       ${totalRead} repositories`);
  lines.push(`  shipped    ${shipped.length} pushed after the baseline`);
  if (reposData?.["truncated"] === true) {
    lines.push(`  ⚠ ${String(reposData?.["warning"] ?? "result truncated")}`);
  }
}
lines.push("");

if (shipped.length) {
  lines.push(roleKnown
    ? `THE GAP  (ranked for ${roleParam}: keyword overlap, then recency)`
    : "THE GAP  (ranked by recency — pass role= to rank by fit)");
  lines.push(`  ${pad("status", 12)}${pad("pushed", 12)}${pad("repository", 26)}${pad("stack", 14)}live`);
  for (const s of shipped) {
    const status = s.mentioned === null
      ? "UNKNOWN"
      : s.mentioned === false
        ? "MISSING"
        : s.confidence === "weak" ? "weak-match" : "listed";
    const live = String(s.repo["homepage"] ?? "").trim();
    lines.push(
      `  ${pad(status, 12)}${pad(String(s.repo["pushed_at"] ?? "?"), 12)}` +
      `${pad(s.name, 26)}${pad(String(s.repo["language"] ?? "—"), 14)}${live || "—"}`,
    );
    if (roleKnown && s.matched.length) {
      lines.push(`  ${" ".repeat(12)}↳ matched: ${s.matched.slice(0, 8).join(", ")}`);
    }
  }
  lines.push("");
}

if (liveUnlisted.length) {
  lines.push("LIVE BUT UNLISTED  (deployed, and the URL appears nowhere in the resume)");
  for (const s of liveUnlisted) lines.push(`  ${pad(s.name, 26)}${s.repo["homepage"]}`);
  lines.push("");
}

if (weak.length) {
  lines.push("WEAK MATCHES  (the name is also an ordinary word — verify these yourself)");
  for (const s of weak) lines.push(`  ${pad(s.name, 26)}matched on ${s.evidence}`);
  lines.push("");
}

if (!mentionsAvailable) {
  lines.push("MENTION DETECTION  unavailable");
  lines.push(`  ⚠ ${String(mentions?.["warning"] ?? "no extractor applied")}`);
  lines.push("  Every repository above is UNKNOWN, not 'not mentioned' — this play could not look.");
  lines.push("");
} else {
  lines.push(`MENTION DETECTION  ${String(mentions?.["method"] ?? "?")} — resume text was read locally and discarded`);
  lines.push("");
}

if (roleParam && !roleKnown) {
  lines.push(`⚠ role="${roleParam}" is not a known track; ranking fell back to recency.`);
  lines.push(`  Known tracks: ${Object.keys(ROLE_PROFILES).join(", ")}`);
  lines.push("");
}

const excluded = Object.entries(exclusions).filter(([, n]) => Number(n) > 0);
if (excluded.length) {
  lines.push("EXCLUDED  (counted, never silently dropped)");
  for (const [reason, n] of excluded) lines.push(`  ${pad(String(n), 6)}${reason}`);
  if (!includeForks && Number(exclusions["fork"] ?? 0) > 0) {
    lines.push("         ↳ pass include_forks=true to include forks");
  }
  lines.push("");
}

lines.push("NEXT");
if (missing.length) {
  lines.push(`  Add ${missing.length} project(s) above to your resume, newest first.`);
  if (liveUnlisted.length) {
    lines.push(liveUnlisted.length === 1
      ? "  1 of them has a live URL worth linking."
      : `  ${liveUnlisted.length} of them have a live URL worth linking.`);
  }
} else if (!mentionsAvailable) {
  lines.push("  Install pdftotext, or export your resume to .docx/.md, to detect what is already named.");
} else {
  lines.push("  Nothing to add. Re-run after your next push.");
}

if (brokenSteps.length) {
  // Never render a normal-looking report over a broken read. The presentation
  // must not throw: a failing presentation discards its own output, and the
  // user is left with a stack trace instead of the reason.
  out.human(abortedReport);
  out.summary("Resume drift: cannot report — a required step did not complete");
  out.result({
    run_id: ctx.run.run_id,
    verdict: "cannot_report",
    failed_steps: brokenSteps,
    reason: "A required step did not complete; no drift conclusion was produced.",
  });
} else {
out.human(lines.join("\n"));
out.summary(verdict);
out.result({
  run_id: ctx.run.run_id,
  verdict,
  baseline: {
    date: baseline,
    source: baselineSource,
    age_days: baselineAge,
    resume_file: chosen["name"] ?? null,
    is_proxy: !sinceValid,
  },
  github: {
    user: githubUser,
    available: reposAvailable,
    read: totalRead,
    shipped_since_baseline: shipped.length,
    truncated: reposData?.["truncated"] ?? false,
  },
  mention_detection: {
    available: mentionsAvailable,
    method: mentions?.["method"] ?? null,
    warning: mentions?.["warning"] ?? null,
  },
  role: { requested: roleParam || null, recognised: roleKnown },
  missing: missing.map((s) => ({
    name: s.name,
    pushed_at: s.repo["pushed_at"],
    language: s.repo["language"],
    homepage: s.repo["homepage"] || null,
    url: s.repo["html_url"],
    role_match: s.matched,
  })),
  weak_matches: weak.map((s) => ({ name: s.name, evidence: s.evidence })),
  unknown_mention: unknown.map((s) => s.name),
  live_but_unlisted: liveUnlisted.map((s) => ({ name: s.name, homepage: s.repo["homepage"] })),
  exclusions,
});
}
