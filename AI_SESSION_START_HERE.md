# AI Session Start Here — Timothy Digital Overhaul

Checkpoint verified: September 6, 2026, ~1:50 p.m. UTC (~8:50 a.m. CDT)
Purpose: resume the work without repeating the repository and architecture survey

## Read this file first. Full stop.

Do **not** begin a session on this project by reading every Markdown file, surveying all repositories, rebuilding the architecture map, re-deriving which Preparation step gates what, or summarizing prior conversations. All of that is done. It is done whether you are Claude, a different AI agent, or a human developer sitting down cold — this file is written to be the one thing you read before doing anything else, regardless of who or what you are.

The `architecture/` folder (repo root of `chms` — **not** `outputs/architecture/`, which never existed here) is reference material. Open only the one section named under "Reference documents" below, only when the current task needs it.

**If you skip this file and start re-deriving the plan from scratch, you are the reason this project has stalled before. Don't.**

### What to do, in order, every session

1. Run the five commands under "Allowed startup delta check" below. Nothing else.
2. If they show no material change, accept this checkpoint as true and go straight to "Next single bounded task."
3. If something changed (a new commit on `origin/main` you don't recognize, `2b4e22f` no longer reachable, etc.), read just enough to explain the delta, update this file's tables, and continue. Do not restart the survey.
4. **Before you stop working — whether you finished the task, hit a wall, or are handing off mid-task — you must update this file.** See "The one rule that prevents another stall" below. This is not optional and it is not something to defer to "later."

---

## ⚠ Repository automation you must know before touching git in `chms`

`.github/workflows/auto-merge-claude.yml` auto-merges **any push to a `claude/**` branch straight into `main`, with no PR review step**. `.github/workflows/deploy.yml` deploys the live Cloudflare Worker (`tlc-chms`) on every push to `main` (and on manual `workflow_dispatch`) — it does **not** trigger on pull-request events.

**Consequence: in this repository, pushing to a `claude/**` branch is a production deployment action, full stop — not a "safe, reversible commit."** If a task's safety rules require separate approval before deploying (every Preparation task before Preparation 7's go/no-go does), do not push. Write files locally, say so explicitly, and let a human (Andrew) decide when to push.

**This project's own two evidence pushes since the prior checkpoint were docs-only changes, explicitly authorized by Andrew before pushing, and each was verified green (auto-merge succeeded, deploy succeeded, diff was docs-only) after the fact.** That is the pattern to repeat: draft locally → ask → push only on explicit "yes" → verify green → report back. See "Completed since the prior checkpoint" for the concrete example.

