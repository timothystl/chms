// Field validation shared by Finance-owned form writers (Facilities, HR). Every value arrives as
// form text; each helper trims, checks, and returns the stored form or throws a message meant for
// the person who filled in the form.

export class FormValidationError extends Error {}

const isoDay = (date) => date.toISOString().slice(0, 10);

export function text(value, max, label, { required = false } = {}) {
  const v = String(value ?? '').trim();
  if (required && !v) throw new FormValidationError(`${label} is required.`);
  if (v.length > max) throw new FormValidationError(`${label} is too long (${max} characters at most).`);
  return v;
}

export function oneOf(value, list, label) {
  const v = String(value ?? '').trim();
  if (!list.includes(v)) throw new FormValidationError(`Choose a valid ${label}.`);
  return v;
}

export function month(value, label) {
  const v = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1850 || Number(m[1]) > 2200) {
    throw new FormValidationError(`${label} must be a month like 2026-09.`);
  }
  return v;
}

export function day(value, label) {
  const v = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || isoDay(new Date(`${v}T00:00:00Z`)) !== v) {
    throw new FormValidationError(`${label} must be a date.`);
  }
  return v;
}

export function int(value, min, max, label, { optional = false } = {}) {
  const v = String(value ?? '').trim();
  if (optional && v === '') return null;
  if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
    throw new FormValidationError(`${label} must be a whole number from ${min} to ${max}.`);
  }
  return Number(v);
}

export function parseDollarsToCents(value, label) {
  const v = String(value ?? '').replace(/[$,\s]/g, '');
  if (v === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new FormValidationError(`${label} must be a dollar amount.`);
  const cents = Math.round(Number(v) * 100);
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_00) throw new FormValidationError(`${label} is too large.`);
  return cents;
}

export function optionalId(value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === '0') return null;
  if (!/^\d+$/.test(v)) throw new FormValidationError('Unknown record.');
  return Number(v);
}

