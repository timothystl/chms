# Functional review fixes — September 24, 2026

## F1: Church Report clear-all after storage cutover

Clear-all still requires administrator permission and a confirmed count preview.
It clears the derived QuickBooks snapshot in Connect first, then Church Report
entries in Finance. Each delete checks its confirmed count in the same SQL
statement. It never submits a batch spanning database owners.

There is no transaction spanning both D1 databases. A failure returns the
completed steps and asks the user to reload the preview before confirming the
remaining work. Repeating the original confirmation after a partial clear is
refused. Existing same-count replacement limitations of count-based confirmation
remain; this is not a record-version snapshot. No production data is cleared as
part of deploying or verifying this fix.

## F2: Query attribution across storage routing

The routed handle exposes the request's original attribution counter. Finance
prepares increment that same counter, while Connect prepares are not counted
twice. Named-query limits apply across owners and remain isolated per request.

## Verification and release scope

Regression tests use two independent SQLite databases, including failed deletes,
count changes, fresh confirmation after partial completion, and named-query limits.
The full Connect suite, built-script check, and production Finance validation are
required. These changes run in Connect's compatibility API; Finance calls that
API, so the affected production Worker is Connect. Finance itself has no changed
runtime code in this repair.
