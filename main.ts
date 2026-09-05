/**
 * Resume Drift
 *
 * @rote-frontmatter
 * ---
 * name: resume-drift
 * description: 'What have you shipped that your resume does not know about? Compares a GitHub account against the date of your most recent resume file and reports the gap: which repositories were pushed after the resume was last written, which of those the resume never names, and which have a live deployment URL that appears nowhere in it. The baseline is the resume file''s own modification time, reported as a PROXY and overridable with since=YYYY-MM-DD, because cloud sync or a re-download can reset it. Mention detection reads the resume locally and emits one boolean per repository: no snippet, no contact detail and no document text ever leaves that step. A repository whose name is also an ordinary English word (studio, portfolio, core) is reported as WEAK evidence rather than asserted, and when no text extractor applies - or when one succeeds but recovers no readable text, as pdftotext does on a scanned or image-only PDF - every repository returns UNKNOWN instead of not-mentioned, because could-not-look and did-not-find are different answers. Pass role= to rank the gap by fit against a named track (backend, frontend, fullstack, ml, devops, mobile, data) using printed keyword evidence, never a generated score. Every excluded repository is reported with its reason and an exact count: forks, archived repositories, the profile README and empty repositories are named, never silently dropped. Offline except for one public GitHub call, read-only, writes nothing, needs no credentials; GITHUB_TOKEN is honoured only to raise the rate limit; private repositories are never counted, because this endpoint returns public repositories only with or without a token, and the report states that on every run. Needs python3; pdftotext enables PDF mention detection. Run it with demo=true to see the whole thing work on a bundled sample resume and a public account, with no setup at all.'
 * source: https://github.com/Andrew-Kevin-007/resume-drift
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
 *   version: 0.1.6
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
 *     - domain-career
 *     - job-resume-maintenance
 * parameters:
 * - name: github_user
 *   param_type: string
 *   required: false
 *   description: GitHub handle to scan, e.g. octocat. A full profile URL works too.
 * - name: resume_path
 *   param_type: string
 *   required: false
 *   description: 'Absolute path to a resume file, or a folder of resumes (newest non-cover-letter wins). On Windows use the WSL form: /mnt/c/Users/<you>/Documents/resume.pdf - a C:\ path is translated automatically when it resolves.'
 * - name: role
 *   param_type: string
 *   required: false
 *   description: Rank the gap by fit for one track. Common job titles are accepted too, e.g. Software Developer resolves to fullstack.
 * - name: since
 *   param_type: string
 *   required: false
 *   description: Override the baseline as YYYY-MM-DD instead of the resume file timestamp. Pass an empty value to clear a previous override, which rote remembers between runs.
 * - name: demo
 *   param_type: string
 *   required: false
 *   description: Set to true to run with no setup at all, against a bundled sample resume and a public GitHub account. Use it once to see the shape of the answer, then pass your own github_user and resume_path.
 * - name: include_forks
 *   param_type: string
 *   required: false
 *   description: Set to true to include forked repositories (default false)
 * steps:
 *   resolve_resume:
 *     type: process.exec
 *     timeout_ms: 20000
 *     argv:
 *     - python3
 *     - '@resource{resolve_resume.py}'
 *     - $resume_path
 *     - $demo
 *     - '@resource{demo-resume.md}'
 *   fetch_repos:
 *     type: process.exec
 *     timeout_ms: 60000
 *     depends_on:
 *     - resolve_resume
 *     argv:
 *     - python3
 *     - '@resource{fetch_repos.py}'
 *     - $github_user
 *     - '@resolve_resume{.stdout.text}'
 *     - $since
 *     - $include_forks
 *     - $demo
 *   match_mentions:
 *     type: process.exec
 *     timeout_ms: 45000
 *     depends_on:
 *     - resolve_resume
 *     - fetch_repos
 *     argv:
 *     - python3
 *     - '@resource{match_mentions.py}'
 *     - '@resolve_resume{.stdout.text}'
 *     - '@fetch_repos{.stdout.text}'
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

// People type job titles, not track slugs. "Software Developer" is exactly what
// someone reaches for, and silently falling back to no ranking punishes them for
// answering in plain English. Resolve the common titles, and say in the report
// which track a title resolved to rather than pretending they typed the slug.
const ROLE_ALIASES: Record<string, string> = {
  "software developer": "fullstack",
  "software engineer": "fullstack",
  "software development engineer": "fullstack",
  "sde": "fullstack",
  "swe": "fullstack",
  "developer": "fullstack",
  "engineer": "fullstack",
  "programmer": "fullstack",
  "full stack": "fullstack",
  "full stack developer": "fullstack",
  "full stack engineer": "fullstack",
  "web developer": "frontend",
  "frontend developer": "frontend",
  "frontend engineer": "frontend",
  "front end": "frontend",
  "ui developer": "frontend",
  "ui engineer": "frontend",
  "backend developer": "backend",
  "backend engineer": "backend",
  "back end": "backend",
  "server engineer": "backend",
  "api engineer": "backend",
  "ml engineer": "ml",
  "machine learning engineer": "ml",
  "machine learning": "ml",
  "ai engineer": "ml",
  "deep learning engineer": "ml",
  "data scientist": "ml",
  "research engineer": "ml",
  "devops engineer": "devops",
  "sre": "devops",
  "site reliability engineer": "devops",
  "platform engineer": "devops",
  "cloud engineer": "devops",
  "infrastructure engineer": "devops",
  "mobile developer": "mobile",
  "mobile engineer": "mobile",
  "android developer": "mobile",
  "ios developer": "mobile",
  "flutter developer": "mobile",
  "data engineer": "data",
  "data analyst": "data",
  "analytics engineer": "data",
};

const roleNormalised = roleParam.replace(/[^a-z0-9]+/g, " ").trim();
const roleResolved = roleNormalised === ""
  ? ""
  : Object.hasOwn(ROLE_PROFILES, roleNormalised)
    ? roleNormalised
    : (ROLE_ALIASES[roleNormalised] ?? "");
const roleKnown = roleResolved !== "";
const roleAliased = roleKnown && roleResolved !== roleNormalised;
const roleKeywords = roleKnown ? ROLE_PROFILES[roleResolved] : [];

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

let verdict: string;
if (!reposAvailable) {
  verdict = "Cannot report — GitHub could not be read";
} else if (shipped.length === 0) {
  verdict = "In sync — nothing pushed since your resume";
} else if (!mentionsAvailable) {
  verdict = `${plural(shipped.length, "project")} pushed since — but your resume could not be read`;
} else if (missing.length === 0) {
  verdict = "In sync — everything you have pushed since is already on it";
} else {
  verdict = `${plural(missing.length, "project")} missing from your resume`;
}

// ---------- render ----------
//
// Shape of this report, deliberately: the answer first, the action second, the
// caveats last. Someone re-running this every few weeks needs the number and the
// list in the first five lines; the proxy-baseline and exclusion accounting still
// matter, but they are reference material, not the headline. Nothing honest was
// removed to get there - it moved below the rule.

const lines: string[] = [];
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
const RULE = "─".repeat(64);

// A step that died leaves a null body. Rendering the normal report over that
// produces confident nonsense — "install pdftotext" when the real problem was a
// mistyped handle. Say what actually broke instead.
const brokenSteps: string[] = [];
if (resume === null) brokenSteps.push(`resolve_resume (${STEP_HANDLES.resolve_resume.outcome.status})`);
if (reposData === null) brokenSteps.push(`fetch_repos (${STEP_HANDLES.fetch_repos.outcome.status})`);

// A required parameter left blank fails in whichever step reads it first, which
// can point at the wrong input entirely. Name the real gap up front.
const demoMode = ["true", "1", "yes"].includes(asParam("demo").toLowerCase());
const missingRequired: string[] = [];
if (!demoMode && !asParam("github_user")) {
  missingRequired.push("github_user — your GitHub handle, e.g. octocat");
}
if (!demoMode && !asParam("resume_path")) {
  missingRequired.push("resume_path — path to your resume file or folder");
}
if (missingRequired.length) {
  missingRequired.push("or pass demo=true to see it run with no setup at all");
}

const abortedReport = brokenSteps.length
  ? [
    "RESUME DRIFT",
    "",
    "  ▸ Cannot report — a required step did not complete",
    "",
    ...(missingRequired.length
      ? ["MISSING INPUT", ...missingRequired.map((m) => `  ${m}`), ""]
      : []),
    "WHAT FAILED",
    ...brokenSteps.map((s) => `  ${s}`),
    "",
    "This play needs both a resume baseline and a repository list before it can say",
    "anything truthful about drift, so it reports nothing rather than guessing.",
    "",
    "The failing step printed the reason above.",
    "On Windows, use the WSL path form: /mnt/c/Users/<you>/Documents/resume.pdf",
  ].join("\n")
  : "";

// ---------- headline ----------

const translatedFrom = resume?.["translated_from_windows_path"];

lines.push("RESUME DRIFT");
lines.push("");
if (demoMode) {
  lines.push("  DEMO RUN. A sample resume ships with this play, and the baseline is pinned,");
  lines.push("  so this shows the shape of the answer without any setup. For your own answer:");
  lines.push("  github_user=<your handle> resume_path=<your resume>");
  lines.push("");
}
lines.push(`  ▸ ${verdict}`);
if (resumeDate) {
  lines.push(`    resume  ${String(chosen["name"] ?? "?")}`);
  lines.push(`            ${baseline}${baselineAge !== null ? ` · ${baselineAge} days ago` : ""}`);
}
lines.push(
  `    github  ${githubUser}` +
  (reposAvailable ? ` · ${totalRead} repos read · ${shipped.length} pushed since` : ""),
);
lines.push("");

if (!reposAvailable) {
  lines.push("GITHUB COULD NOT BE READ");
  lines.push(`  ${String(reposData?.["warning"] ?? "repositories unavailable")}`);
  lines.push("");
}

// ---------- the gap ----------

const listed = shipped.filter((s) => s.mentioned === true && s.confidence !== "weak");
const headline = shipped.filter((s) => s.mentioned !== true);

if (headline.length) {
  const title = mentionsAvailable ? "MISSING FROM YOUR RESUME" : "PUSHED SINCE YOUR RESUME";
  const rank = roleKnown
    ? `ranked for ${roleResolved}`
    : "newest first · pass role= to rank by fit";
  lines.push(`${pad(title, 42)}${rank}`);
  for (const s of headline) {
    const live = String(s.repo["homepage"] ?? "").trim();
    lines.push(
      `  ${pad(String(s.repo["pushed_at"] ?? "?"), 12)}${pad(s.name, 26)}` +
      `${pad(String(s.repo["language"] ?? "—"), 13)}${live}`,
    );
  }
  if (!mentionsAvailable) {
    lines.push("  ↳ shown as UNKNOWN, not missing: your resume could not be read (see below)");
  }
  lines.push("");
}

if (listed.length) {
  lines.push("ALREADY ON YOUR RESUME");
  lines.push(`  ${listed.map((s) => s.name).join(", ")}`);
  lines.push("");
}

if (weak.length) {
  lines.push("WORTH CHECKING YOURSELF");
  for (const s of weak) {
    lines.push(`  ${pad(s.name, 26)}the name is an ordinary word, so the match may be coincidence`);
  }
  lines.push("");
}

// ---------- action ----------

lines.push("NEXT");
if (missing.length) {
  lines.push(`  Add ${missing.length} project${missing.length === 1 ? "" : "s"} above, newest first.`);
  if (liveUnlisted.length) {
    lines.push(liveUnlisted.length === 1
      ? `  ${liveUnlisted[0].name} is deployed and its URL is nowhere in the resume — worth linking.`
      : `  ${liveUnlisted.length} are deployed with URLs nowhere in the resume — worth linking.`);
  }
} else if (!mentionsAvailable && shipped.length) {
  lines.push("  Install pdftotext, or export your resume to .docx/.md, to see what is already named.");
} else if (reposAvailable) {
  lines.push("  Nothing to add. Re-run after your next push.");
}
lines.push("");

// ---------- details, below the rule ----------

lines.push(RULE);
lines.push("DETAILS");

const excluded = Object.entries(exclusions).filter(([, n]) => Number(n) > 0);
if (excluded.length) {
  const total = excluded.reduce((sum, [, n]) => sum + Number(n), 0);
  const parts = excluded
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([reason, n]) => `${n} ${reason}`);
  lines.push(`  excluded   ${total} repos — ${parts.join(", ")}`);
  if (!includeForks && Number(exclusions["fork"] ?? 0) > 0) {
    lines.push("             include_forks=true to count forks");
  }
}

lines.push(`  baseline   ${baselineSource}`);
if (baselineSource.startsWith("demo")) {
  lines.push("             a bundled file's timestamp is its install date, so the demo pins");
  lines.push("             the baseline. Your own run uses your resume's own date.");
} else if (baselineSource.startsWith("since=")) {
  lines.push("             rote remembers parameters between runs — pass an empty since= to clear");
} else {
  lines.push("             a file timestamp is a proxy for when you last wrote it;");
  lines.push("             cloud sync can reset it — override with since=YYYY-MM-DD");
}
if (sinceParam && !sinceValid) {
  lines.push(`             since="${sinceParam}" is not YYYY-MM-DD and was ignored`);
}

const otherCandidates = (resume?.["candidates"] as Array<Record<string, unknown>> | undefined) ?? [];
if (otherCandidates.length > 1) {
  lines.push(`  resumes    ${otherCandidates.length} found in that folder; used the newest non-cover-letter`);
  for (const c of otherCandidates.slice(1, 4)) {
    lines.push(`             ${pad(String(c["mtime_iso"] ?? "?"), 12)}${String(c["name"] ?? "")}`);
  }
  if (otherCandidates.length > 4) {
    lines.push(`             …and ${otherCandidates.length - 4} more`);
  }
  lines.push("             point resume_path at one file to compare against it instead");
}

lines.push(
  `  mentions   ${mentionsAvailable
    ? `${String(mentions?.["method"] ?? "?")} — resume read locally, then discarded`
    : "unavailable"}`,
);
if (!mentionsAvailable) {
  lines.push(`             ${String(mentions?.["warning"] ?? "no extractor applied")}`);
}

lines.push("  private    never counted — GitHub's public endpoint omits private repos");

if (roleParam && !roleKnown) {
  lines.push(`  role       "${roleParam}" is not a known track; ranked by recency instead`);
  lines.push(`             try: ${Object.keys(ROLE_PROFILES).join(", ")}`);
} else if (roleAliased) {
  lines.push(`  role       "${roleParam}" → ${roleResolved}`);
}

if (typeof translatedFrom === "string" && translatedFrom) {
  lines.push(`  path       Windows path translated to WSL: ${translatedFrom}`);
}

if (reposData?.["truncated"] === true) {
  lines.push(`  limit      ${String(reposData?.["warning"] ?? "result truncated")}`);
}

// ---------- emit ----------

const shortSummary = brokenSteps.length
  ? "Resume drift: cannot report — a required step did not complete"
  : `Resume drift: ${verdict}`;

if (brokenSteps.length) {
  // Never render a normal-looking report over a broken read. The presentation
  // must not throw: a failing presentation discards its own output, and the
  // user is left with a stack trace instead of the reason.
  out.human(abortedReport);
  out.summary(shortSummary);
  out.result({
    run_id: ctx.run.run_id,
    verdict: "cannot_report",
    failed_steps: brokenSteps,
    missing_required_parameters: missingRequired,
    reason: "A required step did not complete; no drift conclusion was produced.",
  });
} else {
  out.human(lines.join("\n"));
  out.summary(shortSummary);
  out.result({
    run_id: ctx.run.run_id,
    verdict,
    baseline: {
      date: baseline,
      source: baselineSource,
      age_days: baselineAge,
      resume_file: chosen["name"] ?? null,
      is_proxy: !sinceValid,
      translated_from_windows_path: translatedFrom ?? null,
      candidates_considered: otherCandidates.length,
    },
    github: {
      user: githubUser,
      available: reposAvailable,
      read: totalRead,
      shipped_since_baseline: shipped.length,
      truncated: reposData?.["truncated"] ?? false,
      private_repos_included: false,
    },
    mention_detection: {
      available: mentionsAvailable,
      method: mentions?.["method"] ?? null,
      warning: mentions?.["warning"] ?? null,
    },
    role: { requested: roleParam || null, resolved: roleResolved || null, recognised: roleKnown },
    missing: missing.map((s) => ({
      name: s.name,
      pushed_at: s.repo["pushed_at"],
      language: s.repo["language"],
      homepage: s.repo["homepage"] || null,
      url: s.repo["html_url"],
      role_match: s.matched,
    })),
    already_listed: listed.map((s) => s.name),
    weak_matches: weak.map((s) => ({ name: s.name, evidence: s.evidence })),
    unknown_mention: unknown.map((s) => s.name),
    live_but_unlisted: liveUnlisted.map((s) => ({ name: s.name, homepage: s.repo["homepage"] })),
    exclusions,
  });
}
