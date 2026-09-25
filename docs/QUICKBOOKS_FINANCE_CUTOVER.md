# QuickBooks: moving the connection from Connect to Finance

Decision (Andrew, September 25, 2026): Finance owns the QuickBooks connection.

Status: steps 1–4 were completed September 25, 2026, and both switches are set to `"1"` (step 5).

## Design

- Finance's handlers are in `apps/finance/quickbooks-oauth-routes.js`, and its sync writes Finance's database only:
  - `finance_qb_connection`, `finance_qb_snapshot` and `finance_qb_oauth_state` (migration `0008`, applied September 23);
  - `finance_settings` and `finance_church_entries`, which the storage cutover already moved.
- Finance's sync reproduces Connect's `finance/qb/sync` and `finance/qb/sync-years`, including the Church Report rows (source `qbo_sync`). The row-building helpers are copied into `apps/finance/quickbooks-church-sync.js`, and a test checks them against Connect's originals.
- **One refresh-token writer at every moment.** Intuit rotates the refresh token each time it is used, so two services holding one connection would break each other.
  - The cutover never copies Connect's token. Connect is disconnected first, then Finance gets its own token through a fresh consent.
- Two switches, both off by default:

  | Switch | Where | When `"1"` |
  |---|---|---|
  | `FINANCE_QB_ENABLED` | `wrangler.finance.jsonc` | Finance's QuickBooks page gets its controls, and the `/api/v1/qb/*` routes work (admin only). |
  | `QBO_MANAGED_BY_FINANCE` | `wrangler.toml` (Connect) | Every Connect `finance/qb/*` route answers 409 ("managed in Finance"), and Connect's token refresh refuses. Connect's reads of `finance_qb_connection` and `finance_qb_snapshot` go to Finance's database, so legacy screens and the data-status contract show Finance's connection. |

## Steps

1. **Deploy this code with both switches off.** Nothing changes for staff.
2. **Andrew, Intuit developer portal.** In the existing app (the one Connect uses), open Keys & credentials → Production. Add the redirect URI `https://finance.timothystl.org/api/v1/qb/callback`, keeping Connect's URI until step 6.
3. **Andrew, Cloudflare.** Set Finance's Worker secrets. Use the same client ID and secret the Intuit app already has, which are Connect's `QB_CLIENT_ID` / `QB_CLIENT_SECRET`:
   ```
   npx wrangler secret put FINANCE_QB_CLIENT_ID --config wrangler.finance.jsonc
   npx wrangler secret put FINANCE_QB_CLIENT_SECRET --config wrangler.finance.jsonc
   ```
4. **Disconnect Connect.** In legacy Connect, open Finance → Data & Imports → QuickBooks and choose Disconnect. This revokes Connect's token; from this point nothing holds a token.
5. **Flip both switches and release.** Merge the change that sets `QBO_MANAGED_BY_FINANCE = "1"` and `FINANCE_QB_ENABLED: "1"`. Deploy Connect first, then Finance.
6. **Connect Finance.** An admin opens Finance → QuickBooks → Sync status and does the following:
   1. Choose **Connect QuickBooks** and approve the Timothy Lutheran company.
   2. Optionally choose the budget.
   3. Choose **Sync now**.

   Once this works, Connect's old redirect URI can be removed from the Intuit app.
7. **Verify.** Compare a few Church Report totals with QuickBooks for the current year, one prior year and one recent month.
   - The first Finance sync also corrects a column-offset bug in the old Connect sync, which had placed each prior year's and each month's figures on the following year or month. So figures from an earlier Connect sync may change; the new ones should match QuickBooks.

## Rollback

1. Disconnect in Finance, which revokes Finance's token.
2. Set both switches back to `"0"` and deploy Connect.
3. Reconnect QuickBooks from legacy Connect.

Never run both connections at once.

## Later cleanup

After Finance has run stably:
- remove Connect's QuickBooks routes, its `QB_*` secrets, the `qb_oauth_state:*` use of KV, and the legacy UI buttons;
- drop Connect's copies of the `finance_qb_*` tables.
