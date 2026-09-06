# Repository Document Inventory

Status: Phase 0 structural triage; dispositions are provisional  
Captured: September 5, 2026

This register accounts for every Markdown file currently found in the three repositories. “Proposed disposition” is a starting hypothesis, not authorization to edit or delete the file. Content claims still require verification under the [Repository Documentation Reset](09-repository-documentation-reset.md).

Disposition meanings:

- **Retain** — preserve in the active tree, usually after validation.
- **Rewrite** — replace with a current canonical document serving the same durable purpose.
- **Merge** — extract verified facts into a canonical document, then remove the duplicate source.
- **Convert** — move unresolved work to the backlog or consequential decisions/incidents to ADRs/postmortems.
- **Remove** — delete from the active tree only after confirming no required information remains.
- **Security gate** — rotate/remediate first; ordinary deletion is insufficient.
- **Do not edit** — third-party or legal material.

## `website`

| Current path | Apparent role | Proposed disposition | Verification focus |
|---|---|---|---|
| `CLAUDE.md` | Agent context, architecture, operational rules, incidents, and implementation diary | Rewrite | Extract only current boundaries, commands, safety rules, and verified architecture. |
| `PROJECT-PLAN.md` | Product and implementation plan | Merge / Convert | Separate completed work, unresolved backlog, and architecture decisions. |
| `SECURITY-REMEDIATION-PLAN.md` | Security review and remediation queue | Merge / Convert | Re-test every unresolved finding; preserve evidence and ownership. |
| `admin/BLOCK-EDITOR-ROLLOUT.md` | Editor rollout plan/status | Convert / Remove | Confirm current editor behavior, rollback needs, and unresolved defects. |
| `admin/REDESIGN-STATUS.md` | Admin redesign status | Convert / Remove | Compare claimed completion with the live admin and source. |
| `admin/vendor/tinymce/license.md` | Third-party license | Do not edit | Confirm package/license retention requirements. |
| `design_handoff_admin_overhaul/FIXES.md` | Design fix list | Convert / Remove | Keep unresolved defects only; verify implemented changes. |
| `design_handoff_admin_overhaul/IMPLEMENTATION-PHASES.md` | Historical implementation plan | Convert / Remove | Extract unresolved work and durable decisions. |
| `design_handoff_admin_overhaul/README.md` | Design handoff | Merge / Remove | Preserve current design rules only if still authoritative. |
| `design_handoff_admin_overhaul/REDESIGN-STATUS.md` | Duplicate redesign status | Remove | Reconcile with admin status and source before removal. |
| `design_handoff_church_calendar/README.md` | Calendar design handoff | Merge / Remove | Verify current event/calendar ownership and remaining gaps. |
| `design_handoff_market_event/KICKOFF_PROMPT.md` | Historical coding prompt | Remove | Confirm no unresolved requirement exists only here. |
| `design_handoff_market_event/README.md` | Market event handoff | Merge / Remove | Verify current Events/Website/Connect boundaries. |
| `design_handoff_market_layout/README-repo-note.md` | Handoff repository note | Remove | Confirm no required operational instruction remains. |
| `design_handoff_market_layout/github.md` | Git/handoff note | Remove | Confirm it is not an active workflow dependency. |
| `design_handoff_market_vendor_signup/README.md` | Vendor signup handoff | Merge / Remove | Verify ownership, payments, and data flow. |
| `design_handoff_news_redesign/CLAUDE_CODE_BRIEF.md` | Historical agent brief | Remove | Preserve unresolved requirements elsewhere. |
| `design_handoff_news_redesign/KICKOFF_PROMPT.md` | Historical coding prompt | Remove | Confirm no unresolved requirement exists only here. |
| `design_handoff_news_redesign/README.md` | News design handoff | Merge / Remove | Verify current Website Admin/newsletter operation. |

## `chms`

| Current path | Apparent role | Proposed disposition | Verification focus |
|---|---|---|---|
| `CLAUDE.md` | Agent rules, architecture, backlog, incidents, and implementation diary | Rewrite | Separate shared Connect/Finance runtime facts and retain only current instructions. |
| `MOBILE_SCOPE.md` | Mobile product scope | Merge / Rewrite | Reconcile with current Connect users, permissions, and supported screens. |
| `NOTES.md` | Version-by-version development record | Convert / Remove | Extract consequential incidents/ADRs; rely on releases for routine history. |
| `PLAN.md` | Security, performance, and feature remediation plan | Convert / Remove | Re-test unresolved items and move real work to the chosen backlog. |
| `SECRETS.md` | Credential/reference material | Security gate | Inspect without disclosure, inventory secret names, rotate exposures, and assess Git history. |
| `vendor/tinymce/license.md` | Third-party license | Do not edit | Confirm package/license retention requirements. |

