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

---

## 9. Demo mode, and why it was the highest-leverage thing left

The judging criteria as the organisers stated them: does it run, can a stranger understand
it, do people adopt it once published. The first was solved. The other two were both
blocked by the same thing: **the first run asked too much.**

A stranger scrolling Discord had to find their resume, work out its path, and handle WSL
translation before seeing a single line of output. That converts interest into "later",
and later never arrives.

The registry agrees. Downloads at the time:

| Play | Downloads | Setup required |
|---|---|---|
| `dotisacat/agent-resource-audit` | 12 | none, zero parameters |
| `lgoyal6/claim-evidence-audit` | 3 | a document path |
| `andrew-kevin-007/resume-drift` | 1 | two required parameters |

The most-downloaded play in the registry takes no arguments at all. Two other authors had
already reached the same conclusion independently: `satianurag/repo-fire-check` led its
Discord post with `demo=true`, and `cmdr-chara/documentation-contract-referee` added a
`demo=stale` fixture in v0.2.0.

**What demo mode does.** `demo=true` runs against a sample resume bundled with the play and
a real public GitHub account, with the baseline pinned. Both required parameters became
optional. Every demo run says, in the first three lines, that it is a demo and how to point
it at your own data.

One detail that matters: a bundled file's modification time is its *install* time, so
without a pinned baseline the sample resume always looks current and the demo produces an
empty, pointless report. The pin is stated in the output rather than hidden.

### A third instance of the same bug class

Testing demo mode at exactly the moment the GitHub quota hit zero exposed the most
interesting bug of the session. `GRE-API-APP` came back **WEAK, "no README"**. It had scored
**STRONG, 16** an hour earlier. Nothing about the repository had changed.

The README fetch had been refused by the rate limiter, and the code recorded that refusal as
*evidence the README does not exist*.

This is the third appearance of one failure mode in this project:

1. `pdftotext` succeeding on a scanned PDF, empty text read as "your resume mentions none of
   these projects".
2. A truncated 65 KB payload parsing as null, read as "this account has no repositories".
3. A rate-limited fetch, read as "this project has no README".

In every case the code could not look, and reported what it would have reported had it
looked and found nothing. None of the three crashed. All three produced confident,
well-formatted, completely wrong output, which is the only failure mode that actually
matters in a tool people are meant to trust.

Fixed the same way each time: separate "could not look" from "looked and found nothing", and
give the former its own visible state. A project whose evidence could not be read now
returns NOT EXAMINED and is excluded from the verdict entirely.

A related fix in the same pass: when GitHub cannot be read at all, the NEXT section used to
advise "ship more before applying". That is advice about projects, offered by a run that
read no projects. It now says the rate limit blocked the run and that no conclusion about
the projects is implied.

---

## 10. Reconsidering the whole direction, and Play 3 — `clone-ready`

Kevin, unprompted, questioned the premise of both existing plays: "i dont think a common
user will actually use this... there is a difference between an idea and AN IDEA." He is
right, and the diagnosis is frequency. A resume is touched 2-4 times a year. Both plays
also hit a real ceiling: the unauthenticated GitHub API allows 60 requests/hour, which caps
how many times a stranger can even run them.

**A registry reality check changed the strategy.** `dotisacat/playoffs-standings` (a play
that ranks the live registry by downloads) showed 816 plays and 163 owners, with the real
non-organiser leaders at 72-93 downloads (`sidships/headhunter`, `mahesh/tech-debt`) against
our 1-2. Both leaders share two properties ours lacked: no rate-limit ceiling (pure local
git/filesystem), and accumulating state that makes each run more valuable than the last.
Also observed: one account (`ankurrawat`) published 500+ plays in a single minute, each
sitting at 1-9 downloads - flooding the registry demonstrably does not buy adoption, which
is reassuring evidence the leaders' numbers are real.

**A dedicated judge panel on a fourth play concept was run and it failed, informatively.**
Proposed a weekly git-based work-log ("ship-log") to fix the frequency problem directly.
Adversarial review scored it 4.5/10, surviving 0 of 3 attacks. The load-bearing finding:
*"the recurrence thesis is unobservable before the deadline and self-defeating after it: a
weekly-cadence Play published Saturday gets exactly one run per user before judging."*
Recurrence is a real product property; it does not help win a hackathon judged in 30 hours.
Two more findings: the proposal's own headline metric (`git describe --contains`) did not
compute what it claimed to, and the time estimate omitted the exact activity that made both
existing plays good - iterating against real, messy data.

