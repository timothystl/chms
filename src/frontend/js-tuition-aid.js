export const JS_TUITION_AID = String.raw`// ── TUITION AID PLANNER ──────────────────────────────────────────────
var TAP_GRADE_SEQ = ["PK 3","PK 4","K","1","2","3","4","5","6","7","8","9","10","11","12"];
var _tapConfig = {};
var _tapHistory = [];
var _tapRoster = [];
var _tapYearIdx = 0;
var _tapProjYears = [];
var _tapAllYearOptions = [];
var _tapYearRates = {};
var _tapStudentYears = [];
var _tapPinsByKey = {};
var _tapSaveTimers = {};
var _tapPendingFields = {};
var _tapLinkTargetId = null;
var _tapHistoryTargetId = null;
var _tapImportRecords = [];
var _tapImportUnresolved = [];

function tapApplyBundle(d) {
  _tapConfig = d.config || {};
  _tapHistory = d.history || [];
  _tapRoster = (d.students || []).map(tapFromServerRow);
  _tapYearRates = {};
  (d.yearRates || []).forEach(function(r) { _tapYearRates[r.school_year] = r.tuition_cents; });
  _tapStudentYears = d.studentYears || [];
  tapIndexPins();
}
function loadTuitionAid() {
  var loadingEl = document.getElementById('tap-loading');
  var rootEl = document.getElementById('tap-root');
  loadingEl.style.display = '';
  loadingEl.textContent = 'Loading…';
  rootEl.style.display = 'none';
  api('/admin/api/tuition-aid/students').then(function(d) {
    tapApplyBundle(d);
    _tapYearIdx = 0;
    tapBuildYearOptions();
    loadingEl.style.display = 'none';
    rootEl.style.display = '';
    tapRenderAll();
  }).catch(function(err) {
    if (err && err.message === 'Unauthorized') return;
    loadingEl.textContent = 'Could not load tuition aid data.';
  });
}
// Re-fetches the bundle without resetting the currently-viewed year (unlike loadTuitionAid,
// which always jumps back to "today" — used after adding a historical record so the admin
// stays on the past year they were just working in).
function tapReloadKeepingYear() {
  return api('/admin/api/tuition-aid/students').then(function(d) {
    tapApplyBundle(d);
    tapBuildYearOptions();
    if (_tapYearIdx < 0) { tapRenderPastYearTable(); } else { tapRenderAll(); }
  });
}

// ── Per-year pin cache (outside aid / awards that differ year to year) ──────
function tapSchoolYearLabel(y) {
  var yy = (y + 1) % 100;
  return y + '-' + (yy < 10 ? '0' + yy : yy);
}
function tapYearLabelForIdx(yearIdx) {
  var baseYear = tapCfgNum('base_school_year', 2026);
  return tapSchoolYearLabel(baseYear + yearIdx);
}
function tapIndexPins() {
  _tapPinsByKey = {};
  _tapStudentYears.forEach(function(row) { _tapPinsByKey[row.student_id + '|' + row.school_year] = row; });
}
function tapPinFor(studentId, yearIdx) {
  return _tapPinsByKey[studentId + '|' + tapYearLabelForIdx(yearIdx)] || null;
}
function tapUpsertPinLocal(studentId, yearIdx, fields) {
  var label = tapYearLabelForIdx(yearIdx);
  var key = studentId + '|' + label;
  var row = _tapPinsByKey[key];
  if (!row) {
    row = { student_id: studentId, school_year: label, grade: '', outside_aid_cents: null, fam_pct: null,
      timothy_award_cents: null, family_owed_cents: null, lhs_award_cents: null, note: '' };
    _tapPinsByKey[key] = row;
    _tapStudentYears.push(row);
  }
  Object.keys(fields).forEach(function(k) { row[k] = fields[k]; });
  return row;
}
function tapSavePinDebounced(studentId, yearIdx, fields) {
  var timerKey = 'pin:' + studentId + ':' + yearIdx;
  // Merge into whatever's still pending for this (student, year) instead of replacing it —
  // otherwise editing two different fields (e.g. outside aid then family %) within the
  // debounce window silently drops the first field's save (see tapDebouncedSave below).
  _tapPendingFields[timerKey] = Object.assign(_tapPendingFields[timerKey] || {}, fields);
  clearTimeout(_tapSaveTimers[timerKey]);
  _tapSaveTimers[timerKey] = setTimeout(function() {
    var toSave = _tapPendingFields[timerKey];
    delete _tapPendingFields[timerKey];
    var label = tapYearLabelForIdx(yearIdx);
    api('/admin/api/tuition-aid/students/' + studentId + '/years/' + encodeURIComponent(label), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toSave)
    }).catch(function() {});
  }, 500);
}

function tapCfgNum(key, def) {
  var n = parseFloat(_tapConfig[key]);
  return isNaN(n) ? def : n;
}
function tapFromServerRow(r) {
  return {
    id: r.id, personId: r.person_id || null, householdId: r.household_id || null,
    family: r.family || '', child: r.child || '',
    isPipeline: !!r.is_pipeline, baseGrade: r.base_grade || '', birthYear: r.birth_year || null,
    outsideAid: (r.outside_aid_cents || 0) / 100,
    famPct: r.fam_pct, famPctOrig: r.fam_pct_orig, touched: !!r.touched,
    lhsAward: (r.lhs_award_cents || 0) / 100, lhsAwardOrig: (r.lhs_award_orig_cents || 0) / 100,
    attendsLHS: r.attends_lhs !== 0,
    timothyAwardExact: r.timothy_award_exact_cents != null ? r.timothy_award_exact_cents / 100 : null,
    familyOwedExact: r.family_owed_exact_cents != null ? r.family_owed_exact_cents / 100 : null,
    timothyAwardOverride: r.timothy_award_override_cents != null ? r.timothy_award_override_cents / 100 : null,
    familyOwedOverride: r.family_owed_override_cents != null ? r.family_owed_override_cents / 100 : null,
    note: r.note || ''
  };
}
function tapById(id) { return _tapRoster.filter(function(s) { return s.id === id; })[0]; }

// ── Grade / bucket progression ──────────────────────────────────────
function tapNextGrade(g) {
  if (g === 'Graduated') return 'Graduated';
  var i = TAP_GRADE_SEQ.indexOf(g);
  if (i === -1) return '?';
  return (i + 1 >= TAP_GRADE_SEQ.length) ? 'Graduated' : TAP_GRADE_SEQ[i + 1];
}
function tapGradeAtYear(baseGrade, yearIdx) {
  var g = baseGrade;
  for (var i = 0; i < yearIdx; i++) g = tapNextGrade(g);
  return g;
}
function tapGradeAt(s, yearIdx) {
  if (s.isPipeline) {
    // An explicitly-entered grade (meaning "this grade as of the current school year") always
    // wins over the birth-year formula — birth year alone assumes a fixed age cutoff, which
    // breaks down for a kid close to that cutoff date or one being intentionally held back.
    if (s.baseGrade) return tapGradeAtYear(s.baseGrade, yearIdx);
    var baseYear = tapCfgNum('base_school_year', 2026);
    var calYear = baseYear + yearIdx;
    var seqIdx = calYear - (s.birthYear + 3);
    if (seqIdx < 0) return null;
    if (seqIdx >= TAP_GRADE_SEQ.length) return 'Graduated';
    return TAP_GRADE_SEQ[seqIdx];
  }
  return tapGradeAtYear(s.baseGrade, yearIdx);
}
function tapBucketOf(g) {
  if (g === 'Graduated') return 'Graduated';
  if (['9','10','11','12'].indexOf(g) !== -1) return 'LHS';
  return 'K8';
}
function tapBucketFor(s, g) {
  if (g === null) return 'NotYet';
  var b = tapBucketOf(g);
  if (b === 'LHS' && s.attendsLHS === false) return 'Departed';
  return b;
}
function tapActiveForYear(yearIdx) {
  return _tapRoster.map(function(s) {
    var grade = tapGradeAt(s, yearIdx);
    return { s: s, grade: grade, bucket: tapBucketFor(s, grade) };
  }).filter(function(x) { return x.bucket !== 'Graduated' && x.bucket !== 'Departed' && x.bucket !== 'NotYet'; });
}
// Like tapActiveForYear, but excludes pipeline entrants entirely — even ones whose birth year
// says they're now old enough for K. Being old enough isn't the same as being enrolled; a
// pipeline kid only becomes a real student via the explicit "Enroll" action (tapEnrollPipeline),
// which flips is_pipeline off. Used everywhere that reflects ACTUAL current enrollment/awards
// (planner tables, budget gauges, KPIs). The Budget Projection / Enrollment Mix charts keep
// using tapActiveForYear directly — those are deliberately forward-looking and are the whole
// reason pipeline entrants get tracked by birth year in the first place.
function tapEnrolledActiveForYear(yearIdx) {
  return tapActiveForYear(yearIdx).filter(function(x) { return !x.s.isPipeline; });
}
// Pipeline entrants previewed for a future year (yearIdx !== 0 only — a pipeline kid never
// previews for the current year, see tapRenderPlannerTables). Shared by the planner table
// (which renders these as dimmed "what if enrolled" rows) and tapUpdateGauges (which reports
// their planned totals alongside, but never inside, the real enrolled budget-used figure —
// see the comment on tapEnrolledActiveForYear above for why pipeline stays out of that number).
function tapPipelinePreviewForYear(yearIdx) {
  var maxAward = tapCfgNum('lhs_max_award_cents', 250000) / 100;
  var k8 = [], lhs = [];
  if (yearIdx === 0) return { k8: k8, lhs: lhs };
  _tapRoster.forEach(function(s) {
    if (!s.isPipeline) return;
    var pGrade = tapGradeAt(s, yearIdx);
    if (pGrade === null || pGrade === 'Graduated' || pGrade === 'PK 3' || pGrade === 'PK 4') return;
    var pBucket = tapBucketOf(pGrade);
    if (pBucket === 'K8') {
      var pPin = tapPinFor(s.id, yearIdx);
      k8.push({
        s: s, grade: pGrade, sp: tapSplitFor(s, yearIdx), isOverridden: !!(pPin && pPin.timothy_award_cents != null),
        famPctVal: tapFamPctFor(s, yearIdx), outsideAidVal: tapOutsideAidFor(s, yearIdx), preview: true
      });
    } else if (pBucket === 'LHS') {
      lhs.push({ s: s, grade: pGrade, lhsVal: Math.min(tapLhsAwardFor(s, yearIdx), maxAward), justGraduated: false, preview: true });
    }
  });
  return { k8: k8, lhs: lhs };
}

// ── Award math ─────────────────────────────────────────────────────
function tapTuitionForYear(yearIdx) {
  var override = _tapYearRates[tapYearLabelForIdx(yearIdx)];
  if (override != null) return override / 100;
  var base = tapCfgNum('tuition_base_cents', 850000) / 100;
  var growth = tapCfgNum('tuition_growth_pct', 6) / 100;
  var raw = base * Math.pow(1 + growth, yearIdx);
  return Math.round(raw / 100) * 100;
}
function tapOutsideAidFor(s, yearIdx) {
  var pin = yearIdx !== 0 ? tapPinFor(s.id, yearIdx) : null;
  return (pin && pin.outside_aid_cents != null) ? pin.outside_aid_cents / 100 : s.outsideAid;
}
function tapFamPctFor(s, yearIdx) {
  var pin = yearIdx !== 0 ? tapPinFor(s.id, yearIdx) : null;
  return (pin && pin.fam_pct != null) ? pin.fam_pct : s.famPct;
}
function tapLhsAwardFor(s, yearIdx) {
  var pin = yearIdx !== 0 ? tapPinFor(s.id, yearIdx) : null;
  return (pin && pin.lhs_award_cents != null) ? pin.lhs_award_cents / 100 : s.lhsAward;
}
function tapComputeSplit(tuition, outsideAid, pct) {
  var familyRaw = tuition * (pct / 100);
  var familyOwed = Math.max(0, familyRaw - outsideAid);
  var timothyAward = Math.max(0, tuition - outsideAid - familyOwed);
  return { familyOwed: familyOwed, timothyAward: timothyAward };
}
function tapSplitAt(tuition, outsideAid, pct) {
  var r = tapComputeSplit(tuition, outsideAid, pct);
  var minAward = tapCfgNum('timothy_min_award_cents', 200000) / 100;
  if (r.timothyAward < minAward) {
    r.timothyAward = minAward;
    r.familyOwed = Math.max(0, tuition - outsideAid - r.timothyAward);
  }
  return r;
}
function tapSplitFor(s, yearIdx) {
  var pin = yearIdx !== 0 ? tapPinFor(s.id, yearIdx) : null;
  if (pin && (pin.timothy_award_cents != null || pin.family_owed_cents != null)) {
    return {
      timothyAward: (pin.timothy_award_cents != null ? pin.timothy_award_cents : 0) / 100,
      familyOwed: (pin.family_owed_cents != null ? pin.family_owed_cents : 0) / 100
    };
  }
  // Manual exact-dollar override (typed directly into the Timothy Award field) always wins for
  // the current year once set — regardless of touched — until the Family Share % slider is
  // dragged again, which clears it (see tapSliderChange). Distinct from timothyAwardExact below,
  // which is the original Breeze/manual seed snapshot and only applies pre-touch.
  if (yearIdx === 0 && !s.isPipeline && s.timothyAwardOverride != null) {
    return { familyOwed: s.familyOwedOverride || 0, timothyAward: s.timothyAwardOverride };
  }
  if (yearIdx === 0 && !s.isPipeline && !s.touched && s.timothyAwardExact != null) {
    return { familyOwed: s.familyOwedExact, timothyAward: s.timothyAwardExact };
  }
  var tuition = tapTuitionForYear(yearIdx);
  return tapSplitAt(tuition, tapOutsideAidFor(s, yearIdx), tapFamPctFor(s, yearIdx));
}
function tapPctFromFamilyOwed(tuition, outsideAid, familyOwed) {
  if (tuition <= 0) return 0;
  var familyRaw = Math.min(tuition, familyOwed + outsideAid);
  return Math.max(0, Math.min(100, Math.round((familyRaw / tuition) * 100)));
}

// ── Year selector ──────────────────────────────────────────────────
function tapBuildYearOptions() {
  var baseYear = tapCfgNum('base_school_year', 2026);
  _tapProjYears = [];
  for (var i = 0; i < 6; i++) _tapProjYears.push(tapSchoolYearLabel(baseYear + i));

  _tapAllYearOptions = [];
  for (var j = -5; j <= 5; j++) {
    _tapAllYearOptions.push({ offset: j, label: tapSchoolYearLabel(baseYear + j) + (j === 0 ? ' (current)' : j < 0 ? ' (past)' : '') });
  }
  var sel = document.getElementById('tap-year-select');
  sel.innerHTML = _tapAllYearOptions.map(function(o) {
    return '<option value="' + o.offset + '"' + (o.offset === _tapYearIdx ? ' selected' : '') + '>' + esc(o.label) + '</option>';
  }).join('');
}
function tapSetYear(offset) {
  _tapYearIdx = +offset;
  var isPast = _tapYearIdx < 0;
  document.getElementById('tap-planner-current').style.display = isPast ? 'none' : '';
  document.getElementById('tap-planner-past').style.display = isPast ? '' : 'none';
  tapRenderYearRateBox();
  if (isPast) { tapRenderPastYearTable(); } else { tapRenderPlannerTables(); }
}
function tapRenderYearRateBox() {
  var label = tapYearLabelForIdx(_tapYearIdx);
  var resolved = tapTuitionForYear(_tapYearIdx);
  var isOverride = _tapYearRates[label] != null;
  document.getElementById('tap-year-rate-label').textContent = label;
  document.getElementById('tap-year-rate-input').value = Math.round(resolved);
  document.getElementById('tap-year-rate-note').textContent = isOverride ? 'Actual figure on file.' : 'Projected from ' + tapCfgNum('tuition_growth_pct', 6) + '%/yr growth — not yet finalized.';
}
function tapSaveYearRate() {
  var label = tapYearLabelForIdx(_tapYearIdx);
  var dollars = +document.getElementById('tap-year-rate-input').value;
  if (!dollars || dollars <= 0) return;
  var cents = Math.round(dollars * 100);
  api('/admin/api/tuition-aid/year-rates/' + encodeURIComponent(label), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tuition_cents: cents })
  }).then(function() {
    _tapYearRates[label] = cents;
    tapRenderYearRateBox();
    if (_tapYearIdx < 0) { tapRenderPastYearTable(); } else { tapRenderPlannerTables(); tapRenderKpis(); }
  }).catch(function() {});
}

// ── Top-level render ───────────────────────────────────────────────
function tapRenderAll() {
  tapRenderKpis();
  tapRenderPathway();
  tapRenderHistoryChart();
  tapRenderCompositionChart();
  tapRenderProjectionChart();
  tapRenderEnrollChart();
  tapRenderDetailTable();
  tapRenderPipelineList();
  tapRenderYearRateBox();
  tapRenderTotalBudgetBox();
  tapRenderPlannerTables();
}
function tapRenderTotalBudgetBox() {
  var el = document.getElementById('tap-total-budget-input');
  if (!el) return;
  el.value = _tapConfig.timothy_total_budget_cents != null ? Math.round(tapCfgNum('timothy_total_budget_cents', 0) / 100) : '';
}
function tapSaveTotalBudget() {
  var dollars = +document.getElementById('tap-total-budget-input').value;
  if (!dollars || dollars < 0) return;
  var cents = Math.round(dollars * 100);
  api('/admin/api/tuition-aid/config', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: { timothy_total_budget_cents: cents } })
  }).then(function() {
    _tapConfig.timothy_total_budget_cents = String(cents);
    tapUpdateGauges();
  }).catch(function() {});
}

function tapKpiHtml(lbl, val, note, accent) {
  return '<div class="tap-kpi' + (accent ? ' accent' : '') + '"><div class="tap-lbl">' + esc(lbl) + '</div>'
    + '<div class="tap-val">' + esc(String(val)) + '</div><div class="tap-note">' + esc(note) + '</div></div>';
}
function tapRenderKpis() {
  var active0 = tapEnrolledActiveForYear(0);
  var k8Active = active0.filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var lhsActive = active0.filter(function(x) { return x.bucket === 'LHS'; });
  var tuition0 = tapTuitionForYear(0);
  var totalTimothy = 0, totalFamily = 0;
  k8Active.forEach(function(x) {
    var sp = tapSplitFor(x.s, 0);
    totalTimothy += sp.timothyAward; totalFamily += sp.familyOwed;
  });
  var totalLhs = lhsActive.reduce(function(sum, x) { return sum + x.s.lhsAward; }, 0);
  var k8Budget = tapCfgNum('k8_budget_cents', 7500000) / 100;
  var html = tapKpiHtml('Students Supported', (k8Active.length + lhsActive.length), 'K-8 + LHS combined', true)
    + tapKpiHtml('K-8 Tuition Billed', '$' + Math.round(k8Active.length * tuition0).toLocaleString(), k8Active.length + ' students · $' + Math.round(tuition0).toLocaleString() + ' ea.')
    + tapKpiHtml('Timothy (WOL) Award', '$' + Math.round(totalTimothy).toLocaleString(), 'Partnership + Access grants')
    + tapKpiHtml('Family Portion', '$' + Math.round(totalFamily).toLocaleString(), 'What parents owe')
    + tapKpiHtml('LHSA Aid', '$' + Math.round(totalLhs).toLocaleString(), lhsActive.length + ' student' + (lhsActive.length === 1 ? '' : 's'))
    + tapKpiHtml('WOL Budget Remaining', '$' + Math.round(k8Budget - totalTimothy).toLocaleString(), '$' + Math.round(k8Budget).toLocaleString() + ' annual budget');
  document.getElementById('tap-kpi-row').innerHTML = html;
}

function tapRenderPathway() {
  var active0 = tapEnrolledActiveForYear(0);
  function countGrades(list) { return active0.filter(function(x) { return list.indexOf(x.grade) !== -1; }).length; }
  var stages = [
    { label: 'PK 3-4', count: countGrades(['PK 3','PK 4']), hot: false },
    { label: 'Kindergarten', count: countGrades(['K']), hot: false },
    { label: 'Grades 1-7', count: countGrades(['1','2','3','4','5','6','7']), hot: false },
    { label: 'Grade 8', count: countGrades(['8']), hot: true },
    { label: 'LHS 9-12', count: countGrades(['9','10','11','12']), hot: false }
  ];
  document.getElementById('tap-path-track').innerHTML = stages.map(function(s) {
    return '<div class="tap-path-stage' + (s.hot ? ' hot' : '') + '"><div class="tap-path-line"></div><div class="tap-dot"></div>'
      + '<div class="tap-path-count">' + s.count + '</div><div class="tap-path-label">' + esc(s.label) + '</div></div>';
  }).join('');

  var grads = active0.filter(function(x) { return x.grade === '8'; });
  var pk4 = active0.filter(function(x) { return x.grade === 'PK 4'; });
  var soonPipeline = _tapRoster.filter(function(s) {
    if (!s.isPipeline) return false;
    return tapGradeAt(s, 0) === null && tapGradeAt(s, 2) !== null;
  });
  var flags = [];
  if (grads.length) flags.push({ type: 'grad', text: grads.length + ' eighth-grader' + (grads.length === 1 ? '' : 's') + ' graduate Timothy &rarr; enter LHS 9th grade next year', names: grads.map(function(x) { return x.s.child; }).join(', ') });
  if (pk4.length) flags.push({ type: 'new', text: pk4.length + ' PK4 student' + (pk4.length === 1 ? '' : 's') + ' enter Kindergarten (aid begins) next year', names: pk4.map(function(x) { return x.s.child; }).join(', ') });
  if (soonPipeline.length) flags.push({ type: 'future', text: soonPipeline.length + ' known future entrant' + (soonPipeline.length === 1 ? '' : 's') + ' expected within 2 years', names: soonPipeline.map(function(s) { return s.child + ' (b. ' + s.birthYear + ')'; }).join(', ') });
  document.getElementById('tap-flags').innerHTML = flags.length ? flags.map(function(f) {
    return '<span class="tap-flag" title="' + esc(f.names) + '"><b>' + (f.type === 'grad' ? '&rarr; LHS' : f.type === 'future' ? 'Future' : 'New') + ':</b> ' + f.text + '</span>';
  }).join('') : '<span style="font-size:.78rem;color:var(--warm-gray);">No transitions flagged.</span>';
}

// ── Charts (hand-rolled SVG, matching the app's existing chart pattern) ──
function tapBarLineChart(labels, bars, line) {
  var W = 560, H = 220, PAD = 34;
  var maxBar = Math.max.apply(null, bars.concat([1]));
  var maxLine = Math.max.apply(null, line.concat([1]));
  var n = labels.length, stepX = (W - PAD * 2) / n, barW = stepX * 0.5;
  var barsSvg = '', pts = [], labelsSvg = '';
  bars.forEach(function(v, i) {
    var x = PAD + i * stepX + (stepX - barW) / 2;
    var h = maxBar ? (v / maxBar) * (H - PAD * 2) : 0;
    var y = H - PAD - h;
    barsSvg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="var(--ice-blue)" rx="2"><title>' + esc(labels[i]) + ': $' + Math.round(v).toLocaleString() + '</title></rect>';
  });
  line.forEach(function(v, i) {
    var x = PAD + i * stepX + stepX / 2;
    var y = H - PAD - (maxLine ? (v / maxLine) * (H - PAD * 2) : 0);
    pts.push({ x: x, y: y, v: v });
  });
  var lineSvg = '<polyline points="' + pts.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="none" stroke="var(--gold-accent)" stroke-width="2.5"/>'
    + pts.map(function(p, i) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" fill="var(--gold-accent)"><title>' + esc(labels[i]) + ': ' + p.v.toFixed(1) + '%</title></circle>'; }).join('');
  labels.forEach(function(l, i) {
    var x = PAD + i * stepX + stepX / 2;
    labelsSvg += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" font-size="9" fill="var(--warm-gray)" text-anchor="middle">' + esc(l) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;">' + barsSvg + lineSvg + labelsSvg + '</svg>'
    + '<div style="display:flex;gap:16px;font-size:.72rem;color:var(--warm-gray);margin-top:4px;">'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:var(--ice-blue);border-radius:2px;margin-right:4px;"></span>Tuition/student</span>'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:var(--gold-accent);border-radius:50%;margin-right:4px;"></span>% family pays</span></div>';
}
function tapBarLineSameScale(labels, bars, line, barColor, lineColor, barLabel, lineLabel) {
  var W = 560, H = 220, PAD = 34;
  var maxAll = Math.max.apply(null, bars.concat(line).concat([1]));
  var n = labels.length, stepX = (W - PAD * 2) / n, barW = stepX * 0.5;
  var barsSvg = '', pts = [], labelsSvg = '';
  bars.forEach(function(v, i) {
    var x = PAD + i * stepX + (stepX - barW) / 2;
    var h = (v / maxAll) * (H - PAD * 2);
    var y = H - PAD - h;
    var over = line[i] != null && v > line[i];
    barsSvg += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (over ? 'var(--danger)' : barColor) + '" rx="2" opacity=".85"><title>' + esc(labels[i]) + ': $' + Math.round(v).toLocaleString() + '</title></rect>';
  });
  line.forEach(function(v, i) {
    var x = PAD + i * stepX + stepX / 2;
    var y = H - PAD - (v / maxAll) * (H - PAD * 2);
    pts.push({ x: x, y: y, v: v });
  });
  var lineSvg = '<polyline points="' + pts.map(function(p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '" fill="none" stroke="' + lineColor + '" stroke-width="2" stroke-dasharray="6,4"/>'
    + pts.map(function(p, i) { return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3" fill="' + lineColor + '"><title>' + esc(labels[i]) + ': $' + Math.round(p.v).toLocaleString() + '</title></circle>'; }).join('');
  labels.forEach(function(l, i) {
    var x = PAD + i * stepX + stepX / 2;
    labelsSvg += '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" font-size="9" fill="var(--warm-gray)" text-anchor="middle">' + esc(l) + '</text>';
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;">' + barsSvg + lineSvg + labelsSvg + '</svg>'
    + '<div style="display:flex;gap:16px;font-size:.72rem;color:var(--warm-gray);margin-top:4px;">'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:' + barColor + ';border-radius:2px;margin-right:4px;"></span>' + esc(barLabel) + '</span>'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:' + lineColor + ';border-radius:50%;margin-right:4px;"></span>' + esc(lineLabel) + '</span></div>';
}
function tapRenderHistoryChart() {
  var labels = _tapHistory.map(function(h) { return h.school_year; });
  var bars = _tapHistory.map(function(h) { return h.tuition_cents / 100; });
  var line = _tapHistory.map(function(h) { return h.family_pct; });
  document.getElementById('tap-history-chart').innerHTML = labels.length ? tapBarLineChart(labels, bars, line) : '<div style="color:var(--warm-gray);font-size:.85rem;">No history data.</div>';
}
function tapRenderCompositionChart() {
  var active0 = tapEnrolledActiveForYear(0).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var outsideTotal = 0, familyTotal = 0, timothyTotal = 0;
  active0.forEach(function(x) {
    var sp = tapSplitFor(x.s, 0);
    outsideTotal += x.s.outsideAid; timothyTotal += sp.timothyAward; familyTotal += sp.familyOwed;
  });
  var items = [
    { label: 'Timothy Award (WOL)', value: timothyTotal, color: 'var(--navy)' },
    { label: 'Outside Aid (scholarships, etc.)', value: outsideTotal, color: 'var(--gold-accent)' },
    { label: 'Family Portion', value: familyTotal, color: 'var(--warm-gray)' }
  ];
  document.getElementById('tap-composition-chart').innerHTML = renderPieChart(items, 200);
}
function tapProjectedNeedByYear(yearIdx) {
  var active = tapActiveForYear(yearIdx);
  var k8 = active.filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var lhs = active.filter(function(x) { return x.bucket === 'LHS'; });
  var tuition = tapTuitionForYear(yearIdx);
  var timothyTotal = 0;
  k8.forEach(function(x) {
    var sp = tapSplitAt(tuition, x.s.outsideAid, x.s.famPctOrig);
    timothyTotal += sp.timothyAward;
  });
  var lhsRate = tapCfgNum('lhs_standard_rate_cents', 120000) / 100;
  return { need: timothyTotal + lhs.length * lhsRate, k8Count: k8.length, lhsCount: lhs.length };
}
function tapRenderProjectionChart() {
  var need = [], budget = [];
  var k8Budget = tapCfgNum('k8_budget_cents', 7500000) / 100;
  var lhsRate = tapCfgNum('lhs_standard_rate_cents', 120000) / 100;
  _tapProjYears.forEach(function(y, i) {
    var p = tapProjectedNeedByYear(i);
    need.push(p.need);
    budget.push(k8Budget + p.lhsCount * lhsRate);
  });
  document.getElementById('tap-projection-chart').innerHTML = tapBarLineSameScale(_tapProjYears, need, budget, 'var(--ice-blue)', 'var(--navy)', 'Projected Aid Need (baseline)', 'Budget Available');
}
function tapRenderEnrollChart() {
  var k8 = [], lhs = [];
  _tapProjYears.forEach(function(y, i) {
    var active = tapActiveForYear(i);
    k8.push(active.filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; }).length);
    lhs.push(active.filter(function(x) { return x.bucket === 'LHS'; }).length);
  });
  var W = 560, H = 220, PAD = 34;
  var maxTotal = Math.max.apply(null, k8.map(function(v, i) { return v + lhs[i]; }).concat([1]));
  var n = _tapProjYears.length, stepX = (W - PAD * 2) / n, barW = stepX * 0.5;
  var svg = '';
  _tapProjYears.forEach(function(y, i) {
    var x = PAD + i * stepX + (stepX - barW) / 2;
    var h1 = (k8[i] / maxTotal) * (H - PAD * 2);
    var h2 = (lhs[i] / maxTotal) * (H - PAD * 2);
    var y1 = H - PAD - h1;
    var y2 = y1 - h2;
    svg += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h1.toFixed(1) + '" fill="var(--navy)"><title>' + esc(y) + ' Timothy K-8: ' + k8[i] + '</title></rect>';
    svg += '<rect x="' + x.toFixed(1) + '" y="' + y2.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h2.toFixed(1) + '" fill="var(--gold-accent)"><title>' + esc(y) + ' LHS: ' + lhs[i] + '</title></rect>';
    svg += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 8) + '" font-size="9" fill="var(--warm-gray)" text-anchor="middle">' + esc(y) + '</text>';
  });
  document.getElementById('tap-enroll-chart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:' + H + 'px;">' + svg + '</svg>'
    + '<div style="display:flex;gap:16px;font-size:.72rem;color:var(--warm-gray);margin-top:4px;">'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:var(--navy);border-radius:2px;margin-right:4px;"></span>Timothy K-8</span>'
    + '<span><span style="display:inline-block;width:10px;height:10px;background:var(--gold-accent);border-radius:2px;margin-right:4px;"></span>Lutheran High South</span></div>';
}

function tapRenderDetailTable() {
  var active0 = tapEnrolledActiveForYear(0).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var rows = active0.map(function(x) {
    var sp = tapSplitFor(x.s, 0);
    var linked = x.s.personId ? '<span style="color:var(--sage);">&#10003; linked</span>' : '<span style="color:var(--warm-gray);">not linked</span>';
    return '<tr><td style="padding:6px 8px;">' + esc(x.s.family) + '</td><td style="padding:6px 8px;">' + esc(x.s.child) + '</td><td style="padding:6px 8px;">' + esc(x.grade) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(x.s.outsideAid * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.timothyAward * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.familyOwed * 100)) + '</td>'
      + '<td style="padding:6px 8px;">' + linked + '</td></tr>';
  }).join('');
  document.getElementById('tap-detail-body').innerHTML = rows || '<tr><td colspan="7" style="padding:10px;color:var(--warm-gray);">No K-8 students.</td></tr>';
}

// ── Planner tables ─────────────────────────────────────────────────
var _tapK8Sort = { col: 'grade', dir: 1 };
var _tapLhsSort = { col: 'grade', dir: 1 };
function tapCompareForSort(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
  return (a || 0) - (b || 0);
}
function tapSortRows(rows, sortState, keyFn) {
  if (!sortState.col) return rows;
  var withKeys = rows.map(function(r) { return { r: r, k: keyFn(r, sortState.col) }; });
  withKeys.sort(function(a, b) { return tapCompareForSort(a.k, b.k) * sortState.dir; });
  return withKeys.map(function(x) { return x.r; });
}
function tapSortIndicator(sortState, col) {
  if (sortState.col !== col) return '';
  return sortState.dir === 1 ? ' &#9650;' : ' &#9660;';
}
function tapSortK8(col) {
  if (_tapK8Sort.col === col) _tapK8Sort.dir = -_tapK8Sort.dir; else { _tapK8Sort.col = col; _tapK8Sort.dir = 1; }
  tapRenderPlannerTables();
}
function tapSortLhs(col) {
  if (_tapLhsSort.col === col) _tapLhsSort.dir = -_tapLhsSort.dir; else { _tapLhsSort.col = col; _tapLhsSort.dir = 1; }
  tapRenderPlannerTables();
}
// Dedicated wrappers (no string argument embedded in the onclick HTML attribute) — avoids any
// quote-escaping risk in generated markup, same pattern used elsewhere in this file.
function tapSortK8Family() { tapSortK8('family'); }
function tapSortK8Child() { tapSortK8('child'); }
function tapSortK8Grade() { tapSortK8('grade'); }
function tapSortK8Outside() { tapSortK8('outside'); }
function tapSortK8Pct() { tapSortK8('pct'); }
function tapSortK8Timothy() { tapSortK8('timothy'); }
function tapSortK8FamilyOwes() { tapSortK8('family_owes'); }
function tapSortLhsFamily() { tapSortLhs('family'); }
function tapSortLhsChild() { tapSortLhs('child'); }
function tapSortLhsGrade() { tapSortLhs('grade'); }
function tapSortLhsAward() { tapSortLhs('award'); }

function tapRenderPlannerTables() {
  var k8List = [], lhsList = [];
  var tuition = tapTuitionForYear(_tapYearIdx);
  var maxAward = tapCfgNum('lhs_max_award_cents', 250000) / 100;

  _tapRoster.forEach(function(s) {
    // Pipeline entrants never auto-appear here just because their birth year says they're
    // old enough — that's tracked separately for budget projection (Enrollment Mix / Budget
    // Projection charts), but assigning an actual award requires explicitly clicking Enroll
    // in the Pipeline list (tapEnrollPipeline), which flips is_pipeline off.
    if (s.isPipeline) return;
    var grade = tapGradeAt(s, _tapYearIdx);
    var bucket = tapBucketFor(s, grade);
    var prevGrade = _tapYearIdx > 0 ? tapGradeAt(s, _tapYearIdx - 1) : null;
    var justGraduated = (bucket === 'LHS' && prevGrade === '8');

    if (bucket === 'Graduated' || bucket === 'Departed' || bucket === 'NotYet') return;

    if (bucket === 'K8') {
      if (grade === 'PK 3' || grade === 'PK 4') return;
      var sp = tapSplitFor(s, _tapYearIdx);
      var pinForOverride = _tapYearIdx !== 0 ? tapPinFor(s.id, _tapYearIdx) : null;
      var isOverridden = _tapYearIdx === 0 ? (s.timothyAwardOverride != null) : !!(pinForOverride && pinForOverride.timothy_award_cents != null);
      k8List.push({
        s: s, grade: grade, sp: sp, isOverridden: isOverridden,
        famPctVal: tapFamPctFor(s, _tapYearIdx), outsideAidVal: tapOutsideAidFor(s, _tapYearIdx)
      });
    } else if (bucket === 'LHS') {
      var lhsVal = Math.min(tapLhsAwardFor(s, _tapYearIdx), maxAward);
      if (_tapYearIdx === 0 && s.lhsAward > maxAward) s.lhsAward = maxAward;
      lhsList.push({ s: s, grade: grade, lhsVal: lhsVal, justGraduated: justGraduated });
    }
  });

  // Future-year preview: a pipeline entrant hasn't been formally Enrolled (so they never appear
  // above, current year or otherwise — see the comment at the top of this loop), but a family
  // may already know a not-yet-enrolled kid's real starting grade for a FUTURE year (e.g. they're
  // skipping PK entirely and starting at Kindergarten) and want to plan around that — see the
  // projected award figures AND adjust outside aid / family share / a manual Timothy Award for
  // that year — without being forced to first click Enroll for a PK grade they're not actually
  // attending this year. Editing a preview row saves into the same per-year pin a real student's
  // future-year edit would (tapOutsideAidChange et al. already route there whenever
  // _tapYearIdx !== 0, regardless of is_pipeline), so this is a real, persisted "what if" plan,
  // not just a display estimate. Never folded into tapEnrolledActiveForYear's real budget-used
  // total until the entrant is actually Enrolled — tapUpdateGauges instead reports this same
  // preview set's total as a separate "+ $X planned for N pipeline students" line, via the
  // shared tapPipelinePreviewForYear() helper so the two can never disagree.
  var preview = tapPipelinePreviewForYear(_tapYearIdx);
  k8List = k8List.concat(preview.k8);
  lhsList = lhsList.concat(preview.lhs);

  var k8KeyFn = function(row, col) {
    if (col === 'family') return row.s.family;
    if (col === 'child') return row.s.child;
    // Natural grade order (K, 1, 2, ...), not alphabetical — a plain string sort would put
    // "K" after "8" (letters sort after digits) and misorder any double-digit grade.
    if (col === 'grade') return TAP_GRADE_SEQ.indexOf(row.grade);
    if (col === 'outside') return row.outsideAidVal;
    if (col === 'pct') return row.famPctVal;
    if (col === 'timothy') return row.sp.timothyAward;
    if (col === 'family_owes') return row.sp.familyOwed;
    return '';
  };
  k8List = tapSortRows(k8List, _tapK8Sort, k8KeyFn);

  var k8Rows = k8List.map(function(row) {
    var s = row.s, grade = row.grade, sp = row.sp, famPctVal = row.famPctVal, outsideAidVal = row.outsideAidVal, isOverridden = row.isOverridden;
    var isPreview = !!row.preview;
    // A future-year preview row is fully editable, same inputs as a real row — Outside Aid,
    // Family Share %, and Timothy Award all save into the same per-year "pin" a real student's
    // future-year edit would (tapOutsideAidChange/tapSliderChange/tapTimothyAwardChange already
    // route through tapSavePinDebounced whenever _tapYearIdx !== 0, regardless of is_pipeline —
    // that's what lets an admin actually plan/adjust "what if this kid were enrolled this year"
    // without formally Enrolling them yet). It's just visually flagged as not-yet-real and
    // carries its own Enroll shortcut instead of the LHS-transition toggle a real row gets.
    var gradeBadge = isPreview ? ' <span class="status-pill status-new" style="font-style:normal;" title="Projected from birth year / a manually-entered current grade — not yet formally Enrolled">pipeline</span>' : '';
    var lhsToggle = (!isPreview && grade === '8')
      ? '<label class="tap-lhs-toggle"><input type="checkbox" onchange="tapSetAttendsLHS(' + s.id + ',this.checked)" ' + (s.attendsLHS ? 'checked' : '') + '> Plans to attend LHS</label>' : '';
    var linkBtn = s.personId ? '' : '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenLinkPerson(' + s.id + ')">Link</button> ';
    var histBtn = '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenHistory(' + s.id + ')">History</button> ';
    var pGrade0 = isPreview ? tapGradeAt(s, 0) : null;
    var enrollBtn = (isPreview && pGrade0 !== null && pGrade0 !== 'Graduated')
      ? '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapEnrollPipeline(' + s.id + ')" title="Enroll now, as of the current year">Enroll</button> ' : '';
    return '<tr' + (isPreview ? ' style="background:rgba(201,151,58,.06);"' : '') + '>'
      + '<td style="padding:6px 8px;">' + esc(s.family) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(s.child) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(grade) + gradeBadge + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(tuition * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + Math.round(outsideAidVal) + '" style="width:80px;text-align:right;" onchange="tapOutsideAidChange(this,' + s.id + ')"></td>'
      + '<td style="padding:6px 8px;">'
        // Family Share % is a typed figure, no drag slider — the numbers here are decided, not
        // dialed in, and a slider next to a number box is two controls for one value.
        + '<div class="tap-slider-row">'
          + '<input type="number" min="0" max="100" step="1" value="' + famPctVal + '" oninput="tapSliderChange(this,' + s.id + ')">%'
        + '</div>'
        + '<div class="tap-slider-caption">Family share of $' + Math.round(tuition).toLocaleString() + ' bill</div>'
      + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">'
        + '<input type="number" min="0" step="1" value="' + Math.round(sp.timothyAward) + '" style="width:80px;text-align:right;" id="tap-k8award-' + s.id + '" onchange="tapTimothyAwardChange(this,' + s.id + ')">'
        + (isOverridden ? ' <a href="javascript:void(0)" style="font-size:.68rem;white-space:nowrap;" onclick="tapClearTimothyOverride(' + s.id + ')" title="Clear the manual amount, go back to Family Share %">↺ auto</a>' : '')
      + '</td>'
      + '<td style="padding:6px 8px;text-align:right;"><span id="tap-k8family-' + s.id + '">' + fmtMoney(Math.round(sp.familyOwed * 100)) + '</span>' + lhsToggle + '</td>'
      + '<td style="padding:6px 8px;white-space:nowrap;">' + enrollBtn + histBtn + linkBtn + '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapRemoveStudent(' + s.id + ')">Remove</button></td>'
    + '</tr>';
  });

  var lhsKeyFn = function(row, col) {
    if (col === 'family') return row.s.family;
    if (col === 'child') return row.s.child;
    // Natural grade order (9, 10, 11, 12) — a plain string sort puts "10" before "9".
    if (col === 'grade') return TAP_GRADE_SEQ.indexOf(row.grade);
    if (col === 'award') return row.lhsVal;
    return '';
  };
  lhsList = tapSortRows(lhsList, _tapLhsSort, lhsKeyFn);

  var lhsRows = lhsList.map(function(row) {
    var s = row.s, grade = row.grade, lhsVal = row.lhsVal;
    var isPreview = !!row.preview;
    var gradeBadgeLhs = isPreview ? ' <span class="status-pill status-new" style="font-style:normal;" title="Projected from birth year / a manually-entered current grade — not yet formally Enrolled">pipeline</span>' : '';
    var flag = (!isPreview && row.justGraduated) ? ' <span class="status-pill status-confirmed">new to LHS</span>' : '';
    var lhsLinkBtn = s.personId ? '' : '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenLinkPerson(' + s.id + ')">Link</button> ';
    var pGrade0Lhs = isPreview ? tapGradeAt(s, 0) : null;
    var enrollBtnLhs = (isPreview && pGrade0Lhs !== null && pGrade0Lhs !== 'Graduated')
      ? '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapEnrollPipeline(' + s.id + ')" title="Enroll now, as of the current year">Enroll</button> ' : '';
    return '<tr' + (isPreview ? ' style="background:rgba(201,151,58,.06);"' : '') + '>'
      + '<td style="padding:6px 8px;">' + esc(s.family) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(s.child) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(grade) + gradeBadgeLhs + flag + '</td>'
      + '<td style="padding:6px 8px;">'
        + '<div class="tap-slider-row">'
          + '<input type="range" min="0" max="' + maxAward + '" step="25" value="' + lhsVal + '" oninput="tapLhsSliderChange(this,' + s.id + ')">'
          + '<input type="number" min="0" max="' + maxAward + '" step="25" value="' + lhsVal + '" oninput="tapLhsSliderChange(this,' + s.id + ')">'
        + '</div>'
      + '</td>'
      + '<td class="tap-award-cell" id="tap-lhsaward-' + s.id + '">' + fmtMoney(Math.round(lhsVal * 100)) + '</td>'
      + '<td style="padding:6px 8px;white-space:nowrap;">' + enrollBtnLhs + '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenHistory(' + s.id + ')">History</button> ' + lhsLinkBtn + '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapRemoveStudent(' + s.id + ')">Remove</button></td>'
    + '</tr>';
  });

  document.getElementById('tap-k8-body').innerHTML = k8Rows.join('') || '<tr><td colspan="9" style="padding:10px;color:var(--warm-gray);">No K-8 students this year.</td></tr>';
  document.getElementById('tap-lhs-body').innerHTML = lhsRows.join('') || '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);">No LHS students this year.</td></tr>';
  tapRenderPlannerHeaders();
  tapUpdateGauges();
}
function tapRenderPlannerHeaders() {
  var k8Head = document.getElementById('tap-k8-thead');
  if (k8Head) {
    k8Head.innerHTML = '<tr style="border-bottom:2px solid var(--navy);">'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortK8Family()">Family' + tapSortIndicator(_tapK8Sort, 'family') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortK8Child()">Child' + tapSortIndicator(_tapK8Sort, 'child') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortK8Grade()">Grade' + tapSortIndicator(_tapK8Sort, 'grade') + '</th>'
      + '<th style="text-align:right;padding:6px 8px;">Tuition</th>'
      + '<th style="text-align:right;padding:6px 8px;cursor:pointer;" onclick="tapSortK8Outside()">Outside Aid' + tapSortIndicator(_tapK8Sort, 'outside') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;min-width:190px;cursor:pointer;" onclick="tapSortK8Pct()">Family Share %' + tapSortIndicator(_tapK8Sort, 'pct') + '</th>'
      + '<th style="text-align:right;padding:6px 8px;cursor:pointer;" onclick="tapSortK8Timothy()">Timothy Award $' + tapSortIndicator(_tapK8Sort, 'timothy') + '</th>'
      + '<th style="text-align:right;padding:6px 8px;cursor:pointer;" onclick="tapSortK8FamilyOwes()">Family Owes $' + tapSortIndicator(_tapK8Sort, 'family_owes') + '</th>'
      + '<th style="padding:6px 8px;"></th></tr>';
  }
  var lhsHead = document.getElementById('tap-lhs-thead');
  if (lhsHead) {
    lhsHead.innerHTML = '<tr style="border-bottom:2px solid var(--navy);">'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortLhsFamily()">Family' + tapSortIndicator(_tapLhsSort, 'family') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortLhsChild()">Child' + tapSortIndicator(_tapLhsSort, 'child') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;cursor:pointer;" onclick="tapSortLhsGrade()">Grade' + tapSortIndicator(_tapLhsSort, 'grade') + '</th>'
      + '<th style="text-align:left;padding:6px 8px;min-width:190px;">LHSA Award</th>'
      + '<th style="text-align:right;padding:6px 8px;cursor:pointer;" onclick="tapSortLhsAward()">Award $' + tapSortIndicator(_tapLhsSort, 'award') + '</th>'
      + '<th style="padding:6px 8px;"></th></tr>';
  }
}

function tapOutsideAidChange(el, id) {
  var s = tapById(id);
  if (!s) return;
  var dollars = Math.max(0, Math.round(+el.value || 0));
  var cents = dollars * 100;
  if (_tapYearIdx === 0) {
    s.outsideAid = dollars;
    if (s.timothyAwardOverride != null) {
      // Keep the manually-typed Timothy Award fixed; only family owed shifts with outside aid.
      var tuition0 = tapTuitionForYear(0);
      s.familyOwedOverride = Math.max(0, tuition0 - dollars - s.timothyAwardOverride);
      tapDebouncedSave(id, { outside_aid_cents: cents, family_owed_override_cents: Math.round(s.familyOwedOverride * 100) });
    } else {
      tapDebouncedSave(id, { outside_aid_cents: cents });
    }
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { outside_aid_cents: cents });
    tapSavePinDebounced(id, _tapYearIdx, { outside_aid_cents: cents });
  }
  var sp = tapSplitFor(s, _tapYearIdx);
  var awardEl = document.getElementById('tap-k8award-' + id);
  var famEl = document.getElementById('tap-k8family-' + id);
  if (awardEl) awardEl.value = Math.round(sp.timothyAward);
  if (famEl) famEl.textContent = fmtMoney(Math.round(sp.familyOwed * 100));
  tapUpdateGauges();
}
function tapTimothyAwardChange(el, id) {
  var s = tapById(id);
  // A pipeline entrant can only have this typed directly for a FUTURE year (the preview row —
  // see tapRenderPlannerTables), which saves into the per-year pin regardless of enrollment
  // status; the current year (idx 0) has no override slot on an un-enrolled pipeline row.
  if (!s || (s.isPipeline && _tapYearIdx === 0)) return;
  var dollars = Math.max(0, Math.round(+el.value || 0));
  var tuition = tapTuitionForYear(_tapYearIdx);
  var outsideAid = tapOutsideAidFor(s, _tapYearIdx);
  var familyOwed = Math.max(0, tuition - outsideAid - dollars);
  if (_tapYearIdx === 0) {
    s.timothyAwardOverride = dollars;
    s.familyOwedOverride = familyOwed;
    tapDebouncedSave(id, {
      timothy_award_override_cents: Math.round(dollars * 100),
      family_owed_override_cents: Math.round(familyOwed * 100)
    });
  } else {
    var cents = Math.round(dollars * 100), famCents = Math.round(familyOwed * 100);
    tapUpsertPinLocal(id, _tapYearIdx, { timothy_award_cents: cents, family_owed_cents: famCents });
    tapSavePinDebounced(id, _tapYearIdx, { timothy_award_cents: cents, family_owed_cents: famCents });
  }
  var famEl = document.getElementById('tap-k8family-' + id);
  if (famEl) famEl.textContent = fmtMoney(Math.round(familyOwed * 100));
  tapUpdateGauges();
  tapRenderPlannerTables();
}
function tapClearTimothyOverride(id) {
  var s = tapById(id);
  if (!s) return;
  if (_tapYearIdx === 0) {
    s.timothyAwardOverride = null;
    s.familyOwedOverride = null;
    tapDebouncedSave(id, { timothy_award_override_cents: null, family_owed_override_cents: null });
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { timothy_award_cents: null, family_owed_cents: null });
    tapSavePinDebounced(id, _tapYearIdx, { timothy_award_cents: null, family_owed_cents: null });
  }
  tapRenderPlannerTables();
}
function tapSliderChange(el, id) {
  var s = tapById(id);
  if (!s) return;
  var v = Math.min(100, Math.max(0, Math.round(+el.value || 0)));
  // Deliberately does NOT write the clamped value back into the box being typed in: rewriting a
  // focused input's own value mid-keystroke is the controlled-input round-trip that made the
  // Finance boxes type backward (FIN52). The state below is set from the clamped figure either
  // way, so an out-of-range entry still cannot be saved.
  var hadOverride = s.timothyAwardOverride != null;
  if (_tapYearIdx === 0) {
    s.famPct = v; s.touched = true;
    s.timothyAwardOverride = null; s.familyOwedOverride = null;
    tapDebouncedSave(id, { fam_pct: v, touched: 1, timothy_award_override_cents: null, family_owed_override_cents: null });
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { fam_pct: v, timothy_award_cents: null, family_owed_cents: null });
    tapSavePinDebounced(id, _tapYearIdx, { fam_pct: v, timothy_award_cents: null, family_owed_cents: null });
  }
  var sp = tapSplitFor(s, _tapYearIdx);
  var awardEl = document.getElementById('tap-k8award-' + id);
  var famEl = document.getElementById('tap-k8family-' + id);
  if (awardEl) awardEl.value = Math.round(sp.timothyAward);
  if (famEl) famEl.textContent = fmtMoney(Math.round(sp.familyOwed * 100));
  tapUpdateGauges();
  // Dragging the slider clears any manual Timothy Award override — the "↺ auto" link needs
  // to disappear, which requires a full row re-render (its DOM isn't otherwise touched here).
  if (hadOverride) tapRenderPlannerTables();
}
function tapLhsSliderChange(el, id) {
  var s = tapById(id);
  if (!s) return;
  var maxAward = tapCfgNum('lhs_max_award_cents', 250000) / 100;
  var v = Math.min(maxAward, Math.max(0, Math.round(+el.value || 0)));
  var row = el.closest('tr');
  var ranges = row.querySelectorAll('input[type=range]'), nums = row.querySelectorAll('input[type=number]');
  if (ranges[0]) ranges[0].value = v;
  if (nums[0]) nums[0].value = v;
  var awardEl = document.getElementById('tap-lhsaward-' + id);
  if (awardEl) awardEl.textContent = fmtMoney(Math.round(v * 100));
  tapUpdateGauges();
  if (_tapYearIdx === 0) {
    s.lhsAward = v;
    tapDebouncedSave(id, { lhs_award_cents: Math.round(v * 100) });
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { lhs_award_cents: Math.round(v * 100) });
    tapSavePinDebounced(id, _tapYearIdx, { lhs_award_cents: Math.round(v * 100) });
  }
}
function tapSetAttendsLHS(id, checked) {
  var s = tapById(id);
  if (!s) return;
  s.attendsLHS = checked;
  tapDebouncedSave(id, { attends_lhs: checked ? 1 : 0 });
  tapRenderPlannerTables();
}
function tapDebouncedSave(id, fields) {
  // Merge into whatever's still pending for this student instead of replacing it — otherwise
  // e.g. unchecking "Plans to attend LHS" then editing outside aid within the same 500ms
  // window would silently drop the attends_lhs save (it would look fine locally — the UI
  // state is set immediately by the caller — but never actually reach the database).
  _tapPendingFields[id] = Object.assign(_tapPendingFields[id] || {}, fields);
  clearTimeout(_tapSaveTimers[id]);
  _tapSaveTimers[id] = setTimeout(function() {
    var toSave = _tapPendingFields[id];
    delete _tapPendingFields[id];
    api('/admin/api/tuition-aid/students/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toSave) }).catch(function() {});
  }, 500);
}
function tapBulkSave(updates) {
  if (!updates.length) return;
  api('/admin/api/tuition-aid/students/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: updates }) }).catch(function() {});
}
// famPctUpdates: [{id, famPct}] — for the current year this mutates the master row (existing
// behavior); for any other year it pins a per-year record instead, leaving the master
// row (and therefore every OTHER year's rolling projection) untouched.
function tapBulkSaveForYear(yearIdx, famPctUpdates) {
  if (!famPctUpdates.length) return;
  if (yearIdx === 0) {
    // Also clear any manually-typed Timothy Award override — otherwise a previously-overridden
    // student would silently ignore the freshly-computed Family Share % from Apply Policy/
    // Auto-Balance (tapSplitFor gives the override top priority).
    famPctUpdates.forEach(function(u) {
      var s = tapById(u.id);
      if (s) { s.famPct = u.famPct; s.touched = true; s.timothyAwardOverride = null; s.familyOwedOverride = null; }
    });
    tapBulkSave(famPctUpdates.map(function(u) {
      return { id: u.id, fam_pct: u.famPct, touched: 1, timothy_award_override_cents: null, family_owed_override_cents: null };
    }));
  } else {
    var label = tapYearLabelForIdx(yearIdx);
    famPctUpdates.forEach(function(u) { tapUpsertPinLocal(u.id, yearIdx, { fam_pct: u.famPct, timothy_award_cents: null, family_owed_cents: null }); });
    api('/admin/api/tuition-aid/year-pins/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school_year: label, updates: famPctUpdates.map(function(u) { return { student_id: u.id, fam_pct: u.famPct }; }) })
    }).catch(function() {});
  }
}
function tapClearPinsForYear(yearIdx, studentIds) {
  var label = tapYearLabelForIdx(yearIdx);
  studentIds.forEach(function(id) {
    delete _tapPinsByKey[id + '|' + label];
    _tapStudentYears = _tapStudentYears.filter(function(r) { return !(r.student_id === id && r.school_year === label); });
    api('/admin/api/tuition-aid/students/' + id + '/years/' + encodeURIComponent(label), { method: 'DELETE' }).catch(function() {});
  });
}

// One shared pool ("Total Timothy Aid"), not two independent budgets: LHS awards draw from it
// first (LHS enrollment isn't something staff set directly, it just is what it is each year),
// and whatever's left over is what's actually available for K-8 aid. Falls back to the old
// standalone k8_budget_cents figure when no total pool has been configured yet, so nothing
// changes for anyone who hasn't set the new field.
function tapK8BudgetFor(lhsTotal) {
  if (_tapConfig.timothy_total_budget_cents != null) {
    return Math.max(0, tapCfgNum('timothy_total_budget_cents', 0) / 100 - lhsTotal);
  }
  return tapCfgNum('k8_budget_cents', 7500000) / 100;
}
function tapUpdateGauges() {
  var active = tapEnrolledActiveForYear(_tapYearIdx).filter(function(x) { return !(x.bucket === 'K8' && (x.grade === 'PK 3' || x.grade === 'PK 4')); });
  var k8Active = active.filter(function(x) { return x.bucket === 'K8'; });
  var lhsActive = active.filter(function(x) { return x.bucket === 'LHS'; });
  var k8Total = k8Active.reduce(function(sum, x) { return sum + tapSplitFor(x.s, _tapYearIdx).timothyAward; }, 0);
  var lhsTotal = lhsActive.reduce(function(sum, x) { return sum + tapLhsAwardFor(x.s, _tapYearIdx); }, 0);
  var lhsRate = tapCfgNum('lhs_standard_rate_cents', 120000) / 100;
  var lhsReference = lhsActive.length * lhsRate;
  var hasTotalBudget = _tapConfig.timothy_total_budget_cents != null;
  var totalBudget = tapCfgNum('timothy_total_budget_cents', 0) / 100;
  var k8Budget = tapK8BudgetFor(lhsTotal);

  // Pipeline (not-yet-enrolled) students previewed for this year, if any — see
  // tapPipelinePreviewForYear. Their planned awards are real numbers a family may have typed
  // in, but they're deliberately kept OUT of k8Total/lhsTotal above (which stay keyed to actual
  // enrollment) and instead reported as a separate "+ $X planned for N" line on each gauge, so
  // the real budget-used figure can never silently include a kid who hasn't actually enrolled.
  var pipelinePreview = tapPipelinePreviewForYear(_tapYearIdx);
  var k8PipelineTotal = pipelinePreview.k8.reduce(function(sum, x) { return sum + x.sp.timothyAward; }, 0);
  var lhsPipelineTotal = pipelinePreview.lhs.reduce(function(sum, x) { return sum + x.lhsVal; }, 0);
  var pipelineNoteText = function(total, count) {
    return count ? ('+ ' + fmtMoney(Math.round(total * 100)) + ' planned for ' + count + ' pipeline student' + (count === 1 ? '' : 's') + ' not yet enrolled (not counted above)') : '';
  };
  var setPipelineNote = function(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? '' : 'none';
  };

  var k8Fill = document.getElementById('tap-k8-gauge-fill');
  var k8Text = document.getElementById('tap-k8-gauge-text');
  var k8Over = k8Total > k8Budget;
  k8Fill.style.width = Math.min(100, k8Budget ? (k8Total / k8Budget) * 100 : 0) + '%';
  k8Fill.classList.toggle('over', k8Over);
  // The K-8 rows have no range input any more, so the over-budget red rides the Family Share %
  // number box instead — dropping the selector rather than repointing it would have silently
  // removed the per-row over-budget signal along with the slider.
  document.querySelectorAll('#tap-k8-body .tap-slider-row input[type=number]').forEach(function(sl) { sl.classList.toggle('over', k8Over); });
  k8Text.textContent = fmtMoney(Math.round(k8Total * 100)) + (k8Over ? '  (over by ' + fmtMoney(Math.round((k8Total - k8Budget) * 100)) + ')' : ' of ' + fmtMoney(Math.round(k8Budget * 100)));
  k8Text.classList.toggle('tap-over-text', k8Over);
  document.getElementById('tap-k8-gauge-cap').textContent = hasTotalBudget
    ? 'Budget: ' + fmtMoney(Math.round(k8Budget * 100)) + ' (Total Timothy Aid ' + fmtMoney(Math.round(totalBudget * 100)) + ' − LHS ' + fmtMoney(Math.round(lhsTotal * 100)) + ' first)'
    : 'Budget: ' + fmtMoney(Math.round(k8Budget * 100));
  setPipelineNote('tap-k8-pipeline-note', pipelineNoteText(k8PipelineTotal, pipelinePreview.k8.length));

  var lhsFill = document.getElementById('tap-lhs-gauge-fill');
  var lhsText = document.getElementById('tap-lhs-gauge-text');
  var lhsOver = lhsTotal > lhsReference;
  var lhsPct = lhsReference > 0 ? (lhsTotal / lhsReference) * 100 : (lhsTotal > 0 ? 100 : 0);
  lhsFill.style.width = Math.min(100, lhsPct) + '%';
  lhsFill.classList.toggle('over', lhsOver);
  document.querySelectorAll('#tap-lhs-body input[type=range]').forEach(function(sl) { sl.classList.toggle('over', lhsOver); });
  lhsText.textContent = fmtMoney(Math.round(lhsTotal * 100)) + (lhsOver ? '  (' + fmtMoney(Math.round((lhsTotal - lhsReference) * 100)) + ' above standard rate)' : ' — ' + lhsActive.length + ' student' + (lhsActive.length === 1 ? '' : 's') + ' at standard rate');
  lhsText.classList.toggle('tap-over-text', lhsOver);
  document.getElementById('tap-lhs-gauge-cap').textContent = 'Standard rate: ' + lhsActive.length + ' × ' + fmtMoney(Math.round(lhsRate * 100)) + ' = ' + fmtMoney(Math.round(lhsReference * 100));
  setPipelineNote('tap-lhs-pipeline-note', pipelineNoteText(lhsPipelineTotal, pipelinePreview.lhs.length));

  var totalFill = document.getElementById('tap-total-gauge-fill');
  var totalText = document.getElementById('tap-total-gauge-text');
  var totalCap = document.getElementById('tap-total-gauge-cap');
  if (totalFill && totalText && totalCap) {
    var combinedTotal = k8Total + lhsTotal;
    if (!hasTotalBudget) {
      totalFill.style.width = '0%';
      totalFill.classList.remove('over');
      totalText.textContent = fmtMoney(Math.round(combinedTotal * 100));
      totalText.classList.remove('tap-over-text');
      totalCap.textContent = 'Set a Total Timothy Aid Budget below to track against it';
    } else {
      var totalOver = combinedTotal > totalBudget;
      totalFill.style.width = Math.min(100, totalBudget ? (combinedTotal / totalBudget) * 100 : 0) + '%';
      totalFill.classList.toggle('over', totalOver);
      totalText.textContent = fmtMoney(Math.round(combinedTotal * 100)) + (totalOver ? '  (over by ' + fmtMoney(Math.round((combinedTotal - totalBudget) * 100)) + ')' : ' of ' + fmtMoney(Math.round(totalBudget * 100)));
      totalText.classList.toggle('tap-over-text', totalOver);
      totalCap.textContent = 'LHS ' + fmtMoney(Math.round(lhsTotal * 100)) + ' comes off first, leaving ' + fmtMoney(Math.round(k8Budget * 100)) + ' for K-8 (using ' + fmtMoney(Math.round(k8Total * 100)) + ')';
    }
  }
  setPipelineNote('tap-total-pipeline-note', pipelineNoteText(k8PipelineTotal + lhsPipelineTotal, pipelinePreview.k8.length + pipelinePreview.lhs.length));
}

// ── Bulk actions ─────────────────────────────────────────────────────
// All three act on the currently-viewed year (_tapYearIdx): on the current year they mutate
// the master row as before; on any other year they pin/clear per-year records instead, so
// tuning next year's numbers never disturbs this year's (or another year's) figures.
function tapResetAwards() {
  if (_tapYearIdx === 0) {
    var updates = [];
    _tapRoster.forEach(function(s) {
      s.famPct = s.famPctOrig; s.lhsAward = s.lhsAwardOrig; s.attendsLHS = true; s.touched = false;
      s.timothyAwardOverride = null; s.familyOwedOverride = null;
      updates.push({ id: s.id, fam_pct: s.famPctOrig, lhs_award_cents: Math.round(s.lhsAwardOrig * 100), attends_lhs: 1, touched: 0,
        timothy_award_override_cents: null, family_owed_override_cents: null });
    });
    tapBulkSave(updates);
  } else {
    tapClearPinsForYear(_tapYearIdx, _tapRoster.map(function(s) { return s.id; }));
  }
  tapRenderPlannerTables();
}
function tapApplyPolicy() {
  var active = tapEnrolledActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  if (!active.length) return;
  var tuition = tapTuitionForYear(_tapYearIdx);
  var capPct = tapCfgNum('family_share_cap_pct', 50);
  var lhsForBudget = tapEnrolledActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'LHS'; });
  var lhsTotalForBudget = lhsForBudget.reduce(function(sum, x) { return sum + tapLhsAwardFor(x.s, _tapYearIdx); }, 0);
  var k8Budget = tapK8BudgetFor(lhsTotalForBudget);
  var outsideAidOf = function(s) { return tapOutsideAidFor(s, _tapYearIdx); };

  var alloc = active.map(function(x) {
    var r = tapSplitAt(tuition, outsideAidOf(x.s), capPct);
    return { s: x.s, timothy: r.timothyAward, family: r.familyOwed };
  });
  var total = alloc.reduce(function(sum, a) { return sum + a.timothy; }, 0);

  if (total > k8Budget) {
    var raw = active.map(function(x) {
      var r = tapComputeSplit(tuition, outsideAidOf(x.s), capPct);
      return { s: x.s, timothy: r.timothyAward, family: r.familyOwed };
    });
    var rawTotal = raw.reduce(function(sum, a) { return sum + a.timothy; }, 0);
    for (var pass = 0; pass < 12 && rawTotal > k8Budget; pass++) {
      var scale = k8Budget / rawTotal;
      raw.forEach(function(a) { a.timothy = a.timothy * scale; a.family = Math.max(0, tuition - outsideAidOf(a.s) - a.timothy); });
      rawTotal = raw.reduce(function(sum, a) { return sum + a.timothy; }, 0);
    }
    tapBulkSaveForYear(_tapYearIdx, raw.map(function(a) {
      return { id: a.s.id, famPct: tapPctFromFamilyOwed(tuition, outsideAidOf(a.s), a.family) };
    }));
    tapRenderPlannerTables();
    return;
  } else if (total < k8Budget) {
    var surplus = k8Budget - total;
    var capacity = alloc.reduce(function(sum, a) { return sum + a.family; }, 0);
    if (capacity > 0) {
      var give = Math.min(1, surplus / capacity);
      alloc.forEach(function(a) { var extra = a.family * give; a.timothy += extra; a.family -= extra; });
    }
  }
  tapBulkSaveForYear(_tapYearIdx, alloc.map(function(a) {
    return { id: a.s.id, famPct: tapPctFromFamilyOwed(tuition, outsideAidOf(a.s), a.family) };
  }));
  tapRenderPlannerTables();
}
function tapAutoBalance() {
  var active = tapEnrolledActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var tuition = tapTuitionForYear(_tapYearIdx);
  var lhsForBudget = tapEnrolledActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'LHS'; });
  var lhsTotalForBudget = lhsForBudget.reduce(function(sum, x) { return sum + tapLhsAwardFor(x.s, _tapYearIdx); }, 0);
  var k8Budget = tapK8BudgetFor(lhsTotalForBudget);
  var pctById = {};
  active.forEach(function(x) { pctById[x.s.id] = tapFamPctFor(x.s, _tapYearIdx); });
  for (var pass = 0; pass < 12; pass++) {
    var total = active.reduce(function(sum, x) { return sum + tapComputeSplit(tuition, tapOutsideAidFor(x.s, _tapYearIdx), pctById[x.s.id]).timothyAward; }, 0);
    if (total <= k8Budget) break;
    var scale = k8Budget / total;
    active.forEach(function(x) {
      var oldShare = 1 - pctById[x.s.id] / 100;
      var newShare = oldShare * scale;
      pctById[x.s.id] = Math.min(100, Math.max(0, Math.round((1 - newShare) * 100)));
    });
  }
  tapBulkSaveForYear(_tapYearIdx, active.map(function(x) { return { id: x.s.id, famPct: pctById[x.s.id] }; }));
  tapRenderPlannerTables();
}

// ── Past-year view (read/edit a school year that predates "today") ──────────
// Past years aren't reconstructible from today's roster (a graduated or removed student
// simply isn't in it anymore) — the ledger (_tapStudentYears) is the only source of truth,
// so this renders whatever pins exist for that year rather than walking grade progression.
function tapRenderPastYearTable() {
  var label = tapYearLabelForIdx(_tapYearIdx);
  var rows = _tapStudentYears.filter(function(r) { return r.school_year === label; });
  var body = document.getElementById('tap-past-year-body');
  var addBtn = '<button class="btn-secondary" style="margin-bottom:10px;" onclick="tapOpenPastAdd()">+ Add Family Record</button>';
  if (!rows.length) {
    body.innerHTML = addBtn + '<div style="font-size:.82rem;color:var(--warm-gray);padding:10px 0;">No per-family records saved for ' + esc(label) + ' yet. This tool has no historical per-family data to draw on for years before it existed — use "+ Add Family Record" to enter what you know, or records accumulate automatically as each year is edited going forward.</div>';
    return;
  }
  var html = addBtn + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;"><thead><tr style="border-bottom:2px solid var(--navy);">'
    + '<th style="text-align:left;padding:6px 8px;">Family</th><th style="text-align:left;padding:6px 8px;">Child</th>'
    + '<th style="text-align:left;padding:6px 8px;">Grade</th><th style="text-align:right;padding:6px 8px;">Outside Aid</th>'
    + '<th style="text-align:right;padding:6px 8px;">Timothy Award</th><th style="text-align:right;padding:6px 8px;">Family Owed</th>'
    + '<th style="text-align:right;padding:6px 8px;">LHS Award</th><th style="padding:6px 8px;"></th></tr></thead><tbody>';
  rows.forEach(function(r) {
    html += '<tr>'
      + '<td style="padding:6px 8px;">' + esc(r.family) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(r.child) + '</td>'
      + '<td style="padding:6px 8px;">' + esc(r.grade || '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + (r.outside_aid_cents != null ? Math.round(r.outside_aid_cents / 100) : 0) + '" style="width:80px;text-align:right;" onchange="tapPastOutsideAidChange(this,' + r.student_id + ')"></td>'
      + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + (r.timothy_award_cents != null ? Math.round(r.timothy_award_cents / 100) : '') + '" placeholder="—" style="width:80px;text-align:right;" onchange="tapPastTimothyAwardChange(this,' + r.student_id + ')"></td>'
      + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + (r.family_owed_cents != null ? Math.round(r.family_owed_cents / 100) : '') + '" placeholder="—" style="width:80px;text-align:right;" onchange="tapPastFamilyOwedChange(this,' + r.student_id + ')"></td>'
      + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + (r.lhs_award_cents != null ? Math.round(r.lhs_award_cents / 100) : '') + '" placeholder="—" style="width:80px;text-align:right;" onchange="tapPastLhsAwardChange(this,' + r.student_id + ')"></td>'
      + '<td style="padding:6px 8px;"><button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenHistory(' + r.student_id + ')">History</button></td>'
      + '</tr>';
  });
  html += '</tbody></table></div>';
  body.innerHTML = html;
}
function tapPastFieldChange(el, studentId, field) {
  var dollars = el.value === '' ? null : Math.max(0, Math.round(+el.value || 0));
  var cents = dollars == null ? null : dollars * 100;
  var fields = {}; fields[field] = cents;
  tapUpsertPinLocal(studentId, _tapYearIdx, fields);
  tapSavePinDebounced(studentId, _tapYearIdx, fields);
}
function tapPastOutsideAidChange(el, studentId) { tapPastFieldChange(el, studentId, 'outside_aid_cents'); }
function tapPastTimothyAwardChange(el, studentId) { tapPastFieldChange(el, studentId, 'timothy_award_cents'); }
function tapPastFamilyOwedChange(el, studentId) { tapPastFieldChange(el, studentId, 'family_owed_cents'); }
function tapPastLhsAwardChange(el, studentId) { tapPastFieldChange(el, studentId, 'lhs_award_cents'); }

// ── Add a historical family record to a past year ────────────────────────
// Creates an *inactive* tuition_students row (so it never appears in the current/future
// roster) purely to anchor a tuition_student_years pin for the year being viewed.
function tapOpenPastAdd() {
  document.getElementById('tap-past-add-person-search').value = '';
  document.getElementById('tap-past-add-person-id').value = '';
  document.getElementById('tap-past-add-family').value = '';
  document.getElementById('tap-past-add-child').value = '';
  document.getElementById('tap-past-add-grade').value = '';
  document.getElementById('tap-past-add-outside').value = '';
  document.getElementById('tap-past-add-timothy').value = '';
  document.getElementById('tap-past-add-family-owed').value = '';
  document.getElementById('tap-past-add-lhs').value = '';
  document.getElementById('tap-past-add-error').textContent = '';
  document.getElementById('tap-past-add-year-label').textContent = tapYearLabelForIdx(_tapYearIdx);
  openModal('tap-past-add-modal');
}
function tapSavePastAdd() {
  var errEl = document.getElementById('tap-past-add-error');
  var personId = document.getElementById('tap-past-add-person-id').value;
  var family = document.getElementById('tap-past-add-family').value.trim();
  var child = document.getElementById('tap-past-add-child').value.trim();
  var grade = document.getElementById('tap-past-add-grade').value.trim();
  if (!family && !personId) { errEl.textContent = 'Enter a family name or link a person.'; return; }
  var outside = +document.getElementById('tap-past-add-outside').value || 0;
  var timothyRaw = document.getElementById('tap-past-add-timothy').value;
  var familyOwedRaw = document.getElementById('tap-past-add-family-owed').value;
  var lhsRaw = document.getElementById('tap-past-add-lhs').value;
  errEl.textContent = '';
  var label = tapYearLabelForIdx(_tapYearIdx);
  api('/admin/api/tuition-aid/students', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId ? +personId : null, family: family, child: child, base_grade: grade, active: false })
  }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    var studentId = d.id;
    return api('/admin/api/tuition-aid/students/' + studentId + '/years/' + encodeURIComponent(label), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grade: grade,
        outside_aid_cents: Math.round(outside * 100),
        timothy_award_cents: timothyRaw === '' ? null : Math.round(+timothyRaw * 100),
        family_owed_cents: familyOwedRaw === '' ? null : Math.round(+familyOwedRaw * 100),
        lhs_award_cents: lhsRaw === '' ? null : Math.round(+lhsRaw * 100)
      })
    });
  }).then(function() {
    closeModal('tap-past-add-modal');
    return tapReloadKeepingYear();
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not add.'; });
}

// ── Family / student history (all pinned years for one student) ─────────────
function tapJumpToYear(offset) {
  closeModal('tap-history-modal');
  document.getElementById('tap-year-select').value = offset;
  tapSetYear(offset);
}
function tapOpenHistory(id) {
  _tapHistoryTargetId = id;
  var rows = _tapStudentYears.filter(function(r) { return r.student_id === id; })
    .slice().sort(function(a, b) { return a.school_year < b.school_year ? -1 : 1; });
  var s = tapById(id);
  var family = rows.length ? rows[0].family : (s ? s.family : '');
  var child = rows.length ? rows[0].child : (s ? s.child : '');
  document.getElementById('tap-history-title').textContent = (family ? family + ' — ' : '') + child;
  var body = document.getElementById('tap-history-body');
  var liveRow = '';
  if (s) {
    // LHS Award only applies to LHS (grade 9-12) students; K-8/WOL students never have one
    // (attendsLHS defaults true for everyone and just means "still planning to attend LHS
    // once they get there" — it's not a signal that a K-8 student is currently in LHS).
    // Likewise Timothy Award/Family Owed/Outside Aid are K-8-only concepts — tapSplitFor()
    // isn't meaningful for an LHS-bucket student, whose tuition_students row has no real
    // outside_aid/fam_pct data (LHS aid is tracked as a flat lhs_award_cents instead).
    var bucket0 = tapBucketFor(s, tapGradeAt(s, 0));
    var label = tapYearLabelForIdx(0);
    if (bucket0 === 'K8') {
      var sp = tapSplitFor(s, 0);
      liveRow = '<tr style="background:var(--pale-gold);"><td style="padding:6px 8px;">' + esc(label) + ' (current)</td>'
        + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(s.outsideAid * 100)) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.timothyAward * 100)) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.familyOwed * 100)) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;">—</td>'
        + '<td></td></tr>';
    } else if (bucket0 === 'LHS') {
      liveRow = '<tr style="background:var(--pale-gold);"><td style="padding:6px 8px;">' + esc(label) + ' (current)</td>'
        + '<td style="padding:6px 8px;text-align:right;">—</td>'
        + '<td style="padding:6px 8px;text-align:right;">—</td>'
        + '<td style="padding:6px 8px;text-align:right;">—</td>'
        + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(s.lhsAward * 100)) + '</td>'
        + '<td></td></tr>';
    }
  }
  if (!rows.length && !liveRow) {
    body.innerHTML = '<div style="font-size:.82rem;color:var(--warm-gray);padding:10px 0;">No history recorded for this student yet.</div>';
    openModal('tap-history-modal');
    return;
  }
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;"><thead><tr style="border-bottom:2px solid var(--navy);">'
    + '<th style="text-align:left;padding:6px 8px;">School Year</th><th style="text-align:right;padding:6px 8px;">Outside Aid</th>'
    + '<th style="text-align:right;padding:6px 8px;">Timothy Award</th><th style="text-align:right;padding:6px 8px;">Family Owed</th>'
    + '<th style="text-align:right;padding:6px 8px;">LHS Award</th><th style="padding:6px 8px;"></th></tr></thead><tbody>';
  rows.forEach(function(r) {
    var baseYear = tapCfgNum('base_school_year', 2026);
    var yearIdx = parseInt(r.school_year) - baseYear;
    html += '<tr><td style="padding:6px 8px;">' + esc(r.school_year) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (r.outside_aid_cents != null ? fmtMoney(r.outside_aid_cents) : '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (r.timothy_award_cents != null ? fmtMoney(r.timothy_award_cents) : '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (r.family_owed_cents != null ? fmtMoney(r.family_owed_cents) : '—') + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (r.lhs_award_cents != null ? fmtMoney(r.lhs_award_cents) : '—') + '</td>'
      + '<td style="padding:6px 8px;"><button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapJumpToYear(' + yearIdx + ')">Jump</button></td></tr>';
  });
  html += '</tbody>' + (liveRow ? '<tfoot>' + liveRow + '</tfoot>' : '') + '</table></div>';
  body.innerHTML = html;
  openModal('tap-history-modal');
}

// ── Pipeline management ────────────────────────────────────────────
function tapRenderPipelineList() {
  var box = document.getElementById('tap-pipeline-list');
  var pipe = _tapRoster.filter(function(s) { return s.isPipeline; });
  if (!pipe.length) { box.innerHTML = '<div style="font-size:.78rem;color:#8A7440;font-style:italic;">No future entrants added yet.</div>'; return; }
  box.innerHTML = pipe.map(function(p) {
    var kCalYear = p.birthYear + 5;
    var kk = (kCalYear + 1) % 100;
    var kSchoolYear = kCalYear + '-' + (kk < 10 ? '0' + kk : kk);
    // Being old enough by birth year isn't the same as being actually enrolled — this button
    // only appears once they're age-eligible, and is the only thing that moves a pipeline
    // entrant into the real K-8/LHS planner tables (tapEnrollPipeline).
    var grade0 = tapGradeAt(p, 0);
    var enrollBtn = (grade0 !== null && grade0 !== 'Graduated')
      ? ' <button class="tap-pipeline-remove" style="color:var(--sage);" onclick="tapEnrollPipeline(' + p.id + ')" title="Enroll now">&#10003; Enroll</button>' : '';
    // A manually-entered grade overrides the birth-year projection (see tapGradeAt) — say so
    // instead of showing the now-superseded "K expected" birth-year math.
    var gradeCaption = p.baseGrade ? ('grade ' + esc(p.baseGrade) + ' now') : ('K expected ' + kSchoolYear);
    return '<div class="tap-pipeline-chip">' + esc(p.family) + ' ' + esc(p.child)
      + ' <span style="color:var(--warm-gray);font-size:.72rem;">(b. ' + p.birthYear + ' — ' + gradeCaption + ')</span>'
      + enrollBtn
      + ' <button class="tap-pipeline-remove" onclick="tapRemoveStudent(' + p.id + ')" title="Remove">&times;</button></div>';
  }).join('');
}
function tapEnrollPipeline(id) {
  var s = tapById(id);
  if (!s) return;
  var grade0 = tapGradeAt(s, 0);
  if (grade0 === null || grade0 === 'Graduated') return;
  if (!confirm('Enroll ' + s.child + ' as a current ' + grade0 + '-grade student for ' + tapYearLabelForIdx(0) + '?')) return;
  api('/admin/api/tuition-aid/students/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_pipeline: false, base_grade: grade0 })
  }).then(function() { loadTuitionAid(); }).catch(function() {});
}
function tapAddPipeline() {
  var errEl = document.getElementById('tap-pipeline-error');
  var family = document.getElementById('tap-pipe-family').value.trim();
  var child = document.getElementById('tap-pipe-child').value.trim();
  var birthYear = +document.getElementById('tap-pipe-birthyear').value;
  var grade = document.getElementById('tap-pipe-grade').value;
  var baseYear = tapCfgNum('base_school_year', 2026);
  if (!family || !child) { errEl.textContent = "Enter both a family name and a child's name."; return; }
  if (!birthYear || birthYear < baseYear - 6 || birthYear > baseYear + 1) { errEl.textContent = 'Enter a birth year between ' + (baseYear - 6) + ' and ' + (baseYear + 1) + '.'; return; }
  errEl.textContent = '';
  var body = {
    family: family, child: child, is_pipeline: true, birth_year: birthYear,
    fam_pct: tapCfgNum('default_pipeline_fam_pct', 50), lhs_award_cents: tapCfgNum('lhs_standard_rate_cents', 120000)
  };
  // Optional: birth year alone assumes a fixed age-based cutoff, which doesn't hold for a kid
  // close to the cutoff date or one a family is intentionally holding back a year — an explicit
  // grade (meaning "this grade as of the current school year") overrides that assumption.
  if (grade) body.base_grade = grade;
  api('/admin/api/tuition-aid/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    document.getElementById('tap-pipe-family').value = '';
    document.getElementById('tap-pipe-child').value = '';
    document.getElementById('tap-pipe-birthyear').value = '';
    document.getElementById('tap-pipe-grade').value = '';
    loadTuitionAid();
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not add.'; });
}
function tapRemoveStudent(id) {
  if (!confirm('Remove this student from the planner?')) return;
  api('/admin/api/tuition-aid/students/' + id, { method: 'DELETE' }).then(function() { loadTuitionAid(); }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}

// ── Add student modal ──────────────────────────────────────────────
function tapOpenAddStudent() {
  document.getElementById('tap-add-person-search').value = '';
  document.getElementById('tap-add-person-id').value = '';
  document.getElementById('tap-add-family').value = '';
  document.getElementById('tap-add-child').value = '';
  document.getElementById('tap-add-is-pipeline').checked = false;
  document.getElementById('tap-add-birthyear').value = '';
  document.getElementById('tap-add-error').textContent = '';
  tapToggleAddMode();
  openModal('tap-student-modal');
}
function tapToggleAddMode() {
  var isPipe = document.getElementById('tap-add-is-pipeline').checked;
  document.getElementById('tap-add-grade-wrap').style.display = isPipe ? 'none' : '';
  document.getElementById('tap-add-birthyear-wrap').style.display = isPipe ? '' : 'none';
}
function tapSaveNewStudent() {
  var errEl = document.getElementById('tap-add-error');
  var personId = document.getElementById('tap-add-person-id').value;
  var family = document.getElementById('tap-add-family').value.trim();
  var child = document.getElementById('tap-add-child').value.trim();
  var isPipe = document.getElementById('tap-add-is-pipeline').checked;
  var body = { person_id: personId ? +personId : null, family: family, child: child, is_pipeline: isPipe };
  if (isPipe) {
    var by = +document.getElementById('tap-add-birthyear').value;
    if (!by) { errEl.textContent = 'Birth year is required.'; return; }
    body.birth_year = by;
    body.fam_pct = tapCfgNum('default_pipeline_fam_pct', 50);
  } else {
    body.base_grade = document.getElementById('tap-add-grade').value;
    body.fam_pct = 50;
  }
  body.lhs_award_cents = tapCfgNum('lhs_standard_rate_cents', 120000);
  if (!body.family && !body.person_id) { errEl.textContent = 'Enter a family name or link a person.'; return; }
  errEl.textContent = '';
  api('/admin/api/tuition-aid/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    closeModal('tap-student-modal');
    loadTuitionAid();
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not add.'; });
}

// ── Link existing row to a Person record ───────────────────────────
function tapOpenLinkPerson(id) {
  _tapLinkTargetId = id;
  document.getElementById('tap-link-person-search').value = '';
  document.getElementById('tap-link-person-id').value = '';
  document.getElementById('tap-link-error').textContent = '';
  document.getElementById('tap-link-suggestions').innerHTML = '';
  openModal('tap-link-modal');
  var s = tapById(id);
  if (s && (s.family || s.child)) tapLoadLinkSuggestions(s.family, s.child);
}
function tapLoadLinkSuggestions(family, child) {
  var box = document.getElementById('tap-link-suggestions');
  var q = (family || child || '').trim();
  if (q.length < 2) return;
  box.innerHTML = '<div style="font-size:.75rem;color:var(--warm-gray);">Looking for a match…</div>';
  var famLc = (family || '').trim().toLowerCase();
  var childLc = (child || '').trim().toLowerCase();
  api('/admin/api/people?q=' + encodeURIComponent(q)).then(function(d) {
    var scored = (d.people || []).map(function(p) {
      var fn = (p.first_name || '').toLowerCase(), ln = (p.last_name || '').toLowerCase();
      var score = 0;
      if (famLc && ln === famLc) score += 2; else if (famLc && ln.indexOf(famLc) !== -1) score += 1;
      if (childLc && fn === childLc) score += 2; else if (childLc && fn.indexOf(childLc) !== -1) score += 1;
      return { p: p, score: score };
    }).filter(function(x) { return x.score > 0; })
      .sort(function(a, b) { return b.score - a.score; })
      .slice(0, 4);
    if (!scored.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div style="font-size:.75rem;color:var(--warm-gray);margin-bottom:4px;">Suggested match' + (scored.length > 1 ? 'es' : '') + ' — click to select, or search below if none fit:</div>'
      + scored.map(function(x) {
        var p = x.p, best = x.score >= 4;
        var raw = (p.first_name || '') + ' ' + (p.last_name || '');
        var n = esc(p.first_name) + ' ' + esc(p.last_name);
        var hh = p.household_name ? ' <span style="color:var(--warm-gray);font-size:.78rem;">(' + esc(p.household_name) + ')</span>' : '';
        return '<div class="ac-item" style="border:1px solid var(--border);border-radius:8px;margin-bottom:4px;padding:6px 8px;cursor:pointer;' + (best ? 'background:var(--linen);' : '') + '" onclick="tapPickSuggestion(' + p.id + ',' + jsAttr(raw) + ')">'
          + (best ? '&#9733; ' : '') + n + hh + '</div>';
      }).join('');
  }).catch(function() { box.innerHTML = ''; });
}
function tapPickSuggestion(id, name) {
  document.getElementById('tap-link-person-id').value = id;
  document.getElementById('tap-link-person-search').value = name;
  document.getElementById('tap-link-person-ac').classList.remove('open');
  document.getElementById('tap-link-suggestions').innerHTML = '<div style="font-size:.78rem;color:var(--sage);">&#10003; ' + esc(name) + ' selected — click Link to confirm, or search below to change.</div>';
}
function tapSaveLinkPerson() {
  var personId = document.getElementById('tap-link-person-id').value;
  var errEl = document.getElementById('tap-link-error');
  if (!personId) { errEl.textContent = 'Search and select a person.'; return; }
  api('/admin/api/tuition-aid/students/' + _tapLinkTargetId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ person_id: +personId }) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    closeModal('tap-link-modal');
    loadTuitionAid();
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not link.'; });
}

// ── Import per-student history from an uploaded Excel workbook ──────────────
// Dependency-free XLSX reader: no external library (this app hand-rolls everything, and a
// bundled parser would be the only third-party JS dependency in the whole codebase). Reads
// the ZIP container directly (XLSX is a ZIP of XML files) using the browser's native
// DecompressionStream for the DEFLATE payloads, and a tag-scanning text extractor for the XML
// (no DOMParser dependency either — keeps this testable outside a browser too).
function tapXmlUnescape(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function(m, d) { return String.fromCharCode(+d); })
    .replace(/&#x([0-9a-fA-F]+);/g, function(m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&amp;/g, '&');
}
function tapZipReadEntries(bytes) {
  var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  var eocdOffset = -1;
  var searchStart = Math.max(0, bytes.length - 66000);
  for (var i = bytes.length - 22; i >= searchStart; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid Excel (.xlsx) file.');
  var totalEntries = dv.getUint16(eocdOffset + 10, true);
  var cdOffset = dv.getUint32(eocdOffset + 16, true);
  var entries = [];
  var p = cdOffset;
  for (var e = 0; e < totalEntries; e++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This Excel file is not in the expected format.');
    var compressionMethod = dv.getUint16(p + 10, true);
    var compressedSize = dv.getUint32(p + 20, true);
    var filenameLen = dv.getUint16(p + 28, true);
    var extraLen = dv.getUint16(p + 30, true);
    var commentLen = dv.getUint16(p + 32, true);
    var localHeaderOffset = dv.getUint32(p + 42, true);
    var filename = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + filenameLen));
    entries.push({ filename: filename, compressionMethod: compressionMethod, compressedSize: compressedSize, localHeaderOffset: localHeaderOffset });
    p += 46 + filenameLen + extraLen + commentLen;
  }
  return entries;
}
function tapZipLocalFileDataOffset(bytes, localHeaderOffset) {
  var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(localHeaderOffset, true) !== 0x04034b50) throw new Error('This Excel file is not in the expected format.');
  var filenameLen = dv.getUint16(localHeaderOffset + 26, true);
  var extraLen = dv.getUint16(localHeaderOffset + 28, true);
  return localHeaderOffset + 30 + filenameLen + extraLen;
}
function tapInflateRaw(chunk) {
  var ds = new DecompressionStream('deflate-raw');
  var writer = ds.writable.getWriter();
  writer.write(chunk);
  writer.close();
  var out = [];
  var reader = ds.readable.getReader();
  function pump() {
    return reader.read().then(function(res) {
      if (res.done) return;
      out.push(res.value);
      return pump();
    });
  }
  return pump().then(function() {
    var total = out.reduce(function(s, a) { return s + a.length; }, 0);
    var result = new Uint8Array(total);
    var off = 0;
    for (var i = 0; i < out.length; i++) { result.set(out[i], off); off += out[i].length; }
    return result;
  });
}
function tapZipReadEntryBytes(bytes, entries, filename) {
  var entry = null;
  for (var i = 0; i < entries.length; i++) { if (entries[i].filename === filename) { entry = entries[i]; break; } }
  if (!entry) return Promise.resolve(null);
  var dataOffset = tapZipLocalFileDataOffset(bytes, entry.localHeaderOffset);
  var compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return Promise.resolve(compressed);
  if (entry.compressionMethod === 8) return tapInflateRaw(compressed);
  return Promise.reject(new Error('Unsupported compression in this Excel file.'));
}
function tapXlsxParseSharedStrings(xml) {
  var out = [];
  var siRe = /<si>([\s\S]*?)<\/si>/g;
  var m;
  while ((m = siRe.exec(xml))) {
    var block = m[1];
    var text = '';
    var tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    var tm;
    while ((tm = tRe.exec(block))) text += tapXmlUnescape(tm[1]);
    out.push(text);
  }
  return out;
}
function tapXlsxColToIndex(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}
function tapXlsxParseSheetGrid(xml, sharedStrings) {
  var grid = [];
  var rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  var rm;
  while ((rm = rowRe.exec(xml))) {
    var rowNum = parseInt(rm[1], 10);
    var rowXml = rm[2];
    var rowArr = grid[rowNum - 1] || (grid[rowNum - 1] = []);
    var cellRe = /<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    var cm;
    while ((cm = cellRe.exec(rowXml))) {
      var attrs = cm[1] != null ? cm[1] : cm[2];
      var inner = cm[3] || '';
      var refM = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!refM) continue;
      var colIdx = tapXlsxColToIndex(refM[1]);
      var typeM = /\bt="([a-zA-Z]+)"/.exec(attrs);
      var type = typeM ? typeM[1] : 'n';
      var value = null;
      if (type === 's') {
        var vM = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM) value = sharedStrings[parseInt(vM[1], 10)];
      } else if (type === 'inlineStr') {
        var tM = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(inner);
        if (tM) value = tapXmlUnescape(tM[1]);
      } else if (type === 'str' || type === 'b') {
        var vM2 = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM2) value = type === 'b' ? (vM2[1] === '1') : tapXmlUnescape(vM2[1]);
      } else {
        var vM3 = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (vM3 && vM3[1] !== '') value = parseFloat(vM3[1]);
      }
      rowArr[colIdx] = value;
    }
  }
  var dense = [];
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    if (!row) { dense.push([]); continue; }
    var denseRow = [];
    for (var c = 0; c < row.length; c++) denseRow.push(row[c] === undefined ? null : row[c]);
    dense.push(denseRow);
  }
  return dense;
}
function tapXlsxFindSheetPath(workbookXml, relsXml, sheetName) {
  var sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="(rId\d+)"[^>]*\/>/g;
  var sm, rId = null;
  while ((sm = sheetRe.exec(workbookXml))) {
    if (tapXmlUnescape(sm[1]) === sheetName) { rId = sm[2]; break; }
  }
  if (!rId) return null;
  var relMap = {};
  var relRe = /<Relationship\b[^>]*\/>/g;
  var rm;
  while ((rm = relRe.exec(relsXml))) {
    var tag = rm[0];
    var idM = /\bId="([^"]*)"/.exec(tag);
    var targetM = /\bTarget="([^"]*)"/.exec(tag);
    if (idM && targetM) relMap[idM[1]] = targetM[1];
  }
  var target = relMap[rId];
  if (!target) return null;
  return 'xl/' + target;
}
function tapParseXlsxSheet(arrayBuffer, sheetName) {
  var bytes = new Uint8Array(arrayBuffer);
  var entries = tapZipReadEntries(bytes);
  var dec = new TextDecoder('utf-8');
  return Promise.all([
    tapZipReadEntryBytes(bytes, entries, 'xl/workbook.xml'),
    tapZipReadEntryBytes(bytes, entries, 'xl/_rels/workbook.xml.rels'),
    tapZipReadEntryBytes(bytes, entries, 'xl/sharedStrings.xml')
  ]).then(function(res) {
    var workbookXml = dec.decode(res[0]);
    var relsXml = dec.decode(res[1]);
    var sheetPath = tapXlsxFindSheetPath(workbookXml, relsXml, sheetName);
    if (!sheetPath) throw new Error('Could not find a "' + sheetName + '" sheet in this file.');
    var sharedStrings = res[2] ? tapXlsxParseSharedStrings(dec.decode(res[2])) : [];
    return tapZipReadEntryBytes(bytes, entries, sheetPath).then(function(sheetBytes) {
      return tapXlsxParseSheetGrid(dec.decode(sheetBytes), sharedStrings);
    });
  });
}
function tapFindHistoryHeaderRow(grid) {
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    if (row && row[0] === 'Family' && row[1] === 'Child') return r;
  }
  return -1;
}
function tapYearColumnsFromHeader(headerRow) {
  var out = [];
  for (var c = 2; c < headerRow.length; c++) {
    var cell = headerRow[c];
    if (typeof cell !== 'string') continue;
    var m = /Parent\s*\n?\s*(\d{4}-\d{2})/.exec(cell);
    if (m) out.push({ col: c, year: m[1] });
  }
  return out;
}
function tapExtractHistoryRecords(grid, currentSchoolYear) {
  var headerIdx = tapFindHistoryHeaderRow(grid);
  if (headerIdx === -1) throw new Error('Could not find the header row (expected "Family"/"Child" columns).');
  var yearCols = tapYearColumnsFromHeader(grid[headerIdx]);
  if (!yearCols.length) throw new Error('Could not find any "Parent YYYY-YY" year columns in the header row.');
  var records = [];
  for (var r = headerIdx + 1; r < grid.length; r++) {
    var row = grid[r];
    if (!row) continue;
    var family = row[0], child = row[1];
    if (family == null || typeof family !== 'string') continue;
    if (family.indexOf('▸') === 0 || family.indexOf('📋') === 0) continue;
    var entries = [];
    for (var i = 0; i < yearCols.length; i++) {
      var yc = yearCols[i];
      if (yc.year === currentSchoolYear) continue;
      var val = row[yc.col];
      if (val == null || typeof val !== 'number') continue;
      entries.push({ school_year: yc.year, family_owed_cents: Math.round(val * 100) });
    }
    if (entries.length) records.push({ family: family, child: child || '', entries: entries });
  }
  return records;
}

// ── Wide multi-year-group "Student Tuition History" layout ────────────────
// A richer variant of the simple ledger: instead of one "Parent YYYY-YY" column
// per year, each year gets a 5-column group (Grade / Tuition Billed / Outside Aid /
// Timothy Aid / Family Owed), with the year label merged across the group one row
// above the column headers. Tried first on a "Student Tuition History" sheet;
// falls back to the simple single-column-per-year format if this isn't found.
function tapDetectMultiYearHistoryLayout(grid) {
  var headerIdx = tapFindHistoryHeaderRow(grid);
  if (headerIdx <= 0) return null;
  var yearRow = grid[headerIdx - 1], headerRow = grid[headerIdx];
  if (!yearRow || !headerRow) return null;
  var groups = [];
  for (var c = 2; c < yearRow.length; c++) {
    var cell = yearRow[c];
    if (typeof cell !== 'string') continue;
    var m = /^(\d{4})-(\d{2,4})$/.exec(cell.trim());
    if (!m) continue;
    var year = m[1] + '-' + (m[2].length === 4 ? m[2].slice(2) : m[2]);
    if (tapNormHeader(headerRow[c]) !== 'grade') continue;
    if (tapNormHeader(headerRow[c + 2]).indexOf('outside') !== 0) continue;
    if (tapNormHeader(headerRow[c + 3]).indexOf('timothy') !== 0) continue;
    if (tapNormHeader(headerRow[c + 4]).indexOf('family') !== 0) continue;
    groups.push({ year: year, gradeCol: c, tuitionCol: c + 1, outsideCol: c + 2, timothyCol: c + 3, familyOwedCol: c + 4 });
  }
  return groups.length ? { headerRow: headerIdx, groups: groups } : null;
}
function tapExtractMultiYearHistory(grid, layout, currentSchoolYear) {
  var records = [], reconcileWarnings = [];
  for (var r = layout.headerRow + 1; r < grid.length; r++) {
    var row = grid[r];
    if (!row) continue;
    var family = row[0], child = row[1];
    if (typeof family !== 'string' || !family.trim()) continue;
    if (family.indexOf('▸') === 0 || family.indexOf('📋') === 0) continue;
    if (typeof child !== 'string' || !child.trim()) continue;
    var entries = [];
    for (var i = 0; i < layout.groups.length; i++) {
      var g = layout.groups[i];
      if (g.year === currentSchoolYear) continue;
      var gradeRaw = row[g.gradeCol], tuitionRaw = row[g.tuitionCol], outsideRaw = row[g.outsideCol],
        timothyRaw = row[g.timothyCol], familyRaw = row[g.familyOwedCol];
      var hasGrade = gradeRaw != null && String(gradeRaw).trim() !== '';
      var hasAny = hasGrade || typeof outsideRaw === 'number' || typeof timothyRaw === 'number' || typeof familyRaw === 'number';
      if (!hasAny) continue;
      var entry = { school_year: g.year };
      if (hasGrade) entry.grade = String(gradeRaw).trim();
      if (typeof outsideRaw === 'number') entry.outside_aid_cents = Math.round(outsideRaw * 100);
      if (typeof timothyRaw === 'number') entry.timothy_award_cents = Math.round(timothyRaw * 100);
      if (typeof familyRaw === 'number') entry.family_owed_cents = Math.round(familyRaw * 100);
      entries.push(entry);
      if (typeof tuitionRaw === 'number' && typeof outsideRaw === 'number' && typeof timothyRaw === 'number' && typeof familyRaw === 'number') {
        var computed = tuitionRaw - outsideRaw - timothyRaw;
        if (Math.abs(computed - familyRaw) > 1) {
          reconcileWarnings.push({ family: family.trim(), child: child.trim(), school_year: g.year,
            tuition: tuitionRaw, outside: outsideRaw, timothy: timothyRaw, familyOwed: familyRaw, computed: computed });
        }
      }
    }
    if (entries.length) records.push({ family: family.trim(), child: child.trim(), entries: entries });
  }
  return { records: records, reconcileWarnings: reconcileWarnings };
}

// ── Raw award-workbook parser ────────────────────────────────────────────
// Reads the school's actual working workbook (one sheet per year, e.g. "26-27",
// "2025-26", "Timothy Member Tuition 2023-24") directly - no reformatting needed.
// Only sheets with the clean, single-child-per-row layout (exact "Last Name" /
// "Grade" / "Child" / "Parent Portion" headers) are recognized; older sheets that
// use a different shape (one row per family with multiple children, or a
// different scholarship vocabulary) are skipped and listed for the user rather
// than guessed at.
function tapXlsxListSheetNames(workbookXml) {
  var out = [];
  var sheetRe = /<sheet\b[^>]*\bname="([^"]*)"[^>]*\/>/g;
  var sm;
  while ((sm = sheetRe.exec(workbookXml))) out.push(tapXmlUnescape(sm[1]));
  return out;
}
function tapParseWorkbookAllSheets(arrayBuffer) {
  var bytes = new Uint8Array(arrayBuffer);
  var entries = tapZipReadEntries(bytes);
  var dec = new TextDecoder('utf-8');
  return Promise.all([
    tapZipReadEntryBytes(bytes, entries, 'xl/workbook.xml'),
    tapZipReadEntryBytes(bytes, entries, 'xl/_rels/workbook.xml.rels'),
    tapZipReadEntryBytes(bytes, entries, 'xl/sharedStrings.xml')
  ]).then(function(res) {
    var workbookXml = dec.decode(res[0]);
    var relsXml = dec.decode(res[1]);
    var sharedStrings = res[2] ? tapXlsxParseSharedStrings(dec.decode(res[2])) : [];
    var names = tapXlsxListSheetNames(workbookXml);
    return names.reduce(function(chain, name) {
      return chain.then(function(acc) {
        var sheetPath = tapXlsxFindSheetPath(workbookXml, relsXml, name);
        if (!sheetPath) { acc.push({ name: name, grid: null }); return acc; }
        return tapZipReadEntryBytes(bytes, entries, sheetPath).then(function(sheetBytes) {
          acc.push({ name: name, grid: sheetBytes ? tapXlsxParseSheetGrid(dec.decode(sheetBytes), sharedStrings) : null });
          return acc;
        });
      });
    }, Promise.resolve([]));
  });
}
function tapYearLabelFromSheetName(name) {
  var s = (name || '').trim();
  var m = /^(\d{2})-(\d{2})$/.exec(s);
  if (m) return '20' + m[1] + '-' + m[2];
  m = /(\d{4})-(\d{2,4})$/.exec(s);
  if (m) return m[1] + '-' + (m[2].length === 4 ? m[2].slice(2) : m[2]);
  return null;
}
function tapNormHeader(v) {
  return (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().toLowerCase();
}
var TAP_OUTSIDE_AID_HEADERS = ['today & tomorrow', 'building blocks', 'cfna', 'other', 'mo scholars', 'lase scholarship', 'ace'];
var TAP_TIMOTHY_AWARD_HEADERS = ['partnership grant', 'access grant', 'soldiers of the cross'];
function tapDetectAwardSheetLayout(grid) {
  for (var r = 0; r < grid.length; r++) {
    var row = grid[r];
    if (!row) continue;
    var familyCol = -1, gradeCol = -1, childCol = -1, parentPortionCol = -1, partnershipCol = -1;
    var outsideCols = [], timothyCols = [];
    for (var c = 0; c < row.length; c++) {
      var h = tapNormHeader(row[c]);
      if (h === 'last name') familyCol = c;
      else if (h === 'grade') gradeCol = c;
      else if (h === 'child') childCol = c;
      else if (h.indexOf('parent portion') === 0) parentPortionCol = c;
      else if (TAP_OUTSIDE_AID_HEADERS.indexOf(h) !== -1) outsideCols.push(c);
      else if (TAP_TIMOTHY_AWARD_HEADERS.indexOf(h) !== -1) { timothyCols.push(c); if (h === 'partnership grant') partnershipCol = c; }
    }
    if (familyCol !== -1 && gradeCol !== -1 && childCol !== -1 && parentPortionCol !== -1) {
      return { headerRow: r, familyCol: familyCol, gradeCol: gradeCol, childCol: childCol,
        parentPortionCol: parentPortionCol, outsideCols: outsideCols, timothyCols: timothyCols, partnershipCol: partnershipCol };
    }
  }
  return null;
}
function tapExtractAwardSheetK8(grid, layout, schoolYear) {
  var records = [];
  for (var r = layout.headerRow + 1; r < grid.length; r++) {
    var row = grid[r];
    if (!row) continue;
    var family = row[layout.familyCol], child = row[layout.childCol];
    var parentPortion = row[layout.parentPortionCol];
    if (typeof child !== 'string' || !child.trim()) continue;
    if (typeof parentPortion !== 'number') continue;
    var gradeRaw = row[layout.gradeCol];
    var outsideAid = 0;
    for (var i = 0; i < layout.outsideCols.length; i++) { var v = row[layout.outsideCols[i]]; if (typeof v === 'number') outsideAid += v; }
    var timothyAward = 0;
    for (var j = 0; j < layout.timothyCols.length; j++) { var v2 = row[layout.timothyCols[j]]; if (typeof v2 === 'number') timothyAward += v2; }
    records.push({
      family: (typeof family === 'string' ? family : '').trim(),
      child: child.trim(),
      grade: gradeRaw == null ? '' : String(gradeRaw).trim(),
      outside_aid_cents: Math.round(outsideAid * 100),
      timothy_award_cents: Math.round(timothyAward * 100),
      family_owed_cents: Math.round(parentPortion * 100),
      school_year: schoolYear
    });
  }
  return records;
}
function tapExtractAwardSheetLhs(grid, layout, schoolYear) {
  if (layout.partnershipCol === -1) return [];
  var anchorIdx = -1;
  for (var r = 0; r < grid.length && anchorIdx === -1; r++) {
    var row = grid[r];
    if (!row) continue;
    for (var c = 0; c < row.length; c++) {
      if (typeof row[c] === 'string' && /^lhsa\s*aid$/i.test(row[c].trim())) { anchorIdx = r; break; }
    }
  }
  if (anchorIdx === -1) return [];
  var out = [];
  for (var r2 = anchorIdx - 1; r2 >= 0; r2--) {
    var row2 = grid[r2];
    if (!row2) break;
    var gradeNum = parseInt(row2[layout.gradeCol], 10);
    var childVal = row2[layout.childCol];
    var awardVal = row2[layout.partnershipCol];
    if (!(gradeNum >= 9 && gradeNum <= 12) || typeof childVal !== 'string' || !childVal.trim() || typeof awardVal !== 'number') break;
    out.push({ rawName: childVal.trim(), grade: String(gradeNum), lhs_award_cents: Math.round(awardVal * 100), school_year: schoolYear });
  }
  out.reverse();
  return out;
}
function tapExtractFromRawWorkbook(sheets, currentSchoolYear) {
  var k8Records = [], lhsRaw = [], skippedSheets = [];
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    if (!sheet.grid) continue;
    var yearLabel = tapYearLabelFromSheetName(sheet.name);
    var layout = tapDetectAwardSheetLayout(sheet.grid);
    if (!yearLabel || !layout) { skippedSheets.push(sheet.name); continue; }
    if (yearLabel === currentSchoolYear) continue;
    k8Records = k8Records.concat(tapExtractAwardSheetK8(sheet.grid, layout, yearLabel));
    lhsRaw = lhsRaw.concat(tapExtractAwardSheetLhs(sheet.grid, layout, yearLabel));
  }
  return { k8Records: k8Records, lhsRaw: lhsRaw, skippedSheets: skippedSheets };
}
function tapMatchLhsName(rawName, roster) {
  var norm = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  var tokens = norm.split(' ');
  var fullMatches = roster.filter(function(s) {
    var a = (s.child + ' ' + s.family).trim().toLowerCase().replace(/\s+/g, ' ');
    var b = (s.family + ' ' + s.child).trim().toLowerCase().replace(/\s+/g, ' ');
    return a === norm || b === norm;
  });
  if (fullMatches.length === 1) return { status: 'ok', student: fullMatches[0] };
  if (fullMatches.length > 1) return { status: 'ambiguous', candidates: fullMatches };
  var firstTok = tokens[0];
  var firstMatches = roster.filter(function(s) { return s.child.trim().toLowerCase() === firstTok; });
  if (firstMatches.length === 1) return { status: 'ok', student: firstMatches[0] };
  if (firstMatches.length > 1) return { status: 'ambiguous', candidates: firstMatches };
  return { status: 'notfound' };
}
function tapBuildImportRecords(k8Records, lhsRaw, roster) {
  var map = {};
  function keyOf(family, child) { return family.trim().toLowerCase() + '|' + child.trim().toLowerCase(); }
  k8Records.forEach(function(r) {
    var k = keyOf(r.family, r.child);
    if (!map[k]) map[k] = { family: r.family, child: r.child, entries: [] };
    map[k].entries.push({ school_year: r.school_year, grade: r.grade, outside_aid_cents: r.outside_aid_cents,
      timothy_award_cents: r.timothy_award_cents, family_owed_cents: r.family_owed_cents });
  });
  var lhsUnresolved = [];
  lhsRaw.forEach(function(r) {
    var m = tapMatchLhsName(r.rawName, roster);
    if (m.status !== 'ok') {
      lhsUnresolved.push({ rawName: r.rawName, grade: r.grade, school_year: r.school_year, status: m.status,
        candidates: (m.candidates || []).map(function(c) { return c.family + ' ' + c.child; }) });
      return;
    }
    var k = keyOf(m.student.family, m.student.child);
    if (!map[k]) map[k] = { family: m.student.family, child: m.student.child, entries: [] };
    map[k].entries.push({ school_year: r.school_year, grade: r.grade, lhs_award_cents: r.lhs_award_cents });
  });
  var records = Object.keys(map).map(function(k) { return map[k]; });
  records.sort(function(a, b) { return (a.family + a.child).localeCompare(b.family + b.child); });
  // A K-8 entry and an LHS entry landing on the SAME school year for the SAME family+child name
  // means two different real students share an identical name — matching only has the name
  // string to go on, so this can't be told apart automatically. Flag it instead of silently
  // merging two people's histories into one record.
  var collisionWarnings = [];
  records.forEach(function(rec) {
    var yearsSeen = {};
    var collided = false;
    rec.entries.forEach(function(e) {
      var kind = e.lhs_award_cents != null ? 'lhs' : 'k8';
      if (yearsSeen[e.school_year] && yearsSeen[e.school_year] !== kind) collided = true;
      yearsSeen[e.school_year] = kind;
    });
    if (collided) collisionWarnings.push({ family: rec.family, child: rec.child });
  });
  return { records: records, lhsUnresolved: lhsUnresolved, collisionWarnings: collisionWarnings };
}

function tapOpenImportHistory() {
  _tapImportRecords = [];
  _tapImportUnresolved = [];
  document.getElementById('tap-import-file').value = '';
  document.getElementById('tap-import-status').textContent = '';
  document.getElementById('tap-import-preview').innerHTML = '';
  document.getElementById('tap-import-confirm-btn').style.display = 'none';
  openModal('tap-import-modal');
}
function tapImportFileSelected(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var statusEl = document.getElementById('tap-import-status');
  var previewEl = document.getElementById('tap-import-preview');
  statusEl.textContent = 'Reading ' + file.name + '…';
  previewEl.innerHTML = '';
  document.getElementById('tap-import-confirm-btn').style.display = 'none';
  var currentYear = tapYearLabelForIdx(0);
  file.arrayBuffer().then(function(buf) {
    return tapParseWorkbookAllSheets(buf);
  }).then(function(sheets) {
    var simpleSheet = null;
    for (var i = 0; i < sheets.length; i++) { if (sheets[i].name === 'Student Tuition History') { simpleSheet = sheets[i]; break; } }
    if (simpleSheet) {
      var multiLayout = tapDetectMultiYearHistoryLayout(simpleSheet.grid);
      var records, reconcileWarnings = [];
      if (multiLayout) {
        var multiResult = tapExtractMultiYearHistory(simpleSheet.grid, multiLayout, currentYear);
        records = multiResult.records;
        reconcileWarnings = multiResult.reconcileWarnings;
      } else {
        records = tapExtractHistoryRecords(simpleSheet.grid, currentYear);
      }
      _tapImportRecords = records;
      _tapImportUnresolved = [];
      var totalEntries = records.reduce(function(s, r) { return s + r.entries.length; }, 0);
      if (!records.length) { statusEl.textContent = 'No importable records found in this file.'; return; }
      var simpleMsg = 'Found ' + records.length + ' student' + (records.length === 1 ? '' : 's') + ', ' + totalEntries + ' year' + (totalEntries === 1 ? '' : 's') + ' of history.';
      if (reconcileWarnings.length) simpleMsg += ' ' + reconcileWarnings.length + ' entr' + (reconcileWarnings.length === 1 ? 'y' : 'ies') + " don't add up (tuition − outside aid − Timothy award ≠ family owed) — flagged below, still checked (your call whether to trust family owed or the aid split).";
      simpleMsg += ' Review below, then Import.';
      statusEl.textContent = simpleMsg;
      tapRenderImportPreview(records, [], [], reconcileWarnings);
      document.getElementById('tap-import-confirm-btn').style.display = '';
      return;
    }
    var extracted = tapExtractFromRawWorkbook(sheets, currentYear);
    var built = tapBuildImportRecords(extracted.k8Records, extracted.lhsRaw, _tapRoster);
    _tapImportRecords = built.records;
    _tapImportUnresolved = built.lhsUnresolved;
    var totalEntries = built.records.reduce(function(s, r) { return s + r.entries.length; }, 0);
    if (!built.records.length && !built.lhsUnresolved.length) {
      statusEl.textContent = 'No importable records found in this file'
        + (extracted.skippedSheets.length ? ' (skipped: ' + extracted.skippedSheets.join(', ') + ' — different layout).' : '.');
      return;
    }
    var msg = 'Found ' + built.records.length + ' student' + (built.records.length === 1 ? '' : 's') + ', ' + totalEntries + ' year' + (totalEntries === 1 ? '' : 's') + ' of history.';
    if (built.lhsUnresolved.length) msg += ' ' + built.lhsUnresolved.length + ' LHS award row' + (built.lhsUnresolved.length === 1 ? '' : 's') + ' could not be matched — see below.';
    if (built.collisionWarnings.length) msg += ' ' + built.collisionWarnings.length + ' name' + (built.collisionWarnings.length === 1 ? '' : 's') + ' may belong to two different students — flagged below, unchecked by default.';
    if (extracted.skippedSheets.length) msg += ' Skipped (different layout, not imported): ' + extracted.skippedSheets.join(', ') + '.';
    msg += ' Review below, then Import.';
    statusEl.textContent = msg;
    tapRenderImportPreview(built.records, built.lhsUnresolved, built.collisionWarnings, []);
    document.getElementById('tap-import-confirm-btn').style.display = built.records.length ? '' : 'none';
  }).catch(function(err) {
    statusEl.textContent = (err && err.message) || 'Could not read this file.';
  });
}
function tapRenderImportPreview(records, unresolved, collisionWarnings, reconcileWarnings) {
  var anyRich = records.some(function(rec) { return rec.entries.some(function(e) { return e.lhs_award_cents != null || e.outside_aid_cents != null; }); });
  var collisionKeys = {};
  (collisionWarnings || []).forEach(function(w) { collisionKeys[w.family.trim().toLowerCase() + '|' + w.child.trim().toLowerCase()] = true; });
  var mismatchKeys = {};
  (reconcileWarnings || []).forEach(function(w) { mismatchKeys[w.family.trim().toLowerCase() + '|' + w.child.trim().toLowerCase() + '|' + w.school_year] = true; });
  var html = '<div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">'
    + '<table style="width:100%;border-collapse:collapse;font-size:.8rem;"><thead><tr style="border-bottom:2px solid var(--navy);position:sticky;top:0;background:var(--white);">'
    + '<th style="padding:5px 8px;"></th><th style="text-align:left;padding:5px 8px;">Family</th><th style="text-align:left;padding:5px 8px;">Child</th>'
    + '<th style="text-align:left;padding:5px 8px;">Year</th>'
    + (anyRich ? '<th style="text-align:left;padding:5px 8px;">Grade</th><th style="text-align:right;padding:5px 8px;">Outside Aid</th><th style="text-align:right;padding:5px 8px;">Timothy Award</th>' : '')
    + '<th style="text-align:right;padding:5px 8px;">Family Owed</th>'
    + (anyRich ? '<th style="text-align:right;padding:5px 8px;">LHS Award</th>' : '')
    + '</tr></thead><tbody>';
  for (var r = 0; r < records.length; r++) {
    var rec = records[r];
    var isCollision = !!collisionKeys[rec.family.trim().toLowerCase() + '|' + rec.child.trim().toLowerCase()];
    for (var e = 0; e < rec.entries.length; e++) {
      var entry = rec.entries[e];
      var isLhs = entry.lhs_award_cents != null;
      var isMismatch = !isCollision && !!mismatchKeys[rec.family.trim().toLowerCase() + '|' + rec.child.trim().toLowerCase() + '|' + entry.school_year];
      html += '<tr' + (isCollision ? ' style="background:#FBEAEA;"' : (isMismatch ? ' style="background:#FDF3E3;"' : '')) + '><td style="padding:4px 8px;"><input type="checkbox"' + (isCollision ? '' : ' checked') + ' id="tap-import-cb-' + r + '-' + e + '"></td>'
        + '<td style="padding:4px 8px;">' + esc(rec.family) + (isCollision ? ' ⚠' : '') + '</td><td style="padding:4px 8px;">' + esc(rec.child) + '</td>'
        + '<td style="padding:4px 8px;">' + esc(entry.school_year) + (isMismatch ? ' ≈' : '') + '</td>'
        + (anyRich ? '<td style="padding:4px 8px;">' + esc(entry.grade || '') + '</td>'
            + '<td style="padding:4px 8px;text-align:right;">' + (isLhs ? '—' : fmtMoney(entry.outside_aid_cents || 0)) + '</td>'
            + '<td style="padding:4px 8px;text-align:right;">' + (isLhs ? '—' : fmtMoney(entry.timothy_award_cents || 0)) + '</td>' : '')
        + '<td style="padding:4px 8px;text-align:right;">' + (isLhs ? '—' : (entry.family_owed_cents != null ? fmtMoney(entry.family_owed_cents) : '—')) + '</td>'
        + (anyRich ? '<td style="padding:4px 8px;text-align:right;">' + (isLhs ? fmtMoney(entry.lhs_award_cents) : '—') + '</td>' : '')
        + '</tr>';
    }
  }
  html += '</tbody></table></div>'
    + '<p style="font-size:.72rem;color:var(--warm-gray);margin:8px 0 0;">Uncheck any row you don’t want imported — for example a figure your source file itself flags as an estimate or unreconciled. A family/child not already in the roster gets a history-only record (won’t appear in the current planner).</p>';
  if (collisionWarnings && collisionWarnings.length) {
    html += '<div style="margin-top:10px;padding:8px 10px;background:#FBEAEA;border-radius:8px;font-size:.75rem;">'
      + '<strong>⚠ ' + collisionWarnings.length + ' name' + (collisionWarnings.length === 1 ? '' : 's') + ' matched both a K-8 record and an LHS award in the same school year</strong> — that means two different students almost certainly share this exact name. Their rows above are unchecked by default; review carefully (a middle name, DOB, or household would help tell them apart) before checking either one:'
      + '<ul style="margin:6px 0 0;padding-left:18px;">'
      + collisionWarnings.map(function(w) { return '<li>' + esc(w.family) + ' / ' + esc(w.child) + '</li>'; }).join('')
      + '</ul></div>';
  }
  if (reconcileWarnings && reconcileWarnings.length) {
    html += '<div style="margin-top:10px;padding:8px 10px;background:#FDF3E3;border-radius:8px;font-size:.75rem;">'
      + '<strong>≈ ' + reconcileWarnings.length + ' entr' + (reconcileWarnings.length === 1 ? 'y' : 'ies') + " don't add up</strong> — tuition minus outside aid minus Timothy award doesn't equal family owed for these, so one of the figures is likely off in the source file. Still checked for import (family owed is probably the more reliable number), but worth a look:"
      + '<ul style="margin:6px 0 0;padding-left:18px;">'
      + reconcileWarnings.map(function(w) {
          return '<li>' + esc(w.family) + ' / ' + esc(w.child) + ' (' + esc(w.school_year) + '): tuition ' + fmtMoney(Math.round(w.tuition * 100))
            + ' − outside ' + fmtMoney(Math.round(w.outside * 100)) + ' − Timothy ' + fmtMoney(Math.round(w.timothy * 100))
            + ' = ' + fmtMoney(Math.round(w.computed * 100)) + ', but family owed shows ' + fmtMoney(Math.round(w.familyOwed * 100)) + '</li>';
        }).join('')
      + '</ul></div>';
  }
  if (unresolved && unresolved.length) {
    html += '<div style="margin-top:10px;padding:8px 10px;background:var(--linen);border-radius:8px;font-size:.75rem;">'
      + '<strong>' + unresolved.length + ' LHS award row' + (unresolved.length === 1 ? '' : 's') + ' not imported — could not match to a student:</strong>'
      + '<ul style="margin:6px 0 0;padding-left:18px;">'
      + unresolved.map(function(u) {
          var reason = u.status === 'ambiguous' ? ('matches multiple students on the roster: ' + u.candidates.map(esc).join(', ')) : 'no matching student found on the current roster';
          return '<li>' + esc(u.rawName) + ' (grade ' + esc(u.grade) + ', ' + esc(u.school_year) + ') — ' + reason + '</li>';
        }).join('')
      + '</ul></div>';
  }
  document.getElementById('tap-import-preview').innerHTML = html;
}
function tapConfirmImportHistory() {
  var statusEl = document.getElementById('tap-import-status');
  var payload = [];
  for (var r = 0; r < _tapImportRecords.length; r++) {
    var rec = _tapImportRecords[r];
    var entries = [];
    for (var e = 0; e < rec.entries.length; e++) {
      var cb = document.getElementById('tap-import-cb-' + r + '-' + e);
      if (cb && cb.checked) entries.push(rec.entries[e]);
    }
    if (entries.length) payload.push({ family: rec.family, child: rec.child, entries: entries });
  }
  if (!payload.length) { statusEl.textContent = 'Nothing selected to import.'; return; }
  statusEl.textContent = 'Importing…';
  api('/admin/api/tuition-aid/import-history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: payload })
  }).then(function(d) {
    if (d && d.error) { statusEl.textContent = d.error; return; }
    statusEl.textContent = 'Imported: ' + (d.created || 0) + ' new, ' + (d.updated || 0) + ' updated, ' + (d.unchanged || 0) + ' unchanged'
      + (d.newStudents ? ', ' + d.newStudents + ' new history-only record' + (d.newStudents === 1 ? '' : 's') + ' created' : '') + '.';
    return tapReloadKeepingYear();
  }).catch(function(err) {
    statusEl.textContent = (err && err.message) || 'Import failed.';
  });
}
`;
