# project-shortlist

**Which of your projects actually deserve a place on your resume, and what should the
bullets say?**

`resume-drift` tells you what is missing. This one answers the harder question, because
"missing" and "worth adding" are not the same thing. A project can be absent from your
resume and still not belong there.

```
rote play run andrew-kevin-007/project-shortlist github_user=<you> resume_path=~/Documents/resume.pdf role=backend
```

```
PROJECT SHORTLIST

  ▸ 8 projects earn a place on your resume
    github  <you> · 28 projects · 11 examined in depth

PUT THESE IN YOUR RESUME                    ranked for fullstack
  #   project                 verdict  score  category              on resume
  1   Talos                   STRONG   18     Web app               NO
      1 star · 531 KB of code · worked on across 259 days
  2   GRE-API-APP             STRONG   16     Web app (deployed)    NO
      homepage is set · 3502 KB of code · worked on across 10 days
  4   EIDEN                   STRONG   15     Web app               yes

ON YOUR RESUME BUT THE EVIDENCE IS THIN
  <name>                  WEAK    no README: a reader cannot tell what it does
  Being listed already is not evidence of being worth listing.

NOT STRONG ENOUGH YET
  Studio                  WEAK    no description; no README
```

## It judges what is already on your resume

This is the point. Most tools diff your resume against your repos and stop. A project keeps
its place on the page simply because it is already there, and a one day scaffold with no
README sits next to a year of real work.

Here, everything faces the same rubric. If something on your resume comes back WEAK, it is
named, with the reason.

## The score is printed, not generated

Every verdict is a sum of named signals, and each signal shows the evidence that earned it.
You can recompute the total by hand and argue with any single line of it.

```
deployed +3 · tests +3 · sustained work +3 · attention +1..3 · README +2
documented usage +2 · CI +2 · substance +1..2 · description, topics, licence +1
STRONG >= 12 · SOLID >= 7 · WEAK >= 4 · OMIT below that
a one-day scaffold or a missing README caps a project below SOLID
```

There is no model-derived number anywhere in this Play. A Play is a deterministic step DAG
and cannot call a language model, which is exactly why the verdict is reproducible.

## Deep dive: XYZ bullets that refuse to invent

Once you know which projects you want, confirm three or four:

```
rote play run andrew-kevin-007/project-shortlist github_user=<you> \
  resume_path=~/Documents/resume.pdf role=backend deep_dive=Talos,AUCTUS,quorum
```

Each returns an XYZ bullet, accomplished **X**, as measured by **Y**, by doing **Z**, with
every clause traced to something in the repository:

- **X** is the first prose sentence of the README, quoted and cleaned of markdown.
- **Z** is the stack, read from the dependency manifest. Component libraries and type
  packages are filtered out so the frameworks that name the project survive.
- **Y** is the dangerous one. Most personal projects measure nothing, and this is precisely
  where a language model invents "improved performance by 40%". When the repository
  contains no measured outcome, this Play prints:

```
  Y  measured result
     NOT FOUND IN THE REPOSITORY.
     This project measured nothing, so there is no honest Y to print.
     Supply a real number you can defend (users, latency, volume, accuracy),
     or drop the Y clause. Do not invent one: an interviewer will ask.
```

Candidate numbers are read only from prose. A line containing `=` or backticks, or shaped
like a dependency listing, is configuration rather than a claim, so `MAX_LEN=10485760  # 10
MB cap` is never offered as an achievement. A single GitHub star is not offered either;
that star is usually the author.

## It writes in your resume's voice

A generated bullet that reads differently from every other bullet on the page announces
itself. So the Play measures how your resume already writes, and matches it:

- the opening verb, chosen from the verbs your resume actually uses
- whether bullets end with a full stop
- whether the stack appears in parentheses or after "using"
- your bullet glyph
- your median bullet length, which the X clause is trimmed toward

Verbs are drawn from a fixed allowlist, so this measurement cannot echo your resume's
content back out. If it cannot find at least two bullets, it says so and uses a neutral
default rather than pretending.

One deliberate exception: it will not borrow an outcome verb like "Reduced" to open a
clause describing a thing. "Reduced task management and attendance tracking" is not English.
Style is matched only among verbs that can grammatically open the sentence.

Bullets never contain em dashes, including ones that arrive from a README.

## Privacy

Your resume is read inside one step and discarded there. What leaves that step is one
boolean per repository plus a style profile of counts, ratios and allowlisted verbs. No
snippet, no employer, no contact detail, no document text.

## Rate limits

GitHub allows 60 unauthenticated requests an hour, and a naive deep scan of twenty
repositories would exhaust that in a single run. So:

- every project is scored first from metadata already returned by one repository listing
- evidence calls (README plus recursive file tree, two per repository) are spent only on
  the strongest candidates
- `evidence_budget` bounds the spend, defaults to 24, and what went unexamined is named
- on a rate limit it degrades with a labelled warning rather than reporting an empty result
  as a clean one

`GITHUB_TOKEN` is honoured if present and raises the limit to 5000. It is never required.
Private repositories are never counted: the public endpoint does not return them, with or
without a token.

## Parameters

| name | required | description |
|---|---|---|
| `github_user` | yes | GitHub handle. A full profile URL works too. |
| `resume_path` | yes | Resume file, or a folder of resumes. On Windows a `C:\...` path is translated to its WSL form automatically. |
| `role` | no | `fullstack`, `backend`, `frontend`, `ml`, `devops`, `mobile`, `data`. Job titles work too, case-insensitively. |
| `deep_dive` | no | Comma separated repository names to analyse in depth for bullets. |
| `include_forks` | no | `true` to include forks. |
| `evidence_budget` | no | Max API calls this run may spend. Default 24, max 50. |

## Requirements

`python3` (standard library only). `pdftotext` optional, for PDF resumes.
Read only. Writes nothing. No credentials.

## Licence

MIT
