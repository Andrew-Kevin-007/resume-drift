# Rote Playoffs — working notes

Running log of decisions, findings and gotchas. Kept for documentation and for the
write-up. Newest sections at the bottom.

---

## 1. The event

**Rote Playoffs**, 1–8 September 2026, online, solo entry.
Registration on Luma; communications moved to the Modiqo Discord.

**What a submission is.** You guide an AI agent through one successful run of a task you
actually repeat. Rote "crystallizes" that run into a **Play**: a versioned, inspectable
step-DAG that afterwards runs deterministically. Publishing a Play with **Community**
visibility *is* the submission. No form, no deck. Multiple Plays = multiple submissions.

**Judging.** Three criteria: does it run, can a stranger use it with zero hand-holding,
does it get real adoption. An organiser put it plainly in Discord: *"more useful → more
used"*. Purchased engagement and bot activity disqualify.

**Deadline.** Submissions close Sunday 8pm London (about 00:30 IST Monday).

**Organisers' own bar.** "Build the Play you will still want six months from now, after the
clever prompt is forgotten and the work still needs doing." Strong entries are described as
"small and unglamorous": the shortcut that saves ten minutes, the check that takes too many
clicks.

**Day 3 guidance (the most actionable thing they sent).** Do not restart; instead make the
Play work *on different inputs*. That second run exposes unclear inputs, weak boundaries,
noisy output, and steps that only worked once.

---

## 2. What a Play actually is

Investigated by reading the installed `modiqo/hello` package rather than the marketing copy.

- A Play is `main.ts` carrying a `@rote-frontmatter` YAML block plus a `deps.toml`.
  `manifest.json` is derived from the frontmatter.
- The frontmatter declares a **DAG of steps**. Step kinds available:
  `process.exec`, adapter calls, `adapter.auth.ensure`, and `browser.*`.
- **There is no LLM step type.** A Play cannot call a model. This is the whole point:
  the founder's answer in Discord was that a skill file is prose an LLM must interpret,
  with no guarantee it follows the same path twice, whereas a Play is deterministic.
- The TypeScript body is the **presentation**: it reads completed step outputs and renders.
  Three output modes are contractual and linted: `out.human()`, `out.summary()`,
  `out.result()`.

**Division of labour that falls out of this:** steps gather facts, the presentation decides
and renders. Keeping classification out of the steps avoids argv plumbing and keeps each
step independently useful.

---

## 3. Platform gotchas found the hard way

Worth writing down; several are not documented and cost real time.

| # | Finding | Consequence |
|---|---|---|
| 1 | **Step stdout is capped at 65536 bytes.** | Exceeding it truncates the JSON, which then parses as `null` downstream and reads as "no results" rather than an error. Caused a silent "0 repositories" on a 400-repo account. Fix: filter inside the step, bound output, report the bound. |
| 2 | **`process.exec` runs in `~/.rote/workspaces/dag-<play>-<hash>`**, not your shell cwd. | A relative path default silently scans Rote's own workspace and reports a confident clean result about a tree nobody asked about. Always take an absolute path. |
| 3 | **A throwing presentation discards its entire report.** | Verified: raising an error to signal failure replaced the whole honest report with a stack trace. Branch at the emission point instead; never throw. |
| 4 | **Unsupplied `$param` tokens arrive as the literal string** `"$since"`. | Must be detected and treated as absent, or they become data. |
| 5 | **Rote persists a Play's parameters between runs.** | A `since=` passed once silently governs every later run. Clearing needs an explicit empty `since=`. The report now says when an override is active. |
| 6 | **`valid_values` is enforced case-sensitively, before the Play runs.** | `role=Software Developer` was hard-rejected while `software developer` passed, and the Play cannot normalise case because the rejection happens first. Removed `valid_values` rather than reject a user over capitalisation. |
| 7 | **Missing tool preflight.** An absent binary exits 0 with empty output, and empty output reads as a clean result. | Preflight every dependency. |
| 8 | **Release warns that a personal-handle Play "can be run only by you".** | Overcautious. Verified false by inspecting `dotisacat/agent-resource-audit`, a personal-handle Play doing process work that reports `Ready to run: yes` publicly. Confirmed again by our own publish: `play_run_eligible: true`. |
| 9 | GitHub unauthenticated API is **60 requests/hour**. | The binding constraint on any deep repo analysis. Budget calls, bound them, degrade honestly. |

**Tooling that helps:** `rote play validate`, `rote play lint` (enforces the FlowOutput
contract and literal `stepName("...")` references), and `rote play score` (a static quality
rubric, 7 signals, before publishing).

---

## 4. Environment

Windows 11 host. Rote supports macOS and Linux; **Windows works via WSL** and is listed as
tested, despite an early Discord message saying otherwise.

- Ubuntu 24.04 installed by **manual rootfs import to `D:\WSL\Ubuntu`**, because `wsl --install`
  hit a Store DNS failure and because `C:` only had ~12 GB free at the time.
