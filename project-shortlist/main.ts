/**
 * Project Shortlist
 *
 * @rote-frontmatter
 * ---
 * name: project-shortlist
 * description: 'Which of your projects actually deserve a place on your resume, and what should the bullets say? Judges every repository on a GitHub account against a printed evidence rubric - is it deployed, does it have a README that explains it, tests, CI, a real dependency set, sustained work rather than a one-day scaffold - and returns a ranked shortlist with a verdict per project. Projects ALREADY named on your resume are judged by the same rubric as the rest, because being listed is not evidence of being worth listing, so a thin project already on the page is told to go. Every score is the sum of named signals and every signal prints the evidence that earned it, so the total can be recomputed by hand; there is no generated score anywhere. Pass role= to rank for a track or a job title. Then confirm the three or four you want and re-run with deep_dive= to get, for each, an XYZ resume bullet assembled ONLY from measured facts: X quoted from the README, Z quoted from the dependency manifest, and Y left as an explicit printed gap when the repository contains no measured outcome, because inventing a number is the one thing a resume tool must never do. Bullets avoid em dashes. Read-only, writes nothing, needs no credentials; GITHUB_TOKEN only raises the rate limit. The GitHub API allows 60 unauthenticated requests an hour, so evidence spending is bounded, the bound is a parameter, and what went unexamined is always named. Needs python3; pdftotext enables PDF resume reading. Run it with demo=true to see the whole thing work on a bundled sample resume and a public account, with no setup at all.'
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
 *     - domain-career
 * parameters:
 * - name: github_user
 *   param_type: string
 *   required: false
 *   description: GitHub handle to scan, e.g. octocat. A full profile URL works too.
 * - name: resume_path
 *   param_type: string
 *   required: false
 *   description: Absolute path to a resume file, or a folder of resumes (newest non-cover-letter wins). On Windows a C:\ path is translated to its WSL /mnt form automatically when it resolves.
 * - name: role
 *   param_type: string
 *   required: false
 *   description: 'Rank for a track: fullstack, backend, frontend, ml, devops, mobile, data. Job titles work too and are case-insensitive, e.g. Software Developer.'
 * - name: deep_dive
 *   param_type: string
 *   required: false
 *   description: Comma separated repository names to analyse in depth for XYZ bullets, e.g. Talos,AUCTUS,quorum. Confirm three or four after reading the shortlist.
 * - name: demo
 *   param_type: string
 *   required: false
 *   description: Set to true to run with no setup at all, against a bundled sample resume and a public GitHub account. Use it once to see the shape of the answer, then pass your own github_user and resume_path.
 * - name: include_forks
 *   param_type: string
 *   required: false
 *   description: Set to true to include forked repositories (default false)
 * - name: evidence_budget
 *   param_type: string
 *   required: false
 *   description: Maximum GitHub API calls this run may spend (default 24, max 50). Unauthenticated GitHub allows 60 per hour.
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
 *   scan_and_score:
 *     type: process.exec
 *     timeout_ms: 180000
 *     argv:
 *     - python3
 *     - '@resource{scan_and_score.py}'
 *     - $github_user
 *     - $include_forks
 *     - $deep_dive
 *     - $evidence_budget
 *     - $demo
 *   match_mentions:
 *     type: process.exec
 *     timeout_ms: 45000
 *     depends_on:
 *     - resolve_resume
 *     - scan_and_score
 *     argv:
 *     - python3
 *     - '@resource{match_mentions.py}'
 *     - '@resolve_resume{.stdout.text}'
 *     - '@scan_and_score{.stdout.text}'
 * ---
 *
 * Usage:
 *   rote play run project-shortlist github_user=octocat resume_path=~/Documents/resume.pdf
 *   rote play run project-shortlist github_user=octocat resume_path=~/r.pdf role=backend
 *   rote play run project-shortlist github_user=octocat resume_path=~/r.pdf deep_dive=api,parser
 *
 * Design notes:
 *  - The resume is read only to learn which projects are already named. Its text
 *    never leaves match_mentions, exactly as in resume-drift.
 *  - Scoring is a sum of printed signals. A reader who disagrees with a verdict
 *    can see which signal to argue with.
 *  - The Y slot of a bullet is where a language model would invent a number.
 *    A Play cannot call a model, and this one will not guess: a repository with
 *    no measured outcome gets a printed gap.
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

const STEP_HANDLES = {
  resolve_resume: ctx.step(stepName("resolve_resume")),
  scan_and_score: ctx.step(stepName("scan_and_score")),
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
const scan = bodyOf(STEP_HANDLES.scan_and_score);
const mentions = bodyOf(STEP_HANDLES.match_mentions);

// ---------- parameters ----------

const params = (ctx.params ?? {}) as Record<string, unknown>;
const asParam = (key: string): string => {
  const raw = params[key];
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return value.startsWith("$") ? "" : value;
};

const roleParam = asParam("role").toLowerCase();

// ---------- role resolution (same contract as resume-drift) ----------

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

const ROLE_ALIASES: Record<string, string> = {
  "software developer": "fullstack", "software engineer": "fullstack", "sde": "fullstack",
  "swe": "fullstack", "developer": "fullstack", "engineer": "fullstack",
  "programmer": "fullstack", "full stack": "fullstack", "full stack developer": "fullstack",
  "full stack engineer": "fullstack", "web developer": "frontend",
  "frontend developer": "frontend", "frontend engineer": "frontend", "front end": "frontend",
  "ui developer": "frontend", "backend developer": "backend", "backend engineer": "backend",
  "back end": "backend", "api engineer": "backend", "ml engineer": "ml",
  "machine learning engineer": "ml", "machine learning": "ml", "ai engineer": "ml",
  "data scientist": "ml", "devops engineer": "devops", "sre": "devops",
  "site reliability engineer": "devops", "platform engineer": "devops",
  "cloud engineer": "devops", "infrastructure engineer": "devops",
  "mobile developer": "mobile", "android developer": "mobile", "ios developer": "mobile",
  "data engineer": "data", "data analyst": "data",
};

const roleNormalised = roleParam.replace(/[^a-z0-9]+/g, " ").trim();
const roleResolved = roleNormalised === ""
  ? ""
  : Object.hasOwn(ROLE_PROFILES, roleNormalised)
    ? roleNormalised
    : (ROLE_ALIASES[roleNormalised] ?? "");
const roleKnown = roleResolved !== "";
const roleKeywords = roleKnown ? ROLE_PROFILES[roleResolved] : [];

// ---------- assemble ----------

type Proj = Record<string, unknown>;

const scanAvailable = scan !== null && scan["available"] !== false;
const projects = (scan?.["projects"] as Proj[] | undefined) ?? [];
const deepData = (scan?.["deep"] as Proj[] | undefined) ?? [];
const matchMap = (mentions?.["matches"] as Record<string, Record<string, unknown>> | undefined) ?? {};
const mentionsAvailable = mentions?.["available"] === true;
const mode = String(scan?.["mode"] ?? "shortlist");
const githubUser = String(scan?.["user"] ?? asParam("github_user"));

// ---------- house style, measured from the resume's own bullets ----------
//
// A generated bullet that does not read like the rest of the page announces
// itself. match_mentions measures how this resume writes (opening verb, closing
// punctuation, how the stack is presented, typical length) and passes the shape
// forward. No resume content travels: verbs come from a fixed allowlist and
// everything else is a count or a ratio.

const style = (mentions?.["style"] as Record<string, unknown> | undefined) ?? {};
const styleDetected = style["detected"] === true;
const pct = (key: string): number => Number(style[key] ?? 0);

const styleVerbs = (style["top_verbs"] as string[] | undefined) ?? [];

// X is a noun phrase describing the project, so the opening verb has to be one
// that can take it as an object. "Reduced" may well be this resume's commonest
// verb, but "Reduced task management and attendance tracking" is nonsense.
// Match the resume's voice only among verbs that can actually open this clause.
const CONSTRUCTION_VERBS = [
  "built", "developed", "created", "designed", "implemented", "engineered",
  "architected", "programmed", "prototyped", "shipped", "launched", "constructed",
  "wrote", "delivered",
];
const styleVerbLower = styleDetected
  ? (styleVerbs.find((v) => CONSTRUCTION_VERBS.includes(v)) ?? "built")
  : "built";
const styleVerb = styleVerbLower.charAt(0).toUpperCase() + styleVerbLower.slice(1);
const styleVerbBorrowed = styleDetected && styleVerbs.includes(styleVerbLower);
const styleMedian = styleDetected ? Math.max(8, Number(style["median_words"] ?? 18)) : 18;
const stylePeriod = styleDetected ? pct("ends_with_period_pct") >= 50 : true;
const styleParenTech = styleDetected && pct("tech_in_parentheses_pct") >= 40;
const styleUsingTech = styleDetected && pct("tech_after_using_pct") >= 40;
const styleWantsNumber = styleDetected ? pct("includes_number_pct") >= 40 : false;
const rawGlyph = style["bullet_glyph"];
const styleGlyph = styleDetected && typeof rawGlyph === "string" && rawGlyph
  ? `${rawGlyph} `
  : "";

/** Trim to a word budget without cutting mid-word or leaving a dangling word. */
function fitWords(text: string, budget: number): string {
  const words = text.split(/\s+/);
  if (words.length <= budget) return text;
  let out = words.slice(0, budget).join(" ");
  // A cut that ends on "for" or "and" reads as a typo, not a summary.
  const DANGLING = /\s+(for|with|and|or|to|of|in|on|at|by|the|a|an|from|that|which|as|its|their)$/i;
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out.replace(/[,;:]$/, "").replace(DANGLING, "");
  }
  return out;
}

