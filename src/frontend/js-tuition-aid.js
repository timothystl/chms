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
var _tapLinkTargetId = null;
var _tapHistoryTargetId = null;

function loadTuitionAid() {
  var loadingEl = document.getElementById('tap-loading');
  var rootEl = document.getElementById('tap-root');
  loadingEl.style.display = '';
  loadingEl.textContent = 'Loading…';
  rootEl.style.display = 'none';
  api('/admin/api/tuition-aid/students').then(function(d) {
    _tapConfig = d.config || {};
    _tapHistory = d.history || [];
    _tapRoster = (d.students || []).map(tapFromServerRow);
    _tapYearRates = {};
    (d.yearRates || []).forEach(function(r) { _tapYearRates[r.school_year] = r.tuition_cents; });
    _tapStudentYears = d.studentYears || [];
    tapIndexPins();
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
  clearTimeout(_tapSaveTimers[timerKey]);
  _tapSaveTimers[timerKey] = setTimeout(function() {
    var label = tapYearLabelForIdx(yearIdx);
    api('/admin/api/tuition-aid/students/' + studentId + '/years/' + encodeURIComponent(label), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields)
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
  tapRenderPlannerTables();
}

function tapKpiHtml(lbl, val, note, accent) {
  return '<div class="tap-kpi' + (accent ? ' accent' : '') + '"><div class="tap-lbl">' + esc(lbl) + '</div>'
    + '<div class="tap-val">' + esc(String(val)) + '</div><div class="tap-note">' + esc(note) + '</div></div>';
}
function tapRenderKpis() {
  var active0 = tapActiveForYear(0);
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
  var active0 = tapActiveForYear(0);
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
  var active0 = tapActiveForYear(0).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
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
  var active0 = tapActiveForYear(0).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
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
function tapRenderPlannerTables() {
  var k8Rows = [], lhsRows = [];
  var tuition = tapTuitionForYear(_tapYearIdx);
  var maxAward = tapCfgNum('lhs_max_award_cents', 250000) / 100;

  _tapRoster.forEach(function(s) {
    var grade = tapGradeAt(s, _tapYearIdx);
    var bucket = tapBucketFor(s, grade);
    var prevGrade = _tapYearIdx > 0 ? tapGradeAt(s, _tapYearIdx - 1) : null;
    var justGraduated = (bucket === 'LHS' && prevGrade === '8');
    var isPK = function(g) { return g === 'PK 3' || g === 'PK 4'; };
    var wasVisibleBefore = prevGrade && !isPK(prevGrade) && prevGrade !== 'Graduated';
    var justJoined = s.isPipeline && grade !== null && !isPK(grade) && !wasVisibleBefore;

    if (bucket === 'Graduated' || bucket === 'Departed' || bucket === 'NotYet') return;

    if (bucket === 'K8') {
      if (grade === 'PK 3' || grade === 'PK 4') return;
      var sp = tapSplitFor(s, _tapYearIdx);
      var famPctVal = tapFamPctFor(s, _tapYearIdx);
      var outsideAidVal = tapOutsideAidFor(s, _tapYearIdx);
      var lhsToggle = grade === '8'
        ? '<label class="tap-lhs-toggle"><input type="checkbox" onchange="tapSetAttendsLHS(' + s.id + ',this.checked)" ' + (s.attendsLHS ? 'checked' : '') + '> Plans to attend LHS</label>' : '';
      var newFlag = justJoined ? ' <span class="status-pill status-confirmed">new</span>' : '';
      var linkBtn = s.personId ? '' : '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenLinkPerson(' + s.id + ')">Link</button> ';
      var histBtn = '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenHistory(' + s.id + ')">History</button> ';
      k8Rows.push('<tr>'
        + '<td style="padding:6px 8px;">' + esc(s.family) + '</td>'
        + '<td style="padding:6px 8px;">' + esc(s.child) + newFlag + '</td>'
        + '<td style="padding:6px 8px;">' + esc(grade) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(tuition * 100)) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;"><input type="number" min="0" step="1" value="' + Math.round(outsideAidVal) + '" style="width:80px;text-align:right;" onchange="tapOutsideAidChange(this,' + s.id + ')"></td>'
        + '<td style="padding:6px 8px;">'
          + '<div class="tap-slider-row">'
            + '<input type="range" min="0" max="100" step="1" value="' + famPctVal + '" oninput="tapSliderChange(this,' + s.id + ')">'
            + '<input type="number" min="0" max="100" step="1" value="' + famPctVal + '" oninput="tapSliderChange(this,' + s.id + ')">%'
          + '</div>'
          + '<div class="tap-slider-caption">Family share of $' + Math.round(tuition).toLocaleString() + ' bill</div>'
        + '</td>'
        + '<td class="tap-award-cell" id="tap-k8award-' + s.id + '">' + fmtMoney(Math.round(sp.timothyAward * 100)) + '</td>'
        + '<td style="padding:6px 8px;text-align:right;"><span id="tap-k8family-' + s.id + '">' + fmtMoney(Math.round(sp.familyOwed * 100)) + '</span>' + lhsToggle + '</td>'
        + '<td style="padding:6px 8px;white-space:nowrap;">' + histBtn + linkBtn + '<button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapRemoveStudent(' + s.id + ')">Remove</button></td>'
      + '</tr>');
    } else if (bucket === 'LHS') {
      var flag = justGraduated ? ' <span class="status-pill status-confirmed">new to LHS</span>' : '';
      var lhsVal = Math.min(tapLhsAwardFor(s, _tapYearIdx), maxAward);
      if (_tapYearIdx === 0 && s.lhsAward > maxAward) s.lhsAward = maxAward;
      lhsRows.push('<tr>'
        + '<td style="padding:6px 8px;">' + esc(s.family) + '</td>'
        + '<td style="padding:6px 8px;">' + esc(s.child) + '</td>'
        + '<td style="padding:6px 8px;">' + esc(grade) + flag + '</td>'
        + '<td style="padding:6px 8px;">'
          + '<div class="tap-slider-row">'
            + '<input type="range" min="0" max="' + maxAward + '" step="25" value="' + lhsVal + '" oninput="tapLhsSliderChange(this,' + s.id + ')">'
            + '<input type="number" min="0" max="' + maxAward + '" step="25" value="' + lhsVal + '" oninput="tapLhsSliderChange(this,' + s.id + ')">'
          + '</div>'
        + '</td>'
        + '<td class="tap-award-cell" id="tap-lhsaward-' + s.id + '">' + fmtMoney(Math.round(lhsVal * 100)) + '</td>'
        + '<td style="padding:6px 8px;white-space:nowrap;"><button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapOpenHistory(' + s.id + ')">History</button> <button class="btn-secondary" style="font-size:.68rem;padding:2px 8px;" onclick="tapRemoveStudent(' + s.id + ')">Remove</button></td>'
      + '</tr>');
    }
  });
  document.getElementById('tap-k8-body').innerHTML = k8Rows.join('') || '<tr><td colspan="9" style="padding:10px;color:var(--warm-gray);">No K-8 students this year.</td></tr>';
  document.getElementById('tap-lhs-body').innerHTML = lhsRows.join('') || '<tr><td colspan="6" style="padding:10px;color:var(--warm-gray);">No LHS students this year.</td></tr>';
  tapUpdateGauges();
}

function tapOutsideAidChange(el, id) {
  var s = tapById(id);
  if (!s) return;
  var dollars = Math.max(0, Math.round(+el.value || 0));
  var cents = dollars * 100;
  if (_tapYearIdx === 0) {
    s.outsideAid = dollars;
    tapDebouncedSave(id, { outside_aid_cents: cents });
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { outside_aid_cents: cents });
    tapSavePinDebounced(id, _tapYearIdx, { outside_aid_cents: cents });
  }
  var sp = tapSplitFor(s, _tapYearIdx);
  var awardEl = document.getElementById('tap-k8award-' + id);
  var famEl = document.getElementById('tap-k8family-' + id);
  if (awardEl) awardEl.textContent = fmtMoney(Math.round(sp.timothyAward * 100));
  if (famEl) famEl.textContent = fmtMoney(Math.round(sp.familyOwed * 100));
  tapUpdateGauges();
}
function tapSliderChange(el, id) {
  var s = tapById(id);
  if (!s) return;
  var v = Math.min(100, Math.max(0, Math.round(+el.value || 0)));
  var row = el.closest('tr');
  var ranges = row.querySelectorAll('input[type=range]'), nums = row.querySelectorAll('input[type=number]');
  if (ranges[0]) ranges[0].value = v;
  if (nums[0]) nums[0].value = v;
  if (_tapYearIdx === 0) {
    s.famPct = v; s.touched = true;
    tapDebouncedSave(id, { fam_pct: v, touched: 1 });
  } else {
    tapUpsertPinLocal(id, _tapYearIdx, { fam_pct: v, timothy_award_cents: null, family_owed_cents: null });
    tapSavePinDebounced(id, _tapYearIdx, { fam_pct: v, timothy_award_cents: null, family_owed_cents: null });
  }
  var sp = tapSplitFor(s, _tapYearIdx);
  var awardEl = document.getElementById('tap-k8award-' + id);
  var famEl = document.getElementById('tap-k8family-' + id);
  if (awardEl) awardEl.textContent = fmtMoney(Math.round(sp.timothyAward * 100));
  if (famEl) famEl.textContent = fmtMoney(Math.round(sp.familyOwed * 100));
  tapUpdateGauges();
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
  clearTimeout(_tapSaveTimers[id]);
  _tapSaveTimers[id] = setTimeout(function() {
    api('/admin/api/tuition-aid/students/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) }).catch(function() {});
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
    famPctUpdates.forEach(function(u) { var s = tapById(u.id); if (s) { s.famPct = u.famPct; s.touched = true; } });
    tapBulkSave(famPctUpdates.map(function(u) { return { id: u.id, fam_pct: u.famPct, touched: 1 }; }));
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

function tapUpdateGauges() {
  var active = tapActiveForYear(_tapYearIdx).filter(function(x) { return !(x.bucket === 'K8' && (x.grade === 'PK 3' || x.grade === 'PK 4')); });
  var k8Active = active.filter(function(x) { return x.bucket === 'K8'; });
  var lhsActive = active.filter(function(x) { return x.bucket === 'LHS'; });
  var k8Total = k8Active.reduce(function(sum, x) { return sum + tapSplitFor(x.s, _tapYearIdx).timothyAward; }, 0);
  var lhsTotal = lhsActive.reduce(function(sum, x) { return sum + tapLhsAwardFor(x.s, _tapYearIdx); }, 0);
  var lhsRate = tapCfgNum('lhs_standard_rate_cents', 120000) / 100;
  var lhsReference = lhsActive.length * lhsRate;
  var k8Budget = tapCfgNum('k8_budget_cents', 7500000) / 100;

  var k8Fill = document.getElementById('tap-k8-gauge-fill');
  var k8Text = document.getElementById('tap-k8-gauge-text');
  var k8Over = k8Total > k8Budget;
  k8Fill.style.width = Math.min(100, k8Budget ? (k8Total / k8Budget) * 100 : 0) + '%';
  k8Fill.classList.toggle('over', k8Over);
  document.querySelectorAll('#tap-k8-body input[type=range]').forEach(function(sl) { sl.classList.toggle('over', k8Over); });
  k8Text.textContent = fmtMoney(Math.round(k8Total * 100)) + (k8Over ? '  (over by ' + fmtMoney(Math.round((k8Total - k8Budget) * 100)) + ')' : ' of ' + fmtMoney(Math.round(k8Budget * 100)));
  k8Text.classList.toggle('tap-over-text', k8Over);
  document.getElementById('tap-k8-gauge-cap').textContent = 'Budget: ' + fmtMoney(Math.round(k8Budget * 100));

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
      updates.push({ id: s.id, fam_pct: s.famPctOrig, lhs_award_cents: Math.round(s.lhsAwardOrig * 100), attends_lhs: 1, touched: 0 });
    });
    tapBulkSave(updates);
  } else {
    tapClearPinsForYear(_tapYearIdx, _tapRoster.map(function(s) { return s.id; }));
  }
  tapRenderPlannerTables();
}
function tapApplyPolicy() {
  var active = tapActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  if (!active.length) return;
  var tuition = tapTuitionForYear(_tapYearIdx);
  var capPct = tapCfgNum('family_share_cap_pct', 50);
  var k8Budget = tapCfgNum('k8_budget_cents', 7500000) / 100;
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
  var active = tapActiveForYear(_tapYearIdx).filter(function(x) { return x.bucket === 'K8' && x.grade !== 'PK 3' && x.grade !== 'PK 4'; });
  var tuition = tapTuitionForYear(_tapYearIdx);
  var k8Budget = tapCfgNum('k8_budget_cents', 7500000) / 100;
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
  if (!rows.length) {
    body.innerHTML = '<div style="font-size:.82rem;color:var(--warm-gray);padding:10px 0;">No per-family records saved for ' + esc(label) + ' yet. Records accumulate automatically as each year is edited going forward — this view will fill in over time.</div>';
    return;
  }
  var html = '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.82rem;"><thead><tr style="border-bottom:2px solid var(--navy);">'
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
    var sp = tapSplitFor(s, 0);
    var label = tapYearLabelForIdx(0);
    liveRow = '<tr style="background:var(--pale-gold);"><td style="padding:6px 8px;">' + esc(label) + ' (current)</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(s.outsideAid * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.timothyAward * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + fmtMoney(Math.round(sp.familyOwed * 100)) + '</td>'
      + '<td style="padding:6px 8px;text-align:right;">' + (s.attendsLHS === false ? '—' : fmtMoney(Math.round(s.lhsAward * 100))) + '</td>'
      + '<td></td></tr>';
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
    return '<div class="tap-pipeline-chip">' + esc(p.family) + ' ' + esc(p.child)
      + ' <span style="color:var(--warm-gray);font-size:.72rem;">(b. ' + p.birthYear + ' — K expected ' + kSchoolYear + ')</span>'
      + ' <button class="tap-pipeline-remove" onclick="tapRemoveStudent(' + p.id + ')" title="Remove">&times;</button></div>';
  }).join('');
}
function tapAddPipeline() {
  var errEl = document.getElementById('tap-pipeline-error');
  var family = document.getElementById('tap-pipe-family').value.trim();
  var child = document.getElementById('tap-pipe-child').value.trim();
  var birthYear = +document.getElementById('tap-pipe-birthyear').value;
  var baseYear = tapCfgNum('base_school_year', 2026);
  if (!family || !child) { errEl.textContent = "Enter both a family name and a child's name."; return; }
  if (!birthYear || birthYear < baseYear - 6 || birthYear > baseYear + 1) { errEl.textContent = 'Enter a birth year between ' + (baseYear - 6) + ' and ' + (baseYear + 1) + '.'; return; }
  errEl.textContent = '';
  api('/admin/api/tuition-aid/students', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    family: family, child: child, is_pipeline: true, birth_year: birthYear,
    fam_pct: tapCfgNum('default_pipeline_fam_pct', 50), lhs_award_cents: tapCfgNum('lhs_standard_rate_cents', 120000)
  }) }).then(function(d) {
    if (d && d.error) { errEl.textContent = d.error; return; }
    document.getElementById('tap-pipe-family').value = '';
    document.getElementById('tap-pipe-child').value = '';
    document.getElementById('tap-pipe-birthyear').value = '';
    loadTuitionAid();
  }).catch(function(err) { errEl.textContent = err && err.message || 'Could not add.'; });
}
function tapRemoveStudent(id) {
  if (!confirm('Remove this student from the planner?')) return;
  api('/admin/api/tuition-aid/students/' + id, { method: 'DELETE' }).then(function() { loadTuitionAid(); });
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
  openModal('tap-link-modal');
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
`;
