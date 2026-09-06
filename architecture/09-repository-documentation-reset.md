# Repository Documentation Reset

Status: Phase 0 inventory and proposed standard; no source-repository edits authorized  
Inventory captured: September 5, 2026

## Decision

Repository documentation is part of the architecture cleanup. It must be reviewed with the same care as application code because it currently influences future developers and coding agents.

The reset will not simply delete every Markdown file. Each file will be checked against the source code, deployed infrastructure, database schema, and current staff workflow. Useful facts will move into a small canonical documentation set; history and obsolete instructions will leave the active instruction path.

During Phase 0, all existing repository files remain unchanged.

## Inventory summary

| Repository | Markdown files | Approximate lines | Preliminary observation |
|---|---:|---:|---|
| `website` | 19 | 15,238 | `CLAUDE.md` is an 11,304-line mixture of architecture, operational rules, incidents, changes, and completed work. Multiple design handoffs and status files overlap. |
| `chms` | 6 | 15,339 | `CLAUDE.md`, `NOTES.md`, and `PLAN.md` overlap heavily. A tracked `SECRETS.md` requires a dedicated credential review. |
| `childcare-portal` / future `mymdo` | 21 | 12,630 | `CLAUDE.md` is 6,055 lines and mixes durable safety rules with a development diary. The root README appears oriented toward initial installation rather than the current operating system. Several reviews, plans, status files, and manuals may no longer agree. |
| **Total** | **46** | **43,207** | No document is considered authoritative until verified. |

Counts include third-party license Markdown and placeholder files; those are inventory items but are not candidates for content rewriting.

## Preliminary risks

1. **Instruction overload.** Files intended as coding-agent context have grown into multi-thousand-line chronological records. Important current rules can be buried under completed or superseded work.
2. **Conflicting truth.** Architecture, deployment, authentication, data ownership, and feature status are described in more than one place.
3. **Stale setup guidance.** An original setup guide can be technically accurate for a new installation while being wrong for the deployed application.
4. **History presented as instruction.** Incident accounts and completed fixes are useful evidence, but should not sit in the primary instruction file indefinitely.
5. **Open work mixed with completed work.** Plans, status files, notes, and fix lists make it difficult to identify the actual backlog.
6. **Security-document risk.** A file named `SECRETS.md` is tracked in `chms`. Its contents and Git history must be assessed without copying secret values into replacement documentation.
7. **Cross-repository ambiguity.** Website, Connect, Finance, Serve, and myMDO responsibilities are described from the viewpoint of individual repositories rather than the agreed product architecture.
8. **Agent-specific documentation.** Durable project knowledge should not depend on one vendor-specific context filename.

These are preliminary findings from structure and document metadata. Each factual statement inside the documents still requires verification.

## Canonical documentation standard

Each application repository should converge on the following small active set. A file is added only when the repository actually needs it.

| Path | Purpose | Content rule |
|---|---|---|
| `README.md` | Entry point for humans | What the product is, supported environments, safe local setup, test commands, deployment overview, owners, and links to deeper documents. |
| `AGENTS.md` | Durable implementation instructions | Short, current rules for any coding agent: boundaries, commands, validation, generated files, and prohibited actions. No changelog or session diary. |
| `CLAUDE.md` | Optional compatibility pointer | A short pointer to `AGENTS.md` and canonical docs if existing tooling requires this filename. It must not become a second source of truth. |
| `docs/ARCHITECTURE.md` | Repository-specific system design | Components, runtime, routes, bindings, data stores, dependencies, product boundaries, and important data flows. |
| `docs/DATA-OWNERSHIP.md` | Data contracts | Tables/domains owned here, external owners, writers, readers, projections, and retention expectations. |
| `docs/OPERATIONS.md` | Production operations | Environments, deploy process, migrations, monitoring, rollback, backup, and restore links. No credentials. |
| `docs/SECURITY.md` | Security model | Authentication, authorization, sensitive-data classes, secret storage locations by name, incident route, and review expectations. No secret values. |
| `docs/TESTING.md` | Verification | Local, integration, smoke, accessibility, and production-safe validation. |
| `docs/adr/` | Architecture decisions | One immutable record per consequential decision, including context, decision, tradeoffs, date, and status. |
| User manuals | Role-specific operating instructions | Kept only where staff actually use and maintain them; verified against the live application. |

Product-wide architecture stays in this documentation set rather than being copied into every repository. Repository docs link to it or contain only the portion needed to work safely in that repository.

## What does not belong in active canonical documents

- Long chronological implementation diaries
- Completed task lists and version-by-version fix narratives
- Prompts or kickoff notes that have already been implemented
- Credentials, tokens, passwords, private keys, or recoverable secret values
- Unverified claims about production
- Duplicate architecture descriptions
- Temporary design handoff packets after the implemented result is verified
- Backlogs that are not connected to the actual issue-management process
- Statements like “done” without a verifiable release, commit, test, or production check

Git and release history preserve implementation history. Important incidents and decisions should be summarized in ADRs or postmortems, not retained as hidden instructions inside enormous context files.

## File disposition process

Every one of the 46 files receives a row in a review manifest with:

