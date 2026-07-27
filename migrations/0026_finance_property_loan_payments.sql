-- Adds the two real per-month figures needed to roll the confirmed mortgage balance forward
-- automatically: the actual loan payment (bank reconciliation) and the interest expense
-- (income statement) for that month. Principal paid = loan_payment_cents - interest_expense_cents,
-- computed on read (finComputeMortgageRemainingCents), not stored redundantly.
ALTER TABLE finance_property_monthly ADD COLUMN loan_payment_cents INTEGER;
ALTER TABLE finance_property_monthly ADD COLUMN interest_expense_cents INTEGER;
