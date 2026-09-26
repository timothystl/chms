# Security

## Trust boundaries

Authentication proves identity; server-side authorization grants capabilities. Navigation hiding
is not a security control. Current roles and the permission matrix are documented in `AGENTS.md`;
high-risk Finance, Giving, HR, compensation, and administration capabilities remain explicit and
audited.

Cloudflare Access protects the entire Finance staging Worker. This is a staging access boundary,
not shared production staff identity and not authorization to connect production data.

Connect also supports a staged shared-staff login exchange. When
`CONNECT_ACCESS_TEAM_DOMAIN` and `CONNECT_ACCESS_AUD` are configured, a request carrying
Cloudflare's `Cf-Access-Jwt-Assertion` can enter through `/admin/access-login` (or the normal
Connect root). Connect independently verifies the token signature, issuer, audience and lifetime,
then maps its lowercased email to an existing, active `app_users` row. It never provisions an
account or derives a role from the Access policy. The resulting `vol_auth` session uses the same
live role/deactivation check as password login, so product authorization and immediate local
revocation remain unchanged.

Before enabling the Access application on a hostname:

- use the Google Workspace identity provider for `@timothystl.org` staff;
- add any non-Workspace operator only through a named email allowlist, never `Everyone`;
- keep the Access session at one hour or less and retain the documented two-step offboarding
  procedure (disable the IdP account and revoke the Access user session);
- populate and verify each authorized Connect account's email before cutover; an unassigned or
  inactive identity receives no Connect session;
- exercise admin, staff, member/volunteer exception, deactivation and password break-glass paths
  in staging before applying the policy to the production hostname.

## Sensitive data

Do not expose credentials, session material, personal records, gifts, payroll/HR data, childcare
data, or payment information. Cross-product APIs return only required fields. New anonymous routes
default to denied until explicitly allowlisted and tested.

Runtime credentials belong in managed Cloudflare secrets or equivalent provider stores. Document
secret names and ownership, never values. `SECRETS.md` is a security-sensitive historical reference
pending controlled replacement; do not copy it into issues or new docs.

GitHub secret-scanning alert #1 is tracked in private CHMS issue #876. Its client-visible Firebase
key requires provider-side API/application restriction and usage verification before the alert can
be resolved or the key rotated. No Git-history rewrite is authorized by that issue.

## Change review

Authentication, permission, migration, credential, public-route, and cross-service changes require
focused negative-path tests and a rollback plan. Production configuration, data, and releases
require explicit approval for the operation.