## `childcare-portal` / future `mymdo`

| Current path | Apparent role | Proposed disposition | Verification focus |
|---|---|---|---|
| `CLAUDE.md` | Agent rules, safety findings, design history, incidents, and implementation diary | Rewrite | Extract current Supabase/RLS, time-clock, billing, deploy, and validation rules. |
| `CONTRIBUTING.md` | Contributor workflow | Rewrite / Retain | Align branch, review, test, migration, and deployment controls with the new standard. |
| `PRIVACY-AND-SECURITY-OVERVIEW.md` | Privacy/security overview | Merge / Rewrite | Verify roles, RLS, sensitive data, retention, incident response, and actual production controls. |
| `README.md` | Initial setup guide | Rewrite | Describe the operated myMDO product; move verified provisioning to Operations. |
| `calendar-selector-reference.md` | UI/component reference | Retain / Merge | Confirm the referenced component and guidance remain in use. |
| `docs/BILLING_MODEL.md` | Billing domain model | Merge / Rewrite | Reconcile with schema, payment provider, reports, and Finance boundaries. |
| `docs/CODE_REVIEW.md` | Historical review findings | Convert / Remove | Re-test open findings; preserve only unresolved issues and consequential incidents. |
| `docs/CODE_REVIEW_2026-08.md` | Later historical review | Convert / Remove | Deduplicate against the earlier review and current state. |
| `docs/LIVE_TEST_CHECKLIST.md` | Production validation checklist | Rewrite / Retain | Separate safe smoke tests from destructive tests and name required roles/environments. |
| `docs/NEXT_STEPS.md` | Backlog/status | Convert / Remove | Verify each item and move open work to the chosen backlog. |
| `docs/PARENT_PORTAL_PLAN.md` | Product plan | Merge / Convert | Compare with the deployed parent portal and retain unresolved approved scope only. |
| `docs/POLICY_SCOPING_PLAN.md` | Policy feature plan | Convert / Remove | Confirm whether approved, implemented, deferred, or obsolete. |
| `docs/PROCARE_FEATURE_ANALYSIS.md` | External-product comparison | Retain as reference / Archive | Date and label as research; do not treat it as current architecture. |
| `docs/STAX_GO_LIVE.md` | Payment go-live runbook | Rewrite / Retain | Verify provider configuration, responsibilities, rollback, reconciliation, and secret handling. |
| `docs/WAITLIST_STATUS.md` | Feature status | Convert / Remove | Compare with live waitlist behavior and current backlog. |
| `docs/admin-manual.md` | Director/admin user manual | Rewrite / Retain | Review with the MDO administrator against the live app. |
| `docs/design_handoff/HANDOFF_NOTE.md` | Historical design note | Remove | Confirm all required instructions exist in the implemented design or canonical docs. |
| `docs/design_handoff/README.md` | Historical design handoff | Merge / Remove | Preserve current design-system rules only if still authoritative. |
| `docs/parent-manual.md` | Parent user manual | Rewrite / Retain | Validate later with representative users when public use begins; mark currently untested. |
| `docs/staff-manual.md` | Staff user manual | Rewrite / Retain | Review with staff who actually clock in and use daily operations. |
| `images/logo/placeholder.md` | Empty-directory placeholder | Remove if unused | Confirm build, packaging, and repository tooling do not require the path. |

## Immediate conclusions

- The active instruction set should become dramatically smaller, but deletion is not yet safe.
- The oversized `CLAUDE.md` files are inputs to the rewrite, not suitable long-term sources of truth.
- `chms/SECRETS.md` is the first security-sensitive documentation item and must follow the credential procedure.
- Manuals require staff validation; technical inspection alone cannot establish that they describe real workflows.
- Third-party licenses are outside the reset and remain untouched.
- Design handoffs, prompts, and completed fix/status documents are strong removal candidates only after requirements and unresolved work are accounted for.

## Next inventory pass

The next pass adds, for every row, the last responsible author/owner, claims requiring verification, conflicting documents, source or production evidence, final disposition, canonical destination, and approval. That pass occurs before any replacement commit.
