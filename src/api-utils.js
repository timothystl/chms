// Shared utilities used across multiple api-*.js modules.
import { json, html } from './auth.js';

// ── Configurable role permissions ─────────────────────────────────────────
// The four flags below (isFinance/isStaff/canRegister/canReports) are the actual
// access-control primitives threaded through the whole ChMS API — handleChmsApi computes
// them once and passes them straight into every domain handler (handleGivingApi,
// handleReportsApi, etc.), so redefining these four from configurable, per-role storage
// (rather than the fixed formulas they used to be) is a single point of truth: every
// downstream consumer automatically respects an admin's changes with no other file
// touched. admin always gets all four regardless of config (never editable, so an admin
// can never lock themselves out); member is a structurally different, filtered read-only
// view handled entirely separately and isn't part of this matrix. canEdit (the fourth
// original flag) is deliberately NOT included here — it's a blanket "not read-only"
// flag (true for every non-member role, always), not a specific feature toggle.
export const ROLE_PERMISSION_KEYS = ['finance', 'staff', 'register', 'reports'];
export const ROLE_PERMISSION_ROLES = ['finance', 'staff', 'office'];
export const DEFAULT_ROLE_PERMISSIONS = {
  finance: { finance: true,  staff: false, register: false, reports: true },
  staff:   { finance: false, staff: true,  register: true,  reports: true },
  office:  { finance: false, staff: false, register: true,  reports: false },
};

// Pure — takes the raw stored JSON string (or null/undefined) and returns the full
// {finance:{...}, staff:{...}, office:{...}} matrix with every role/key defaulted, so a
// partially-edited or missing config can never leave a key silently undefined.
export function resolveRolePermissions(storedJson) {
  let overrides = {};
  if (storedJson) { try { overrides = JSON.parse(storedJson) || {}; } catch { overrides = {}; } }
  const result = {};
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) {
    result[role] = Object.assign({}, DEFAULT_ROLE_PERMISSIONS[role], overrides[role] || {});
  }
  return result;
}

export async function getRolePermissions(db) {
  const row = await db.prepare("SELECT value FROM chms_config WHERE key='role_permissions_json'").first();
  return resolveRolePermissions(row?.value);
}

// The four flags a given role actually gets, folding in admin's always-full-access and
// member's not-applicable status (member permissions are computed elsewhere entirely).
export function permissionsForRole(matrix, role) {
  if (role === 'admin') return { finance: true, staff: true, register: true, reports: true };
  return matrix[role] || { finance: false, staff: false, register: false, reports: false };
}