**Kevin's own reframe won.** He asked: what if it recognises the repo you just cloned and
gets it running - no more `npm install`, wrong directory, missing env var, guessing which
package manager. This lands directly on the organisers' own language ("the shortcut that
saves ten minutes... the routine task that finally stops hurting") and beats every earlier
proposal on the property that mattered: clone frequency is far higher than resume frequency,
it needs zero network calls (no rate limit, ever), and a dozen real cloned repos were
already sitting on disk as test data before a line of code was written - directly answering
the panel's "iterate against real data" objection.

**What it does.** Reads a cloned repository on disk and returns the exact install/run
sequence, plus a short list of things that would have bitten a stranger. Deliberately the
shortest report of the three plays: the job is "what do I paste," not an audit, and per
explicit instruction the whole design leans toward calm, low-cortisol language over the
denser evidence-table style of the other two.

**Real bugs the local test sweep caught, each on an actual cloned repo already on disk:**

1. **A fabricated justification.** The lockfile-choice message originally claimed "chosen
   because it is the newest lockfile" while the code actually picked by a fixed priority
   list and never checked a single mtime - the exact species of dishonesty every other fix
   in this project exists to prevent. Fixed to check real mtimes (or a real `packageManager`
   field) and state whichever one actually decided it.
2. **A 20.3-second run on a directory that was not a project at all.** Pointing `root=` at
   a large personal folder (Documents) took 20s against a 30s step timeout, dangerously
   close to failing outright. Root cause: the source-scanner's file cap only incremented on
   files matching known source extensions, so a folder full of non-code files could be
   walked indefinitely without ever tripping the bound. Fixed with a second, unconditional
   cap on every file visited regardless of extension, plus skipping the scan entirely when
   no `.env.example` exists to diff against (its result is discarded in that case anyway,
   so running it was pure waste). Confirmed fix: 20.3s to 0.37s on the same input.
3. **A missed monorepo shape**, found on a real repo (`Attendancetracker`) with a
   `docker-compose.yml` building `backend/` and `frontend/` from local Dockerfiles. A
   root-only scan reported nothing to install, which was false - both services had real
   manifests one directory down. Fixed by parsing compose `context:` paths and re-running
   the same ecosystem scan scoped to each one.
4. **A miscount surfaced by the same repo**: the headline read "3 services" when only 2
   were runnable; a stray venv-only, no-manifest finding at the repo root was being counted
   as a third service. Separated "how many services are runnable" from "how many locations
   produced any finding at all," and moved the stray finding out of the copy-paste block
   entirely into the bitten-you list, where it belongs.
5. **A blind spot in the env-var scanner**: Rust source was not scanned at all
   (`std::env::var`), so a Rust project with `.env`/`.env.example` both present looked
   "fully verified" when undeclared-var detection had never actually run against it. Added
   `.rs` plus `env::var`/`os.Getenv`/`ENV[]` patterns for Rust, Go and Ruby.