function roleFit(p: Proj): string[] {
  if (!roleKnown) return [];
  const hay = [
    String(p["name"] ?? ""), String(p["description"] ?? ""),
    String(p["language"] ?? ""), ((p["topics"] as string[] | undefined) ?? []).join(" "),
    String(p["category"] ?? ""),
  ].join(" ").toLowerCase();
  return roleKeywords.filter((k) => hay.includes(k));
}

const enriched = projects.map((p) => {
  const name = String(p["name"] ?? "");
  const m = matchMap[name] ?? {};
  return {
    p,
    name,
    verdict: String(p["verdict"] ?? "NOT EXAMINED"),
    score: Number(p["score"] ?? 0),
    fit: roleFit(p),
    onResume: (m["mentioned"] ?? null) as boolean | null,
    weakMatch: m["confidence"] === "weak",
  };
});

const RANK: Record<string, number> = { STRONG: 0, SOLID: 1, WEAK: 2, OMIT: 3, "NOT EXAMINED": 4 };
enriched.sort((a, b) => {
  if (RANK[a.verdict] !== RANK[b.verdict]) return RANK[a.verdict] - RANK[b.verdict];
  if (roleKnown && b.fit.length !== a.fit.length) return b.fit.length - a.fit.length;
  return b.score - a.score;
});

