# resume-drift

Two Rote Plays for keeping a resume honest about what you have actually built.

| Play | Answers |
|---|---|
| **`resume-drift`** (this README) | What have I shipped that my resume does not know about? |
| **[`project-shortlist`](project-shortlist/)** | Which of my projects actually deserve the space, and what should the bullets say? |

```
rote play run andrew-kevin-007/resume-drift      github_user=<you> resume_path=~/Documents/resume.pdf
rote play run andrew-kevin-007/project-shortlist github_user=<you> resume_path=~/Documents/resume.pdf role=backend
```

`resume-drift` finds the gap. `project-shortlist` decides what belongs in it, judging the
projects already on your resume by the same rubric, and drafts XYZ bullets that match your
resume's existing style without inventing a single number.

See [NOTES.md](NOTES.md) for the build log: design decisions, the bugs found while testing,
and the platform gotchas discovered along the way.

---

**What have you shipped that your resume doesn't know about?**

You ship a project. You push it to GitHub. You deploy it to Vercel. You post about it.
Then you never update your resume — and three months later you're applying for a job with
a document that describes a version of you that stopped existing in June.

`resume-drift` answers one question, in about three seconds:

> Which repositories have I pushed since my resume was last written, and which of those
> does the resume never mention?

```
rote play run <owner>/resume-drift github_user=octocat resume_path=~/Documents/resume.pdf
```

```
RESUME DRIFT

VERDICT  7 project(s) missing from your resume

BASELINE
  resume     Jane_Developer_SWE_20260605.pdf
  dated      2026-06-05  (92 days ago)
  comparing  everything pushed after 2026-06-05
  source     resume file timestamp (proxy)

THE GAP  (ranked for fullstack: keyword overlap, then recency)
  status      pushed      repository                stack         live
  MISSING     2026-09-01  Talos                     TypeScript    —
  weak-match  2026-07-24  Portfolio                 TypeScript    https://example.vercel.app
  MISSING     2026-06-09  Studio                    TypeScript    https://studio.vercel.app
  listed      2026-06-08  AUCTUS                    Python        —

LIVE BUT UNLISTED  (deployed, and the URL appears nowhere in the resume)
  Studio                    https://studio.vercel.app

EXCLUDED  (counted, never silently dropped)
  3     fork
  1     profile README
  18    not pushed since baseline
```

## Why this one is careful

Anything that reads your resume and tells you what's missing is one bad assumption away from
being confidently wrong. So the uncomfortable parts are stated rather than hidden:

- **The baseline is a proxy, and says so.** It uses the resume file's modification time.
  Cloud sync, a copy, or a re-download resets that. Override it with `since=YYYY-MM-DD`.
- **"Could not look" is not "did not find."** Mention detection needs to read the resume.
  PDFs need `pdftotext`; without it every repository comes back **UNKNOWN**, never
  "missing". A tool that reports absence it never checked for is worse than one that admits it.
- **An extractor that succeeds on nothing counts as a failure.** `pdftotext` exits cleanly
  on a scanned or image-only PDF and hands back a page of form feeds. Empty text matches no
  project name, so a naive reading would call *everything* missing while printing that it
  had read your resume. If fewer than 100 alphanumeric characters come back, the run reports
  **UNKNOWN** and tells you the file looks image-only.
- **Ambiguous names are flagged, not asserted.** A repo called `Studio`, `Portfolio` or
  `Core` can match an ordinary sentence in your resume. Those come back as `weak-match`
  for you to verify, not as facts.
- **Nothing is silently dropped.** Forks, archived repos, the profile README and empty
  repos are each excluded *with a printed reason and an exact count*.
- **Ranking is keyword evidence, not a generated score.** Pass `role=` and it prints the
  terms it matched on, so you can disagree with it.

## Privacy

Your resume is a personal document. It is read inside a single step and discarded there.
**Only one boolean per repository leaves that step** — no snippet, no character count, no
phone number, no email address, no document text. Nothing about your resume appears in the
report, the JSON result, or anywhere on disk.

The only network call is one unauthenticated request to the public GitHub API.
`GITHUB_TOKEN` is honoured *if already present* in your environment, purely to raise the
rate limit — it is never required, never requested, and never printed.

**Private repositories are never counted.** `GET /users/{username}/repos` returns public
repositories only, with or without a token, so a private project will not appear in the
gap even if it is the newest thing you shipped. The report states this on every run rather
than letting you infer that your private work was checked.

## Parameters

| name | required | description |
|---|---|---|
| `github_user` | yes | GitHub handle to scan. A full profile URL also works. |
| `resume_path` | yes | Absolute path to a resume file, **or** a folder of resumes (newest non-cover-letter wins). On Windows, a `C:\...` path is translated to its `/mnt/c/...` WSL form automatically. |
| `role` | no | Rank the gap by fit. Tracks: `fullstack`, `backend`, `frontend`, `ml`, `devops`, `mobile`, `data`. Job titles work too and are case-insensitive — `Software Developer`, `SRE`, `Data Scientist`. Anything unrecognised falls back to newest-first and says so. |
| `since` | no | Override the baseline as `YYYY-MM-DD`. Pass an empty `since=` to clear a previous override. |
| `include_forks` | no | `true` to include forked repositories. |

## Supported resume formats

| format | mention detection | needs |
|---|---|---|
| `.md` `.txt` `.tex` | yes | nothing |
| `.docx` | yes | nothing (unzipped with the Python standard library) |
| `.odt` | yes | nothing |
| `.pdf` | yes | `pdftotext` (`apt install poppler-utils` / `brew install poppler`) |
| `.doc` `.rtf` `.pages` | baseline date only | — |

Without an extractor the play still works: it sets the baseline and reports every
repository as `UNKNOWN` rather than guessing.

## Requirements

- `python3` (3.8+, standard library only — nothing is pip-installed)
- `pdftotext`, optional, only for PDF mention detection

Read-only. Writes nothing, anywhere. No credentials.

## Windows

Rote runs under WSL, so paths inside it are Linux paths. You can still paste a Windows path
straight out of Explorer — `C:\Users\you\Documents\Resumes` is translated to
`/mnt/c/Users/you/Documents/Resumes` when that resolves, and the run tells you it did so.
If it does not resolve, the error prints the exact `/mnt/...` path it tried, because WSL
paths are case-sensitive where Windows is not.

## Known limitation

Rote remembers a play's parameters between runs. If you pass `since=` once, it keeps
applying to later runs — the report tells you when an override is in effect and how to
clear it, but be aware of it.

## License

MIT
