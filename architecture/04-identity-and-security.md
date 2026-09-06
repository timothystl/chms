# Identity, Authorization, and Security Boundaries

## Target identity model

Website Admin, Connect, and Finance should use one standards-based church-staff identity provider. Authentication establishes identity; each application independently grants permissions.

Do not build a custom central-authentication Worker unless no suitable provider exists. Candidate selection must consider the church's existing Google or Microsoft accounts, account recovery, MFA, offboarding, auditability, and cost.

## Identities that remain separate

- myMDO parents remain Supabase Auth users.
- MDO staff PIN/kiosk workflows remain task-specific flows.
- Public Website, Give, and Serve visitors do not receive staff identities.
- Machine integrations use scoped service credentials, not staff sessions.

## Permission principles

- Default deny.
- Product access is not granted merely because staff identity exists.
- Finance, payroll, HR, child/family, giving, and payment permissions require explicit grants.
- Website editor, Connect people editor, Connect giving editor, scheduler, facilities, governance, HR, Finance editor, Finance administrator, payroll processor, council read-only, myMDO full administrator, myMDO restricted staff, and parent are distinct roles/capabilities.
- Cross-product APIs expose only required fields.
- Authorization is enforced server-side, not by hiding navigation.
- Every permission-changing action is audited.

## Phase 0 permission matrix template

| Role/persona | Website | Connect People | Giving | Communications | Serve/Scheduler | Facilities | Governance | HR | Finance | Payroll | myMDO |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Website editor | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None | None | None |
| Church office | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None/TBD | TBD | TBD | None |
| Treasurer | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None | TBD | TBD | None |
| Council read-only | TBD | TBD | TBD | TBD | TBD | TBD | TBD | None | TBD | None | None |
| MDO director | None/TBD | None/TBD | None | None/TBD | None | None | None | Limited/TBD | Limited/TBD | Approval input | Full |
| MDO staff | None | None | None | None | None | None | None | None | None | None | Staff workflow |
| Parent/member | Public/member scope only | TBD | Own allowed data only | Preferences | Public only | Public request | None | None | None | None | Own-family scope |

Every `TBD` must be resolved during Phase 0 before shared authentication is implemented.

