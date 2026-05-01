// Shared utilities used across multiple api-*.js modules.
import { json } from './auth.js';

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
  if (!raw) return '';
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
//   1. USPS OAuth API  (USPS_CLIENT_ID + USPS_CLIENT_SECRET) — new REST API
//   2. USPS Web Tools  (USPS_USER_ID)                        — legacy XML API
//   3. Lob             (LOB_API_KEY)
//   4. Census Bureau   (free fallback, no key needed)
// All helpers return a plain object: { ok, address1, address2, city, state, zip, zip4, dpvConfirmation, deliverable }
// or { ok: false, error } on failure.

function escXml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    dpvConfirmation: 'Y', deliverable: true, deliverability: 'deliverable',
  };
}

async function validateAddressCore(addr, env, uspsToken) {
  if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET)
    return validateUspsOAuth(addr, env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET, uspsToken);
  if (env.USPS_USER_ID)  return validateUspsWebTools(addr, env.USPS_USER_ID);
  if (env.LOB_API_KEY)   return validateLob(addr, env.LOB_API_KEY);
  return validateCensus(addr);
}

// ── UTILS API HANDLER ─────────────────────────────────────────────────────
export async function handleUtilsApi(req, env, url, method, seg, db, isAdmin) {

  // POST /admin/api/utils/validate-address
  if (seg === 'utils/validate-address' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    if (!(b.address1 || '').trim()) return json({ error: 'address1 is required' }, 400);
    try {
      const result = await validateAddressCore(b, env);
      return result.ok ? json(result) : json({ error: result.error }, 422);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  // POST /admin/api/utils/bulk-validate-addresses — validate + standardize active people with an address.
  // Processes 50 addresses per call to avoid Worker timeout. Frontend loops until hasMore=false.
  if (seg === 'utils/bulk-validate-addresses' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    let body = {}; try { body = await req.json(); } catch {}
    const offset = parseInt(body.offset || 0);
    const PAGE = 50;

    const totalRow = await db.prepare(
      `SELECT COUNT(*) as n FROM people WHERE address1 != '' AND status = 'active'`
    ).first();
    const total = totalRow?.n || 0;

    const rows = (await db.prepare(
      `SELECT id, address1, address2, city, state, zip
       FROM people WHERE address1 != '' AND status = 'active'
       ORDER BY id LIMIT ? OFFSET ?`
    ).bind(PAGE, offset).all()).results || [];

    // Fetch USPS token once for the whole page (avoids one token request per address)
    let uspsToken = null;
    if (env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET) {
      try { uspsToken = await getUspsToken(env.USPS_CLIENT_ID, env.USPS_CLIENT_SECRET); }
      catch (e) { return json({ error: 'USPS auth failed: ' + e.message }, 502); }
    }

    let validated = 0, updated = 0, failed = 0;
    const failures = [];

    // 5 concurrent per mini-batch within the page
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async row => {
        try {
          const r = await validateAddressCore(row, env, uspsToken);
          validated++;
          if (!r.ok) { failed++; failures.push({ id: row.id, error: r.error }); return; }
          if (!r.deliverable) return;
          const newZip = r.zip + (r.zip4 ? '-' + r.zip4 : '');
          const changed = r.address1 !== (row.address1 || '') || r.address2 !== (row.address2 || '')
                       || r.city !== (row.city || '') || r.state !== (row.state || '')
                       || newZip !== (row.zip || '');
          if (changed) {
            await db.prepare('UPDATE people SET address1=?,address2=?,city=?,state=?,zip=? WHERE id=?')
              .bind(r.address1, r.address2 || '', r.city, r.state, newZip, row.id).run();
            updated++;
          }
        } catch (e) {
          failed++;
          failures.push({ id: row.id, error: e.message });
        }
      }));
    }

    const nextOffset = offset + rows.length;
    return json({ ok: true, total, offset, validated, updated, failed,
                  hasMore: nextOffset < total, nextOffset,
                  failures: failures.slice(0, 10) });
  }

  // POST /admin/api/utils/normalize-phones — one-time bulk phone cleanup (admin only)
  if (seg === 'utils/normalize-phones' && method === 'POST') {
    if (!isAdmin) return json({ error: 'Access denied' }, 403);
    const rows = (await db.prepare(`SELECT id, phone FROM people WHERE phone != ''`).all()).results || [];
    const toUpdate = rows
      .map(r => ({ id: r.id, norm: normalizePhone(r.phone), orig: r.phone }))
      .filter(r => r.norm !== r.orig);
    for (const row of toUpdate) {
      await db.prepare('UPDATE people SET phone=? WHERE id=?').bind(row.norm, row.id).run();
    }
    return json({ ok: true, updated: toUpdate.length, total_with_phone: rows.length });
  }

  return null;
}
