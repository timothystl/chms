// Mirrors PAYROLL_RPC_FNS in timothystl/website's tlc-admin-worker.js exactly.
// This is a fail-fast local guard, not the real enforcement boundary -- Website's
// own /sb/* proxy checks the same allowlist server-side and is authoritative.
// Keep the two lists in sync by convention (separate repos, no shared import).
export const PAYROLL_RPC_FNS = [
  'payroll_get_staff',
  'payroll_get_period_entries',
  'payroll_get_prior_pto',
  'payroll_get_period_approval',
  'payroll_get_mdo_staff',
  'payroll_get_mdo_hours',
  'payroll_get_mdo_clock_events',
  'payroll_get_mdo_pto',
  'payroll_get_mdo_period_approval',
  'payroll_get_mdo_rate_snapshot',
  'payroll_get_year_totals',
  'payroll_backfill_total',
  'payroll_approve_period',
  'payroll_unapprove_period',
  'payroll_save_hours',
  'payroll_save_staff',
  'payroll_deactivate_staff',
];