const include = enriched.filter((e) => e.verdict === "STRONG" || e.verdict === "SOLID");
const demote = enriched.filter((e) => (e.verdict === "WEAK" || e.verdict === "OMIT") && e.p["examined"]);
const unexamined = enriched.filter((e) => !e.p["examined"]);
// The requested check: something already on the resume whose evidence does not hold up.
const listedButWeak = demote.filter((e) => e.onResume === true);
const otherDemote = demote.filter((e) => e.onResume !== true);

// ---------- render ----------

const lines: string[] = [];
const pad = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
const RULE = "─".repeat(70);

const brokenSteps: string[] = [];
if (resume === null) brokenSteps.push(`resolve_resume (${STEP_HANDLES.resolve_resume.outcome.status})`);
if (scan === null) brokenSteps.push(`scan_and_score (${STEP_HANDLES.scan_and_score.outcome.status})`);

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

let verdictLine: string;
if (!scanAvailable) {
  verdictLine = "Cannot report — GitHub could not be read";
} else if (mode === "deep_dive") {
  verdictLine = `Deep dive on ${deepData.length} project${deepData.length === 1 ? "" : "s"}`;
} else {
  verdictLine = include.length === 1
    ? "1 project earns a place on your resume"
    : `${include.length} projects earn a place on your resume`;
}

