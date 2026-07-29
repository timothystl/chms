export const JS_ATTENDANCE = String.raw`// ── ATTENDANCE ────────────────────────────────────────────────────────
// 1a redesign ("This Week · Trends · Festivals · History · Reports") — see CLAUDE.md
// "Attendance / Reports" queued item for the design-handoff summary. Everything below is
// derived client-side from one wide GET /admin/api/attendance load (loadAttendance()); no
// new backend endpoints were added except the pre-existing sunday-name lookup.
var MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var _attTotalInDb = 0;
var ATT_LOOKBACK_YEARS = 5; // heat grid needs the current year + 4 previous years
var _attTab = 'week';
var _attEntryDate = '';
var _attEntryTrailAvg4 = 0;
var ATT_TABS = ['week','trends','festivals','history','reports'];

function loadAttendance() {
  var y = new Date().getFullYear();
  var from = (y - (ATT_LOOKBACK_YEARS - 1)) + '-01-01';
  var to = (y + 1) + '-12-31';
  return api('/admin/api/attendance?from=' + from + '&to=' + to + '&order=asc').then(function(d) {
    _loadedServices = d.services || [];
    _attTotalInDb = d.total_in_db || 0;
    attRenderAll();
  });
}

function attSetTab(tab) {
  _attTab = tab;
  ATT_TABS.forEach(function(t) {
    var b = document.getElementById('att-tab-' + t);
    if (b) b.classList.toggle('active', t === tab);
    var p = document.getElementById('att-panel-' + t);
    if (p) p.classList.toggle('active', t === tab);
  });
}

function attRenderAll() {
  if (!_attEntryDate) _attEntryDate = attNextToRecordDate();
  attEntryLoad(_attEntryDate);
  attRenderStillToEnter();
  attRenderPulse();
  attRenderBars26();
  attRenderHeatGrid();
  attRenderRecent();
  attRenderTrends();
  attRenderFestivals();
  attRenderHistory();
}

// ── Data model ───────────────────────────────────────────────────────
// One row per Sunday date, combining the 08:00 and 10:45 service records (if present).
function attSundayMap() {
  var map = {};
  (_loadedServices || []).forEach(function(s) {
    if (s.service_type !== 'sunday') return;
    if (!map[s.service_date]) map[s.service_date] = { date: s.service_date, att8: 0, att1045: 0, id8: null, id1045: null, name: '', notes: '' };
    var row = map[s.service_date];
    if (s.service_time === '08:00') { row.att8 = s.attendance || 0; row.id8 = s.id; }
    else if (s.service_time === '10:45') { row.att1045 = s.attendance || 0; row.id1045 = s.id; }
    if (s.service_name) row.name = s.service_name;
    if (s.notes) row.notes = s.notes;
  });
  Object.keys(map).forEach(function(d) { map[d].combined = map[d].att8 + map[d].att1045; });
  return map;
}
// Sundays with a recorded (nonzero) combined count, today or earlier, ascending by date.
function attEnteredSundaysAsc() {
  var map = attSundayMap();
  var today = new Date().toISOString().slice(0, 10);
  return Object.keys(map).filter(function(d) { return map[d].combined > 0 && d <= today; })
    .sort().map(function(d) { return map[d]; });
}
function attEnteredBefore(date) {
  return attEnteredSundaysAsc().filter(function(r) { return r.date < date; });
}
function attTrailingAvg(rows, n) {
  if (!rows.length) return 0;
  var slice = rows.slice(Math.max(0, rows.length - n));
  var sum = slice.reduce(function(a, r) { return a + r.combined; }, 0);
  return Math.round(sum / slice.length);
}
function attFmtShort(d) {
  var p = d.split('-');
  return MONTH_NAMES[parseInt(p[1]) - 1] + ' ' + parseInt(p[2]);
}
function attNextSundayOnOrAfter(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return d.toISOString().slice(0, 10);
}
function attTotalOnDate(date) {
  return (_loadedServices || []).filter(function(s) { return s.service_date === date; })
    .reduce(function(s, r) { return s + (r.attendance || 0); }, 0);
}

// ── Still to enter (This Week entry card) ───────────────────────────────
// Every 8:00/10:45 leg with no recorded count, from 8 weeks back through the upcoming
// Sunday (inclusive), so the imminent Sunday shows even before it happens.
function attComputeStillToEnter() {
  var today = new Date().toISOString().slice(0, 10);
  var map = attSundayMap();
  var lookbackWeeks = 8;
  var next = new Date(attNextSundayOnOrAfter(today) + 'T00:00:00');
  var start = new Date(next);
  start.setDate(start.getDate() - 7 * lookbackWeeks);
  var out = [];
  for (var cur = new Date(start); cur <= next; cur.setDate(cur.getDate() + 7)) {
    var ds = cur.toISOString().slice(0, 10);
    var row = map[ds];
    var nm = (row && row.name) || '';
    if (!row || !row.att8) out.push({ date: ds, time: '08:00', label: '8:00 Service', name: nm });
    if (!row || !row.att1045) out.push({ date: ds, time: '10:45', label: '10:45 Service', name: nm });
  }
  return out; // ascending by date, 8:00 before 10:45
}
function attNextToRecordDate() {
  var still = attComputeStillToEnter();
  if (still.length) return still[0].date;
  return attNextSundayOnOrAfter(new Date().toISOString().slice(0, 10));
}
function attRenderStillToEnter() {
  var still = attComputeStillToEnter();
  var badge = document.getElementById('att-still-badge');
  if (badge) badge.textContent = still.length + ' open';
  var el = document.getElementById('att-still-list');
  if (!el) return;
  if (!still.length) { el.innerHTML = '<div class="att-still-empty">All caught up &mdash; nothing missing in the last 8 weeks.</div>'; return; }
  el.innerHTML = still.slice(0, 8).map(function(r) {
    var d2 = new Date(r.date + 'T00:00:00');
    var disp = (d2.getMonth() + 1) + '/' + d2.getDate();
    var desc = (r.name ? esc(r.name) + ' &middot; ' : '') + r.label;
    return '<div class="att-still-row"><div class="att-still-date">' + disp + '</div><div class="att-still-desc">' + desc + '</div>'
      + '<button class="att-still-enter require-edit-attendance" onclick="attEntryLoad(&#39;' + r.date + '&#39;);attSetTab(&#39;week&#39;);">Enter</button></div>';
  }).join('');
}

// ── Entry card ───────────────────────────────────────────────────────
function attEntryLoad(date) {
  _attEntryDate = date;
  var map = attSundayMap();
  var row = map[date] || { att8: 0, att1045: 0, name: '' };
  var in8 = document.getElementById('att-entry-8'), in1045 = document.getElementById('att-entry-1045');
  if (in8) in8.value = row.att8 || '';
  if (in1045) in1045.value = row.att1045 || '';
  var d2 = new Date(date + 'T00:00:00');
  var dispDate = d2.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  var dEl = document.getElementById('att-entry-date');
  if (dEl) dEl.textContent = dispDate;
  var today = new Date().toISOString().slice(0, 10);
  var pillEl = document.getElementById('att-entry-pill');
  if (pillEl) pillEl.textContent = date === today ? 'Due today' : (date < today ? 'Past due' : 'Upcoming');
  var subEl = document.getElementById('att-entry-sub');
  if (subEl) subEl.textContent = row.name || '';
  if (!row.name) attFetchSundayName(date);
  _attEntryTrailAvg4 = attTrailingAvg(attEnteredBefore(date), 4);
  attEntryInputChanged();
}
function attFetchSundayName(date) {
  api('/admin/api/attendance/sunday-name?date=' + encodeURIComponent(date)).then(function(d) {
    if (d && d.name && _attEntryDate === date) {
      var subEl = document.getElementById('att-entry-sub');
      if (subEl) subEl.textContent = d.name;
    }
  });
}
function attEntryInputChanged() {
  var a8 = parseInt((document.getElementById('att-entry-8') || {}).value) || 0;
  var a1045 = parseInt((document.getElementById('att-entry-1045') || {}).value) || 0;
  var combined = a8 + a1045;
  var cEl = document.getElementById('att-entry-combined');
  if (cEl) cEl.textContent = combined;
  var dEl = document.getElementById('att-entry-delta');
  if (!dEl) return;
  if (_attEntryTrailAvg4 > 0) {
    var delta = combined - _attEntryTrailAvg4;
    dEl.textContent = (delta >= 0 ? '+' : '') + delta + ' vs 4-wk avg';
    dEl.className = 'att-delta ' + (delta >= 0 ? 'pos' : 'neg');
  } else {
    dEl.textContent = '';
    dEl.className = 'att-delta';
  }
}
function attSaveEntry() {
  var date = _attEntryDate;
  if (!date) return;
  var a8 = parseInt((document.getElementById('att-entry-8') || {}).value) || 0;
  var a1045 = parseInt((document.getElementById('att-entry-1045') || {}).value) || 0;
  var map = attSundayMap();
  var row = map[date];
  var saves = [];
  if (row && (row.id8 || row.id1045)) {
    // Existing rows for this date — update in place rather than calling bulk-sunday, which
    // always INSERTs new rows (no upsert) and would create duplicates.
    if (row.id8) saves.push(api('/admin/api/attendance/' + row.id8, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance: a8 }) }));
    else if (a8) saves.push(api('/admin/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_date: date, service_time: '08:00', service_name: row.name || '', service_type: 'sunday', attendance: a8 }) }));
    if (row.id1045) saves.push(api('/admin/api/attendance/' + row.id1045, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance: a1045 }) }));
    else if (a1045) saves.push(api('/admin/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_date: date, service_time: '10:45', service_name: row.name || '', service_type: 'sunday', attendance: a1045 }) }));
  } else {
    saves.push(api('/admin/api/attendance/bulk-sunday', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service_date: date, service_name: (row && row.name) || '', att_8: a8, att_1045: a1045 }) }));
  }
  Promise.all(saves).then(function(results) {
    var err = results.filter(Boolean).find(function(r) { return r && r.error; });
    if (err) { alert('Error: ' + err.error); return; }
    loadAttendance().then(function() { attEntryLoad(attNextToRecordDate()); });
  });
}

// ── Pulse card ───────────────────────────────────────────────────────
function attRenderPulse() {
  var entered = attEnteredSundaysAsc();
  var el = document.getElementById('att-pulse-stats');
  if (!el) return;
  if (!entered.length) {
    el.innerHTML = '<span style="font-size:.85rem;color:var(--att-text-2);">No attendance recorded yet.</span>';
    var footE = document.getElementById('att-bars26-foot'); if (footE) footE.innerHTML = '';
    return;
  }
  var latest = entered[entered.length - 1];
  var prior = entered.length > 1 ? entered[entered.length - 2] : null;
  var delta = prior ? latest.combined - prior.combined : null;
  var avg4 = attTrailingAvg(entered, 4);
  var avg52 = attTrailingAvg(entered, 52);
  var today = new Date().toISOString().slice(0, 10);
  var curYear = today.slice(0, 4), priorYear = String(parseInt(curYear) - 1);
  var todayMD = today.slice(5);
  var ytdCur = entered.filter(function(r) { return r.date.slice(0, 4) === curYear; }).reduce(function(s, r) { return s + r.combined; }, 0);
  var ytdPrior = entered.filter(function(r) { return r.date.slice(0, 4) === priorYear && r.date.slice(5) <= todayMD; }).reduce(function(s, r) { return s + r.combined; }, 0);
  var ytdHtml = '';
  if (ytdCur > 0 && ytdPrior > 0) {
    var pct = Math.round((ytdCur - ytdPrior) / ytdPrior * 100);
    ytdHtml = '<div><div class="att-pulse-stat-val" style="color:' + (pct >= 0 ? 'var(--att-pos)' : 'var(--att-neg)') + ';">' + (pct >= 0 ? '+' : '') + pct + '%</div><div class="att-pulse-caption">YTD vs ' + priorYear + '</div></div>';
  }
  var sundaysThisYear = entered.filter(function(r) { return r.date.slice(0, 4) === curYear; }).length;
  var latestParts = latest.date.split('-');
  var latestLbl = MONTH_NAMES[parseInt(latestParts[1]) - 1].toUpperCase() + ' ' + parseInt(latestParts[2]);
  el.innerHTML =
    '<div class="att-pulse-primary"><div class="att-pulse-primary-row"><div class="att-pulse-value">' + latest.combined + '</div>'
    + (delta !== null ? '<div class="att-delta ' + (delta >= 0 ? 'pos' : 'neg') + '" style="font-size:.92rem;font-weight:700;">' + (delta >= 0 ? '+' : '') + delta + ' vs prior week</div>' : '') + '</div>'
    + '<div class="att-pulse-caption">LATEST &middot; ' + latestLbl + '</div></div>'
    + '<div class="att-pulse-divider"></div>'
    + '<div><div class="att-pulse-stat-val">' + avg4 + '</div><div class="att-pulse-caption">4-week avg</div></div>'
    + '<div><div class="att-pulse-stat-val">' + avg52 + '</div><div class="att-pulse-caption">52-week avg</div></div>'
    + ytdHtml
    + '<div><div class="att-pulse-stat-val">' + sundaysThisYear + '</div><div class="att-pulse-caption">Sundays recorded</div></div>';
}
function attRenderBars26() {
  var entered = attEnteredSundaysAsc();
  var last26 = entered.slice(-26);
  var wrap = document.getElementById('att-bars26');
  var foot = document.getElementById('att-bars26-foot');
  if (!wrap || !foot) return;
  if (!last26.length) { wrap.innerHTML = ''; foot.innerHTML = ''; return; }
  var maxV = Math.max.apply(null, last26.map(function(r) { return r.combined; })) || 1;
  wrap.innerHTML = last26.map(function(r) {
    var priorIdx = entered.indexOf(r);
    var priorSlice = entered.slice(Math.max(0, priorIdx - 4), priorIdx);
    var mean = priorSlice.length ? Math.round(priorSlice.reduce(function(a, x) { return a + x.combined; }, 0) / priorSlice.length) : null;
    var cls = (mean === null || r.combined >= mean) ? 'gold' : 'teal';
    var h = Math.max(2, Math.round(r.combined / maxV * 100));
    return '<div class="att-bar26-col"><div class="att-bar26-val">' + r.combined + '</div><div class="att-bar26-bar ' + cls + '" style="height:' + h + '%;" title="' + r.date + ': ' + r.combined + '"></div></div>';
  }).join('');
  foot.innerHTML = '<span>' + attFmtShort(last26[0].date) + '</span><span>' + attFmtShort(last26[last26.length - 1].date) + '</span>';
}

// ── Heat grid: every Sunday, five years ─────────────────────────────────
function attHeatLevelClass(v, q1, q2, q3) {
  if (v <= q1) return '1';
  if (v <= q2) return '2';
  if (v <= q3) return '3';
  return '4';
}
function attRenderHeatGrid() {
  var entered = attEnteredSundaysAsc();
  var wrap = document.getElementById('att-heat-grid');
  var footEl = document.getElementById('att-heat-foot');
  if (!wrap || !footEl) return;
  if (!entered.length) { wrap.innerHTML = '<div style="font-size:.85rem;color:var(--att-text-2);">No attendance recorded yet.</div>'; footEl.innerHTML = ''; return; }
  var vals = entered.map(function(r) { return r.combined; }).sort(function(a, b) { return a - b; });
  function pctile(p) { var idx = Math.min(vals.length - 1, Math.floor(p * vals.length)); return vals[idx]; }
  var q1 = pctile(.25), q2 = pctile(.5), q3 = pctile(.75);
  var byDate = {};
  entered.forEach(function(r) { byDate[r.date] = r.combined; });
  var curYear = new Date().getFullYear();
  var years = [];
  for (var i = ATT_LOOKBACK_YEARS - 1; i >= 0; i--) years.push(curYear - i);
  var rows = years.map(function(yr) {
    var sundays = [];
    var d = new Date(yr, 0, 1);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
    while (d.getFullYear() === yr) { sundays.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 7); }
    sundays = sundays.slice(0, 52);
    var cells = sundays.map(function(ds) {
      var v = byDate[ds] || 0;
      var cls = v > 0 ? attHeatLevelClass(v, q1, q2, q3) : 'empty';
      return '<div class="att-heat-cell heat-' + cls + '" title="' + ds + ': ' + (v || 'no data') + '"></div>';
    }).join('');
    var yrVals = sundays.map(function(ds) { return byDate[ds] || 0; }).filter(function(v) { return v > 0; });
    var avg = yrVals.length ? Math.round(yrVals.reduce(function(a, b) { return a + b; }, 0) / yrVals.length) : 0;
    return '<div class="att-heat-row"><div class="att-heat-year">' + yr + '</div><div class="att-heat-cells">' + cells + '</div><div class="att-heat-avg">' + (avg || '&#8212;') + '</div></div>';
  }).join('');
  wrap.innerHTML = rows;
  var monthTicks = MONTH_NAMES.map(function(m) { return '<span style="flex:1;text-align:center;">' + m + '</span>'; }).join('');
  footEl.innerHTML = '<div style="display:flex;flex:1;">' + monthTicks + '</div>'
    + '<div class="att-heat-legend">fewer '
    + '<span class="att-heat-legend-cell heat-1"></span><span class="att-heat-legend-cell heat-2"></span>'
    + '<span class="att-heat-legend-cell heat-3"></span><span class="att-heat-legend-cell heat-4"></span> fuller</div>';
}

// ── Recent Sundays ───────────────────────────────────────────────────
function attRenderRecent() {
  var entered = attEnteredSundaysAsc();
  var recent = entered.slice(-6).reverse();
  var el = document.getElementById('att-recent-list');
  if (!el) return;
  if (!recent.length) { el.innerHTML = '<div style="padding:10px 0;color:var(--att-text-2);font-size:.85rem;">No Sundays recorded yet.</div>'; return; }
  el.innerHTML = recent.map(function(r) {
    var p = r.date.split('-');
    var disp = (p[1] | 0) + '/' + (p[2] | 0) + '/' + p[0];
    return '<div class="att-recent-row"><div class="att-recent-date">' + disp + '</div><div class="att-recent-name">' + esc(r.name || '') + '</div>'
      + '<div class="att-recent-8">' + r.att8 + '</div><div class="att-recent-1045">' + r.att1045 + '</div><div class="att-recent-total">' + r.combined + '</div></div>';
  }).join('');
}

// ── Trends: monthly rhythm, service mix, year-over-year ─────────────────
var ATT_SEASON = { '01': 'Epiphany', '02': 'Lent', '03': 'Lent', '04': 'Easter', '05': 'Easter', '06': 'summer', '07': 'summer', '08': 'summer', '09': 'fall', '10': 'fall', '11': 'Advent', '12': 'Advent' };
function attRenderTrends() {
  attRenderMonthlyRhythm();
  attRenderServiceMix();
  attRenderYoYTable();
}
function attMonthKeysLast(n) {
  var out = [];
  var d = new Date();
  d.setDate(1);
  for (var i = n - 1; i >= 0; i--) {
    var dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}
function attFmtMonthYr(k) {
  var p = k.split('-');
  return MONTH_NAMES[parseInt(p[1]) - 1] + " '" + p[0].slice(2);
}
function attRenderMonthlyRhythm() {
  var entered = attEnteredSundaysAsc();
  var byMonth = {};
  entered.forEach(function(r) { var mk = r.date.slice(0, 7); if (!byMonth[mk]) byMonth[mk] = []; byMonth[mk].push(r.combined); });
  var keys = attMonthKeysLast(12);
  var avg52 = attTrailingAvg(entered, 52);
  var wrap = document.getElementById('att-month-bars');
  var footWrap = document.getElementById('att-month-foot');
  var subEl = document.getElementById('att-month-subtitle');
  if (!wrap || !footWrap) return;
  var vals = keys.map(function(k) { var arr = byMonth[k]; return arr && arr.length ? Math.round(arr.reduce(function(a, b) { return a + b; }, 0) / arr.length) : null; });
  var withVals = vals.filter(function(v) { return v != null; });
  if (!withVals.length) {
    wrap.innerHTML = '<div style="font-size:.85rem;color:var(--att-text-2);">No attendance recorded yet.</div>';
    footWrap.innerHTML = '';
    if (subEl) subEl.textContent = 'Average Sunday attendance per month';
    return;
  }
  var maxV = Math.max.apply(null, withVals.concat([1]));
  if (subEl) subEl.textContent = 'Average Sunday attendance per month · ' + attFmtMonthYr(keys[0]) + ' – ' + attFmtMonthYr(keys[keys.length - 1]);
  wrap.innerHTML = keys.map(function(k, i) {
    var v = vals[i];
    var h = v ? Math.max(2, Math.round(v / maxV * 100)) : 0;
    var cls = (v != null && v >= avg52) ? 'hi' : 'lo';
    return '<div class="att-month-col"><div class="att-month-val">' + (v != null ? v : '') + '</div><div class="att-month-bar ' + cls + '" style="height:' + h + '%;"></div></div>';
  }).join('');
  footWrap.innerHTML = keys.map(function(k) {
    var mo = k.slice(5, 7);
    return '<div class="att-month-foot-col"><div class="att-month-label">' + MONTH_NAMES[parseInt(mo) - 1] + '</div><div class="att-month-season">' + (ATT_SEASON[mo] || '') + '</div></div>';
  }).join('');
}
function attQuarterKeysLast(n) {
  var now = new Date();
  var y = now.getFullYear(), q = Math.floor(now.getMonth() / 3);
  var out = [];
  for (var i = n - 1; i >= 0; i--) {
    var idx = y * 4 + q - i;
    out.push(Math.floor(idx / 4) + '-Q' + ((idx % 4) + 1));
  }
  return out;
}
function attRenderServiceMix() {
  var byQ = {};
  var today = new Date().toISOString().slice(0, 10);
  (_loadedServices || []).forEach(function(s) {
    if (s.service_type !== 'sunday' || !s.attendance || s.service_date > today) return;
    var y = parseInt(s.service_date.slice(0, 4)), mo = parseInt(s.service_date.slice(5, 7));
    var q = Math.floor((mo - 1) / 3) + 1;
    var k = y + '-Q' + q;
    if (!byQ[k]) byQ[k] = { a8: 0, a1045: 0 };
    if (s.service_time === '08:00') byQ[k].a8 += s.attendance;
    else if (s.service_time === '10:45') byQ[k].a1045 += s.attendance;
  });
  var keys = attQuarterKeysLast(8);
  var el = document.getElementById('att-service-mix');
  if (!el) return;
  var any = keys.some(function(k) { return byQ[k]; });
  if (!any) { el.innerHTML = '<div style="font-size:.85rem;color:var(--att-text-2);">No data yet.</div>'; return; }
  el.innerHTML = keys.map(function(k) {
    var v = byQ[k] || { a8: 0, a1045: 0 };
    var total = v.a8 + v.a1045;
    var pct1045 = total ? Math.round(v.a1045 / total * 100) : 0;
    var w8 = total ? (v.a8 / total * 100) : 0, w1045 = total ? (v.a1045 / total * 100) : 0;
    return '<div class="att-mix-row"><div class="att-mix-hdr"><div class="att-mix-label">' + k + '</div>'
      + '<div><span style="color:var(--att-gold-text);font-weight:700;">' + v.a8 + '</span> &middot; <span style="color:var(--color-teal);font-weight:700;">' + v.a1045 + '</span> &middot; ' + pct1045 + '% at 10:45</div></div>'
      + '<div class="att-mix-track"><div class="att-mix-fill-8" style="width:' + w8 + '%;"></div><div class="att-mix-fill-1045" style="width:' + w1045 + '%;"></div></div></div>';
  }).join('');
}
function attRenderYoYTable() {
  var curYear = new Date().getFullYear();
  var years = [curYear - 2, curYear - 1, curYear];
  var byYM = {};
  attEnteredSundaysAsc().forEach(function(r) {
    var y = parseInt(r.date.slice(0, 4)), m = r.date.slice(5, 7);
    if (years.indexOf(y) < 0) return;
    var k = y + '-' + m;
    if (!byYM[k]) byYM[k] = [];
    byYM[k].push(r.combined);
  });
  function avgFor(y, m) { var arr = byYM[y + '-' + m]; return arr && arr.length ? Math.round(arr.reduce(function(a, b) { return a + b; }, 0) / arr.length) : null; }
  var maxV = 1;
  for (var mm = 1; mm <= 12; mm++) years.forEach(function(y) { var v = avgFor(y, String(mm).padStart(2, '0')); if (v && v > maxV) maxV = v; });
  var yrColors = ['var(--att-yr-1)', 'var(--att-yr-2)', 'var(--att-yr-3)'];
  var hdr = '<div class="att-yoy-hdr"><div></div>' + years.map(function(y) { return '<div style="text-align:right;">' + y + '</div>'; }).join('') + '<div style="text-align:right;">&Delta;</div></div>';
  var rows = '';
  for (var m = 1; m <= 12; m++) {
    var mk = String(m).padStart(2, '0');
    var cells = years.map(function(y, yi) {
      var v = avgFor(y, mk);
      if (v == null) return '<div class="att-yoy-cell"><span style="color:var(--att-text-3);">&#8212;</span></div>';
      var w = Math.max(2, Math.round(v / maxV * 100));
      return '<div class="att-yoy-cell"><div class="att-yoy-bar" style="width:' + w + '%;background:' + yrColors[yi] + ';"></div><div class="att-yoy-num">' + v + '</div></div>';
    }).join('');
    var vLast = avgFor(years[2], mk), vPrior = avgFor(years[1], mk);
    var deltaHtml = '<span style="color:var(--att-text-3);">&#8212;</span>';
    if (vLast != null && vPrior != null) {
      var dv = vLast - vPrior;
      deltaHtml = '<span style="color:' + (dv >= 0 ? 'var(--att-pos)' : 'var(--att-neg)') + ';">' + (dv >= 0 ? '+' : '') + dv + '</span>';
    }
    rows += '<div class="att-yoy-row"><div style="font-size:.78rem;color:var(--att-text-lbl);font-weight:700;">' + MONTH_NAMES[m - 1] + '</div>' + cells + '<div class="att-yoy-delta">' + deltaHtml + '</div></div>';
  }
  var elT = document.getElementById('att-yoy-table');
  if (elT) elT.innerHTML = hdr + rows;
}

// ── Festivals ────────────────────────────────────────────────────────
// Easter via the Meeus/Jones/Butcher Gregorian algorithm (same math previously used for the
// old line chart's Easter marker). Attendance totals sum ALL rows on that date — Easter
// Sunday is normally logged as a regular 'sunday' type service, not 'special'.
function attEasterDate(year) {
  var a = year % 19, b = Math.floor(year / 100), c = year % 100;
  var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  var m = Math.floor((a + 11 * h + 22 * l) / 451);
  var mo = Math.floor((h + l - 7 * m + 114) / 31), dy = (h + l - 7 * m + 114) % 31 + 1;
  return year + '-' + String(mo).padStart(2, '0') + '-' + String(dy).padStart(2, '0');
}
function attAshWednesday(year) {
  var e = new Date(attEasterDate(year) + 'T00:00:00');
  e.setDate(e.getDate() - 46);
  return e.toISOString().slice(0, 10);
}
function attThanksgivingEve(year) {
  var d = new Date(year, 10, 1); // Nov 1
  var day = d.getDay();
  var firstThu = 1 + ((4 - day + 7) % 7);
  var thu = new Date(year, 10, firstThu + 21); // 4th Thursday
  thu.setDate(thu.getDate() - 1);
  return thu.toISOString().slice(0, 10);
}
function attRenderFestivals() {
  var curYear = new Date().getFullYear();
  var years = [curYear - 3, curYear - 2, curYear - 1, curYear];
  var fests = [
    { name: 'Easter', fn: attEasterDate },
    { name: 'Christmas Eve', fn: function(y) { return y + '-12-24'; } },
    { name: 'Ash Wednesday', fn: attAshWednesday },
    { name: 'Thanksgiving Eve', fn: attThanksgivingEve },
  ];
  var el = document.getElementById('att-festivals-grid');
  if (!el) return;
  el.innerHTML = fests.map(function(f) {
    var vals = years.map(function(y) { return { year: y, v: attTotalOnDate(f.fn(y)) }; });
    var withData = vals.filter(function(x) { return x.v > 0; });
    var maxV = Math.max.apply(null, withData.map(function(x) { return x.v; }).concat([1]));
    var last = vals[vals.length - 1], prev = vals[vals.length - 2];
    var deltaHtml = '';
    if (last.v > 0 && prev.v > 0) {
      var pct = Math.round((last.v - prev.v) / prev.v * 100);
      deltaHtml = '<div class="att-fest-delta" style="color:' + (pct >= 0 ? 'var(--att-pos)' : 'var(--att-neg)') + ';">' + (pct >= 0 ? '+' : '') + pct + '% vs last year</div>';
    }
    var bars = vals.map(function(x, i) {
      var h = x.v ? Math.max(3, Math.round(x.v / maxV * 100)) : 0;
      var cls = i === vals.length - 1 ? 'latest' : 'prior';
      return '<div class="att-fest-bar-col"><div class="att-fest-val">' + (x.v || '') + '</div><div class="att-fest-bar ' + cls + '" style="height:' + h + '%;"></div></div>';
    }).join('');
    var yrFoot = vals.map(function(x) { return '<div class="att-fest-yr">' + x.year + '</div>'; }).join('');
    return '<div><div class="att-fest-hdr"><div class="att-fest-name">' + f.name + '</div>' + deltaHtml + '</div>'
      + '<div class="att-fest-bars">' + bars + '</div><div class="att-fest-foot">' + yrFoot + '</div></div>';
  }).join('');
}

// ── History ──────────────────────────────────────────────────────────
function attRenderHistory() {
  var full = attEnteredSundaysAsc();
  var el = document.getElementById('att-hist-rows');
  if (!el) return;
  if (!full.length) { el.innerHTML = '<div style="padding:16px 0;color:var(--att-text-2);font-size:.85rem;">No Sundays recorded yet.</div>'; return; }
  var entered = full.slice().reverse(); // newest first
  el.innerHTML = entered.map(function(r) {
    var idx = full.indexOf(r);
    var priorSlice = full.slice(Math.max(0, idx - 4), idx);
    var mean = priorSlice.length ? Math.round(priorSlice.reduce(function(a, x) { return a + x.combined; }, 0) / priorSlice.length) : null;
    var delta = mean != null ? r.combined - mean : null;
    var p = r.date.split('-');
    var disp = (p[1] | 0) + '/' + (p[2] | 0) + '/' + p[0];
    var dk = r.date.replace(/-/g, '_');
    var deltaHtml = delta != null
      ? '<span style="color:' + (delta >= 0 ? 'var(--att-pos)' : 'var(--att-neg)') + ';">' + (delta >= 0 ? '+' : '') + delta + '</span>'
      : '<span style="color:var(--att-text-3);">&#8212;</span>';
    return '<div>'
      + '<div class="att-hist-row" onclick="toggleAttEdit(&#39;' + dk + '&#39;)">'
      + '<div class="att-hist-date">' + disp + '</div><div class="att-hist-name">' + esc(r.name || '') + '</div>'
      + '<div class="att-hist-8">' + r.att8 + '</div><div class="att-hist-1045">' + r.att1045 + '</div>'
      + '<div class="att-hist-total">' + r.combined + '</div><div class="att-hist-delta">' + deltaHtml + '</div>'
      + '</div>'
      + '<div id="att-edit-' + dk + '" class="att-inline-form" style="display:none;">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px;">'
      + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--color-navy);margin-bottom:3px;">8:00 Attendance</div>'
      + '<input type="number" id="ai8-' + dk + '" min="0" value="' + r.att8 + '" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
      + '<div><div style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--color-navy);margin-bottom:3px;">10:45 Attendance</div>'
      + '<input type="number" id="ai1045-' + dk + '" min="0" value="' + r.att1045 + '" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
      + '</div>'
      + '<div style="margin-bottom:10px;"><input type="text" id="ainotes-' + dk + '" value="' + esc(r.notes || '') + '" placeholder="Notes&hellip;" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;"></div>'
      + '<div class="att-btn-row require-edit-attendance">'
      + '<button class="att-btn-primary" style="padding:7px 16px;" onclick="saveInlineAttEdit(&#39;' + dk + '&#39;,' + (r.id8 || 'null') + ',' + (r.id1045 || 'null') + ')">Save</button>'
      + '<button class="att-btn-secondary" style="padding:7px 16px;" onclick="toggleAttEdit(&#39;' + dk + '&#39;)">Cancel</button>'
      + '<button class="btn-danger" style="margin-left:auto;" onclick="deleteAttDate(&#39;' + dk + '&#39;,[' + [r.id8, r.id1045].filter(Boolean).join(',') + '])">Delete</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}
function attCsvCell(v) {
  v = (v === null || v === undefined) ? '' : String(v);
  if (/^[=+\-@]/.test(v)) v = "'" + v; // guard against Excel formula injection, same pattern as SW15
  if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function attExportHistoryCsv() {
  var rows = [['Date', 'Sunday', '8:00', '10:45', 'Total']];
  attEnteredSundaysAsc().slice().reverse().forEach(function(r) {
    rows.push([r.date, r.name || '', r.att8, r.att1045, r.combined]);
  });
  var csv = rows.map(function(r) { return r.map(attCsvCell).join(','); }).join('\n');
  var blob = new Blob([csv + '\n'], { type: 'text/csv' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'attendance-history-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}
function toggleAttEdit(dk) {
  var form = document.getElementById('att-edit-' + dk);
  if (!form) return;
  var isOpen = form.style.display !== 'none';
  document.querySelectorAll('.att-inline-form').forEach(function(f) { f.style.display = 'none'; });
  if (!isOpen) {
    form.style.display = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    var inp = form.querySelector('input[type=number]');
    if (inp) { inp.focus(); inp.select(); }
  }
}
function saveInlineAttEdit(dk, id8, id1045) {
  var att8 = parseInt(document.getElementById('ai8-' + dk).value) || 0;
  var att1045 = parseInt(document.getElementById('ai1045-' + dk).value) || 0;
  var notes = document.getElementById('ainotes-' + dk).value;
  var saves = [];
  if (id8) saves.push(api('/admin/api/attendance/' + id8, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance: att8, notes: notes }) }));
  if (id1045) saves.push(api('/admin/api/attendance/' + id1045, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance: att1045, notes: notes }) }));
  Promise.all(saves).then(function() { loadAttendance(); });
}
function saveInlineSingle(ids, dk) {
  var saves = ids.map(function(id) {
    var val = parseInt(document.getElementById('aisingle-' + id).value) || 0;
    return api('/admin/api/attendance/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance: val }) });
  });
  Promise.all(saves).then(function() { loadAttendance(); });
}
function deleteAttDate(dk, ids) {
  if (!confirm('Delete these service records?')) return;
  Promise.all(ids.map(function(id) { return api('/admin/api/attendance/' + id, { method: 'DELETE' }); })).then(function() { loadAttendance(); });
}
function seedYearSundays() {
  var year = new Date().getFullYear();
  var yn = prompt('Seed all Sundays for which year?', year);
  if (!yn) return;
  year = parseInt(yn);
  if (isNaN(year)) return;
  api('/admin/api/attendance/seed-year', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: year }) }).then(function(d) {
    if (d.ok) { alert('Added ' + (d.inserted / 2) + ' Sundays for ' + d.year + ' (' + (d.skipped / 2) + ' already existed).'); loadAttendance(); }
  });
}

// ── Add special / midweek service (entry card secondary action) ────────
function openSpecialServiceEntry() {
  var el = document.getElementById('att-add-form');
  el.style.display = '';
  el.innerHTML = '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:14px;">Add Special / Midweek Service</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Date</label><input type="date" id="spf-date" value="'+new Date().toISOString().slice(0,10)+'" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Type</label>'
    + '<select id="spf-type" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;font-size:.9rem;">'
    + '<option value="special">Special (Christmas, Easter Vigil, Good Friday…)</option>'
    + '<option value="midweek">Midweek (Ash Wednesday, Lent, Advent…)</option>'
    + '</select></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Service Name</label>'
    + '<input type="text" id="spf-name" list="spf-name-suggestions" placeholder="e.g. Christmas Eve" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;">'
    + '<datalist id="spf-name-suggestions"><option value="Christmas Eve"><option value="Christmas Day"><option value="Good Friday"><option value="Maundy Thursday"><option value="Easter Vigil"><option value="Ash Wednesday"><option value="Thanksgiving Eve"><option value="Advent Midweek"><option value="Lenten Midweek"></datalist></div>'
    + '<div><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--steel-anchor);">Attendance</label><input type="number" id="spf-att" min="0" placeholder="0" style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:1rem;font-weight:700;"></div>'
    + '</div>'
    + '<div style="margin-bottom:12px;"><label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--warm-gray);">Time (optional)</label><input type="time" id="spf-time" placeholder="e.g. 19:00" style="width:100%;padding:6px;border:1px solid var(--border);border-radius:6px;"></div>'
    + '<div style="display:flex;gap:8px;"><button class="btn-primary" onclick="saveSpecialService()">Save</button><button class="btn-secondary" onclick="document.getElementById(\'att-add-form\').style.display=\'none\'">Cancel</button></div>';
}
function saveSpecialService() {
  var date = document.getElementById('spf-date').value;
  var name = (document.getElementById('spf-name').value || '').trim();
  var att  = parseInt(document.getElementById('spf-att').value) || 0;
  var type = document.getElementById('spf-type').value;
  var time = document.getElementById('spf-time').value || '';
  if (!date) { alert('Please enter a date.'); return; }
  if (!name) { alert('Please enter a service name.'); return; }
  if (!att)  { alert('Please enter attendance.'); return; }
  api('/admin/api/attendance', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ service_date:date, service_name:name, service_type:type, service_time:time, attendance:att })
  }).then(function(d) {
    if (d.error) { alert('Error: ' + d.error); return; }
    document.getElementById('att-add-form').style.display = 'none';
    loadAttendance();
  });
}

// ── Reports tab ──────────────────────────────────────────────────────
function attRunGivingVsAttendance() {
  var from = document.getElementById('att-gva-from').value;
  var to = document.getElementById('att-gva-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-vs-attendance?from=' + from + '&to=' + to).then(function(d) {
    if (d.error) { alert(d.error); return; }
    showAttRptOutput(renderGivingVsAttendance(d));
  });
}
function attRunCouncilPacket() {
  var entered = attEnteredSundaysAsc();
  var last8 = entered.slice(-8).reverse();
  var latest = entered.length ? entered[entered.length - 1] : null;
  var avg4 = attTrailingAvg(entered, 4), avg52 = attTrailingAvg(entered, 52);
  var rows = last8.map(function(r) {
    var p = r.date.split('-');
    return '<tr><td>' + ((p[1] | 0) + '/' + (p[2] | 0) + '/' + p[0]) + '</td><td>' + esc(r.name || '') + '</td><td style="text-align:right;">' + r.att8 + '</td><td style="text-align:right;">' + r.att1045 + '</td><td style="text-align:right;font-weight:700;">' + r.combined + '</td></tr>';
  }).join('');
  var html = '<div id="att-packet"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
    + '<h3 style="font-family:var(--font-head);color:var(--color-navy);">Council Attendance Packet</h3>'
    + '<button class="att-btn-secondary" onclick="attPrintPacket()">Print</button></div>'
    + '<div class="rpt-overview" style="margin-bottom:14px;">'
    + (latest ? '<div class="rpt-stat"><div class="rpt-stat-num">' + latest.combined + '</div><div class="rpt-stat-lbl">Latest Sunday</div></div>' : '')
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + avg4 + '</div><div class="rpt-stat-lbl">4-week avg</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + avg52 + '</div><div class="rpt-stat-lbl">52-week avg</div></div>'
    + '</div>'
    + (rows ? '<table class="rpt-table"><thead><tr><th>Date</th><th>Sunday</th><th style="text-align:right;">8:00</th><th style="text-align:right;">10:45</th><th style="text-align:right;">Total</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div style="color:var(--att-text-2);">No Sundays recorded yet.</div>')
    + '</div>';
  showAttRptOutput(html);
}
function attPrintPacket() {
  document.body.classList.add('printing-att-packet');
  var cleanup = function() { document.body.classList.remove('printing-att-packet'); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(function() { window.print(); setTimeout(cleanup, 1000); }, 60);
}

function _chartResizeHandle(fnName) {
  return '<div style="height:14px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;margin:2px 0;opacity:0.4;touch-action:none;" onmousedown="'+fnName+'(event)" ontouchstart="'+fnName+'(event)" title="Drag to resize chart"><div style="width:32px;height:3px;background:var(--warm-gray);border-radius:2px;"></div></div>';
}

// Returns vertical screen position whether the event is mouse or touch.
function _ptrY(e) {
  if (e.touches && e.touches.length) return e.touches[0].clientY;
  if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
  return e.clientY;
}

// ── Report chart resize (YoY att, by-service att, giving trend) — shared with js-reports.js ──
var _rptResizing = false, _rptResizeStartY = 0, _rptResizeStartH = 0, _rptResizeRaf = 0, _rptResizeKey = '';
function _rptResizeStart(e, key, h0) {
  _rptResizing = true; _rptResizeKey = key; _rptResizeStartY = _ptrY(e); _rptResizeStartH = h0;
  if (e.preventDefault) e.preventDefault();
  document.addEventListener('mousemove', _rptResizeMoveH);
  document.addEventListener('mouseup', _rptResizeEndH);
  document.addEventListener('touchmove', _rptResizeMoveH, { passive: false });
  document.addEventListener('touchend', _rptResizeEndH);
  document.addEventListener('touchcancel', _rptResizeEndH);
}
var _rptResizeMoveH = function(e) {
  if (!_rptResizing) return;
  if (e.cancelable && e.touches) e.preventDefault();
  var y = _ptrY(e);
  cancelAnimationFrame(_rptResizeRaf);
  _rptResizeRaf = requestAnimationFrame(function() {
    var newH = Math.max(120, Math.min(600, _rptResizeStartH + y - _rptResizeStartY));
    if (_rptResizeKey === 'yoy') {
      _yoyRptH = newH;
      var w = document.getElementById('att-yoy-chart-wrap');
      if (w && _lastYoYRptData) w.innerHTML = renderYoYChart(_lastYoYRptData, newH);
    } else if (_rptResizeKey === 'byService') {
      _byServiceRptH = newH;
      var w = document.getElementById('att-service-chart-wrap');
      if (w && _lastByServiceRptData) w.innerHTML = _lastByServiceRptData.mode === 'multi-year'
        ? renderMultiYearServiceChart(_lastByServiceRptData, newH)
        : renderByServiceChart(_lastByServiceRptData, newH);
    } else if (_rptResizeKey === 'givingTrend') {
      _givingTrendH = newH;
      var w = document.getElementById('giving-trend-svg-wrap');
      // Redraw via the single shared renderer (js-reports.js) instead of a second hand-inlined
      // copy of the same chart — the inlined copy had drifted (hardcoded Dec-25-marker year)
      // before this fix. renderGivingTrendChart() returns a full card wrapper with its own
      // #giving-trend-svg-wrap; re-target just the <svg> so the drag-resize keeps updating
      // in place without replacing the wrapper element mid-drag.
      if (w && _lastGivingTrendData) {
        var fullCard = renderGivingTrendChart(_lastGivingTrendData, newH);
        var svgMatch = fullCard.match(/<svg[\s\S]*?<\/svg>/);
        if (svgMatch) w.innerHTML = svgMatch[0];
      }
    }
  });
};
var _rptResizeEndH = function() {
  _rptResizing = false;
  document.removeEventListener('mousemove', _rptResizeMoveH);
  document.removeEventListener('mouseup', _rptResizeEndH);
  document.removeEventListener('touchmove', _rptResizeMoveH);
  document.removeEventListener('touchend', _rptResizeEndH);
  document.removeEventListener('touchcancel', _rptResizeEndH);
};
function yoyRptResizeStart(e) { _rptResizeStart(e, 'yoy', _yoyRptH); }
function byServiceResizeStart(e) { _rptResizeStart(e, 'byService', _byServiceRptH); }
function givingTrendResizeStart(e) { _rptResizeStart(e, 'givingTrend', _givingTrendH); }

function renderYoYChart(d, chartH) {
  var palette=['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var mShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var W=800,H=chartH||200,pL=36,pR=12,pT=12,pB=36,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  d.years.forEach(function(yr){
    for(var mo=1;mo<=12;mo++){
      var ms=mo<10?'0'+mo:''+mo;
      var row=(d.monthly[yr]||[]).find(function(r){return r.month===ms;});
      if(row&&row.total) allV.push(row.total);
    }
  });
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxY=function(i){return pL+i*(cW/11);};
  var pyY=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',lines='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyY(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  for(var xi=0;xi<12;xi++){
    xlbls+='<text x="'+pxY(xi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+mShort[xi]+'</text>';
  }
  var legend='<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px;justify-content:center;">';
  d.years.forEach(function(yr,yi){
    var color=palette[yi%palette.length];
    var pts=[];
    for(var mo2=1;mo2<=12;mo2++){
      var ms2=mo2<10?'0'+mo2:''+mo2;
      var row2=(d.monthly[yr]||[]).find(function(r){return r.month===ms2;});
      if(row2&&row2.total) pts.push({x:pxY(mo2-1),y:pyY(row2.total),v:row2.total,mi:mo2-1});
    }
    if(!pts.length) return;
    var pathD=pts.map(function(p,j){return(j?'L ':'M ')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    lines+='<path d="'+pathD+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linejoin="round"/>';
    pts.forEach(function(p){
      lines+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" fill="'+color+'"><title>'+mShort[p.mi]+' '+yr+': '+p.v+'</title></circle>';
    });
    legend+='<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:14px;height:14px;background:'+color+';border-radius:3px;flex-shrink:0;"></span>'+yr+'</span>';
  });
  legend+='</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+lines+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">Year-over-Year Trend</div>'+svg+legend+'</div>';
}

function renderByServiceChart(d, chartH) {
  var sundays=d.sundays||[];
  if(sundays.length>52) sundays=sundays.slice(sundays.length-52);
  var n=sundays.length;
  if(!n) return '';
  var W=800,H=chartH||180,pL=36,pR=12,pT=12,pB=32,cW=W-pL-pR,cH=H-pT-pB;
  var allV=[];
  sundays.forEach(function(s){if(s.att_8)allV.push(s.att_8);if(s.att_1045)allV.push(s.att_1045);});
  if(!allV.length) return '';
  var maxV=Math.max.apply(null,allV)*1.1;
  var pxS=function(i){return pL+(i/(n>1?n-1:1))*cW;};
  var pyS=function(v){return pT+cH-(v/maxV)*cH;};
  var grid='',ylbls='',xlbls='',line8='',line1045='';
  [0,Math.round(maxV*0.5/1.1),Math.round(maxV/1.1)].forEach(function(v){
    var yy=pyS(v);
    grid+='<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls+='<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+Math.round(v)+'</text>';
  });
  var stepS=Math.max(1,Math.ceil(n/8));
  for(var si=0;si<n;si+=stepS){
    var sp=sundays[si].service_date.split('-');
    xlbls+='<text x="'+pxS(si).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+MONTH_NAMES[parseInt(sp[1])-1]+' '+parseInt(sp[2])+'</text>';
  }
  var pts8=[],pts1045=[];
  sundays.forEach(function(s,i){
    if(s.att_8) pts8.push([pxS(i),pyS(s.att_8),s.att_8,s.service_date]);
    if(s.att_1045) pts1045.push([pxS(i),pyS(s.att_1045),s.att_1045,s.service_date]);
  });
  if(pts8.length){
    line8='<path d="'+pts8.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#C9973A" stroke-width="2" stroke-linejoin="round"/>';
    pts8.forEach(function(p){line8+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#C9973A"><title>'+p[3]+' 8am: '+p[2]+'</title></circle>';});
  }
  if(pts1045.length){
    line1045='<path d="'+pts1045.map(function(p,j){return(j?'L ':'M ')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ')+'" fill="none" stroke="#2E7EA6" stroke-width="2" stroke-linejoin="round"/>';
    pts1045.forEach(function(p){line1045+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.5" fill="#2E7EA6"><title>'+p[3]+' 10:45am: '+p[2]+'</title></circle>';});
  }
  var legend='<div style="display:flex;gap:16px;margin-top:6px;justify-content:center;">'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#C9973A;"></span>8am</span>'
    +'<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:24px;height:3px;background:#2E7EA6;"></span>10:45am</span>'
    +'</div>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+line8+line1045+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;"><div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">8am vs 10:45am Trend</div>'+svg+legend+'</div>';
}

function _buildAttYoYHtml(d, h) {
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var html = '<div id="att-yoy-chart-wrap">'+renderYoYChart(d, h)+'</div>';
  html += _chartResizeHandle('yoyRptResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:4px;">Attendance Year-over-Year (Sunday Combined)</div>';
  html += '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:12px;">Monthly values show average Sunday attendance for that month.</div>';
  html += '<table class="rpt-table"><thead><tr><th>Month</th>';
  d.years.forEach(function(yr) { html += '<th style="text-align:right;">'+yr+'<br><span style="font-weight:400;font-size:.75rem;">avg/Sun</span></th>'; });
  html += '</tr></thead><tbody>';
  for (var m = 1; m <= 12; m++) {
    var mStr = String(m).padStart(2, '0');
    html += '<tr><td>' + months[m-1] + '</td>';
    d.years.forEach(function(yr) {
      var row = (d.monthly[yr] || []).find(function(r) { return r.month === mStr; });
      var cell = row ? row.total + '<span style="color:var(--warm-gray);font-size:.75rem;"> ('+row.sundays+')</span>' : '—';
      html += '<td style="text-align:right;">' + cell + '</td>';
    });
    html += '</tr>';
  }
  html += '<tr class="rpt-total"><td>Annual Total</td>';
  d.years.forEach(function(yr) { html += '<td style="text-align:right;">' + ((d.totals[yr] || {}).total || 0) + '</td>'; });
  html += '</tr><tr><td style="color:var(--warm-gray);font-size:.82rem;">Sundays recorded</td>';
  d.years.forEach(function(yr) { html += '<td style="text-align:right;color:var(--warm-gray);font-size:.82rem;">' + ((d.totals[yr] || {}).sundays || 0) + '</td>'; });
  html += '</tr></tbody></table><div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}
function _buildAttByServiceHtml(d, h) {
  var html = '<div id="att-service-chart-wrap">'+renderByServiceChart(d, h)+'</div>';
  html += _chartResizeHandle('byServiceResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:12px;">Attendance by Service Time</div>';
  html += '<table class="rpt-table" style="margin-bottom:16px;"><thead><tr><th>Service</th><th style="text-align:right;">Services</th><th style="text-align:right;">Total</th><th style="text-align:right;">Avg/Service</th></tr></thead><tbody>';
  (d.by_time || []).forEach(function(r) {
    var lbl = r.service_name || (r.service_time === '08:00' ? '8am Service' : r.service_time === '10:45' ? '10:45am Service' : esc(r.service_time));
    html += '<tr><td>' + esc(lbl) + '</td><td style="text-align:right;">' + r.services + '</td><td style="text-align:right;">' + r.total + '</td><td style="text-align:right;">' + r.avg_attendance + '</td></tr>';
  });
  html += '</tbody></table>';
  if (d.sundays && d.sundays.length) {
    html += '<div style="font-weight:700;color:var(--steel-anchor);font-size:.88rem;margin-bottom:8px;">Sunday Combined Totals</div>';
    html += '<table class="rpt-table"><thead><tr><th>Date</th><th style="text-align:right;">8am</th><th style="text-align:right;">10:45am</th><th style="text-align:right;">Combined</th></tr></thead><tbody>';
    d.sundays.forEach(function(r) {
      var parts = r.service_date.split('-');
      html += '<tr><td>' + ((parts[1]|0)+'/'+((parts[2]|0))+'/'+parts[0]) + '</td><td style="text-align:right;">' + (r.att_8 || '—') + '</td><td style="text-align:right;">' + (r.att_1045 || '—') + '</td><td style="text-align:right;font-weight:600;">' + r.combined + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}
function runAttendanceSummary() {
  var years = [];
  document.querySelectorAll('#rpt-att-years input[type=checkbox]:checked').forEach(function(cb) { years.push(cb.value); });
  if (!years.length) { alert('Select at least one year.'); return; }
  api('/admin/api/reports/attendance-summary?years=' + encodeURIComponent(years.join(','))).then(function(d) {
    _lastYoYRptData = d;
    showAttRptOutput(_buildAttYoYHtml(d, _yoyRptH));
  });
}
function setAttByServiceMode(mode) {
  _attSvcMode = mode;
  document.getElementById('att-svc-range-inputs').style.display = mode === 'range' ? '' : 'none';
  document.getElementById('att-svc-years-inputs').style.display = mode === 'years' ? '' : 'none';
  document.getElementById('att-svc-mode-range').classList.toggle('active', mode === 'range');
  document.getElementById('att-svc-mode-years').classList.toggle('active', mode === 'years');
}
function runAttendanceByTime() {
  if (_attSvcMode === 'years') {
    var years = [];
    document.querySelectorAll('#rpt-att-svc-years input[type=checkbox]:checked').forEach(function(cb) { years.push(cb.value); });
    if (!years.length) { alert('Select at least one year.'); return; }
    api('/admin/api/reports/attendance-by-time?years=' + encodeURIComponent(years.join(','))).then(function(d) {
      _lastByServiceRptData = d;
      showAttRptOutput(_buildAttByServiceMultiYearHtml(d, _byServiceRptH));
    });
  } else {
    var from = document.getElementById('rpt-att-from').value;
    var to = document.getElementById('rpt-att-to').value;
    api('/admin/api/reports/attendance-by-time?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to)).then(function(d) {
      _lastByServiceRptData = d;
      showAttRptOutput(_buildAttByServiceHtml(d, _byServiceRptH));
    });
  }
}
// Generic grouped-bar-chart renderer, shared across Attendance and Finance. One call renders
// N series (colored bars) across M groups (x-axis categories) — e.g. one bar per year within
// each service-time group (Attendance), or one bar per This-Year/Last-Year/Projected within
// each Income/Expenses/Net group (Finance). Returns '' when there's no data to plot, same as
// the chart functions built on it always did.
//   opts.groups:  [{key, label}]                — x-axis categories, in display order
//   opts.series:  [{key, label, color}]          — one bar per series within every group
//   opts.value(groupKey, seriesKey)              — returns the numeric value, or null/undefined to skip that bar
//   opts.tooltip(groupKey, seriesKey, value)      — optional; defaults to "<seriesLabel> <groupLabel>: <value>"
//   opts.chartH, opts.title, opts.barLabel(v)     — optional height/title/on-bar-label formatter
function renderGroupedBarChart(opts) {
  var groups = opts.groups || [], series = opts.series || [];
  if (!groups.length || !series.length) return '';
  var W = 800, H = opts.chartH || 180, pL = 40, pR = 16, pT = 12, pB = 40;
  var cW = W - pL - pR, cH = H - pT - pB;
  var maxV = 0;
  groups.forEach(function(g) {
    series.forEach(function(s) {
      var v = opts.value(g.key, s.key);
      if (v != null && v > maxV) maxV = v;
    });
  });
  if (!maxV) return '';
  maxV = maxV * 1.15;
  var groupW = cW / groups.length;
  var barW = Math.max(4, Math.min(30, (groupW * 0.8) / series.length));
  var groupGap = (groupW - barW * series.length) / 2;
  var pyV = function(v) { return pT + cH - (v / maxV) * cH; };
  var grid = '', ylbls = '', xlbls = '', bars = '';
  [0, Math.round(maxV * 0.5 / 1.15), Math.round(maxV / 1.15)].forEach(function(v) {
    var yy = pyV(v);
    grid += '<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls += '<text x="'+(pL-4)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">'+(opts.barLabel ? opts.barLabel(v) : Math.round(v))+'</text>';
  });
  groups.forEach(function(g, gi) {
    var cx = pL + gi * groupW + groupW / 2;
    xlbls += '<text x="'+cx.toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="10">'+g.label+'</text>';
  });
  series.forEach(function(s, si) {
    groups.forEach(function(g, gi) {
      var v = opts.value(g.key, s.key);
      if (v == null) return;
      var x = pL + gi * groupW + groupGap + si * barW;
      var bH = Math.max(1, (v / maxV) * cH);
      var barY = pT + cH - bH;
      var tip = opts.tooltip ? opts.tooltip(g.key, s.key, v) : (s.label + ' ' + g.label + ': ' + v);
      bars += '<rect x="'+x.toFixed(1)+'" y="'+barY.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bH.toFixed(1)+'" fill="'+s.color+'" rx="2"><title>'+tip+'</title></rect>';
      var lbl = opts.barLabel ? opts.barLabel(v) : Math.round(v);
      if (bH > 14) bars += '<text x="'+(x+barW/2).toFixed(1)+'" y="'+(barY+bH-3).toFixed(1)+'" text-anchor="middle" fill="#fff" font-size="8">'+lbl+'</text>';
    });
  });
  var legend = '<div style="display:flex;gap:12px;margin-top:6px;justify-content:center;flex-wrap:wrap;">';
  series.forEach(function(s) {
    legend += '<span style="display:flex;align-items:center;gap:5px;font-size:.8rem;"><span style="display:inline-block;width:14px;height:14px;background:'+s.color+';border-radius:3px;flex-shrink:0;"></span>'+s.label+'</span>';
  });
  legend += '</div>';
  var svg = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+bars+xlbls+ylbls+'</svg>';
  var titleHtml = opts.title ? '<div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:8px;">'+opts.title+'</div>' : '';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;margin-bottom:16px;">'+titleHtml+svg+legend+'</div>';
}
function renderMultiYearServiceChart(d, chartH) {
  var years = d.years || [];
  var palette = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var timesSet = {};
  years.forEach(function(yr) {
    (d.by_time_years[yr] || []).forEach(function(r) {
      if (r.service_type === 'sunday') timesSet[r.service_time] = r.service_name || r.service_time;
    });
  });
  var times = Object.keys(timesSet).sort();
  if (!years.length || !times.length) return '';
  var byTimeYear = {};
  years.forEach(function(yr) {
    byTimeYear[yr] = {};
    (d.by_time_years[yr] || []).forEach(function(r) { if (r.service_type === 'sunday') byTimeYear[yr][r.service_time] = r; });
  });
  function timeLabel(t) { return t === '08:00' ? '8am' : t === '10:45' ? '10:45am' : t; }
  return renderGroupedBarChart({
    title: 'Avg Attendance by Service Time',
    chartH: chartH,
    groups: times.map(function(t) { return { key: t, label: timeLabel(t) }; }),
    series: years.map(function(yr, yi) { return { key: yr, label: String(yr), color: palette[yi % palette.length] }; }),
    value: function(t, yr) { var r = byTimeYear[yr][t]; return r ? r.avg_attendance : null; },
    tooltip: function(t, yr, v) {
      var r = byTimeYear[yr][t];
      return yr + ' ' + timeLabel(t) + ': avg ' + v + ', total ' + r.total + ', ' + r.services + ' services';
    },
  });
}
function _buildAttByServiceMultiYearHtml(d, h) {
  var years = d.years || [];
  var html = '<div id="att-service-chart-wrap">'+renderMultiYearServiceChart(d, h)+'</div>';
  html += _chartResizeHandle('byServiceResizeStart');
  html += '<div style="font-family:var(--font-head);font-size:1rem;color:var(--steel-anchor);margin-bottom:12px;">Attendance by Service — Multi-Year</div>';
  html += '<table class="rpt-table" style="margin-bottom:16px;"><thead><tr><th>Service</th>';
  years.forEach(function(yr) { html += '<th style="text-align:right;">'+esc(yr)+' Avg</th><th style="text-align:right;">'+esc(yr)+' Total</th>'; });
  html += '</tr></thead><tbody>';
  var timesMap = {};
  years.forEach(function(yr) {
    (d.by_time_years[yr] || []).forEach(function(r) { if (r.service_type === 'sunday') timesMap[r.service_time] = r.service_name || r.service_time; });
  });
  Object.keys(timesMap).sort().forEach(function(t) {
    var lbl = t === '08:00' ? '8am Service' : t === '10:45' ? '10:45am Service' : esc(timesMap[t]);
    html += '<tr><td>'+lbl+'</td>';
    years.forEach(function(yr) {
      var byTime = {};
      (d.by_time_years[yr] || []).forEach(function(r) { byTime[r.service_time] = r; });
      var r = byTime[t];
      html += '<td style="text-align:right;">'+(r ? r.avg_attendance : '—')+'</td><td style="text-align:right;">'+(r ? r.total : '—')+'</td>';
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button></div>';
  return html;
}

`;
