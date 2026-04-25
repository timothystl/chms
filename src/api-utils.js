// Shared utilities used across multiple api-*.js modules.

// Disambiguate household display names when multiple households share the same name.
// "Smith Family" + "John" → "John Smith Family"; "Smith" + "John" → "John Smith"
export function disambiguateHHName(name, headFirst) {
  if (!headFirst) return name;
  const m = name.match(/^(.*?)\s*Family\s*$/i);
  return m ? (headFirst + ' ' + m[1].trim() + ' Family') : (headFirst + ' ' + name);
}

// Returns the ISO date string (YYYY-MM-DD) of the Monday of the current UTC week.
export function isoWeekKey() {
  const dayOfWeek = new Date().getUTCDay(); // 0=Sun
  const daysToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const mon = new Date();
  mon.setUTCDate(mon.getUTCDate() + daysToMon);
  return mon.toISOString().slice(0, 10);
}