export function randHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function escLite(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Shared small-card page shell used by unauthenticated, token-driven single-form flows
// (password reset, Connect member invite setup).
export function authCardPage(title, bodyInner) {
  return html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <title>${title} — Connect</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,300&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
    <style>:root{--navy:#1E2D4A;--teal:#2E7EA6;--gold:#C9973A;--cream:#F8F4EE;--muted:#8A8898;}
      *{box-sizing:border-box;margin:0;padding:0;}
      body{font-family:'DM Sans',sans-serif;background:var(--cream);display:flex;align-items:center;justify-content:center;min-height:100vh;}
      .card{background:#fff;border-radius:16px;padding:2.5rem;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(30,45,74,.12);}
      .wm-display{font-family:'Cormorant Garamond',serif;font-style:italic;font-weight:300;font-size:2.6rem;color:var(--navy);text-align:center;margin-bottom:.5rem;}
      .wm-sub{font-size:10px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);text-align:center;margin-bottom:1.75rem;}
      .field{margin-bottom:1rem;} label{display:block;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.2em;color:var(--navy);margin-bottom:.4rem;}
      input{width:100%;padding:.7rem 1rem;border:1.5px solid rgba(30,45,74,.2);border-radius:8px;font-size:.95rem;font-family:inherit;outline:none;}
      input:focus{border-color:var(--teal);}
      .btn{width:100%;background:var(--navy);color:#fff;border:none;padding:.85rem;border-radius:8px;font-size:1rem;font-weight:500;cursor:pointer;margin-top:.5rem;}
      .btn:hover{background:var(--teal);} .btn:disabled{opacity:.6;cursor:wait;}
      .msg{padding:.75rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.9rem;}
      .msg.err{background:#fceae8;color:#c0392b;} .msg.ok{background:#e8f6ed;color:#1d6b3a;}
      a{color:var(--teal);font-size:.85rem;text-decoration:none;} a:hover{text-decoration:underline;}
    </style></head><body><div class="card">${bodyInner}</div></body></html>`);
}

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

// ── CSV GIVING IMPORT HELPERS ─────────────────────────────────────────────────

// Parse Breeze fund strings into per-fund splits.
// Handles:
//   "40085 General Fund"
//   "40085 General Fund (160.00), 49094 Tuition Aid (40.00)"
//   "General Fund: $160.00, Tuition Aid: $40.00"
//   "" or "nan"  → General Fund
export function parseFundSplits(fundStr, totalCents) {
  const s = (fundStr || '').trim();
  if (!s || s.toLowerCase() === 'nan') return [{ name: 'General Fund', cents: totalCents }];
  // Breeze CSV format: starts with numeric fund ID prefix e.g. "40085 General Fund (160.00)"
  if (/^\d+\s/.test(s)) {
    const parts = s.split(/,\s*(?=\d)/);
    const splits = parts.map(p => {
      const m = p.trim().match(/^(.+?)(?:\s+\(([0-9.]+)\))?\s*$/);
      return m ? { name: m[1].trim(), cents: m[2] ? Math.round(parseFloat(m[2]) * 100) : null } : null;
    }).filter(Boolean);
    if (splits.length > 1) return splits.map(f => ({ name: f.name, cents: f.cents ?? 0 }));
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  // Colon format: "General Fund: $160.00, Tuition Aid: $40.00"
  if (/:\s*\$?[0-9]/.test(s)) {
    const parts = s.split(/,\s*(?=\S)/);
    const splits = [];
    for (const p of parts) {
      const m = p.trim().match(/^([^:]+?):\s*\$?([0-9.]+)\s*$/);
      if (m) splits.push({ name: m[1].trim(), cents: Math.round(parseFloat(m[2]) * 100) });
    }
    if (splits.length > 1) return splits;
    if (splits.length === 1) return [{ name: splits[0].name, cents: totalCents }];
  }
  return [{ name: s, cents: totalCents }];
}

// Compute the breeze_id / entry key for a CSV giving row.
//   splitIdx: 0-based index within a parseFundSplits multi-fund single row (-1 if not multi-fund)
//   nthOcc:   how many times this payment ID has appeared in the CSV so far (1-indexed)
export function givingEntryId(pid, nthOcc, splitIdx) {
  if (splitIdx >= 0) return pid + '-' + (splitIdx + 1);  // parseFundSplits multi-fund row
  return nthOcc === 1 ? pid : pid + '-' + nthOcc;         // Breeze per-fund multi-row
}

// Returns true if this giving row is already present in existingIds (dedup check).
export function isGivingDup(pid, nthOcc, existingIds) {
  return nthOcc === 1
    ? (existingIds.has(pid) || existingIds.has(pid + '-1'))
    : existingIds.has(pid + '-' + nthOcc);
}

// ── PHONE NORMALIZATION ───────────────────────────────────────────────────
// Strips formatting and returns (XXX) XXX-XXXX for 10-digit US numbers.
// Returns original string unchanged for international or unusual formats.
export function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    return '(' + digits.slice(1, 4) + ') ' + digits.slice(4, 7) + '-' + digits.slice(7);
  }
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return raw;
}

// ── ADDRESS VALIDATION HELPERS ───────────────────────────────────────────
// Service priority:
//   1. Google Address Validation (GOOGLE_ADDRESS_API_KEY) — no rate-limit ceiling, best for bulk
//   2. USPS OAuth API  (USPS_CLIENT_ID + USPS_CLIENT_SECRET) — new REST API, 60 req/hour cap
//   3. USPS Web Tools  (USPS_USER_ID)                        — legacy XML API
//   4. Lob             (LOB_API_KEY)
//   5. Census Bureau   (free fallback, no key needed)
// All helpers return a plain object: { ok, address1, address2, city, state, zip, zip4, dpvConfirmation, deliverable }
// or { ok: false, error } on failure.

function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Strip HTML tags and normalize whitespace from an address field
function cleanAddrField(s) {
  return (s || '').replace(/<[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}
// Return a copy of addr with HTML stripped from address1/address2
function cleanAddr(addr) {
  return { ...addr, address1: cleanAddrField(addr.address1), address2: cleanAddrField(addr.address2) };
}

// Fetch a USPS OAuth token (call once per bulk operation, share across addresses)
async function getUspsToken(clientId, clientSecret) {
  const tokenRes = await fetch('https://apis.usps.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error('USPS token error: ' + (err.error_description || tokenRes.status));
  }
  const { access_token } = await tokenRes.json();
  return access_token;
}

// New USPS OAuth 2.0 API — accepts a pre-fetched token to avoid re-authing per address
async function validateUspsOAuth(addr, clientId, clientSecret, token) {
  const access_token = token || await getUspsToken(clientId, clientSecret);

  // Step 2: validate address
  const params = new URLSearchParams();
  params.set('streetAddress', (addr.address1 || '').trim());
  if ((addr.address2 || '').trim()) params.set('secondaryAddress', addr.address2.trim());
  if ((addr.city    || '').trim()) params.set('city',  addr.city.trim());
  if ((addr.state   || '').trim()) params.set('state', addr.state.trim());
  if ((addr.zip     || '').trim()) params.set('ZIPCode', addr.zip.replace(/[^0-9]/g, '').slice(0, 5));

  const addrRes = await fetch('https://apis.usps.com/addresses/v3/address?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + access_token },
  });
  if (!addrRes.ok) {
    const err = await addrRes.json().catch(() => ({}));
    const msg = err.apiMessage || err.detail || ('USPS error ' + addrRes.status);
    return { ok: false, error: msg };
  }
  const data = await addrRes.json();
  const addr2 = data.address || {};
  const addInfo = data.additionalInfo || {};
  const dpvMap = { Y: 'Y', S: 'S', D: 'D', N: 'N' };
  const dpv = dpvMap[addInfo.DPVConfirmation] || (data.firm ? 'Y' : 'N');
  return {
    ok: true,
    address1: addr2.streetAddress || (addr.address1 || ''),
    address2: addr2.secondaryAddress || (addr.address2 || ''),
    city: addr2.city || (addr.city || ''),
    state: addr2.state || (addr.state || ''),
    zip: addr2.ZIPCode || (addr.zip || ''),
    zip4: addr2.ZIPPlus4 || '',
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit'
                  : dpv === 'D' ? 'deliverable_incorrect_unit' : 'undeliverable',
  };
}

// Legacy USPS Web Tools XML API (single user ID)
async function validateUspsWebTools(addr, userId) {
  const street = (addr.address1 || '').trim();
  const unit   = (addr.address2 || '').trim();
  const city   = (addr.city    || '').trim();
  const state  = (addr.state   || '').trim();
  const zip    = (addr.zip     || '').replace(/[^0-9]/g, '').slice(0, 5);
  // USPS quirk: Address1 = apt/unit, Address2 = street number + name
  const xml = `<AddressValidateRequest USERID="${escXml(userId)}"><Revision>1</Revision><Address>`
    + `<Address1>${escXml(unit)}</Address1><Address2>${escXml(street)}</Address2>`
    + `<City>${escXml(city)}</City><State>${escXml(state)}</State>`
    + `<Zip5>${zip}</Zip5><Zip4></Zip4></Address></AddressValidateRequest>`;
  const res = await fetch('https://secure.shippingapis.com/ShippingAPI.dll?API=Verify&XML=' + encodeURIComponent(xml));
  if (!res.ok) return { ok: false, error: 'USPS service error ' + res.status };
  const text = await res.text();
  const get = tag => { const m = text.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>')); return m ? m[1] : ''; };
  if (text.includes('<Error>')) return { ok: false, error: get('Description') || 'USPS error' };
  const dpv = get('DPVConfirmation') || 'N';
  return {
    ok: true,
    address1: get('Address2'),  // USPS response: street is Address2
    address2: get('Address1'),  // USPS response: unit is Address1
    city: get('City'), state: get('State'),
    zip: get('Zip5'), zip4: get('Zip4'),
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit'
                  : dpv === 'D' ? 'deliverable_incorrect_unit' : 'undeliverable',
  };
}

async function validateLob(addr, lobKey) {
  const body = { primary_line: (addr.address1 || '').trim() };
  if (addr.address2?.trim()) body.secondary_line = addr.address2.trim();
  if (addr.city?.trim())     body.city = addr.city.trim();
  if (addr.state?.trim())    body.state = addr.state.trim();
  if (addr.zip?.trim())      body.zip_code = addr.zip.replace(/[^0-9]/g, '').slice(0, 5);
  const res = await fetch('https://api.lob.com/v1/us_verifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(lobKey + ':') },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message || ('Lob error ' + res.status) };
  }
  const data = await res.json();
  const c = data.components || {};
  const lobDpv = { deliverable: 'Y', deliverable_unnecessary_unit: 'Y',
                   deliverable_missing_unit: 'S', deliverable_incorrect_unit: 'D', undeliverable: 'N' };
  const dpv = lobDpv[data.deliverability] || 'N';
  return {
    ok: true,
    address1: data.primary_line || '', address2: data.secondary_line || '',
    city: c.city || '', state: c.state || '', zip: c.zip_code || '', zip4: c.zip_code_plus_4 || '',
    dpvConfirmation: dpv, deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: data.deliverability || '',
  };
}

async function validateCensus(addr) {
  const parts = [addr.address1, addr.address2, addr.city, addr.state, addr.zip]
    .map(s => (s || '').trim()).filter(Boolean);
  const res = await fetch(
    'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address='
    + encodeURIComponent(parts.join(', ')) + '&benchmark=2020&format=json'
  );
  if (!res.ok) return { ok: false, error: 'Census geocoding service error ' + res.status };
  const data = await res.json();
  const matches = data?.result?.addressMatches || [];
  if (matches.length === 0) {
    return { ok: true, address1: addr.address1 || '', address2: addr.address2 || '',
             city: addr.city || '', state: addr.state || '', zip: addr.zip || '', zip4: '',
             dpvConfirmation: 'N', deliverable: false, deliverability: 'undeliverable' };
  }
  const match = matches[0];
  const c = match.addressComponents || {};
  const streetMatch = (match.matchedAddress || '').match(/^([^,]+)/);
  return {
    ok: true,
    address1: streetMatch ? streetMatch[1].trim() : (addr.address1 || ''),
    address2: addr.address2 || '',
    city: c.city || addr.city || '', state: c.state || addr.state || '',
    zip: c.zip || addr.zip || '', zip4: '',
    dpvConfirmation: 'Y', deliverable: true, deliverability: 'deliverable', source: 'census',
  };
}

async function validateGoogle(addr, apiKey) {
  const addressLines = [(addr.address1 || '').trim(), (addr.address2 || '').trim()].filter(Boolean);
  const body = {
    address: {
      regionCode: 'US',
      addressLines,
      locality: (addr.city || '').trim() || undefined,
      administrativeArea: (addr.state || '').trim() || undefined,
      postalCode: (addr.zip || '').trim() || undefined,
    },
  };
  const res = await fetch('https://addressvalidation.googleapis.com/v1:validateAddress?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message || ('Google error ' + res.status) };
  }
  const data = await res.json();
  const result = data.result || {};
  const postal = result.address?.postalAddress || {};
  const usps = result.uspsData || {};
  const dpvMap = { CONFIRMED: 'Y', UNCONFIRMED_BUT_MATCHABLE: 'S', UNCONFIRMED: 'N' };
  const dpv = dpvMap[usps.dpvConfirmation] || (result.verdict?.addressComplete ? 'Y' : 'N');
  return {
    ok: true,
    address1: (postal.addressLines || [])[0] || (addr.address1 || ''),
    address2: (postal.addressLines || [])[1] || (addr.address2 || ''),
    city: postal.locality || (addr.city || ''),
    state: postal.administrativeArea || (addr.state || ''),
    zip: (postal.postalCode || (addr.zip || '')).split('-')[0],
    zip4: usps.zipPlus4 || '',
    dpvConfirmation: dpv,
    deliverable: dpv === 'Y' || dpv === 'S' || dpv === 'D',
    deliverability: dpv === 'Y' ? 'deliverable' : dpv === 'S' ? 'deliverable_missing_unit' : 'undeliverable',
    source: 'google',
  };
}

async function validateAddressCore(addr, env, uspsToken) {
  const a = cleanAddr(addr);
  if (env.GOOGLE_ADDRESS_API_KEY) return validateGoogle(a, env.GOOGLE_ADDRESS_API_KEY);
  if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET)
    return validateUspsOAuth(a, env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET, uspsToken);
  if (env.USPS_USER_ID)  return validateUspsWebTools(a, env.USPS_USER_ID);
  if (env.LOB_API_KEY)   return validateLob(a, env.LOB_API_KEY);
  return validateCensus(a);
}

// ── UTILS API HANDLER ─────────────────────────────────────────────────────
export async function handleUtilsApi(req, env, url, method, seg, db, isAdmin, canEdit) {

  // POST /admin/api/utils/validate-address
  if (seg === 'utils/validate-address' && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!(b.address1 || '').trim()) return json({ error: 'address1 is required' }, 400);
    try {
      const result = await validateAddressCore(b, env);
      return result.ok ? json(result) : json({ error: result.error }, 422);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  // GET /admin/api/utils/static-map?address=... — server-side Google Static Maps proxy.
  // Keeps the key off the client entirely (it's a server-side key with no HTTP-referrer
  // restriction, unlike a typical embed/JS-API key, so it must never be exposed in page
  // source). Returns the map image bytes directly.
  //
  // NOTE: this hits the Maps *Static* API, which is a DIFFERENT Google product than the
  // Address Validation API. A key restricted to Address Validation (per SECRETS.md) will be
  // rejected here with 403 unless "Maps Static API" is also enabled on the project and the
  // key's API restrictions allow it. Prefer a dedicated GOOGLE_MAPS_API_KEY; fall back to the
  // address key only for backwards compatibility.
  if (seg === 'utils/static-map' && method === 'GET') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    const mapKey = env.GOOGLE_MAPS_API_KEY || env.GOOGLE_ADDRESS_API_KEY;
    if (!mapKey) return json({ error: 'Maps not configured' }, 501);
    const address = (url.searchParams.get('address') || '').trim();
    if (!address) return json({ error: 'address is required' }, 400);
    const mapUrl = 'https://maps.googleapis.com/maps/api/staticmap?' + new URLSearchParams({
      center: address,
      zoom: '15',
      size: '600x260',
      scale: '2',
      markers: 'color:0x1E2D4A|' + address,
      key: mapKey,
    });
    const r = await fetch(mapUrl);
    if (!r.ok) {
      // Surface Google's own reason (e.g. "API keys with referer restrictions cannot be used
      // with this API", "The Maps Static API must be enabled") so this is diagnosable from the
      // Network tab instead of a generic failure.
      let reason = '';
      try { reason = (await r.text()).slice(0, 300).trim(); } catch {}
      return json({ error: 'Map lookup failed', status: r.status, google: reason }, 502);
    }
    return new Response(r.body, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  }

  // POST /admin/api/utils/bulk-validate-addresses — validate + standardize active people with an address.
  // Processes 45 addresses per call to stay under Cloudflare's 50-subrequest limit
  // (1 USPS token fetch + up to 45 address calls = 46 max per invocation).
  // Frontend loops until hasMore=false.
  if (seg === 'utils/bulk-validate-addresses' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    let body = {}; try { body = await req.json(); } catch {}
    const offset = parseInt(body.offset || 0);
    const PAGE = 45;

    const totalRow = await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE address1 != '' AND status = 'active'`
    ).first();
    const total = totalRow?.n || 0;

    const rows = (await db.prepare(
      `SELECT id, first_name, last_name, address1, address2, city, state, zip
       FROM people WHERE address1 != '' AND status = 'active'
       ORDER BY id LIMIT ? OFFSET ?`
    ).bind(PAGE, offset).all()).results || [];

    // Fetch USPS token once for the whole page (avoids one token request per address)
    let uspsToken = null;
    if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET) {
      try { uspsToken = await getUspsToken(env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET); }
      catch (e) { return json({ error: 'USPS auth failed: ' + e.message }, 502); }
    }

    // Missouri cities that commonly appear with a missing state field
    const MO_CITIES = new Set(['st. louis','saint louis','st louis','wentzville','fenton','crestwood',
      'kirkwood','ballwin','arnold','florissant','hazelwood','manchester','chesterfield','wildwood',
      'webster groves','richmond heights','brentwood','maplewood','affton','mehlville','oakville',
      'lemay','sunset hills','des peres','ellisville','eureka','pacific','valley park','high ridge',
      'imperial','festus','crystal city','house springs','barnhart','jefferson city','columbia',
      'springfield','kansas city','independence','st. charles','saint charles','o\'fallon','st peters']);

    let validated = 0, updated = 0, failed = 0;
    const failures = [];

    // 5 concurrent per mini-batch within the page
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async row => {
        try {
          // ── Step 1: skip placeholder "unknown" streets ──────────────
          if (/^unknown$/i.test((row.address1 || '').trim())) return;

          // ── Step 2: strip HTML tags (e.g. <BR> from Breeze) ─────────
          let a1 = cleanAddrField(row.address1);
          let a2 = cleanAddrField(row.address2 || '');

          // ── Step 3: split pipe-separated facility names ──────────────
          // "Facility Name|123 Main St" → address2=facility, address1=street
          if (a1.includes('|')) {
            const [facility, street] = a1.split('|');
            a2 = facility.trim();
            a1 = street.trim();
          }

          // ── Step 4: split care facility prefix from street ───────────
          // "Facility Name 123 Main St" — everything before first digit is facility
          // Only applies when address2 is empty, address1 starts with non-digit text,
          // and it's NOT a PO Box (which legitimately starts with non-digit text)
          if (!a2 && /^[^0-9]/.test(a1) && !/^p\.?o\.?\s*box/i.test(a1)) {
            const m = a1.match(/^(.*?)\s+(\d+.*)$/);
            if (m && m[1].trim().length > 0) {
              a2 = m[1].trim();
              a1 = m[2].trim();
            }
          }

          // ── Step 5: split apt/unit suffix out of street field ────────
          // "3615 Jamieson Ave Apt. 1S" or "2405 Hampton Ave 3A" → address2
          const aptMatch = a1.match(/^(.+?)\s+((?:Apt\.?|Unit|Suite|#)\s*\S+)$/i);
          if (aptMatch && !a2) {
            a1 = aptMatch[1].trim();
            a2 = aptMatch[2].trim();
          }

          // ── Step 6: infer missing state from known MO city names ─────
          let city  = (row.city  || '').trim();
          let state = (row.state || '').trim();
          if (!state && MO_CITIES.has(city.toLowerCase())) state = 'MO';

          const workRow = { ...row, address1: a1, address2: a2, city, state };

          // Save any structural changes to DB immediately (facility split, apt split, state)
          const structChanged = a1 !== (row.address1 || '') || a2 !== (row.address2 || '')
                             || city !== (row.city || '') || state !== (row.state || '');
          if (structChanged) {
            await db.prepare('UPDATE people SET address1=?,address2=?,city=?,state=? WHERE id=?')
              .bind(a1, a2, city, state, row.id).run();
          }

          // ── Step 7: USPS validation ──────────────────────────────────
          const r = await validateAddressCore(workRow, env, uspsToken);
          validated++;
          if (!r.ok) {
            if (structChanged) updated++; // count structural cleanup as an update even if USPS fails
            failed++;
            failures.push({ id: row.id, name: (row.first_name + ' ' + row.last_name).trim(), address: [a1, city, state].filter(Boolean).join(', '), error: r.error });
            return;
          }
          if (!r.deliverable) {
            if (structChanged) updated++;
            return;
          }
          const newZip = r.zip + (r.zip4 ? '-' + r.zip4 : '');
          const uspsChanged = r.address1 !== a1 || r.address2 !== a2
                           || r.city !== city || r.state !== state
                           || newZip !== (row.zip || '');
          if (structChanged || uspsChanged) {
            await db.prepare('UPDATE people SET address1=?,address2=?,city=?,state=?,zip=? WHERE id=?')
              .bind(r.address1, r.address2 || '', r.city, r.state, newZip, row.id).run();
            updated++;
          }
        } catch (e) {
          failed++;
          failures.push({ id: row.id, name: (row.first_name + ' ' + row.last_name).trim(), address: [row.address1, row.city, row.state].filter(Boolean).join(', '), error: e.message });
        }
      }));
    }

    const nextOffset = offset + rows.length;
    return json({ ok: true, total, offset, validated, updated, failed,
                  hasMore: nextOffset < total, nextOffset,
                  failures });
  }

  // POST /admin/api/utils/normalize-phones — one-time bulk phone cleanup (admin only)
  if (seg === 'utils/normalize-phones' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const rows = (await db.prepare(`SELECT id, phone FROM people WHERE phone != ''`).all()).results || [];
    const toUpdate = rows
      .map(r => ({ id: r.id, norm: normalizePhone(r.phone), orig: r.phone }))
      .filter(r => r.norm !== r.orig);
    if (toUpdate.length) {
      const CHUNK = 99;
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        await db.batch(toUpdate.slice(i, i + CHUNK).map(row =>
          db.prepare('UPDATE people SET phone=? WHERE id=?').bind(row.norm, row.id)
        ));
      }
    }
    return json({ ok: true, updated: toUpdate.length, total_with_phone: rows.length });
  }

  return null;
}