- repository and path;
- intended audience;
- apparent purpose;
- last meaningful update;
- claims that require verification;
- overlap or conflict with other files;
- security sensitivity;
- decision: `retain`, `rewrite`, `merge`, `convert`, `remove`, or `third-party/do not edit`;
- canonical destination;
- reviewer and evidence;
- completion commit and rollback point.

No bulk deletion is allowed. Each disposition must preserve required legal notices, user manuals, operational recovery knowledge, security constraints, and unresolved work.

## Verification method

For each claimed fact, use this evidence order:

1. deployed Cloudflare or Supabase configuration and observed routes;
2. current database schema and migrations;
3. current source code and automated tests;
4. current production-safe behavior checks;
5. Git and release history;
6. existing prose documentation.

When sources disagree, record the disagreement. Do not silently choose the most recent-looking Markdown statement.

## Credential and sensitive-file procedure

`chms/SECRETS.md` requires its own gated review:

1. Determine whether it contains real, historical, example, or reference-only values without reproducing values in logs or reports.
2. Identify every credential's intended owner and proper secret store.
3. Verify production bindings by secret name, not value.
4. Rotate any real or plausibly exposed credential before removing the file.
5. Search the entire Git history and related deployment logs for exposure.
6. Decide whether history rewriting is warranted; this is a separate destructive operation requiring explicit approval and coordination with every clone.
7. Replace the file with credential-management instructions containing names and locations only, if such a document is needed.

Deleting the current file does not remove it from Git history and is not, by itself, remediation.

## Proposed reset sequence

### D0 — Inventory and freeze

- Preserve repository state and capture the 46-file manifest.
- Mark all existing documents as unverified inputs.
- Make no deletions or replacements.

### D1 — Establish verified truth

- Complete infrastructure, data, route, authentication, and ownership inventories.
- Reconcile documentation claims against code and deployed configuration.
- Separate current rules, historical evidence, open work, and obsolete material.

### D2 — Draft canonical replacements

- Draft the new canonical set outside the active source tree.
- Create traceability from every retained fact to its source and from every old file to its proposed disposition.
- Have the responsible product owner review workflows and ownership statements.

### D3 — Security remediation first

- Resolve credential exposure and rotation before any sensitive file is removed.
- Validate authentication and authorization descriptions with the identity plan.

### D4 — Controlled repository-by-repository replacement

- Create a named backup tag or equivalent immutable rollback point.
- Reset one repository at a time.
- Add canonical replacements and remove only approved obsolete files in the same reviewed change.
- Preserve third-party licenses and necessary role manuals.
- Run link checks, command checks, and repository tests.
- Confirm a fresh developer can orient, test, and identify the deployment boundary using only the replacement set.

### D5 — Prevent recurrence

- Set maximum-purpose expectations: `AGENTS.md` and any compatibility `CLAUDE.md` remain short and non-chronological.
- Require ADRs for architecture decisions.
- Put tasks in the chosen issue tracker, not permanent context files.
- Review documentation ownership and freshness at each release or scheduled quarterly review.
- Add an automated broken-link and obvious-secret scan where appropriate.

## Repository-specific starting hypotheses

These are hypotheses to test, not final deletion decisions.

### `website`

- Rewrite `CLAUDE.md` into short durable agent instructions plus canonical links.
- Reconcile `PROJECT-PLAN.md`, `SECURITY-REMEDIATION-PLAN.md`, editor rollout/status files, and design-handoff packets.
- Convert still-relevant architectural decisions and unresolved security work; remove completed prompts and duplicated status narratives from the active tree after verification.
- Preserve the TinyMCE license unchanged.

### `chms`

- Separate Connect and Finance truth even while they temporarily share a repository and Worker.
- Replace overlapping `CLAUDE.md`, `NOTES.md`, and `PLAN.md` responsibilities with canonical docs, ADRs, and a real backlog.
- Review `MOBILE_SCOPE.md` against the current product boundary.
- Treat `SECRETS.md` as a security incident review item, not ordinary documentation cleanup.
- Preserve the TinyMCE license unchanged.

### `childcare-portal` / `mymdo`

- Rewrite the README around the currently operated myMDO product; move one-time provisioning into a verified operations runbook if still needed.
- Extract durable safety, RLS, time-clock, billing, and deployment rules from `CLAUDE.md`.
- Reconcile both code-review documents, live-test checklist, next-steps and feature-plan/status documents against the current schema and deployed app.
- Validate the admin, parent, and staff manuals with their actual users before retaining them.
- Keep the future repository rename separate from the documentation reset so either change can be rolled back independently.

## Exit criteria

The documentation reset is complete only when:

- all 46 source documents have recorded dispositions;
- all retained claims have been verified or clearly labeled as uncertain;
- each product and data domain has one documented owner;
- active instructions contain no chronological development diary;
- active documentation contains no secret values;
- current setup, testing, deployment, backup, and rollback instructions have been exercised;
- internal links pass;
- user manuals have named staff reviewers;
- old paths no longer compete as sources of truth;
- each repository has an explicit rollback point and a reviewed replacement commit.

This work belongs after Phase 0 evidence collection and before major architecture movement. It reduces the chance that a later developer recreates today's coupling by following stale repository instructions.
