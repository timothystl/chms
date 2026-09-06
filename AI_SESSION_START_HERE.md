# AI Session Start Here — Timothy Digital Overhaul

Checkpoint verified: September 6, 2026, 11:21 a.m. UTC (~6:21 a.m. CDT)
Purpose: resume the work without repeating the repository and architecture survey

## Mandatory context rule

Read this file first and treat it as the operational checkpoint.

Do **not** begin by reading every Markdown file, surveying all repositories, rebuilding the architecture map, or summarizing the prior conversation. Those tasks are already complete. The files under `architecture/` (repo root — **not** `outputs/architecture/`; that prefix was a stale local-scratchpad path from an earlier session and does not exist in the repository) are reference material to open only when the current task requires a specific section.

At the beginning of a new session, run only the delta checks in "Allowed startup delta check" below. If they do not reveal a material change, accept this checkpoint and proceed with the single bounded task. If something changed, report only the delta; do not restart the survey.

## ⚠ Repository automation you must know before touching git in `chms`

`.github/workflows/auto-merge-claude.yml` auto-merges **any push to a `claude/**` branch straight into `main`, with no PR review step**. `.github/workflows/deploy.yml` deploys the live Cloudflare Worker on every push to `main` (and on manual `workflow_dispatch`) — it does **not** trigger on pull-request events.

Consequence: in this repository, pushing to a `claude/**` branch is never a safe "just commit it" action — it is a production deployment, whatever the content. If a task's safety constraints forbid deploying without separate approval (as Preparation 1B's did), do not push to a `claude/**` branch during that task. Write files locally and say so explicitly; let a human decide when to push.

## Settled architecture decisions

1. Timothy has four staff products: Church Website, Connect, Finance, and myMDO.
2. Finance is a separate operational function and is intended to become `finance.timothystl.org`; separation begins inside the existing `chms` repository before any repository or database split.
3. Connect owns people, Giving, communications, volunteers, scheduling, facilities, governance, and restricted church HR.
4. myMDO remains the complete MDO product, including its own visual design and narrow website controls. A separate MDO HR application is not planned.
5. The Church Website editor remains the staff surface for church pages and newsletters. MDO editing should not be bolted into it as generic church pages.
6. Shared staff identity is a later objective; permissions and product ownership remain separate.
7. Serve may keep a separate public hostname without becoming a separate staff application or repository.
8. Do not split repositories merely to make the diagram tidy. Separate deployment/data boundaries only when ownership, security, load, or failure isolation justifies them.

## Verified repository checkpoint

| Repository | Local state | Remote state | Meaning |
|---|---|---|---|
| `website` | branch `claude/prep-1a-setup-1eovrx` at `7029f3c`, clean | matches — no local-only work | Unchanged since the prior checkpoint |
| `chms` | branch `claude/prep-1a-setup-1eovrx` at `e37f345`, clean except one **new, uncommitted, unpushed** evidence file | `origin/main` also at `e37f345` — local was fast-forwarded to it this session | The `outputs/architecture/` reference material referenced by the prior checkpoint was pushed to `origin/main` by the user (as commit `e37f345`, "Add files via upload") and is now present locally at `architecture/` (root-relative, no `outputs/` prefix) after a clean fast-forward merge |
| `childcare-portal` | **does not exist in this environment** | — | This session's filesystem has no `work/childcare-portal` or any `*childcare*` path anywhere. This is a discrepancy from the prior checkpoint's three-repo layout, not yet explained — flag it rather than assume it's equivalent to `myMDO`/`childcare-portal` being the same thing under a different name, since that hasn't been verified |

PR #828 (Finance/Giving hardening) is still merged as `3d37ac7`, unchanged. Two further deploys have gone live on top of it since the prior checkpoint — one real feature (Chart of Accounts board categories, `e7f4604`) and one documentation-only push (`e37f345`, the architecture folder). See the Preparation 1B evidence record for the full correlation.

## Allowed startup delta check

Run only:

```bash
git -C chms fetch --prune origin
git -C chms status --short --branch
git -C chms rev-list --left-right --count HEAD...origin/main
git -C chms merge-base --is-ancestor 2b4e22f HEAD && echo "2b4e22f still reachable"
git -C chms log origin/main -5 --oneline
```