**⚠ This repository is shared by other, unrelated concurrent sessions.** Commits will appear on `origin/main` that have nothing to do with this overhaul project (feature work on scheduler, giving, tuition aid, etc. — this repo's ordinary `CLAUDE.md`/`PLAN.md`/`NOTES.md` backlog, a completely separate body of work from this checkpoint file). Do not assume every new commit on `main` is yours to explain. Check whether a commit's message and files touch `architecture/` before treating it as part of this project's history.

---

## Settled architecture decisions (do not re-litigate)

1. Timothy has four staff products: Church Website, Connect, Finance, and myMDO.
2. Finance is a separate operational function, intended to become `finance.timothystl.org`; separation begins **inside** the existing `chms` repository before any repository or database split.
3. Connect owns people, Giving, communications, volunteers, scheduling, facilities, governance, and restricted church HR.
4. myMDO remains the complete MDO product, including its own visual design and narrow website controls. No separate MDO HR application is planned.
5. The Church Website editor remains the staff surface for church pages and newsletters. MDO editing should not be bolted into it as generic church pages.
6. Shared staff identity is a later objective; permissions and product ownership remain separate for now.
7. Serve may keep a separate public hostname without becoming a separate staff application or repository.
8. Do not split repositories merely to make the diagram tidy. Separate deployment/data boundaries only when ownership, security, load, or failure isolation actually justifies it.

---

## ⚠ THE GATE, STATED PLAINLY (this is the fact that has caused the most confusion — read it twice)

**Preparation 6 ("Draft the documentation reset") is the specific, named gate on beginning Finance extraction.** Not the 7-day baseline. Not Preparation 7. Preparation 6, and only Preparation 6, is what the plan itself names.

Quoted directly from the architecture plan's own "Immediate safety rules," as read and reproduced in `architecture/evidence/2026-09-06-finance-extraction-scoping.md`:

> "Until Preparation Phase 6 is signed off: ... Do not begin the Finance extraction, repository renames, shared-auth rollout, payroll move, or documentation deletion."

Two things this means concretely, so nobody re-derives them incorrectly again:

- **The 7-day baseline (Preparation 2) is waived and closed.** Andrew's own words, on record: *"The seven day window I decided is unnecessary it was just to collect usage data and not needed now."* Waiving Preparation 2 does **not** satisfy Preparation 6 — they are unrelated gates for unrelated purposes. A future session must not treat "the baseline was waived" as "therefore Finance extraction can begin."
- **Preparation 7 (the final Phase 0 go/no-go) is a later, broader gate** that authorizes starting *Implementation 1* — several steps downstream of Finance extraction, not a substitute for Preparation 6.

**Preparation 6 has not been started.** Its scope (from the same evidence file, §8, itself sourced from reading Preparation 6's full text in the plan): review 46 Markdown files (43,207 lines) against actual source/deployed config/schema/staff workflow; give `chms/SECRETS.md` a real credential inventory and rotation plan (not just deletion); draft canonical replacement docs (README, AGENTS, Architecture, Data Ownership, Operations, Security, Testing, ADRs, verified user manuals) **outside** the active repository trees; assign a retain/rewrite/merge/convert/remove disposition to every one of the 46 files; test every documented command and link. This is realistically several bounded sessions on its own.

Preparations 3 (backup/restore), 4 (operational map), and 5 (ownership/permissions/report registry) are also still open. They inform how extraction should be sequenced once it starts, but **none of them is the named blocking gate** — only Preparation 6 is.

---

## Verified repository checkpoint

| Repository | Local state | Remote state | Meaning |
|---|---|---|---|
| `website` | branch `claude/prep-1a-setup-1eovrx` at `7029f3c`, clean, as of the prior checkpoint | not re-verified this session | No known change; re-verify with a fresh `git -C website fetch && git -C website status` if you touch this repo |
| `chms` | branch `claude/prep-1a-setup-1eovrx`, fully in sync with `origin/claude/prep-1a-setup-1eovrx` (clean, no local-only work) | `origin/main` at `1221968570e8185505179b19a33746022bd1437b` | See commit history below |
| `childcare-portal` | **does not exist in this environment** — no `work/childcare-portal` or any `*childcare*` path found anywhere | — | Unresolved discrepancy from an earlier session's three-repo layout. Not yet explained. If you need this repo, say so explicitly and ask whether it should be attached, rather than assuming it is the same thing as `myMDO` under a different name — that has never been verified. |

### `origin/main` commit history (most recent 12, as of this checkpoint)

In order, newest first. **Commits marked (this project)** are the overhaul project's own evidence-file pushes. **Commits marked (unrelated)** are other concurrent sessions' ordinary feature work on this repo's own separate backlog (see `chms/CLAUDE.md`/`PLAN.md`) — not part of this checkpoint's history, listed only so you don't mistake them for gaps or confuse them with this project's own commits.

- `1221968` (this project) — merge commit landing `82103dd`, the Finance-extraction-scoping evidence file (`architecture/evidence/2026-09-06-finance-extraction-scoping.md`)
- `abb2018` / `7b76067` (unrelated) — "Scheduler volunteers can carry a second (e.g. parent) email address," branch `claude/scheduler-multiple-emails-df9e57` — ordinary chms feature work, nothing to do with this project
- `941a060` (this project) — merge commit landing `4529f3a`, the Preparation 1B deployment-identity-snapshot evidence file
- (older commits predate this checkpoint's scope — see the prior checkpoint's evidence records if needed)

If `git log origin/main -12 --oneline` looks materially different from this list (beyond more unrelated commits accumulating on top), something changed that this checkpoint doesn't know about — stop and reconcile before proceeding.

PR #828 (Finance/Giving hardening) remains merged as `3d37ac7`, unchanged since the prior checkpoint.

---

## Allowed startup delta check

Run only this:

```bash
git -C chms fetch --prune origin
git -C chms status --short --branch
git -C chms rev-list --left-right --count HEAD...origin/main
git -C chms merge-base --is-ancestor 2b4e22f HEAD && echo "2b4e22f still reachable"
git -C chms log origin/main -12 --oneline
```

If `2b4e22f` is no longer reachable, stop and explain the discrepancy before doing anything else. Otherwise, compare the last command's output to the commit history listed above. If the only difference is more unrelated commits on top, proceed normally. If something touching `architecture/` or this checkpoint file appears that you don't recognize, read just that commit's diff before continuing — do not run a broad inventory.

---

## Completed since the prior checkpoint

- **Preparation 1B's evidence record and the prior checkpoint update were committed and pushed**, after explicit authorization from Andrew ("Ok you can push it"). Verified: the auto-merge workflow run completed with `conclusion: success`, the dispatched deploy workflow run completed with `conclusion: success`, and `git diff --stat` confirmed the change was docs-only. Landed as merge commit `941a060` (source commit `4529f3a`).
- **A Finance-extraction scoping and readiness document was written, committed, and pushed**, again after explicit authorization. Same verification discipline applied and passed: auto-merge green, deploy green, `git diff --stat` confirmed only the one new evidence file changed. Landed as merge commit `1221968` (source commit `82103dd`). This is `architecture/evidence/2026-09-06-finance-extraction-scoping.md` — it is the document that resolves the Preparation 6 gate question stated above, and it contains the current best answer for what a Finance-extraction-adjacent session should actually do next (see below).
- **This checkpoint file itself has been rewritten** to fix several things that had gone stale or were actively misleading: the repository-state table, the "next task" section (which previously stated an incorrect gate — see the boxed section above), the reference-documents list, and to add the "update before you stop" rule that was missing entirely before.

---

## Next single bounded task

**Begin Preparation 6, scoped to ONE product's documentation at a time.** This is the concrete recommendation from `architecture/evidence/2026-09-06-finance-extraction-scoping.md` §9, and it is the correct next step because Preparation 6 is the actual gate (see above) and it is large enough that it must not be attempted in one unbounded pass.

Concretely, for the next session:

1. Pick **one** of: Website docs, Connect docs, Finance docs, myMDO docs, or cross-cutting docs (`SECRETS.md`, root `README`, `AGENTS` file). Finance docs is the most natural next pick, since it directly informs the extraction work everyone actually wants to get to — but any one of the five is a legitimately bounded starting point.
2. For that one product's slice: identify which of the 46 Markdown files fall under it, check each one's factual claims against actual source/deployed config/schema/current staff workflow, and assign a disposition — retain, rewrite, merge, convert, or remove — to each.
3. Draft the canonical replacement content for that slice **outside the active repository trees** (e.g., under `architecture/` as a new evidence/draft file, not overwriting the live docs yet — that overwrite is itself part of what Preparation 6 gates, and shouldn't happen piecemeal).
4. Write up the result as a new evidence file under `architecture/evidence/`, following the same naming convention as the existing three.
5. **Do not** touch `SECRETS.md`'s actual content, delete any of the 46 files, or begin Finance extraction itself in this same session. Those all wait for Preparation 6 to be fully signed off across all five slices.

Preparation 3 (backup/restore) and Preparation 4 (operational map) can run as separate, parallel bounded sessions alongside Preparation 6 slices — they don't block each other. Preparation 5 (ownership/permissions/report registry, including the Tuition Aid and `chms_config`-key ownership questions raised in the scoping document's §6) should wait until after at least one Preparation 6 slice, since it benefits from that groundwork.

**Do not begin Implementation 1 (safe deployment boundaries) or Implementation 2 (cross-product contracts) until Preparation 6 (all slices), Preparation 7 (formal go/no-go), and ideally 3–5 are done.** This is unchanged from every prior checkpoint and remains the single most important safety rule in this project.

---

## The one rule that prevents another stall

**Before you end this session for any reason — task complete, blocked, out of time, handing off — you must update this file's "Verified repository checkpoint," "Completed since the prior checkpoint," and "Next single bounded task" sections to reflect exactly what you did and what should happen next.** State it as if the next reader has zero memory of this conversation, because they will.

If you cannot commit/push the update yourself (e.g., because doing so would be an unapproved deploy per the automation warning above), still **edit the local file** and say explicitly, in your final message to the user, that the file was updated locally and needs to be committed/pushed. Do not leave this file describing a stale state and rely on the next session's own git-log delta check to catch everything — the delta check only catches git history, not "what was I in the middle of."

This file has gone stale before. That staleness is a large part of why this project has stalled across sessions. Fix it every time, without exception.

---

## Context and token guardrails

- Do not read all historical repository documents.
- Do not regenerate the application inventory, architecture plan, or documentation inventory.
- Do not summarize whole repositories.
- Open at most one architecture reference initially: `architecture/11-overhaul-readiness-and-execution-plan.md`, and only the Preparation section relevant to the task at hand.
- If a task expands beyond its stated bound, stop and ask for a separately bounded session.

## Safety constraints still in force

- No production deployment, migration, Cloudflare/Supabase configuration change, authentication change, repository rename, data move, or documentation deletion without separate approval.
- **In this repository specifically**: pushing to a `claude/**` branch is itself a production-deployment action. Treat it accordingly — draft locally, ask, push only on explicit "yes," verify green afterward.
- Do not reset, rebase, or overwrite any existing checkout.
- Preserve user changes and use disposable worktrees for verification.
- Baseline measurement (if ever resumed) begins only after the final approved stabilization deployment and a 24–48 hour stability check — but note this baseline was waived by Andrew (see the boxed gate section above) and is not currently an active blocker for anything.

## Reference documents (open only as needed)

- Master phased plan: `architecture/11-overhaul-readiness-and-execution-plan.md`
- Current deployment map: `architecture/01-current-state.md`
- Target boundaries: `architecture/02-target-architecture.md`
- Backup/restore requirements: `architecture/05-operations-backup-recovery.md`
- Documentation disposition: `architecture/09-repository-documentation-reset.md`
- Preparation 1A evidence: `architecture/evidence/2026-09-05-preparation-1a-finance-verification.md`
- Preparation 1B evidence: `architecture/evidence/2026-09-06-preparation-1b-deployment-identity-snapshot.md`
- Finance-extraction scoping (⚠ read this one for the gate resolution and the recommended next-session ordering): `architecture/evidence/2026-09-06-finance-extraction-scoping.md`

This checkpoint is authoritative for session startup — for AI agents and human developers alike. The larger architecture package is background reference, not required reading. If this file and the larger architecture package ever disagree, this file wins for "what to do next"; the package wins for "why."