**Demo fixture is a static bundled directory, not a runtime-constructed one** (unlike the
other two plays' approach) - simpler, avoids declaring any write effect for the demo path,
and deterministic by construction. One small fixture intentionally exercises three findings
at once: a genuine lockfile conflict (two lockfiles present, real mtime difference), one env
var read in source but missing from `.env.example`, and a Postgres service declared in
`docker-compose.yml`.

**State:** published, public, quality score 1.00, validate and lint passing, verified
running from its public URI. Real test sweep covered seven actual cloned repositories
already on disk (Next.js single-lockfile, dual-lockfile conflict, Rust with Cargo.toml,
Python with no manifest at all, a nested project root one folder down, and the
Attendancetracker monorepo) plus both failure paths (missing directory, no parameters).

---

## 11. Post-submission testing loop (production-readiness pass)

With all three plays published, ran a continuous, self-paced testing loop rather than
stopping - functionality, performance, and UI/UX, aimed at production readiness rather
than just "clears the judging bar."

**pnpm/npm/yarn workspaces (clone-ready).** A synthetic monorepo test (not backed by
docker-compose, the shape already handled) showed the play reporting "pnpm install" and
then nothing runnable - Turborepo/Nx/pnpm-workspace projects are at least as common as the
docker-compose monorepo case. Fixed by parsing `pnpm-workspace.yaml` or a `package.json`
`workspaces` field and listing each member's run command in that manager's real syntax
(`pnpm --filter`, `yarn workspace`, `npm run --workspace=`).

**A second instance of the "truncated sample reported as the total" bug.** A performance
stress test (6000 real source files, deliberately built past the scanner's own cap) found
clone-ready's env-var list sliced to 15 entries *before* its length was reported, so the
headline always read "15 env vars missing" regardless of the true count (4000, in this
test). Fixed by reporting the true total separately from the displayed sample. Also
surfaced that the scanner's own truncation flag was computed but never shown - added a
DETAILS note.

**Invalid GITHUB_TOKEN (HTTP 401).** Tested with a deliberately bad token. resume-drift
gave only a bare HTTP code; project-shortlist was worse, since a 401 was not distinguished
from "the account listing failed" and fell through to "check the handle," which is
actively wrong - the handle was fine, the token was not. Both now name the real, common
cause and the fix (unset or replace the token) directly.

**Every documented resume format, tested end to end** (.doc, .rtf, .pages, a corrupted
.docx) surfaced a message-accuracy bug shared by both plays: the "too few characters
recovered" warning was hardcoded to scanned-PDF/OCR language regardless of which extractor
actually ran, which is nonsensical advice for a short .rtf or .txt file. Fixed to branch on
the actual extractor. Also confirmed, and recorded rather than fixed given the time budget:
.rtf has no real parser and is read as raw plaintext, so genuine RTF control-word markup
becomes part of the matched text - verified this does not break real matches (project
names in real RTF prose were still found correctly), with the residual risk being a
low-probability false positive against a repository coincidentally named after an RTF
control word.

**Cross-play audits that found nothing** (worth recording as evidence the earlier fixes
generalised, not just a clean bill of health): systematically grepped both other plays for
the same "slice before counting" pattern that caused the clone-ready bug above - both
already computed truncation flags before slicing and disclosed samples honestly. Tested
both plays against a real low-repo-count account (octocat) - clean "in sync" / "nothing
scores high enough" rendering, no crashes.

**Cosmetic consistency**, cheap and previously unnoticed: three plays had picked three
different DETAILS rule-line widths (60, 64, 70 characters) with no functional reason,
and clone-ready's demo banner read slightly differently from the other two. Standardised.

**Go got a run command, but only with real evidence.** clone-ready suggested `cargo run`
for Rust but nothing for Go, an inconsistency found while building a real Go fixture. The
naive fix (`go run .` unconditionally) would have repeated the exact mistake being fixed
everywhere else today: a large share of real Go repositories are libraries with no main
package, and `go run .` fails outright on those. Added a real check - a top-level .go file
whose contents start with `package main` - before ever suggesting it.

**The most valuable finding of the day came from testing the PUBLISHED plays, not local
files.** A live-URI verification sweep - `rote play run https://play.modiqo.ai/... demo=true`,
exactly the command in every README - crashed clone-ready outright: "no such directory:
/tmp/pnpm-mono", a root= value left sticky from a synthetic fixture built several
iterations earlier and long since gone. The bug: `if demo_flag and not raw` only used the
bundled fixture when root happened to be empty, so a stale non-empty root silently beat
demo=true instead of the other way around. resume-drift and project-shortlist's own
resume_path handling already had this right (demo wins unconditionally); clone-ready did
not.

Auditing for the same shape elsewhere found it again, in both remaining plays: github_user
had the identical bug in resume-drift's fetch_repos.py and project-shortlist's
scan_and_score.py. Reproduced concretely - set github_user=octocat, then run demo=true
alone - and both plays silently kept running against octocat instead of the documented
demo account. Not a crash this time, which is precisely what made it easy to miss: a
demo that quietly shows the wrong account still looks like it worked. Fixed identically in
all three places; grepped all three plays for any remaining instance of the pattern and
found none.

**Lesson worth keeping**: testing against a play's own public URI, with only the exact
parameters a README documents, catches a category of bug that testing local files with
every parameter explicitly set cannot - because explicitly setting every parameter on
every test run is exactly what prevents platform's parameter-memory quirk from ever
mattering during testing.
