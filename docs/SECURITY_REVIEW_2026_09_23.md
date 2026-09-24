# Finance authorization repair — September 23, 2026

The repository-wide review found that standalone Finance used broad role names
instead of Connect's configurable permission matrix. Its Giving preview API also
read the server-to-server summary before checking the requesting user's access.

## Changes

- The signed-identity `staff-role-v1` response includes the user's current resolved
  permissions, read from Connect on each request. No user-directory or donor
  records are included.
- Finance sections enforce the corresponding Giving, accounting, budget, or
  compensation permission. Missing/unknown permissions deny access. Member and
  volunteer roles remain excluded; the compensation-only role remains narrow.
- Financial Health, Charts, and Board Packet contain both accounting and Giving
  data, so they require both permissions. A user with only accounting access can
  still use the separate Church, Balance Sheet, Daycare, and Property sections.
- The Giving preview API authenticates and authorizes before requesting a summary.
- Council budget writes and compensation planner reads/writes honor the relevant
  current permission, including revocation. Existing private draft isolation stays.

## Validation and release

Tests cover anonymous preview denial, lower-role denial before any sensitive
report fetch, permission grants/revocations, composite reports, and scoped council
budget writes. Existing report tests now include real permission-shaped contract
fixtures instead of assuming that every staff/council account has broad access.

Deploy Connect before Finance: Connect supplies the new permission-bearing
contract. New Finance deliberately denies non-admin requests from an older
role-only contract. Both releases use the exact tested main commit through the
existing deployment workflows. No accounting or Giving data is modified by this
repair, and disabled native accounting writers remain disabled.

The separate review findings about Church Report clear-all crossing databases
and lost query-attribution metadata remain functional follow-up work; they are
not fixed by this authorization change.
