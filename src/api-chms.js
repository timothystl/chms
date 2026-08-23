// ── ChMS (People & Giving) API handler ────────────────────────────────────────
import { json } from './auth.js';
import { isoWeekKey, handleUtilsApi, getRolePermissions, permissionsForRole, isAnonSafeGivingSeg } from './api-utils.js';
import { handleHouseholdsApi } from './api-households.js';
import { handleImportApi } from './api-import.js';
import { handleReportsApi } from './api-reports.js';
import { handlePeopleApi, handleSendMemberInvite } from './api-people.js';
import { handleGivingApi } from './api-giving.js';
import { handleTuitionAidApi } from './api-tuition-aid.js';
import { handleFinanceApi } from './api-finance.js';

export async function handleChmsApi(req, env, url, method, seg, role = 'admin') {
  const db = env.DB;

  // ── Role-based access control ────────────────────────────────────
  // Roles: admin | finance | staff | council | member | volunteer
  //   admin   — always full access, not configurable (can never be locked out)
  //   finance | staff | council — every feature item below is admin-configurable per role
  //             (Settings → Role Permissions). See api-utils.js for the defaults.
  //   council — the governance tier (renamed from `office`): sees the Finance workspace and
  //             the Reports tab, and giving only at the 'anon' level — totals, never donors.
  //   member  — GET people filtered to member_type='member' only; a structurally different
  //             read-only view, not part of the configurable matrix
  //   volunteer — read-only access to the public Volunteers admin screen only (Signups /
  //             Ministry Roles / Events / Templates, all in api-admin.js); denied outright
  //             everywhere in this file. Not part of the configurable matrix either.
  const isAdmin = role === 'admin';
  const perms = await getRolePermissions(db);
  const rolePerms = permissionsForRole(perms, role);
  // Per-item access helpers off the resolved granular matrix. admin bypasses everything
  // (never configurable); member's levels come from the matrix but are already clamped in
  // resolveRolePermissions so it can never carry an 'edit' or a non-safe item.
  const itemLevel = (item) => (isAdmin ? 'edit' : (rolePerms[item] || 'none'));
  const canView   = (item) => isAdmin || itemLevel(item) !== 'none';
  const canEditItem = (item) => isAdmin || itemLevel(item) === 'edit';

  // Anonymous giving: 'anon' grants the aggregate giving picture and nothing that names a
  // donor. It is a level BELOW 'view', so `canView('giving')` is true for it — which is
  // right for the Giving nav and the fund/method/month totals, and wrong for anything
  // per-person. So the two are separated here and stay separated all the way down:
  //   givingAnon        → totals only, allowlisted segments (see the gate below)
  //   isFinance         → may see an individual's giving (person profile, first-time givers,
  //                       statements, per-donor reports). Deliberately FALSE for anon.
  //   canViewGivingSums → may see giving totals at all, anon included.
  const givingAnon        = !isAdmin && itemLevel('giving') === 'anon';
  const canViewGivingSums = canView('giving');
  // Legacy flags still threaded into the domain handlers. With central per-item enforcement
  // below, these only need to be permissive enough for READS within an already-gated
  // segment — every write is blocked centrally before dispatch if the item isn't 'edit'.
  //   isFinance  → individual giving reads (giving handler + giving data in people/reports)
  //   isStaff    → follow-up / audit / attendance reads (people/reports handlers)
  //   canRegister→ register access
  const isFinance   = canViewGivingSums && !givingAnon;
  const isStaff     = canView('attendance') || canView('followups') || canView('audit');
  const canRegister = canView('register');
  // People / Households / Tags / Orgs / Funds editing — unchanged blanket flag: every
  // non-member role can edit the baseline directory (the per-item view/edit toggles above
  // are the feature areas layered on top, not the directory itself).
  const canEdit    = role === 'admin' || role === 'finance' || role === 'staff' || role === 'council';

  // ── Central per-item access gate ──────────────────────────────────────────
  // Each feature segment maps to exactly one configurable item. 'none' → no access at all;
  // a non-GET request to an item the role only has 'view' on is blocked here, so a
  // view-only role can read but never write, and no downstream handler has to re-check.
  // Order matters: reports/giving must resolve to the `giving` item, so it's listed before
  // the generic reports rule and the first match wins.
  const ACCESS_GATE = [
    { match: (s) => s.startsWith('giving') || s.startsWith('reports/giving'), item: 'giving' },
    { match: (s) => s.startsWith('tuition-aid'), item: 'tuitionaid' },
    { match: (s) => s.startsWith('finance'), item: 'finance' },
    { match: (s) => s.startsWith('attendance'), item: 'attendance' },
    { match: (s) => s.startsWith('followup'), item: 'followups' },
    { match: (s) => s.startsWith('audit'), item: 'audit' },
    { match: (s) => s.startsWith('register'), item: 'register' },
    { match: (s) => s.startsWith('reports'), item: 'reports' },
  ];
  for (const rule of ACCESS_GATE) {
    if (rule.match(seg)) {
      if (!canView(rule.item)) return json({ error: 'Access denied' }, 403);
      if (method !== 'GET' && !canEditItem(rule.item)) {
        return json({ error: 'Access denied: view-only permission for this area' }, 403);
      }
      // Anonymous giving: reads only, and only the allowlisted aggregate endpoints. This is
      // the single chokepoint for it — every giving route reaches its handler through here,
      // so nothing per-donor can be added later and be reachable by accident.
      if (rule.item === 'giving' && givingAnon && !isAnonSafeGivingSeg(seg)) {
        return json({ error: 'Access denied: this role sees giving totals only, not individual donors' }, 403);
      }
      break;
    }
  }
  // Config (settings) — reads open to any logged-in role (needed for e.g. the
  // member-types dropdown used everywhere); writes admin only
  if (seg.startsWith('config') && method !== 'GET' && !isAdmin) {
    return json({ error: 'Access denied: changing settings requires admin access' }, 403);
  }
  // Imports — admin only
  if (seg.startsWith('import/') && !isAdmin) {
    return json({ error: 'Access denied: imports require admin access' }, 403);
  }
  // Dev board — admin only
  if (seg === 'board' && !isAdmin) {
    return json({ error: 'Access denied' }, 403);
  }
  // Volunteer role — a narrow, read-only tester/manager account for the public sign-up flow.
  // Its entire real surface (Signups / Ministry Roles / Events / Templates) lives in
  // api-admin.js, reachable before this function is ever called for it — those GET routes are
  // already open to any authenticated role, and their writes already require admin/staff. This
  // file (People/Households/Giving/Reports/etc.) has nothing for it, so it's denied outright
  // rather than reusing the member tier's careful per-row redaction, which this role doesn't
  // need and shouldn't inherit by accident.
  if (role === 'volunteer') {
    return json({ error: 'Access denied' }, 403);
  }
  // Member role — GET the filtered people directory + tags + member-types, plus the general
  // Reports tab IF an admin has toggled it on (canView('reports')). Giving reports are never
  // reachable here — reports/giving resolves to the `giving` item in the gate above and is
  // already 403'd for members. All writes are blocked regardless.
  if (role === 'member') {
    // `config/member-types` is the REAL path (see api-import.js) — the bare `member-types`
    // below is a legacy dispatch alias that the frontend never calls. Listing only the alias
    // meant loadMemberTypes() 403'd on every single member page load, which surfaced as a
    // bare "Access denied" banner on an otherwise working directory (reported 2026-08-03).
    // `households/<id>` and nothing else under households — NOT the list, NOT no-head-count,
    // fix-heads, sync-address or the photo routes. The handler returns a redacted shape for
    // this role (family chips only, no giving/envelope/notes); this pattern is what stops a
    // member reaching the other household endpoints alongside it.
    const allowedSegs = seg.startsWith('people') || seg === 'tags'
      || seg === 'member-types' || seg === 'config/member-types'
      || /^households\/\d+$/.test(seg)
      || (canView('reports') && seg.startsWith('reports'));
    if (!allowedSegs) return json({ error: 'Access denied' }, 403);
    if (method !== 'GET') return json({ error: 'Access denied' }, 403);
  }
  // Write operations — require canEdit (not member)
  if (method !== 'GET' && !canEdit &&
      (seg.startsWith('people') || seg.startsWith('households') || seg.startsWith('tags') ||
       seg.startsWith('attendance') || seg.startsWith('register') || seg.startsWith('funds') ||
       seg.startsWith('organizations'))) {
    return json({ error: 'Access denied: editing requires staff, council, or finance access' }, 403);
  }

  // ── Dashboard ────────────────────────────────────────────────────
  if (seg === 'dashboard' && method === 'GET') {
    // DB4: Month-at-a-time birthdays & anniversaries (exclude visitor/inactive/other/org)
    const dashMonth = Math.max(1, Math.min(12, parseInt(url.searchParams.get('month') || '') || (new Date().getMonth() + 1)));
    const dashMonthStr = String(dashMonth).padStart(2, '0');
    // These 12 reads are mutually independent, so they run as one parallel batch rather than
    // 12 serial D1 round-trips. The dashboard is the app's landing screen, so this latency is
    // on the critical path for every login. Anything below that depends on a result here
    // (the anniversary partner lookup) still runs afterwards.
    // P24-B: birthdaysRes/annRowsRes/baptismAnniversariesRes/annIssueCandidatesRes were
    // originally four more serial awaits after this batch — none of the four depends on
    // anything computed here (birthdays/annRows/baptismAnniversaries need only dashMonthStr,
    // annIssueCandidates isn't month-scoped at all), so they run alongside the rest instead.
    const [
      mtCfgRowDash, typeCountsRes, totalHouseholdsRow, memberCountRow, memberHHCountRow,
      confirmedCountRow, baptizedCountRow, addedThisMonthRow, addedThisYearRow,
      gfYtdRow, gfLastYearYtdRow, gfLastYearTotalRow,
      birthdaysRes, annRowsRes, baptismAnniversariesRes, annIssueCandidatesRes,
    ] = await Promise.all([
      // Membership counts by type — GROUP BY LOWER() to merge case variants (e.g. "member" vs "Member")
      db.prepare("SELECT value FROM chms_config WHERE key='member_types'").first(),
      db.prepare(
        `SELECT LOWER(member_type) as member_type, COUNT(*) as n FROM people WHERE active=1 GROUP BY LOWER(member_type) ORDER BY n DESC`
      ).all(),
      db.prepare(`SELECT COUNT(*) as n FROM households`).first(),
      // DB1: member-only count for dashboard stat card
      db.prepare(
        `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member'`
      ).first(),
      // DB2: households that contain at least one member
      db.prepare(
        `SELECT COUNT(DISTINCT household_id) as n FROM people
         WHERE active=1 AND LOWER(member_type)='member'
           AND household_id IS NOT NULL AND household_id != ''`
      ).first(),
      // Confirmed / baptized counts (members only) for the dashboard quick-stat card
      db.prepare(
        `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member' AND confirmed=1`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) as n FROM people WHERE active=1 AND LOWER(member_type)='member' AND baptized=1`
      ).first(),
      // Added this month / this year
      db.prepare(
        `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of month')`
      ).first(),
      db.prepare(
        `SELECT COUNT(*) as n FROM people WHERE active=1 AND created_at >= date('now','start of year')`
      ).first(),
      // Giving dashboard stats — General Fund only (funds whose name starts with '40085')
      db.prepare(
        `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         JOIN funds f ON ge.fund_id=f.id
         WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=strftime('%Y','now')
           AND f.name LIKE '40085%'`
      ).first(),
      db.prepare(
        `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         JOIN funds f ON ge.fund_id=f.id
         WHERE COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)
                 BETWEEN strftime('%Y','now','-1 year')||'-01-01'
                     AND strftime('%Y-%m-%d','now','-1 year')
           AND f.name LIKE '40085%'`
      ).first(),
      db.prepare(
        `SELECT COALESCE(SUM(ge.amount),0) as total FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         JOIN funds f ON ge.fund_id=f.id
         WHERE substr(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date),1,4)=cast(strftime('%Y','now')-1 as text)
           AND f.name LIKE '40085%'`
      ).first(),
      db.prepare(
        `SELECT id, first_name, last_name, dob FROM people
         WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL)
           AND dob != ''
           AND LOWER(member_type) = 'member'
           AND strftime('%m', dob) = ?
         ORDER BY strftime('%d', dob)`
      ).bind(dashMonthStr).all(),
      // DB4: fetch anniversaries with role+household so couples can be paired
      db.prepare(
        `SELECT id, first_name, last_name, anniversary_date, family_role, household_id FROM people
         WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL) AND anniversary_date != ''
           AND LOWER(member_type) = 'member'
           AND LOWER(marital_status) != 'widowed'
           AND strftime('%m', anniversary_date) = ?
           AND NOT EXISTS (
             SELECT 1 FROM people p2
             WHERE p2.household_id=people.household_id AND p2.id!=people.id
               AND (p2.deceased=1 OR p2.status='deceased') AND p2.family_role IN ('head','spouse')
           )
         ORDER BY strftime('%d', anniversary_date), household_id,
           CASE family_role WHEN 'head' THEN 0 WHEN 'spouse' THEN 1 ELSE 2 END`
      ).bind(dashMonthStr).all(),
      // DB4: Baptism anniversaries for the month (members only, non-deceased, with a baptism_date)
      db.prepare(
        `SELECT id, first_name, last_name, baptism_date FROM people
         WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL)
           AND baptism_date != ''
           AND LOWER(member_type) = 'member'
           AND strftime('%m', baptism_date) = ?
         ORDER BY strftime('%d', baptism_date)`
      ).bind(dashMonthStr).all(),
      // SW8: Anniversary data-quality/pastoral-care flags — year-round (not month-scoped) so
      // staff can review and fix/reach out at any time, not just when the date rolls around.
      db.prepare(
        `SELECT id, first_name, last_name, anniversary_date, family_role, household_id FROM people
         WHERE active=1 AND (status IS NULL OR status='active') AND (deceased=0 OR deceased IS NULL)
           AND anniversary_date != '' AND household_id IS NOT NULL AND household_id != ''
           AND LOWER(member_type) NOT IN ('visitor','inactive','other','organization')
           AND LOWER(marital_status) != 'widowed'`
      ).all(),
    ]);
    const birthdays = birthdaysRes.results || [];
    const annRows = annRowsRes.results || [];
    const baptismAnniversaries = baptismAnniversariesRes.results || [];
    const annIssueCandidates = annIssueCandidatesRes.results || [];
    const configuredTypesDash = mtCfgRowDash ? JSON.parse(mtCfgRowDash.value) : ['Member','Friend','Visitor','Inactive','Organization','Other'];
    const typeNameMapDash = {};
    for (const t of configuredTypesDash) typeNameMapDash[t.toLowerCase()] = t;
    const typeCounts = typeCountsRes.results || [];
    for (const r of typeCounts) r.member_type = typeNameMapDash[r.member_type] || (r.member_type.charAt(0).toUpperCase() + r.member_type.slice(1));
    const totalPeople = typeCounts.reduce(function(s,r){return s+r.n;},0);
    const totalHouseholds = totalHouseholdsRow?.n || 0;
    const memberCount = memberCountRow?.n || 0;
    const memberHHCount = memberHHCountRow?.n || 0;
    const confirmedCount = confirmedCountRow?.n || 0;
    const baptizedCount = baptizedCountRow?.n || 0;
    const addedThisMonth = addedThisMonthRow?.n || 0;
    const addedThisYear = addedThisYearRow?.n || 0;
    const gfYtd = gfYtdRow?.total || 0;
    const gfLastYearYtd = gfLastYearYtdRow?.total || 0;
    const gfLastYearTotal = gfLastYearTotalRow?.total || 0;
    // Group same-household + same-date pairs into one entry ("Bob & Alice Johnson")
    const _annRoleOrder = { head: 0, spouse: 1, child: 2, other: 3 };
    const annGroupMap = new Map();
    for (const p of annRows) {
      const key = (p.household_id && p.household_id !== '') ? `${p.household_id}:${p.anniversary_date}` : `_${p.id}`;
      if (!annGroupMap.has(key)) annGroupMap.set(key, []);
      annGroupMap.get(key).push(p);
    }
    // For still-unpaired entries, try to find the household partner who may not have anniversary_date set.
    // Common Breeze pattern: only the head of household has the date; spouse field is blank.
    const unpairedHHIds = [...new Set(
      [...annGroupMap.values()]
        .filter(g => g.length === 1 && g[0].household_id)
        .map(g => g[0].household_id)
    )];
    if (unpairedHHIds.length > 0) {
      const ph = unpairedHHIds.map(() => '?').join(',');
      const partners = (await db.prepare(
        `SELECT id, first_name, last_name, anniversary_date, family_role, household_id
         FROM people WHERE active=1 AND (status IS NULL OR status='active')
           AND (deceased=0 OR deceased IS NULL) AND household_id IN (${ph})`
      ).bind(...unpairedHHIds).all()).results || [];
      const partnersByHH = {};
      for (const s of partners) {
        if (!partnersByHH[s.household_id]) partnersByHH[s.household_id] = [];
        partnersByHH[s.household_id].push(s);
      }
      for (const group of annGroupMap.values()) {
        if (group.length !== 1 || !group[0].household_id) continue;
        const existing = group[0];
        const candidates = (partnersByHH[existing.household_id] || []).filter(s => s.id !== existing.id);
        // Prefer head/spouse roles; fall back to any household member
        const partner = candidates.find(s => s.family_role === 'head' || s.family_role === 'spouse') || candidates[0];
        if (partner) group.push({ ...partner, anniversary_date: existing.anniversary_date });
      }
    }
    const anniversaries = [...annGroupMap.values()]
      .filter(group => group.length >= 2)
      .map(group => {
        group.sort((a, b) => (_annRoleOrder[a.family_role] ?? 4) - (_annRoleOrder[b.family_role] ?? 4) || a.id - b.id);
        return {
          id: group[0].id,
          first_name: group.map(p => p.first_name || '').filter(Boolean).join(' & '),
          last_name: group[0].last_name,
          anniversary_date: group[0].anniversary_date,
          paired: group.length > 1
        };
      })
      .sort((a, b) => a.anniversary_date.slice(5) < b.anniversary_date.slice(5) ? -1 : 1);
    // SW8: Anniversary data-quality/pastoral-care flags — people with an anniversary_date
    // who would be silently skipped by the automated anniversary email/SMS sends (and left
    // out of the DB4 anniversary card above) because no living, date-matched partner could
    // be paired with them.
    let anniversaryIssues = [], anniversaryIssueTotal = 0;
    if (annIssueCandidates.length) {
      const issueHHIds = [...new Set(annIssueCandidates.map(p => p.household_id))];
      const hhMembers = [];
      const HH_CHUNK = 90;
      for (let i = 0; i < issueHHIds.length; i += HH_CHUNK) {
        const chunk = issueHHIds.slice(i, i + HH_CHUNK);
        const ph2 = chunk.map(() => '?').join(',');
        const rows = (await db.prepare(
          `SELECT id, first_name, last_name, family_role, household_id, anniversary_date, deceased, status
           FROM people WHERE household_id IN (${ph2})`
        ).bind(...chunk).all()).results || [];
        hhMembers.push(...rows);
      }
      const membersByHH = {};
      for (const m of hhMembers) { (membersByHH[m.household_id] = membersByHH[m.household_id] || []).push(m); }
      const flagged = [];
      for (const p of annIssueCandidates) {
        const partner = (membersByHH[p.household_id] || [])
          .find(m => m.id !== p.id && (m.family_role === 'head' || m.family_role === 'spouse'));
        let issue = null;
        if (!partner) issue = 'no_partner';
        else if (partner.deceased === 1 || partner.status === 'deceased') issue = 'deceased_partner';
        else if (!partner.anniversary_date || partner.anniversary_date !== p.anniversary_date) issue = 'date_mismatch';
        if (issue) flagged.push({
          id: p.id, first_name: p.first_name, last_name: p.last_name,
          anniversary_date: p.anniversary_date, household_id: p.household_id, issue,
          partner_name: partner ? `${partner.first_name} ${partner.last_name}`.trim() : null,
        });
      }
      flagged.sort((a, b) => a.anniversary_date.slice(5).localeCompare(b.anniversary_date.slice(5)));
      anniversaryIssueTotal = flagged.length;
      anniversaryIssues = flagged.slice(0, 20);
    }
    // Second independent batch — same reasoning as the stat batch above: none of these nine
    // reads depend on each other or on anything computed since, so they run in parallel.
    const [
      recentPeopleRes, recentAttendanceRes, followUpItemsRes, firstGiversRes,
      notSeenRecentlyRes, reviewQueueBatchRes, reviewQueueTotalRow,
      followupQueueBatchRes, followupQueueTotalRow,
    ] = await Promise.all([
      // Recent additions
      db.prepare(
        `SELECT p.id, p.first_name, p.last_name, p.member_type, p.created_at, h.name as household_name
         FROM people p LEFT JOIN households h ON p.household_id=h.id
         WHERE p.active=1 ORDER BY p.created_at DESC LIMIT 10`
      ).all(),
      // Most recent attendance
      // DB3: Last 2 services (show both Sunday services)
      db.prepare(
        `SELECT service_date, service_time, service_name, attendance
         FROM worship_services WHERE attendance > 0
         ORDER BY service_date DESC, service_time DESC LIMIT 2`
      ).all(),
      // Open follow-up items (pastoral queue)
      db.prepare(
        `SELECT f.*, p.first_name, p.last_name FROM follow_up_items f
         LEFT JOIN people p ON p.id=f.person_id
         WHERE f.completed=0 ORDER BY f.created_at DESC LIMIT 50`
      ).all(),
      // First-time givers in the last 60 days (exclude dismissed records)
      db.prepare(
        `SELECT p.id, p.first_name, p.last_name, MIN(COALESCE(NULLIF(ge.contribution_date,''),gb.batch_date)) as first_gift_date
         FROM giving_entries ge
         JOIN giving_batches gb ON ge.batch_id=gb.id
         JOIN people p ON p.id=ge.person_id
         WHERE p.first_gift_noted = 0
         GROUP BY ge.person_id
         HAVING first_gift_date >= date('now','-60 days')
         ORDER BY first_gift_date DESC LIMIT 20`
      ).all(),
      // People not seen recently (last_seen_date set more than 8 weeks ago, or never seen but added 8+ weeks ago)
      db.prepare(
        `SELECT id, first_name, last_name, member_type, last_seen_date, created_at FROM people
         WHERE active=1 AND (
           (last_seen_date != '' AND last_seen_date < date('now','-56 days'))
         ) ORDER BY last_seen_date ASC LIMIT 20`
      ).all(),
      // Weekly review queue (DC1): small batch of stale visitor/friend records due for triage.
      // "Stale" = never reviewed OR last_reviewed_at older than 365 days.
      db.prepare(
        `SELECT id, first_name, last_name, member_type, email, phone,
                created_at, last_reviewed_at, last_seen_date,
                (SELECT MAX(COALESCE(NULLIF(ge.contribution_date,''), gb.batch_date))
                   FROM giving_entries ge
                   JOIN giving_batches gb ON gb.id = ge.batch_id
                   WHERE ge.person_id = people.id) AS last_gift_date
         FROM people
         WHERE status='active'
           AND LOWER(member_type) NOT IN ('member','organization','')
           AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))
         ORDER BY CASE WHEN last_reviewed_at = '' THEN 0 ELSE 1 END,
                  last_reviewed_at ASC,
                  created_at ASC
         LIMIT 5`
      ).all(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM people
         WHERE status='active'
           AND LOWER(member_type) NOT IN ('member','organization','')
           AND (last_reviewed_at = '' OR date(last_reviewed_at) < date('now','-365 days'))`
      ).first(),
      // New-contact follow-up queue (FU2/DB9)
      db.prepare(
        `SELECT id, first_name, last_name, member_type, email, phone,
                first_contact_date, followup_status, followup_notes
         FROM people
         WHERE status='active'
           AND first_contact_date != ''
           AND (followup_status IS NULL OR followup_status != 'done')
           AND LOWER(member_type) NOT IN ('member','organization')
         ORDER BY first_contact_date DESC, id DESC
         LIMIT 5`
      ).all(),
      db.prepare(
        `SELECT COUNT(*) AS n FROM people
         WHERE status='active'
           AND first_contact_date != ''
           AND (followup_status IS NULL OR followup_status != 'done')
           AND LOWER(member_type) NOT IN ('member','organization')`
      ).first(),
    ]);
    const recentPeople = recentPeopleRes.results || [];
    const recentAttendance = recentAttendanceRes.results || [];
    const followUpItems = followUpItemsRes.results || [];
    const firstGivers = firstGiversRes.results || [];
    const notSeenRecently = notSeenRecentlyRes.results || [];
    const reviewQueueBatch = reviewQueueBatchRes.results || [];
    const reviewQueueTotal = reviewQueueTotalRow?.n || 0;
    const followupQueueBatch = followupQueueBatchRes.results || [];
    const followupQueueTotal = followupQueueTotalRow?.n || 0;
    // Weekly task checklist (engagement_tasks) — auto-seed defaults on first access each week
    let weeklyTasks = [], weeklyTasksWeek = '';
    if (canEdit) {
      weeklyTasksWeek = isoWeekKey();
      weeklyTasks = (await db.prepare(
        'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
      ).bind(weeklyTasksWeek).all()).results || [];
      if (!weeklyTasks.length) {
        const defaults = [
          'Review new visitors in the people list',
          'Send newsletter to new contacts',
          'Follow up with first-time givers',
          'Follow up with prayer requests',
          'Check in with members not seen recently',
        ];
        // P24-B: one batch, and INSERT OR IGNORE rather than plain INSERT — a unique index on
        // (title, week_key) (migrations/0037) means two staff opening the dashboard the same
        // Monday morning and both finding it empty no longer both seed all five rows. The
        // loser's five inserts are silently ignored instead of duplicated.
        await db.batch(defaults.map((title, i) =>
          db.prepare('INSERT OR IGNORE INTO engagement_tasks(title,week_key,sort_order) VALUES(?,?,?)').bind(title, weeklyTasksWeek, i)
        ));
        weeklyTasks = (await db.prepare(
          'SELECT * FROM engagement_tasks WHERE week_key=? ORDER BY sort_order, id'
        ).bind(weeklyTasksWeek).all()).results || [];
      }
    }
    // Open prayer requests (FU1) — staff+ sees these. Two independent counts, run together.
    let prayerOpen = [], prayerOpenTotal = 0;
    if (canEdit) {
      const [prayerOpenRes, prayerOpenTotalRow] = await Promise.all([
        db.prepare(
          `SELECT pr.id, pr.person_id, pr.requester_name, pr.requester_email, pr.request_text,
                  pr.source, pr.status, pr.submitted_at,
                  p.first_name, p.last_name
           FROM prayer_requests pr
           LEFT JOIN people p ON p.id = pr.person_id
           WHERE pr.status IN ('open','praying')
           ORDER BY pr.submitted_at DESC, pr.id DESC
           LIMIT 5`
        ).all(),
        db.prepare(
          "SELECT COUNT(*) AS n FROM prayer_requests WHERE status IN ('open','praying')"
        ).first(),
      ]);
      prayerOpen = prayerOpenRes.results || [];
      prayerOpenTotal = prayerOpenTotalRow?.n || 0;
    }
    return json({
      totalPeople, totalHouseholds, memberCount, memberHHCount, confirmedCount, baptizedCount,
      addedThisMonth, addedThisYear, dashMonth,
      typeCounts,
      // giving data (General Fund = funds starting with '40085'). The three totals are
      // congregation-wide sums, so an anon-giving role sees them; firstGivers is a list of
      // named people and stays behind full giving access.
      gfYtd:           canViewGivingSums ? gfYtd           : undefined,
      gfLastYearYtd:   canViewGivingSums ? gfLastYearYtd   : undefined,
      gfLastYearTotal: canViewGivingSums ? gfLastYearTotal : undefined,
      firstGivers:     isFinance ? firstGivers     : [],
      // pastoral data: staff+ only
      followUpItems:   isStaff  ? followUpItems   : [],
      recentAttendance: isStaff ? recentAttendance : [],
      birthdays, anniversaries, baptismAnniversaries, recentPeople, notSeenRecently,
      // engagement review queue (DC1/DB9): any editor can use
      reviewQueue:     canEdit ? reviewQueueBatch : [],
      reviewQueueTotal: canEdit ? reviewQueueTotal : 0,
      // new-contact follow-up queue (FU2/DB9)
      followupQueue:   canEdit ? followupQueueBatch : [],
      followupQueueTotal: canEdit ? followupQueueTotal : 0,
      // SW8: anniversary data-quality/pastoral-care flags (deceased or no matching partner)
      anniversaryIssues: canEdit ? anniversaryIssues : [],
      anniversaryIssueTotal: canEdit ? anniversaryIssueTotal : 0,
      // weekly task checklist
      weeklyTasks, weeklyTasksWeek,
      // prayer requests (FU1)
      prayerOpen, prayerOpenTotal
    });
  }

  // ── Utilities (address validation, phone normalization) → api-utils.js ─────
  if (seg.startsWith('utils/')) {
    const result = await handleUtilsApi(req, env, url, method, seg, db, isAdmin, canEdit);
    if (result) return result;
  }

  // ── Connect member invite (admin/staff/office/finance only) ────────────────
  const inviteMatch = seg.match(/^people[/](\d+)[/]invite$/);
  if (inviteMatch && method === 'POST') {
    if (!canEdit) return json({ error: 'Access denied' }, 403);
    return handleSendMemberInvite(env, parseInt(inviteMatch[1], 10));
  }

  // ── People / Archive / Brevo / Photos / Follow-ups → api-people.js ────────
  if (seg.startsWith('people') || seg === 'member-types' ||
      seg.startsWith('brevo/') || seg.startsWith('followup') || seg === 'audit' || seg === 'audit/undo') {
    const result = await handlePeopleApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit, canRegister, role);
    if (result !== null) return result;
  }

  // ── Households / Organizations / Tags / Funds → api-households.js ─────────
  if (seg.startsWith('households') || seg.startsWith('organizations') ||
      seg.startsWith('tags') || seg.startsWith('funds')) {
    const result = await handleHouseholdsApi(req, env, url, method, seg, db, isAdmin, canEdit, role);
    if (result !== null) return result;
  }

  // ── Giving Entries / Batches / Quick Entry → api-giving.js ─────────────────
  if (seg.startsWith('giving') || seg.startsWith('giving/')) {
    const result = await handleGivingApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
    if (result !== null) return result;
  }

  // ── Tuition Aid Planner → api-tuition-aid.js ────────────────────────────
  // Pass the tuition-specific view flag (not the giving one) — the central gate has already
  // enforced view/edit for this item, so this only needs to satisfy the handler's own guard.
  if (seg.startsWith('tuition-aid')) {
    const result = await handleTuitionAidApi(req, env, url, method, seg, db, canView('tuitionaid'));
    if (result !== null) return result;
  }

  // ── Finance Overview (QuickBooks + daycare) → api-finance.js ───────────
  // connecting/disconnecting QuickBooks is further restricted to admin inside api-finance.js
  if (seg.startsWith('finance')) {
    const result = await handleFinanceApi(req, env, url, method, seg, db, isAdmin, canView('finance'));
    if (result !== null) return result;
  }

  // ── Reports / Engagement / Prayer → api-reports.js ────────────────────────
  if (seg.startsWith('reports/') || seg.startsWith('engagement/') || seg.startsWith('prayer-requests') ||
      seg === 'giving/reconcile-orphans' || seg === 'giving/reconcile-diagnose' ||
      seg === 'giving/force-remove-orphans' ||
      (seg.startsWith('people/') && seg.endsWith('/dismiss-first-gift'))) {
    const result = await handleReportsApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit, givingAnon);
    if (result !== null) return result;
  }

  // ── Attendance ───────────────────────────────────────────────────
  if (seg === 'attendance' && method === 'GET') {
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const type = url.searchParams.get('type') || '';
    const order = (url.searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let sql = 'SELECT * FROM worship_services WHERE service_date BETWEEN ? AND ?';
    const binds = [from, to];
    if (type) { sql += ' AND service_type=?'; binds.push(type); }
    sql += ` ORDER BY service_date ${order}, service_time ASC`;
    const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
    const totalRow = await db.prepare('SELECT COUNT(*) as n FROM worship_services').first();
    return json({ services: rows, total_in_db: totalRow?.n ?? 0 });
  }

  if (seg === 'attendance' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const r = await db.prepare(
      `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(b.service_date||'',b.service_time||'',b.service_name||'',b.service_type||'sunday',
           parseInt(b.attendance)||0,parseInt(b.communion)||0,b.notes||'').run();
    return json({ ok: true, id: r.meta?.last_row_id });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'PUT') {
    const id = parseInt(seg.split('/')[1]);
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    // Merge with existing row so partial updates (attendance only) work
    const existing = await db.prepare('SELECT * FROM worship_services WHERE id=?').bind(id).first();
    if (!existing) return json({ error: 'Not found' }, 404);
    await db.prepare(
      `UPDATE worship_services SET service_date=?,service_time=?,service_name=?,service_type=?,attendance=?,communion=?,notes=? WHERE id=?`
    ).bind(
      b.service_date ?? existing.service_date,
      b.service_time ?? existing.service_time,
      b.service_name ?? existing.service_name,
      b.service_type ?? existing.service_type,
      b.attendance !== undefined ? parseInt(b.attendance)||0 : existing.attendance,
      b.communion !== undefined ? parseInt(b.communion)||0 : existing.communion,
      b.notes !== undefined ? b.notes : existing.notes,
      id
    ).run();
    return json({ ok: true });
  }

  if (seg.match(/^attendance\/\d+$/) && method === 'DELETE') {
    const id = parseInt(seg.split('/')[1]);
    await db.prepare('DELETE FROM worship_services WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // Seed all Sundays for a year with 8:00 and 10:45 services (skips existing)
  if (seg === 'attendance/seed-year' && method === 'POST') {
    let b; try { b = await req.json(); } catch { b = {}; }
    const year = parseInt(b.year) || new Date().getFullYear();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    // Find all Sundays in the year
    const sundays = [];
    const d = new Date(year, 0, 1);
    // Advance to first Sunday
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    while (d.getFullYear() === year) {
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const dateStr = `${year}-${mm}-${dd}`;
      const name = `${months[d.getMonth()]} ${d.getDate()}`;
      sundays.push({ dateStr, name });
      d.setDate(d.getDate() + 7);
    }
    let inserted = 0, skipped = 0;
    for (const { dateStr, name } of sundays) {
      for (const time of ['08:00', '10:45']) {
        const exists = await db.prepare(
          'SELECT id FROM worship_services WHERE service_date=? AND service_time=?'
        ).bind(dateStr, time).first();
        if (exists) { skipped++; continue; }
        await db.prepare(
          `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
           VALUES (?,?,?,?,0,0,?)`
        ).bind(dateStr, time, name, 'sunday', '').run();
        inserted++;
      }
    }
    return json({ ok: true, year, sundays: sundays.length, inserted, skipped });
  }

  if (seg === 'attendance/bulk-sunday' && method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const date = b.service_date || '';
    const name = b.service_name || '';
    const ids = [];
    for (const [time, att, com] of [['08:00', parseInt(b.att_8)||0, parseInt(b.com_8)||0], ['10:45', parseInt(b.att_1045)||0, parseInt(b.com_1045)||0]]) {
      const r = await db.prepare(
        `INSERT INTO worship_services (service_date,service_time,service_name,service_type,attendance,communion,notes)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(date, time, name, 'sunday', att, com, b.notes||'').run();
      ids.push(r.meta?.last_row_id);
    }
    return json({ ok: true, ids });
  }

  if (seg === 'attendance/sunday-name' && method === 'GET') {
    const date = url.searchParams.get('date') || '';
    // Check scheduler_data for custom label
    try {
      const row = await db.prepare("SELECT value FROM scheduler_data WHERE key='ws_sun_labels'").first();
      if (row?.value) {
        const labels = JSON.parse(row.value);
        if (labels[date]) return json({ name: labels[date] });
      }
    } catch {}
    return json({ name: '' });
  }

  if (seg === 'reports/attendance-summary' && method === 'GET') {
    const yearsParam = url.searchParams.get('years') || String(new Date().getFullYear());
    const years = yearsParam.split(',').map(y => y.trim()).filter(Boolean).slice(0, 6);
    // For each year, get monthly Sunday combined totals
    const result = {};
    for (const yr of years) {
      const rows = (await db.prepare(
        `SELECT strftime('%m', service_date) as month,
                ROUND(SUM(attendance) * 1.0 / COUNT(DISTINCT service_date)) as total,
                COUNT(DISTINCT service_date) as sundays,
                SUM(attendance) as monthly_total,
                SUM(CASE WHEN service_time='08:00' THEN attendance ELSE 0 END) as att_8,
                SUM(CASE WHEN service_time='10:45' THEN attendance ELSE 0 END) as att_1045
         FROM worship_services
         WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?
         GROUP BY month ORDER BY month`
      ).bind(yr).all()).results || [];
      result[yr] = rows;
    }
    // Also per-year totals
    const totals = {};
    for (const yr of years) {
      const t = await db.prepare(
        `SELECT SUM(attendance) as total, COUNT(DISTINCT service_date) as sundays
         FROM worship_services WHERE service_type='sunday' AND attendance > 0 AND substr(service_date,1,4)=?`
      ).bind(yr).first();
      totals[yr] = t || { total: 0, sundays: 0 };
    }
    return json({ years, monthly: result, totals });
  }

  if (seg === 'reports/attendance-by-time' && method === 'GET') {
    const yearsParam = url.searchParams.get('years');
    if (yearsParam) {
      const years = yearsParam.split(',').map(y => y.trim()).filter(y => /^\d{4}$/.test(y)).slice(0, 10);
      const by_time_years = {};
      await Promise.all(years.map(async yr => {
        const rows = (await db.prepare(
          `SELECT service_time, service_type,
                  MAX(service_name) as service_name,
                  COUNT(*) as services, SUM(attendance) as total,
                  ROUND(AVG(attendance)) as avg_attendance
           FROM worship_services
           WHERE attendance > 0 AND service_date BETWEEN ? AND ?
           GROUP BY service_type, service_time ORDER BY service_type, service_time`
        ).bind(yr + '-01-01', yr + '-12-31').all()).results || [];
        by_time_years[yr] = rows;
      }));
      return json({ mode: 'multi-year', years, by_time_years });
    }
    const from = url.searchParams.get('from') || (new Date().getFullYear() + '-01-01');
    const to   = url.searchParams.get('to')   || (new Date().getFullYear() + '-12-31');
    const rows = (await db.prepare(
      `SELECT service_time, service_type,
              MAX(service_name) as service_name,
              COUNT(*) as services, SUM(attendance) as total,
              ROUND(AVG(attendance)) as avg_attendance
       FROM worship_services
       WHERE attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_type, service_time ORDER BY service_type, service_time`
    ).bind(from, to).all()).results || [];
    // Sunday combined totals per date
    const sundays = (await db.prepare(
      `SELECT service_date, SUM(attendance) as combined,
              MIN(CASE WHEN service_time='08:00' THEN attendance END) as att_8,
              MIN(CASE WHEN service_time='10:45' THEN attendance END) as att_1045
       FROM worship_services
       WHERE service_type='sunday' AND attendance > 0 AND service_date BETWEEN ? AND ?
       GROUP BY service_date ORDER BY service_date ASC`
    ).bind(from, to).all()).results || [];
    return json({ mode: 'date-range', from, to, by_time: rows, sundays });
  }

  // ── Import / Config / Register / Export / Breeze Sync → api-import.js ──
  return await handleImportApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit);
}

// ── ChMS SEED DEFAULTS ──────────────────────────────────────────────