If `2b4e22f` is no longer reachable, stop and explain the discrepancy. Otherwise, do not run a broad file or documentation inventory.

## Completed since the prior checkpoint

- Preparation 1A's evidence record was read and its checkpoint claims verified against the current local/remote state (no material change to the PR #828 finding).
- The `architecture/` reference material, which the prior checkpoint referenced but which was absent from the local `chms` clone, was located on GitHub, confirmed to have just been pushed to `origin/main` by the user, and fast-forwarded into the local clone. No conflicts, no history rewrite.
- **Preparation 1B (deployment identity + stabilization snapshot) is complete.** Evidence record: `architecture/evidence/2026-09-06-preparation-1b-deployment-identity-snapshot.md`. Key findings:
  - Active deployment (`tlc-chms`, `DEPLOY_VERSION 1.230.0`) correlated to GitHub Actions run #884 (commit `e37f345`) with a tight timestamp match.
  - Production D1 re-checked: no stuck rollup claim, migrations ledger still only records `0001`–`0003`, the giving-dedup marker and `schema_fingerprint` are on record with literal values for the first time.
  - Worker log inspection and platform-level D1 usage analytics (rows read/written, top SQL) **could not be obtained from this session's tool surface** — no log-tailing/observability or Analytics API tool was available. This remains open pending dashboard access or an additional tool.
  - The 24–48h stabilization observation is underway (~11–12 hours elapsed as of the snapshot), not newly started, not yet complete. The 7-day baseline has not begun.
  - The `auto-merge-claude.yml` hazard documented above was discovered during this task. Because of it, nothing was committed or pushed this session — the evidence record and this checkpoint update exist only in the local working tree.

## Next single bounded task

Not yet assigned. Candidates, in order of what the prior sessions' own exit assessments called for:

1. **Decide how to land the Preparation 1B evidence record and this checkpoint file in git**, given the auto-merge hazard above — a human decision, not an autonomous one, because merging will trigger a (docs-only) production deploy.
2. **Close the Worker-log and D1-analytics gaps** — needs either a human with signed-in Cloudflare dashboard access (as Preparation 1A's D1 evidence required), or a session with a Cloudflare Logs/Analytics-capable tool.
3. **Re-run the stabilization snapshot** once ~24h and again ~48h have elapsed since the last code-changing deploy (`e7f4604`, live 2026-09-06T00:04:46Z), to actually observe the window rather than only measure elapsed time against it.
4. Do not begin Finance extraction, schema changes, or repository restructuring until the 7-day baseline is declared complete and a separate session is explicitly bounded for it.

## Context and token guardrails

- Do not read all historical repository documents.
- Do not regenerate the application inventory, architecture plan, or documentation inventory.
- Do not summarize whole repositories.
- Open at most one architecture reference initially: `architecture/11-overhaul-readiness-and-execution-plan.md`, and only the Preparation section relevant to the task at hand.
- If a task expands beyond its stated bound, stop and ask for a separately bounded session.
- End the session with a compact checkpoint and update this file's repository snapshot if Git state changed.

## Safety constraints still in force

- No production deployment, migration, Cloudflare/Supabase configuration change, authentication change, repository rename, data move, or documentation deletion without separate approval.
- **In this repository specifically**: pushing to a `claude/**` branch is itself a production-deployment action (see the automation warning above). Treat it accordingly.
- Do not reset, rebase, or overwrite any existing checkout.
- Preserve user changes and use disposable worktrees for verification.
- Baseline measurement begins only after the final approved stabilization deployment and a 24–48 hour stability check.

## Reference documents (open only as needed)

- Master phased plan: `architecture/11-overhaul-readiness-and-execution-plan.md`
- Current deployment map: `architecture/01-current-state.md`
- Target boundaries: `architecture/02-target-architecture.md`
- Backup/restore requirements: `architecture/05-operations-backup-recovery.md`
- Documentation disposition: `architecture/09-repository-documentation-reset.md`
- Preparation 1A evidence: `architecture/evidence/2026-09-05-preparation-1a-finance-verification.md`
- Preparation 1B evidence: `architecture/evidence/2026-09-06-preparation-1b-deployment-identity-snapshot.md`

This checkpoint is authoritative for session startup. The larger architecture package is background reference, not required reading.