- Node 18 from apt was too old for Claude Code (needs >= 22). Installed Node 22.14.0 from the
  official tarball into `/usr/local`.
- `uv` installed via `pipx` (Rote's installer requires it).
- `systemd` enabled in `/etc/wsl.conf` so Tulving (recurring Plays) can register timers.
- `poppler-utils` installed for `pdftotext`.

Disk cleanup along the way: 11.85 GB free -> 15.6 GB by clearing the npm cache, Playwright
browser binaries and crash dumps. The largest single item found was a 9.65 GB Claude desktop
VM image (`rootfs.vhdx` + `sessiondata.vhdx`), deliberately left alone as app-managed.

---

## 5. Choosing what to build

Rejected several directions before landing. The rejected ones are recorded because the
reasons still apply.

- **Dev-tooling / repo auditors** — the field converged here hard. By day 1 the Discord
  already had `repo-fire-check`, `documentation-contract-referee`, `pkg-vet` and
  `auth-security-audit`. Most crowded lane, least differentiation.
- **US government data (recall lookup)** — clean APIs, but US-only data for an India-based
  builder in a heavily Indian community. Cannot dogfood it, and much of the audience cannot
  use it.
- **Consumer/novelty ideas** (sky-overhead briefing, grid carbon timing, passport expiry) —
  interesting, but manufactured rather than a task actually repeated.

**Chosen: resume drift.** Kevin's own recurring pain, stated in his words: ships a project,
pushes to GitHub, deploys on Vercel, posts about it, and the resume never gets updated;
worse when maintaining several role-specific versions. Verified against real data before
committing: newest resume dated 2026-06-05, with 11 non-fork repos pushed since. A real
92-day gap.

Checked the registry for prior art. Adjacent but different: `rameshwar/job-resume-match`
(job post vs resume), `lgoyal6/interview-story` (repo to spoken answer),
`lgoyal6/claim-evidence-audit` (are claims already on a CV supported by the repo). Nobody
had built "I shipped things and my resume does not know."

---

## 6. Play 1 — `andrew-kevin-007/resume-drift`

**Question it answers:** which repositories were pushed after my resume was last written,
which of those does the resume never name, and which are deployed but unlinked.

**Design decisions worth keeping:**

- **Privacy by construction.** The resume is read inside `match_mentions` and discarded
  there. Only one boolean per repository leaves that step: no snippet, no contact detail,
  no document text reaches stdout, the report, or the JSON result.
- **The baseline is admitted to be a proxy.** It is the resume file's mtime, which cloud
  sync or a re-download can reset. Overridable with `since=YYYY-MM-DD`, and the report says
  which source it used.
- **"Could not look" is not "did not find."** If no extractor applies, every repository is
  UNKNOWN rather than missing.
- **Ambiguous names are flagged, not asserted.** A repo called `Studio` or `Portfolio` can
  match an ordinary sentence, so those return `weak-match` for the user to verify.
- **Nothing is silently dropped.** Forks, archived repos, the profile README and empty repos
  are excluded with printed reasons and exact counts.
- **Ranking prints its evidence.** `role=` matches keywords and shows which ones matched;
  there is no generated score.

**Bugs caught by an adversarial pre-publication audit** (five review lenses, each finding
then attacked by independent refuters; note the audit was **partial**, most verifiers died
on a session limit, so unverified findings were dropped rather than refuted):

1. **Image-only PDFs produced a confident wrong answer.** `pdftotext` exits 0 on a scanned
   PDF and returns form feeds. The check was `if text is None`, so `""` passed through,
   matched nothing, and marked *every* project missing under a line claiming the resume had
   been read. Fixed: under 100 alphanumeric characters recovered counts as extraction
   failure. This was the single behaviour the Play advertised most loudly.
2. **A false claim about private repositories.** README and the step's own output said
   `GITHUB_TOKEN` would include private repos. `GET /users/{username}/repos` returns public
   repositories only, token or not. Someone setting a token to count private work would have
   been told "IN SYNC" while their private repos were skipped. Fixed in all three places.

**Bugs caught by Kevin running it through the interactive UI** (the value of a real user):

3. **Windows paths were rejected.** `C:\Users\...` does not exist inside WSL. Technically
   correct, practically useless on an officially supported platform. Now translated to
   `/mnt/c/...` when it resolves, and disclosed in the report; when it does not resolve the
   error prints the exact `/mnt` path tried and notes WSL is case-sensitive.
4. **A blank required parameter blamed the wrong input.** With `github_user` empty, the
   failure pointed at the resume. The abort report now names the missing input first.
5. **`role=Software Developer` did nothing.** About 45 job titles now resolve to tracks,
   case-insensitively, and the report shows the resolution.

**Report redesigned for repeat use:** answer in the first three lines, then the list, then
the action; every caveat moved below a rule into `DETAILS`. Nothing honest was removed, it
just stopped being the headline.

**State:** published, public, `quality score 1.00`, validate and lint passing.
`https://play.modiqo.ai/andrew-kevin-007/resume-drift`
Source: `https://github.com/Andrew-Kevin-007/resume-drift`

---

## 7. Play 2 — `project-shortlist` (in progress)

**The gap in Play 1 that prompted it.** Play 1 answers "what is missing". It does not answer
"what *deserves* to be there". A project already on the resume is skipped rather than judged,
so a weak project keeps its place simply because it is already listed.

**What this one does.**

1. Judge **every** project on the same evidence, including the ones already on the resume.
   Explicitly requested: AUCTUS is on the resume and must still face the same scrutiny.
2. Categorise each project (web app, backend/API, ML, CLI, library, learning exercise).
3. Score real-world substance from **measured evidence**, with the rubric printed.
4. Rank for a target role.
5. Emit a **final list of projects that belong in the resume's project section**, and say
   why each excluded one was excluded.
6. On confirmation of 3 or 4 projects, **deep dive** into exactly those for detail, role
   orientation, real-world use and highlights.

**Writing rules for generated bullets (Kevin's, non-negotiable):**
- **No em dashes.**
- **XYZ format**: accomplished X, as measured by Y, by doing Z.
- **No fabrication.** Every clause must trace to something measured in the repository.

**How "no fabrication" is enforced without an LLM.** The Y slot is the dangerous one: most
personal projects have no metric, and this is exactly where a model would invent "improved
performance by 40%". Since a Play cannot call a model, bullets are assembled from measured
facts only, and a missing Y is printed as an explicit gap for the user to fill rather than
guessed. Same discipline as `lgoyal6/claim-evidence-audit`, which prints ABSENT rather than
inventing a finding.

**Rate-limit driven architecture.** GitHub allows 60 unauthenticated requests per hour.

- Cheap pass: score every repository from metadata already returned by the single repos call.
- Evidence pass: README plus full file tree (Git Trees API, recursive, one call) for the top
  candidates only. Two calls per repository, bounded, and the bound is printed.
- Deep dive: richer fetch for only the 3 or 4 confirmed projects.
- On 403, degrade with a labelled warning instead of reporting an empty result as clean.

**Why a separate Play rather than extending Play 1:** it answers a different question, it
keeps a working published Play intact, and each published Play counts as its own submission.

### Built and published

`https://play.modiqo.ai/andrew-kevin-007/project-shortlist` — quality score 1.00, validate
and lint passing, `Ready to run: yes` publicly.

**It immediately earned its existence.** Play 1 reported `Studio` as "missing from your
resume". Play 2 examined it and returned **WEAK: no description, no README**. So the honest
answer was never "add Studio", it was "Studio is not worth adding yet". A pure diff tool
cannot tell those apart. It also surfaced strong projects Play 1 never mentioned, because
Play 1 only looks after the resume date: `GRE-API-APP` (deployed, 3.5 MB), `EIDEN`,
`OrangeResidencySite`, `SkyMood`.

### Quality bugs found by running it, and what they teach

1. **The Y slot was suggesting configuration values as achievements.** The first deep dive
   offered `2.x` (a SQLAlchemy version), `94%` (from a code comment) and `10 MB` (a request
   size cap) as "measured results". Tightened to conservative shapes only, and metrics are
   now read only from prose lines: a line containing `=` or backticks, or shaped like a
   dependency listing, is code and not a claim. **This was the most important fix in the
   Play**: a tool that hands you a config constant and calls it a result is inviting the
   exact fabrication it exists to prevent.
2. **An em dash arrived from the README** and landed in a draft bullet, breaking the one
   formatting rule. Dashes are now converted at bullet assembly, because a dash that arrives
   by accident is still a dash on the page.
3. **`X` was a whole paragraph, truncated mid-word** ("cryptographically v"). Now the first
   sentence, cleaned of markdown, cut on a word boundary.
4. **`Z` listed ten Radix UI primitives instead of the stack.** Root cause was ordering:
   dependencies were capped at 12 *before* ranking, and `package.json` is alphabetical, so
   `@hookform` and `@radix-ui/*` filled the cap and `next`/`react` never survived. Raised the
   pre-rank cap and added a noise list plus a headline list.
5. **A single star was being offered as a metric.** That star is usually the author. Raised
   to 3 stars and 2 forks before a count counts as evidence someone else used the thing.

The pattern across all five: the dangerous failures were never crashes. They were confident,
plausible, well-formatted output that happened to be worthless. That is the failure mode a
resume tool has to be built against.

---

## 8. State at the end of the session

| | |
|---|---|
| `resume-drift@0.1.4` | published, public, score 1.00 |
| `project-shortlist@0.1.0` | published, public, score 1.00 |
| Source repo | `github.com/Andrew-Kevin-007/resume-drift` |
| Local packages | `D:\Luma_Hack\resume-drift\`, `D:\Luma_Hack\project-shortlist\` |

Both count as separate submissions.

**Outstanding:** push the updated README and the `project-shortlist` package to GitHub, and
post in Discord for visibility. Download counts across the whole registry were still in
single digits at this point, so early visibility is worth real points against a criterion
that is explicitly about adoption.