if (brokenSteps.length) {
  out.human([
    "PROJECT SHORTLIST",
    "",
    "  ▸ Cannot report — a required step did not complete",
    "",
    ...(missingRequired.length ? ["MISSING INPUT", ...missingRequired.map((m) => `  ${m}`), ""] : []),
    "WHAT FAILED",
    ...brokenSteps.map((s) => `  ${s}`),
    "",
    "This play needs a resume and a repository list before it can judge anything,",
    "so it reports nothing rather than guessing.",
    "On Windows, use the WSL path form: /mnt/c/Users/<you>/Documents/resume.pdf",
  ].join("\n"));
  out.summary("Project shortlist: cannot report");
  out.result({
    run_id: ctx.run.run_id,
    verdict: "cannot_report",
    failed_steps: brokenSteps,
    missing_required_parameters: missingRequired,
  });
} else if (mode === "deep_dive") {
  // ---------------- deep dive: XYZ scaffolds, no invented facts ----------------
  lines.push("PROJECT DEEP DIVE");
  lines.push("");
  lines.push(`  ▸ ${verdictLine}`);
  lines.push(`    ${roleKnown ? `oriented for ${roleResolved}` : "no role given; pass role= to orient these"}`);
  lines.push("");
  lines.push("Each bullet below is XYZ: what you did, what it measured, how you did it.");
  lines.push("Every clause is quoted from the repository. Nothing here was invented, and");
  lines.push("where a repository proves nothing, the slot says so instead of guessing.");
  lines.push("");
  if (styleDetected) {
    lines.push("HOUSE STYLE  (measured from your resume, so these read like the rest of the page)");
    lines.push(
      `  ${String(style["bullets_seen"] ?? "?")} existing bullets · median ${styleMedian} words · ` +
      `opens with a verb ${pct("opens_with_verb_pct")}% · ends with a full stop ${pct("ends_with_period_pct")}%`,
    );
    lines.push(
      `  your verbs: ${styleVerbs.slice(0, 4).join(", ") || "none detected"} · ` +
      `stack shown ${styleParenTech ? "in parentheses" : "after 'using'"} · ` +
      `${pct("includes_number_pct")}% of your bullets carry a number`,
    );
    if (!styleWantsNumber) {
      lines.push("  most of your bullets carry no number, so a missing Y is in keeping here");
    }
  } else {
    lines.push("HOUSE STYLE  not measured");
    lines.push(`  ${String(style["reason"] ?? "no bullet-shaped lines were found")}`);
    lines.push("  Drafts below use a neutral default: verb first, full stop, stack after 'using'.");
  }
  lines.push("");

  const unmatched = (scan?.["unmatched_deep_names"] as string[] | undefined) ?? [];
  if (unmatched.length) {
    lines.push(`⚠ not found on this account: ${unmatched.join(", ")}`);
    lines.push("");
  }

  for (const d of deepData) {
    const name = String(d["name"] ?? "");
    const fitFor = enriched.find((e) => e.name === name);
    lines.push(RULE);
    lines.push(`${pad(name, 34)}${String(d["category"] ?? "")}`);
    const live = String(d["homepage"] ?? "").trim();
    if (live) lines.push(`  live at ${live}`);
    lines.push("");

    const x = d["x"];
    lines.push("  X  what it does");
    if (typeof x === "string" && x) {
      lines.push(`     "${x}"`);
      lines.push(`     source: ${String(d["x_source"] ?? "repository")}`);
    } else {
      lines.push("     NOT FOUND. The repository has no README prose and no description,");
      lines.push("     so nothing here states what it does. Write one sentence yourself.");
    }
    lines.push("");

    const ys = (d["y_candidates"] as Array<Record<string, unknown>> | undefined) ?? [];
    lines.push("  Y  measured result");
    if (ys.length) {
      for (const y of ys.slice(0, 4)) {
        lines.push(`     ${pad(String(y["value"] ?? ""), 18)}from: ${String(y["line"] ?? "").slice(0, 84)}`);
      }
      lines.push("     Use one only if it is genuinely yours to claim.");
    } else {
      lines.push("     NOT FOUND IN THE REPOSITORY.");
      lines.push("     This project measured nothing, so there is no honest Y to print.");
      lines.push("     Supply a real number you can defend (users, latency, volume, accuracy),");
      lines.push("     or drop the Y clause. Do not invent one: an interviewer will ask.");
    }
    lines.push("");

    const zs = ((d["z_stack"] as string[] | undefined) ?? []).filter(Boolean);
    lines.push("  Z  how it was built");
    if (zs.length) {
      lines.push(`     ${zs.slice(0, 10).join(", ")}`);
      if (d["z_source"]) lines.push(`     source: ${String(d["z_source"])}`);
    } else {
      lines.push("     NOT FOUND. No dependency manifest was readable, so the stack is unproven.");
    }

    const hl = ((d["highlights"] as string[] | undefined) ?? []).filter(Boolean);
    if (hl.length) {
      lines.push("");
      lines.push(`  evidence: ${hl.join(", ")}`);
    }
    if (fitFor && fitFor.fit.length) {
      lines.push(`  matches ${roleResolved}: ${fitFor.fit.slice(0, 8).join(", ")}`);
    }

    lines.push("");
    lines.push("  DRAFT BULLET");
    // The no-em-dash rule applies to text destined for the resume, and README
    // prose is full of them. Convert rather than pass them through: an em dash
    // that arrives by accident is still an em dash on the page.
    const noDash = (t: string) =>
      t.replace(/\s*[—–]\s*/g, ", ").replace(/\s*,\s*,/g, ",").replace(/\s+/g, " ").trim();
    const xRaw = typeof x === "string" && x
      ? noDash(x).replace(/\.$/, "")
      : "[WRITE ONE SENTENCE: what it does]";
    // The evidence block above lists the full dependency set. A bullet names the
    // stack, so prefer the unscoped packages a reader recognises over helper
    // libraries that happen to sort early in package.json.
    const zBullet = zs.filter((d) => !d.startsWith("@"));
    const zForBullet = (zBullet.length >= 2 ? zBullet : zs).slice(0, 3);
    const zText = zs.length ? noDash(zForBullet.join(", ")) : "[NAME THE STACK]";
    const yText = ys.length
      ? noDash(String(ys[0]["value"] ?? ""))
      : "[ADD A REAL NUMBER, or delete this clause]";

    // Match the page it is going on. A bullet that reads differently from every
    // other bullet on the resume announces itself as generated, so the opening
    // verb, the closing punctuation, how the stack is presented and the rough
    // length all come from the resume's own measured habits.
    const verb = styleVerb;
    const xFitted = fitWords(xRaw, Math.max(6, styleMedian - 8));
    const tail = styleParenTech ? `(${zText})` : `using ${zText}`;
    lines.push(`    ${styleGlyph}${verb} ${xFitted}, measured by ${yText}, ${tail}${stylePeriod ? "." : ""}`);
    if (xFitted !== xRaw) {
      lines.push(`    (X trimmed toward this resume's median bullet of ${styleMedian} words)`);
    }
    lines.push("");
  }

  lines.push(RULE);
  lines.push("RULES THESE DRAFTS FOLLOW");
  lines.push("  no em dashes");
  lines.push("  XYZ order: what you did, what it measured, how you did it");
  lines.push("  nothing asserted that the repository does not show");
  lines.push("");
  lines.push("DETAILS");
  lines.push(`  api calls  ${String(scan?.["api_calls"] ?? "?")} of ${String(scan?.["api_budget"] ?? "?")} budgeted`);
  if (scan?.["warning"]) lines.push(`  note       ${String(scan["warning"])}`);

  out.human(lines.join("\n"));
  out.summary(`Project deep dive: ${deepData.length} project(s)`);
  out.result({
    run_id: ctx.run.run_id,
    mode,
    verdict: verdictLine,
    role: { requested: roleParam || null, resolved: roleResolved || null },
    deep: deepData,
    unmatched_deep_names: unmatched,
    api_calls: scan?.["api_calls"] ?? null,
  });
} else {
  // ---------------- shortlist ----------------
  lines.push("PROJECT SHORTLIST");
  lines.push("");
  if (demoMode) {
    lines.push("  DEMO RUN. A sample resume ships with this play, so this shows the shape of");
    lines.push("  the answer without any setup. For your own answer:");
    lines.push("  github_user=<your handle> resume_path=<your resume>");
    lines.push("");
  }
  lines.push(`  ▸ ${verdictLine}`);
  lines.push(
    `    github  ${githubUser} · ${String(scan?.["live_repos"] ?? "?")} projects · ` +
    `${String(scan?.["examined"] ?? 0)} examined in depth`,
  );
  if (resume?.["chosen"]) {
    lines.push(`    resume  ${String((resume["chosen"] as Record<string, unknown>)["name"] ?? "")}`);
  }
  lines.push("");

  if (!scanAvailable) {
    lines.push("GITHUB COULD NOT BE READ");
    lines.push(`  ${String(scan?.["warning"] ?? "unavailable")}`);
    lines.push("");
  }

  if (include.length) {
    lines.push(`${pad("PUT THESE IN YOUR RESUME", 44)}${roleKnown ? `ranked for ${roleResolved}` : "ranked by evidence"}`);
    lines.push(`  ${pad("#", 4)}${pad("project", 24)}${pad("verdict", 9)}${pad("score", 7)}${pad("category", 22)}on resume`);
    include.forEach((e, i) => {
      const state = e.onResume === null ? "unknown" : e.onResume ? (e.weakMatch ? "maybe" : "yes") : "NO";
      lines.push(
        `  ${pad(String(i + 1), 4)}${pad(e.name, 24)}${pad(e.verdict, 9)}` +
        `${pad(String(e.score), 7)}${pad(String(e.p["category"] ?? ""), 22)}${state}`,
      );
      const sigs = ((e.p["signals"] as Array<Record<string, unknown>> | undefined) ?? [])
        .slice(0, 3).map((s) => String(s["evidence"] ?? ""));
      if (sigs.length) lines.push(`      ${sigs.join(" · ")}`);
      if (roleKnown && e.fit.length) lines.push(`      matches ${roleResolved}: ${e.fit.slice(0, 6).join(", ")}`);
    });
    lines.push("");
  }

  if (listedButWeak.length) {
    lines.push("ON YOUR RESUME BUT THE EVIDENCE IS THIN");
    for (const e of listedButWeak) {
      const why = ((e.p["flags"] as string[] | undefined) ?? []).slice(0, 2).join("; ")
        || "few signals of real use";
      lines.push(`  ${pad(e.name, 24)}${pad(e.verdict, 8)}${why}`);
    }
    lines.push("  Being listed already is not evidence of being worth listing.");
    lines.push("  Strengthen these, or give the space to something above.");
    lines.push("");
  }

  if (otherDemote.length) {
    lines.push("NOT STRONG ENOUGH YET");
    for (const e of otherDemote.slice(0, 10)) {
      const why = ((e.p["flags"] as string[] | undefined) ?? []).slice(0, 2).join("; ")
        || "few signals of real use";
      lines.push(`  ${pad(e.name, 24)}${pad(e.verdict, 8)}${why}`);
    }
    if (otherDemote.length > 10) lines.push(`  …and ${otherDemote.length - 10} more`);
    lines.push("");
  }

  if (unexamined.length) {
    lines.push("NOT EXAMINED");
    lines.push(`  ${unexamined.length} project(s) ranked too low to spend API calls on.`);
    lines.push(`  Raise evidence_budget to look at more: ${unexamined.slice(0, 6).map((e) => e.name).join(", ")}${unexamined.length > 6 ? ", …" : ""}`);
    lines.push("");
  }

  lines.push("NEXT");
  if (!scanAvailable) {
    // Never advise about projects that were never read. "Ship more" is nonsense
    // when the real answer is "wait for the rate limit to reset".
    lines.push("  Nothing was judged, because GitHub could not be read. Wait for the rate");
    lines.push("  limit to reset, or set GITHUB_TOKEN to raise it, then run this again.");
    lines.push("  No conclusion about your projects is implied by this run.");
  } else if (include.length) {
    const top = include.slice(0, 4).map((e) => e.name);
    lines.push("  Pick the three or four you want, then re-run with:");
    lines.push(`    deep_dive=${top.join(",")}`);
    lines.push("  That returns an XYZ resume bullet for each, built only from what the");
    lines.push("  repository proves, with any missing number left as a gap for you to fill.");
  } else {
    lines.push("  Nothing cleared the bar. Raise evidence_budget, or ship more before applying.");
  }
  lines.push("");

  lines.push(RULE);
  lines.push("HOW THE SCORE IS BUILT  (a sum of named signals; recompute it by hand if you like)");
  lines.push("  deployed +3 · tests +3 · sustained work +3 · attention +1..3 · README +2");
  lines.push("  documented usage +2 · CI +2 · substance +1..2 · description, topics, licence +1");
  lines.push("  STRONG >= 12 · SOLID >= 7 · WEAK >= 4 · OMIT below that");
  lines.push("  a one-day scaffold or a missing README caps a project below SOLID");
  lines.push("");
  lines.push("DETAILS");
  lines.push(`  api calls  ${String(scan?.["api_calls"] ?? "?")} of ${String(scan?.["api_budget"] ?? "?")} budgeted`);
  const quotaLeft = Number(scan?.["quota_remaining_before"] ?? -1);
  if (quotaLeft >= 0) {
    lines.push(
      `  quota      ${quotaLeft} GitHub calls were available` +
      (scan?.["quota_resets_in_minutes"] != null
        ? `, resetting in about ${String(scan["quota_resets_in_minutes"])} min`
        : ""),
    );
    if (scan?.["budget_capped_by_quota"] === true) {
      lines.push("             this run was cut to fit that, which is why some projects");
      lines.push("             were not examined. Set GITHUB_TOKEN to raise the limit to 5000.");
    }
  }
  const exclusions = (scan?.["exclusions"] as Record<string, number> | undefined) ?? {};
  const ex = Object.entries(exclusions).filter(([, n]) => Number(n) > 0);
  if (ex.length) lines.push(`  excluded   ${ex.map(([k, v]) => `${v} ${k}`).join(", ")}`);
  lines.push(`  resume     ${mentionsAvailable
    ? `read with ${String(mentions?.["method"] ?? "?")}, then discarded`
    : "could not be read, so 'on resume' shows unknown"}`);
  if (!mentionsAvailable && mentions?.["warning"]) {
    lines.push(`             ${String(mentions["warning"])}`);
  }
  if (roleParam && !roleKnown) {
    lines.push(`  role       "${roleParam}" is not a known track; ranked by evidence instead`);
  }
  if (scan?.["warning"]) lines.push(`  note       ${String(scan["warning"])}`);
  if (scan?.["output_trimmed"]) lines.push("  note       output trimmed to fit the step limit");

  out.human(lines.join("\n"));
  out.summary(`Project shortlist: ${verdictLine}`);
  out.result({
    run_id: ctx.run.run_id,
    mode,
    verdict: verdictLine,
    role: { requested: roleParam || null, resolved: roleResolved || null, recognised: roleKnown },
    shortlist: include.map((e, i) => ({
      rank: i + 1, name: e.name, verdict: e.verdict, score: e.score,
      category: e.p["category"], on_resume: e.onResume,
      homepage: e.p["homepage"] || null, url: e.p["url"], role_match: e.fit,
    })),
    listed_but_weak: listedButWeak.map((e) => ({ name: e.name, verdict: e.verdict, flags: e.p["flags"] })),
    not_strong_enough: otherDemote.map((e) => ({ name: e.name, verdict: e.verdict, flags: e.p["flags"] })),
    not_examined: unexamined.map((e) => e.name),
    exclusions,
    api_calls: scan?.["api_calls"] ?? null,
    resume_read: mentionsAvailable,
  });
}
