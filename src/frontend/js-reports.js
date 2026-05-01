export const JS_REPORTS = String.raw`// ── REPORTS ────────────────────────────────────────────────────────────
function initReports() {
  initReportTrendYears();
}
function showRptOutput(html) {
  var o = document.getElementById('rpt-output');
  o.innerHTML = html;
  o.classList.add('visible');
  o.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function showAttRptOutput(html) {
  var o = document.getElementById('att-rpt-output');
  if (!o) return;
  o.innerHTML = html;
  o.style.display = 'block';
  o.scrollIntoView({behavior:'smooth', block:'nearest'});
}
function runMembership() {
  api('/admin/api/reports/membership').then(function(d) {
    var rows = (d.counts||[]).map(function(r) {
      return '<tr><td>' + esc(r.member_type||'—') + '</td><td style="text-align:right;">' + r.n + '</td></tr>';
    }).join('');
    var tagRows = (d.tag_counts||[]).map(function(r) {
      return '<tr><td>' + esc(r.name) + '</td><td style="text-align:right;">' + r.n + '</td></tr>';
    }).join('');
    // R1: Age-group breakdown
    var ageGroups = d.age_groups || [];
    var ageTotal = ageGroups.reduce(function(s, b){ return s + (b.n || 0); }, 0);
    var ageRows = ageGroups.map(function(b) {
      var pct = ageTotal > 0 ? Math.round(b.n * 1000 / ageTotal) / 10 : 0;
      return '<tr><td>' + esc(b.label) + '</td><td style="text-align:right;">' + b.n + '</td>'
        + '<td style="text-align:right;color:var(--warm-gray);">' + pct.toFixed(1) + '%</td></tr>';
    }).join('');
    var ageBlock = ageGroups.length ? '<h4 style="margin:20px 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.95rem;">By Age Group</h4>'
      + '<table class="rpt-table"><thead><tr><th>Age Group</th><th style="text-align:right;">Count</th><th style="text-align:right;">Share</th></tr></thead><tbody>'
      + ageRows
      + '<tr class="rpt-total"><td>Total</td><td style="text-align:right;">' + ageTotal + '</td><td></td></tr>'
      + '</tbody></table>' : '';
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Membership Summary</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + '<table class="rpt-table"><thead><tr><th>Member Type</th><th style="text-align:right;">Count</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td style="text-align:right;">' + (d.total||0) + '</td></tr>'
      + '</tbody></table>'
      + ageBlock
      + (tagRows ? '<h4 style="margin:20px 0 8px;font-family:var(--font-head);color:var(--steel-anchor);font-size:.95rem;">By Tag</h4>'
        + '<table class="rpt-table"><thead><tr><th>Tag</th><th style="text-align:right;">People</th></tr></thead><tbody>' + tagRows + '</tbody></table>' : '')
    );
  });
}
// ── R3: People Insights ───────────────────────────────────────────────
var _peopleInsightsScope = 'member';
function runPeopleInsights(scope) {
  if (scope) _peopleInsightsScope = scope;
  api('/admin/api/reports/people-insights?scope=' + encodeURIComponent(_peopleInsightsScope)).then(function(d) {
    if (d.error) { alert(d.error); return; }

    // ── Block 1: New contacts by month (bar chart) ──────────────────
    var contacts = d.new_contacts || [];
    var contactBlock = '';
    if (contacts.length) {
      var maxC = Math.max.apply(null, contacts.map(function(r){return r.n||0;})) || 1;
      var n = contacts.length, W = Math.max(400, n*34), H = 110, pL = 28, pR = 8, pT = 18, pB = 26;
      var cW = W - pL - pR, cH = H - pT - pB, slotW = cW/n, barW = Math.max(6, Math.min(24, slotW*0.7));
      var baseY = pT + cH;
      var bars2 = '', xlbls2 = '', ylbls2 = '', grid2 = '';
      [0, Math.round(maxC/2), maxC].forEach(function(v) {
        var yy = pT + cH - (v/maxC)*cH;
        grid2 += '<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
        ylbls2 += '<text x="'+(pL-3)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="8">'+Math.round(v)+'</text>';
      });
      var labelEvery = Math.max(1, Math.ceil(n/12));
      contacts.forEach(function(r, i) {
        var bxv = pL + (i+0.5)*slotW, bv = r.n||0, byv = pT + cH - (bv/maxC)*cH, bhv = baseY - byv;
        bars2 += '<rect x="'+(bxv-barW/2).toFixed(1)+'" y="'+byv.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bhv.toFixed(1)+'" fill="#2E7EA6" rx="2" opacity="0.8"><title>'+esc(r.month)+': '+bv+'</title></rect>';
        if (bv > 0) bars2 += '<text x="'+bxv.toFixed(1)+'" y="'+(byv-2).toFixed(1)+'" text-anchor="middle" fill="#2E7EA6" font-size="7">'+bv+'</text>';
        if (i % labelEvery === 0) {
          var parts = r.month.split('-');
          xlbls2 += '<text x="'+bxv.toFixed(1)+'" y="'+(H-4)+'" text-anchor="middle" fill="#9A8A78" font-size="7">'+MONTH_NAMES[parseInt(parts[1])-1]+' \''+parts[0].slice(2)+'</text>';
        }
      });
      var totalContacts = contacts.reduce(function(s,r){return s+(r.n||0);},0);
      contactBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
        + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:4px;">&#128200; New Contacts — last 24 months (' + totalContacts + ' total)</div>'
        + '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:8px;">Based on first contact date, or record created date if not set.</div>'
        + '<div style="overflow-x:auto;"><svg viewBox="0 0 '+W+' '+H+'" style="min-width:'+W+'px;width:100%;height:'+H+'px;">'+grid2+bars2+xlbls2+ylbls2+'</svg></div></div>';
    }

    // ── Block 2: Member-type trend by year ──────────────────────────
    var trendRaw = d.member_type_trend || [];
    var trendBlock = '';
    if (trendRaw.length) {
      var years2 = [], typeSet = [];
      var trendMap = {};
      trendRaw.forEach(function(r) {
        if (years2.indexOf(r.year) < 0) years2.push(r.year);
        var tl = (r.member_type||'Unknown');
        if (typeSet.indexOf(tl) < 0) typeSet.push(tl);
        trendMap[(r.year||'') + '|' + tl] = r.n || 0;
      });
      var trendHead = '<tr><th>Year</th>' + typeSet.map(function(t){return '<th style="text-align:right;">'+esc(t)+'</th>';}).join('') + '<th style="text-align:right;">Total</th></tr>';
      var trendRows2 = years2.map(function(yr) {
        var total2 = 0;
        var cells = typeSet.map(function(t) {
          var v = trendMap[yr + '|' + t] || 0; total2 += v;
          return '<td style="text-align:right;">' + v + '</td>';
        }).join('');
        return '<tr><td>' + esc(yr) + '</td>' + cells + '<td style="text-align:right;font-weight:600;">' + total2 + '</td></tr>';
      }).join('');
      trendBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
        + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:4px;">&#128101; New People by Year &amp; Type</div>'
        + '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:8px;">Current active people grouped by their first contact year and current member type.</div>'
        + '<div style="overflow-x:auto;"><table class="rpt-table"><thead>' + trendHead + '</thead><tbody>' + trendRows2 + '</tbody></table></div></div>';
    }

    // ── Block 3: Age distribution (horizontal bars) ─────────────────
    var ageGroups2 = d.age_groups || [];
    var ageTotal2 = ageGroups2.reduce(function(s,b){return s+(b.n||0);},0);
    var ageRows2 = ageGroups2.map(function(b) {
      var pct = ageTotal2 > 0 ? Math.round(b.n * 100 / ageTotal2) : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
        + '<div style="flex:0 0 120px;font-size:.85rem;color:var(--charcoal);">'+esc(b.label)+'</div>'
        + '<div style="flex:1;background:var(--linen);border-radius:4px;height:15px;overflow:hidden;">'
        + '<div style="background:#C9973A;height:100%;width:'+pct+'%;"></div></div>'
        + '<div style="flex:0 0 90px;text-align:right;font-size:.82rem;color:var(--warm-gray);">'+b.n+' ('+pct+'%)</div></div>';
    }).join('');
    var ageBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#127891; Age Distribution — '+scopeLabel+' ('+ageTotal2+')</div>'
      + ageRows2 + '</div>';

    // ── Block 4: Gender pie chart ───────────────────────────────────
    var genderColors = { Male:'#2E7EA6', Female:'#C9973A', Unknown:'#b0a090' };
    var genderItems = (d.gender||[]).map(function(r){
      return { label: esc(r.g), value: r.n, color: genderColors[r.g] || '#888' };
    });
    var genderTotal = genderItems.reduce(function(s,it){return s+(it.value||0);},0);
    var genderBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#9874;&#65039; Gender Breakdown — '+scopeLabel+' ('+genderTotal+')</div>'
      + '<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">'
      + renderPieChart(genderItems, 180)
      + '</div></div>';

    // ── Block 5: Household composition ─────────────────────────────
    var hh = d.household_sizes || {};
    var hhItems = [
      { label: 'Single (1 person)',     value: hh.single || 0,       color: '#2E7EA6' },
      { label: 'Couple (2 people)',     value: hh.couple || 0,       color: '#5A9E6F' },
      { label: 'Small family (3–4)',    value: hh.small  || 0,       color: '#C9973A' },
      { label: 'Large family (5+)',     value: hh.large  || 0,       color: '#9B59B6' },
      { label: 'No household assigned', value: hh.no_household || 0, color: '#b0a090' },
    ];
    var hhTotal2 = hhItems.reduce(function(s,it){return s+(it.value||0);},0);
    var hhRows2 = hhItems.map(function(it) {
      var pct = hhTotal2 > 0 ? Math.round(it.value * 100 / hhTotal2) : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
        + '<div style="flex:0 0 170px;font-size:.85rem;color:var(--charcoal);">'+esc(it.label)+'</div>'
        + '<div style="flex:1;background:var(--linen);border-radius:4px;height:15px;overflow:hidden;">'
        + '<div style="background:'+it.color+';height:100%;width:'+pct+'%;opacity:.8;"></div></div>'
        + '<div style="flex:0 0 90px;text-align:right;font-size:.82rem;color:var(--warm-gray);">'+it.value+' ('+pct+'%)</div></div>';
    }).join('');
    var hhBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#127968; Household Composition — '+scopeLabel+' ('+hhTotal2+')</div>'
      + hhRows2 + '</div>';

    // ── Block 6: Sacramental pipeline (members only) ────────────────
    var pl = d.sacramental_pipeline || {};
    var plTotal = (pl.both||0) + (pl.baptized_only||0) + (pl.confirmed_only||0) + (pl.neither||0);
    var plItems = [
      { label: 'Baptized &amp; Confirmed', value: pl.both||0,            color:'#5A9E6F' },
      { label: 'Baptized only',            value: pl.baptized_only||0,   color:'#2E7EA6' },
      { label: 'Confirmed only',           value: pl.confirmed_only||0,  color:'#C9973A' },
      { label: 'Neither recorded',         value: pl.neither||0,         color:'#b0a090' },
    ];
    var plRows = plItems.map(function(it) {
      var pct = plTotal > 0 ? Math.round(it.value * 100 / plTotal) : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
        + '<div style="flex:0 0 180px;font-size:.85rem;color:var(--charcoal);">'+it.label+'</div>'
        + '<div style="flex:1;background:var(--linen);border-radius:4px;height:15px;overflow:hidden;">'
        + '<div style="background:'+it.color+';height:100%;width:'+pct+'%;opacity:.85;"></div></div>'
        + '<div style="flex:0 0 90px;text-align:right;font-size:.82rem;color:var(--warm-gray);">'+it.value+' ('+pct+'%)</div></div>';
    }).join('');
    var pipelineBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:4px;">&#9989; Sacramental Pipeline ('+plTotal+' members)</div>'
      + '<div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:8px;">Members only — baptized and confirmed flags from Breeze profile.</div>'
      + plRows + '</div>';

    var scopeLabel = d.scope === 'member' ? 'Members' : 'All Active';
    var scopeBar = '<div style="display:flex;gap:6px;margin-bottom:14px;">'
      + ['member','active'].map(function(s) {
          var lbl = s === 'member' ? 'Members Only' : 'All Active';
          var active = d.scope === s;
          return '<button class="btn-secondary" style="font-size:.8rem;padding:4px 12px;'+(active?'background:var(--teal);color:#fff;border-color:var(--teal);':'')+'" onclick="runPeopleInsights(\''+s+'\')">'+lbl+'</button>';
        }).join('')
      + '</div>';
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">People Insights</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + scopeBar
      + contactBlock + trendBlock + ageBlock + genderBlock + hhBlock + pipelineBlock
    );
  });
}

// ── Reusable pie chart (SVG) ──────────────────────────────────────────
// items: [{label, value, color}]; diameter in px.
function renderPieChart(items, diameter) {
  var total = items.reduce(function(s, it){ return s + (it.value||0); }, 0);
  if (!total) return '<div style="color:var(--warm-gray);font-size:.85rem;">No data.</div>';
  var D = diameter || 220, R = D/2, cx = R, cy = R;
  var angle = -Math.PI / 2;
  var slices = '';
  items.forEach(function(it) {
    var frac = (it.value || 0) / total;
    if (!frac) return;
    var end = angle + frac * 2 * Math.PI;
    var x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    var x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
    var largeArc = frac > 0.5 ? 1 : 0;
    if (frac >= 0.9999) {
      slices += '<circle cx="'+cx+'" cy="'+cy+'" r="'+R+'" fill="'+it.color+'"><title>'+esc(it.label)+': 100%</title></circle>';
    } else {
      slices += '<path d="M '+cx+','+cy+' L '+x1.toFixed(2)+','+y1.toFixed(2)
        +' A '+R+','+R+' 0 '+largeArc+' 1 '+x2.toFixed(2)+','+y2.toFixed(2)+' Z" fill="'+it.color+'"'
        +'><title>'+esc(it.label)+': '+(frac*100).toFixed(1)+'%</title></path>';
    }
    angle = end;
  });
  var svg = '<svg viewBox="0 0 '+D+' '+D+'" style="width:'+D+'px;height:'+D+'px;max-width:100%;">'+slices+'</svg>';
  var legend = '<div style="display:flex;flex-direction:column;gap:6px;font-size:.85rem;">';
  items.forEach(function(it) {
    if (!it.value) return;
    var pct = (it.value / total * 100).toFixed(1);
    legend += '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="display:inline-block;width:12px;height:12px;background:'+it.color+';border-radius:2px;flex-shrink:0;"></span>'
      + '<span style="flex:1;">'+esc(it.label)+'</span>'
      + '<span style="color:var(--warm-gray);font-variant-numeric:tabular-nums;">'+pct+'%</span></div>';
  });
  legend += '</div>';
  return '<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">'
    + '<div>'+svg+'</div><div style="flex:1;min-width:180px;">'+legend+'</div></div>';
}

function runGivingByMethod() {
  var from = document.getElementById('rpt-method-from').value;
  var to   = document.getElementById('rpt-method-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-by-method?from=' + from + '&to=' + to).then(function(d) {
    var labels  = { cash:'Cash', check:'Check', card:'Card / Online', ach:'ACH / Bank', other:'Other' };
    var palette = { cash:'#5A9E6F', check:'#2E7EA6', card:'#C9973A', ach:'#9B59B6', other:'#8A7968' };
    var rows = (d.rows||[]).map(function(r) {
      return '<tr><td>' + esc(labels[r.method] || r.method || 'Unknown') + '</td><td style="text-align:right;">' + (r.contributions||0) + '</td><td style="text-align:right;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
    }).join('');
    var pieItems = (d.rows||[]).map(function(r) {
      return { label: labels[r.method] || r.method || 'Unknown', value: r.total_cents||0, color: palette[r.method] || '#8A7968' };
    });
    var pieBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.9rem;margin-bottom:10px;">Share by Method</div>'
      + renderPieChart(pieItems, 200)
      + '</div>';
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving by Method: ' + esc(fmtDate(from)) + ' \u2013 ' + esc(fmtDate(to)) + '</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + pieBlock
      + '<table class="rpt-table"><thead><tr><th>Method</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td></td><td style="text-align:right;">' + fmtMoney(d.grand_total_cents||0) + '</td></tr>'
      + '</tbody></table>'
    );
  });
}
function runGivingSummary() {
  var from = document.getElementById('rpt-from').value;
  var to = document.getElementById('rpt-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-summary?from=' + from + '&to=' + to).then(function(d) {
    // Group funds by numeric prefix (e.g. "40085" from "40085 General Fund")
    var groups = {}, order = [];
    (d.rows||[]).forEach(function(r) {
      var m = (r.fund_name||'').match(/^(\d+)\s/);
      var key = m ? m[1] : '';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    var rows = '';
    order.forEach(function(key) {
      var grp = groups[key];
      var multipleInGroup = key && grp.length > 1;
      if (multipleInGroup) {
        var grpCents = grp.reduce(function(s,r){ return s+(r.total_cents||0); }, 0);
        var grpGifts = grp.reduce(function(s,r){ return s+(r.contributions||0); }, 0);
        rows += '<tr class="rpt-group-hdr"><td colspan="3">' + esc(key) + '</td></tr>';
        grp.forEach(function(r) {
          rows += '<tr><td style="padding-left:22px;">' + esc(r.fund_name) + '</td><td style="text-align:right;">' + (r.contributions||0) + '</td><td style="text-align:right;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
        });
        rows += '<tr class="rpt-group-sub"><td style="padding-left:22px;">Subtotal</td><td style="text-align:right;">' + grpGifts + '</td><td style="text-align:right;">' + fmtMoney(grpCents) + '</td></tr>';
      } else {
        grp.forEach(function(r) {
          rows += '<tr><td>' + esc(r.fund_name) + '</td><td style="text-align:right;">' + (r.contributions||0) + '</td><td style="text-align:right;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
        });
      }
    });
    var givers = d.total_givers || 0;
    var txns   = d.total_transactions || 0;
    var grand  = d.grand_total_cents || 0;
    var avgGift = txns > 0 ? Math.round(grand / txns) : 0;
    var methodLabels = { cash:'Cash', check:'Check', card:'Card / Online', ach:'ACH / Bank', other:'Other' };
    var methodRows = (d.by_method||[]).map(function(m) {
      var pct = grand > 0 ? Math.round((m.total_cents||0) * 1000 / grand) / 10 : 0;
      return '<tr><td>' + esc(methodLabels[m.method] || m.method || 'Unknown') + '</td>'
        + '<td style="text-align:right;">' + (m.contributions||0) + '</td>'
        + '<td style="text-align:right;">' + fmtMoney(m.total_cents||0) + '</td>'
        + '<td style="text-align:right;color:var(--warm-gray);">' + pct.toFixed(1) + '%</td></tr>';
    }).join('');
    var avgPerGiver = givers > 0 ? Math.round(grand / givers) : 0;
    var overview = '<div class="rpt-overview">'
      + '<div class="rpt-stat"><div class="rpt-stat-num">' + givers.toLocaleString() + '</div><div class="rpt-stat-lbl">Total Givers</div></div>'
      + '<div class="rpt-stat"><div class="rpt-stat-num">' + txns.toLocaleString() + '</div><div class="rpt-stat-lbl">Total Transactions</div></div>'
      + '<div class="rpt-stat"><div class="rpt-stat-num">' + fmtMoney(grand) + '</div><div class="rpt-stat-lbl">Total Given</div></div>'
      + '<div class="rpt-stat"><div class="rpt-stat-num">' + fmtMoney(avgGift) + '</div><div class="rpt-stat-lbl">Avg / Gift</div></div>'
      + '<div class="rpt-stat"><div class="rpt-stat-num">' + fmtMoney(avgPerGiver) + '</div><div class="rpt-stat-lbl">Avg / Giver</div></div>'
      + '</div>';
    var methodTable = methodRows
      ? '<h4 style="font-family:var(--font-head);color:var(--steel-anchor);margin:18px 0 6px 0;">Method Overview</h4>'
        + '<table class="rpt-table" style="max-width:560px;margin-bottom:18px;"><thead><tr><th>Method</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th><th style="text-align:right;">Share</th></tr></thead><tbody>' + methodRows + '</tbody></table>'
      : '';
    // R1: By age group
    var ageGroups = d.by_age_group || [];
    var ageTotalGive = ageGroups.reduce(function(s, b){ return s + (b.total_cents || 0); }, 0);
    var ageRowsHtml = ageGroups.map(function(b) {
      var pct = ageTotalGive > 0 ? Math.round((b.total_cents||0) * 1000 / ageTotalGive) / 10 : 0;
      var avgPerG = (b.givers||0) > 0 ? Math.round((b.total_cents||0) / b.givers) : 0;
      return '<tr><td>' + esc(b.label) + '</td>'
        + '<td style="text-align:right;">' + (b.givers||0) + '</td>'
        + '<td style="text-align:right;">' + (b.contributions||0) + '</td>'
        + '<td style="text-align:right;">' + fmtMoney(b.total_cents||0) + '</td>'
        + '<td style="text-align:right;">' + fmtMoney(avgPerG) + '</td>'
        + '<td style="text-align:right;color:var(--warm-gray);">' + pct.toFixed(1) + '%</td></tr>';
    }).join('');
    var ageTable = (ageGroups.some(function(b){ return (b.givers||0) > 0; }))
      ? '<h4 style="font-family:var(--font-head);color:var(--steel-anchor);margin:18px 0 6px 0;">By Age Group</h4>'
        + '<table class="rpt-table" style="max-width:720px;margin-bottom:18px;"><thead><tr><th>Age Group</th><th style="text-align:right;">Givers</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th><th style="text-align:right;">Avg / Giver</th><th style="text-align:right;">Share</th></tr></thead><tbody>' + ageRowsHtml + '</tbody></table>'
      : '';
    var reconBtn = '<button id="rpt-reconcile-btn" class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" '
      + 'onclick="reconcileGivingOrphans(\'' + esc(from) + '\',\'' + esc(to) + '\')">Reconcile Orphans</button>';
    var diagBtn = '<button id="rpt-diagnose-btn" class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" '
      + 'onclick="diagnoseGivingReconcile(\'' + esc(from) + '\',\'' + esc(to) + '\')">Diagnose</button>';
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving by Fund: ' + esc(fmtDate(from)) + ' – ' + esc(fmtDate(to)) + '</h3>'
      + '<div style="display:flex;gap:8px;">' + diagBtn + reconBtn + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div></div>'
      + overview
      + methodTable
      + ageTable
      + '<h4 style="font-family:var(--font-head);color:var(--steel-anchor);margin:6px 0 6px 0;">By Fund</h4>'
      + '<table class="rpt-table"><thead><tr><th>Fund</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td>Total</td><td></td><td style="text-align:right;">' + fmtMoney(grand) + '</td></tr>'
      + '</tbody></table>'
    );
  });
}
function diagnoseGivingReconcile(from, to) {
  var btn = document.getElementById('rpt-diagnose-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Diagnosing…'; }
  api('/admin/api/giving/reconcile-diagnose?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
    .then(function(d) {
      if (btn) { btn.disabled = false; btn.textContent = 'Diagnose'; }
      if (d.error) { alert('Error: ' + d.error); return; }
      _lastGivingDiagnose = d;
      showRptOutput(renderGivingDiagnose(d, from, to));
    });
}
var _lastGivingDiagnose = null;
function classLabel(k) {
  return {
    in_breeze: 'In Breeze',
    no_breeze_id: 'No Breeze ID (manual / quick entry)',
    split_suffix_base_in_breeze: 'Split-row suffix (base in Breeze)',
    split_suffix_orphan: 'Split-row suffix (base missing)',
    orphan: 'Orphan (breeze_id not in Breeze)'
  }[k] || k;
}
function renderGivingDiagnose(d, from, to) {
  var extras = d.extras || [];
  var fundRows = (d.fund_summary || [])
    .filter(function(s){ return s.extras_count > 0; })
    .map(function(s) {
      var classSummary = Object.keys(s.by_class || {}).filter(function(k){ return k !== 'in_breeze'; })
        .map(function(k){ return classLabel(k) + ': ' + s.by_class[k]; }).join('; ') || '—';
      return '<tr><td>' + esc(s.fund_name) + '</td>'
        + '<td style="text-align:right;">' + s.total_count + '</td>'
        + '<td style="text-align:right;">' + fmtMoney(s.total_cents) + '</td>'
        + '<td style="text-align:right;color:#c0392b;"><strong>+' + s.extras_count + '</strong></td>'
        + '<td style="text-align:right;color:#c0392b;"><strong>+' + fmtMoney(s.extras_cents) + '</strong></td>'
        + '<td style="font-size:.78rem;color:var(--warm-gray);">' + esc(classSummary) + '</td></tr>';
    }).join('');
  if (!fundRows) fundRows = '<tr><td colspan="6" style="text-align:center;color:var(--warm-gray);">No funds have extras — DB matches Breeze in this range.</td></tr>';

  var extraRows = extras.map(function(r) {
    return '<tr>'
      + '<td>' + esc(r.fund_name) + '</td>'
      + '<td>' + esc(r.gift_date) + '</td>'
      + '<td>' + esc(r.person_name) + '</td>'
      + '<td style="text-align:right;">' + fmtMoney(r.amount_cents) + '</td>'
      + '<td style="font-family:monospace;font-size:.78rem;">' + esc(r.breeze_id || '—') + '</td>'
      + '<td style="font-size:.78rem;">' + esc(classLabel(r.classification)) + '</td>'
      + '<td style="font-size:.78rem;">' + esc(r.batch_desc) + '</td>'
      + '<td style="font-size:.78rem;">' + (r.twin_entry_ids.length ? ('twin: ' + r.twin_entry_ids.join(',')) : '—') + '</td>'
      + '<td>id ' + r.id + '</td>'
      + '</tr>';
  }).join('');

  var cc = d.classification_counts || {};
  var ccRows = Object.keys(cc).sort().map(function(k) {
    return '<tr><td>' + esc(classLabel(k)) + '</td><td style="text-align:right;">' + cc[k] + '</td></tr>';
  }).join('');

  var forceBtn = (d.extras_count > 0 && _userRole === 'admin')
    ? '<button id="rpt-force-remove-btn" class="btn-secondary" style="font-size:.8rem;padding:4px 10px;color:#c0392b;border-color:#c0392b;" onclick="forceRemoveGivingOrphans()">Force Remove ' + d.extras_count + '</button>'
    : '';
  return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Reconcile Diagnose: ' + esc(fmtDate(from)) + ' – ' + esc(fmtDate(to)) + '</h3>'
    + '<div style="display:flex;gap:8px;">'
    +   forceBtn
    +   '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="exportGivingDiagnoseCsv()">Export Extras CSV</button>'
    +   '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="runGivingSummary()">Back to Report</button>'
    + '</div></div>'
    + '<div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:14px;font-size:.88rem;">'
    +   '<div><strong>DB rows:</strong> ' + d.db_row_count + ' (' + fmtMoney(d.db_total_cents) + ')</div>'
    +   '<div><strong>Breeze payments:</strong> ' + d.breeze_payment_count + '</div>'
    +   '<div style="color:#c0392b;"><strong>Extras in DB:</strong> ' + d.extras_count + ' (' + fmtMoney(d.extras_total_cents) + ')</div>'
    +   '<div style="color:#888;"><strong>Missing from DB:</strong> ' + d.missing_from_db_count + '</div>'
    + '</div>'
    + '<h4 style="margin:12px 0 4px 0;">Classification Counts</h4>'
    + '<table class="rpt-table" style="max-width:520px;"><thead><tr><th>Classification</th><th style="text-align:right;">Rows</th></tr></thead><tbody>'
    + ccRows + '</tbody></table>'
    + '<h4 style="margin:16px 0 4px 0;">Funds with Extras</h4>'
    + '<table class="rpt-table"><thead><tr><th>Fund</th><th style="text-align:right;">Rows</th><th style="text-align:right;">Total</th><th style="text-align:right;">Extras</th><th style="text-align:right;">Extra $</th><th>Breakdown</th></tr></thead><tbody>'
    + fundRows + '</tbody></table>'
    + '<h4 style="margin:16px 0 4px 0;">Extra Entries (' + extras.length + ')</h4>'
    + (extras.length
       ? '<table class="rpt-table" style="font-size:.88rem;"><thead><tr><th>Fund</th><th>Date</th><th>Person</th><th style="text-align:right;">Amount</th><th>breeze_id</th><th>Classification</th><th>Batch</th><th>Twins</th><th>DB ID</th></tr></thead><tbody>'
         + extraRows + '</tbody></table>'
       : '<p style="color:var(--warm-gray);">No extras — DB matches Breeze giving/list for this range.</p>');
}
function forceRemoveGivingOrphans() {
  var d = _lastGivingDiagnose;
  if (!d) { alert('Run Diagnose first.'); return; }
  if (!d.extras_count) { alert('No orphans to remove.'); return; }
  var msg = 'This will PERMANENTLY DELETE ' + d.extras_count + ' giving entries totaling '
    + fmtMoney(d.extras_total_cents) + ' for ' + d.from + ' to ' + d.to + '.\n\n'
    + 'This is irreversible. These are entries whose breeze_id is not in Breeze\'s '
    + 'current giving/list (typically from batches the user deleted in Breeze).\n\n'
    + 'Only rows with a breeze_id are affected — manual/quick-entry rows are never touched.\n\n'
    + 'Continue?';
  if (!confirm(msg)) return;
  var btn = document.getElementById('rpt-force-remove-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
  api('/admin/api/giving/force-remove-orphans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start: d.from, end: d.to,
      confirm_count: d.extras_count,
      confirm_cents: d.extras_total_cents
    })
  }).then(function(r) {
    if (r.error) {
      alert('Error: ' + r.error);
      if (btn) { btn.disabled = false; btn.textContent = 'Force Remove ' + d.extras_count; }
      return;
    }
    alert('Removed ' + (r.removed || 0) + ' entries (' + fmtMoney(r.removed_cents || 0) + ').');
    runGivingSummary();
  });
}
function exportGivingDiagnoseCsv() {
  var d = _lastGivingDiagnose;
  if (!d) { alert('Run Diagnose first.'); return; }
  var header = 'id,fund,gift_date,contribution_date,person_id,person,amount,breeze_id,classification,batch_desc,twins\n';
  var rows = (d.extras||[]).map(function(r) {
    return [r.id, r.fund_name, r.gift_date, r.contribution_date, r.person_id, r.person_name,
            (r.amount_cents/100).toFixed(2), r.breeze_id, r.classification, r.batch_desc,
            (r.twin_entry_ids||[]).join(';')]
      .map(function(v){ var s = String(v==null?'':v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; })
      .join(',');
  }).join('\n');
  var blob = new Blob([header + rows + '\n'], { type: 'text/csv' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'giving-diagnose-' + d.from + '-to-' + d.to + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function reconcileGivingOrphans(from, to) {
  var btn = document.getElementById('rpt-reconcile-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Reconciling…'; }
  api('/admin/api/giving/reconcile-orphans', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({start: from, end: to})
  }).then(function(d) {
    if (d.error) { alert('Error: ' + d.error); if (btn) { btn.disabled = false; btn.textContent = 'Reconcile Orphans'; } return; }
    var msg = 'Reconciliation complete.\n'
      + 'Breeze payments checked: ' + (d.breezePaymentsChecked||0) + '\n'
      + 'DB entries checked: ' + (d.dbEntriesChecked||0) + '\n'
      + 'Orphan candidates: ' + (d.orphanCandidates||0) + '\n'
      + 'Orphans removed: ' + (d.orphansRemoved||0);
    alert(msg);
    if (d.orphansRemoved > 0) runGivingSummary();
    else if (btn) { btn.disabled = false; btn.textContent = 'Reconcile Orphans'; }
  });
}
function initReportTrendYears() {
  var el = document.getElementById('rpt-trend-years');
  if (!el || el.children.length) return;
  var cur = new Date().getFullYear();
  for (var y = cur; y >= cur - 4; y--) {
    var chk = document.createElement('label');
    chk.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;';
    chk.innerHTML = '<input type="checkbox" value="'+y+'" '+(y>=cur-2?'checked':'')+' style="width:14px;height:14px;"> <span>'+y+'</span>';
    el.appendChild(chk);
  }
}
function runGivingTrend() {
  initReportTrendYears();
  var checked = Array.from(document.querySelectorAll('#rpt-trend-years input:checked')).map(function(c){return c.value;});
  if (!checked.length) { alert('Please select at least one year.'); return; }
  api('/admin/api/reports/giving-trend?years=' + encodeURIComponent(checked.join(','))).then(function(d) {
    _lastGivingTrendData = d;
    showRptOutput(renderGivingTrendChart(d, _givingTrendH));
  });
}
function renderGivingTrendChart(d, chartH) {
  var palette = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E74C3C'];
  var mShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var W=800,H=chartH||220,pL=60,pR=16,pT=16,pB=36,cW=W-pL-pR,cH=H-pT-pB;
  var allV = [];
  (d.years||[]).forEach(function(yr) {
    (d.monthly[yr]||[]).forEach(function(r) { if (r.total_cents) allV.push(r.total_cents); });
  });
  if (!allV.length) return '<div style="padding:20px;color:var(--warm-gray);">No giving data for selected years.</div>';
  var maxV = Math.max.apply(null, allV) * 1.1;
  var pxM = function(i) { return pL + i * (cW / 11); };
  var pyV = function(v) { return pT + cH - (v / maxV) * cH; };
  var grid = '', ylbls = '', xlbls = '', lines = '', markers = '';
  var gridVals = [0, Math.round(maxV*0.25/1.1), Math.round(maxV*0.5/1.1), Math.round(maxV*0.75/1.1), Math.round(maxV/1.1)];
  gridVals.forEach(function(v) {
    var yy = pyV(v);
    grid += '<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylbls += '<text x="'+(pL-4)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#9A8A78" font-size="9">$'+Math.round(v/100).toLocaleString()+'</text>';
  });
  for (var xi = 0; xi < 12; xi++) {
    xlbls += '<text x="'+pxM(xi).toFixed(1)+'" y="'+(H-5)+'" text-anchor="middle" fill="#9A8A78" font-size="9">'+mShort[xi]+'</text>';
  }
  // Easter (Meeus/Jones/Butcher Gregorian algorithm) and Christmas markers.
  // Uses day-of-year to position markers (Jan 1 = pxM(0), Dec 31 = pxM(11))
  // so dates near year-end (like Dec 25) stay inside the chart area.
  var easterOf = function(y) {
    var a=y%19, b=Math.floor(y/100), c=y%100, e=Math.floor(b/4), ee=b%4;
    var f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
    var h=(19*a+b-e-g+15)%30, i=Math.floor(c/4), k=c%4;
    var l=(32+2*ee+2*i-h-k)%7, mm=Math.floor((a+11*h+22*l)/451);
    var month=Math.floor((h+l-7*mm+114)/31), day=((h+l-7*mm+114)%31)+1;
    return { month: month, day: day };
  };
  var xAtDate = function(y, m, day) {
    var daysBefore = [0,31,59,90,120,151,181,212,243,273,304,334];
    var isLeap = (y%4===0 && y%100!==0) || y%400===0;
    var doy = daysBefore[m-1] + day + ((isLeap && m > 2) ? 1 : 0);
    var total = isLeap ? 366 : 365;
    return pL + ((doy - 1) / (total - 1)) * (pxM(11) - pL);
  };
  var legend = '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;justify-content:center;">';
  (d.years||[]).forEach(function(yr, yi) {
    var color = palette[yi % palette.length];
    var yrInt = parseInt(yr, 10);
    var pts = [];
    for (var mo = 1; mo <= 12; mo++) {
      var ms = mo < 10 ? '0'+mo : ''+mo;
      var row = (d.monthly[yr]||[]).find(function(r){return r.month===ms;});
      if (row && row.total_cents) pts.push({x: pxM(mo-1), y: pyV(row.total_cents), v: row.total_cents, mi: mo-1});
    }
    if (!pts.length) return;
    var pathD = pts.map(function(p,j){return(j?'L ':'M ')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    lines += '<path d="'+pathD+'" fill="none" stroke="'+color+'" stroke-width="2.5" stroke-linejoin="round"/>';
    pts.forEach(function(p) {
      lines += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3.5" fill="'+color+'"><title>'+mShort[p.mi]+' '+yr+': $'+Math.round(p.v/100).toLocaleString()+'</title></circle>';
    });
    // Easter marker for this year (dashed vertical line)
    var ed = easterOf(yrInt);
    var ex = xAtDate(yrInt, ed.month, ed.day);
    markers += '<line x1="'+ex.toFixed(1)+'" y1="'+pT+'" x2="'+ex.toFixed(1)+'" y2="'+(H-pB)+'" stroke="'+color+'" stroke-width="1" stroke-dasharray="3,3" opacity="0.55"><title>Easter '+yr+': '+mShort[ed.month-1]+' '+ed.day+'</title></line>';
    markers += '<text x="'+ex.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="'+color+'" font-size="9" font-weight="700" opacity="0.75">E</text>';
    var yearTotal = (d.monthly[yr]||[]).reduce(function(s,r){return s+(r.total_cents||0);},0);
    legend += '<span style="display:flex;align-items:center;gap:5px;font-size:.82rem;">'
      + '<span style="display:inline-block;width:14px;height:14px;background:'+color+';border-radius:3px;flex-shrink:0;"></span>'
      + yr+' <span style="color:var(--warm-gray);">($'+Math.round(yearTotal/100).toLocaleString()+')</span></span>';
  });
  // Shared Christmas marker (Dec 25) — gray dashed line, single instance
  var cx = xAtDate(2026, 12, 25);
  markers += '<line x1="'+cx.toFixed(1)+'" y1="'+pT+'" x2="'+cx.toFixed(1)+'" y2="'+(H-pB)+'" stroke="#8a7968" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"><title>Christmas: Dec 25</title></line>';
  markers += '<text x="'+cx.toFixed(1)+'" y="'+(pT+9)+'" text-anchor="middle" fill="#8a7968" font-size="9" font-weight="700" opacity="0.8">C</text>';
  legend += '<span style="display:flex;align-items:center;gap:10px;font-size:.75rem;color:var(--warm-gray);margin-left:8px;border-left:1px solid var(--border);padding-left:12px;"><span>E = Easter</span><span>C = Christmas</span></span>';
  legend += '</div>';
  var svg = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+markers+lines+xlbls+ylbls+'</svg>';
  return '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px 16px 8px;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;">Giving Trend — Monthly Totals by Year</div>'
    + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
    + '<div id="giving-trend-svg-wrap">'+svg+'</div>' + legend
    + _chartResizeHandle('givingTrendResizeStart')
    + '</div>';
}

// ── R5: Contact Info Completeness ───────────────────────────────────────
function runContactCompleteness(scope) {
  scope = scope || 'active';
  api('/admin/api/reports/contact-completeness?scope=' + encodeURIComponent(scope)).then(function(d) {
    var total = d.total || 0;
    var cats = [
      { k: 'email',   lbl: 'Missing Email',   n: d.missing_email,   icon: '&#9993;' },
      { k: 'phone',   lbl: 'Missing Phone',   n: d.missing_phone,   icon: '&#9742;' },
      { k: 'address', lbl: 'Missing Address', n: d.missing_address, icon: '&#127968;' },
      { k: 'dob',     lbl: 'Missing DOB',     n: d.missing_dob,     icon: '&#127874;' },
      { k: 'photo',   lbl: 'Missing Photo',   n: d.missing_photo,   icon: '&#128247;' },
    ];
    var bars = cats.map(function(c) {
      var pct = total > 0 ? Math.round(c.n * 100 / total) : 0;
      var complete = total - c.n;
      var cpct = total > 0 ? Math.round(complete * 100 / total) : 100;
      return '<div style="margin-bottom:10px;cursor:pointer;" onclick="runContactCompletenessField(\'' + c.k + '\',\'' + scope + '\')">'
        + '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;">'
        + '<div style="font-size:.88rem;color:var(--charcoal);font-weight:600;">' + c.icon + ' ' + esc(c.lbl) + '</div>'
        + '<div style="font-size:.82rem;color:var(--warm-gray);font-variant-numeric:tabular-nums;">' + c.n.toLocaleString() + ' of ' + total.toLocaleString() + ' (' + pct + '%)</div></div>'
        + '<div style="background:var(--linen);border-radius:4px;height:12px;overflow:hidden;position:relative;">'
        + '<div style="background:#5A9E6F;height:100%;width:' + cpct + '%;transition:width .2s;" title="Complete: ' + cpct + '%"></div>'
        + '</div></div>';
    }).join('');
    var scopeBtn = function(val, lbl) {
      var active = scope === val;
      return '<button class="btn-sm" style="padding:4px 10px;font-size:.8rem;' + (active ? 'background:var(--steel-anchor);color:#fff;' : 'background:var(--linen);color:var(--charcoal);') + 'border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="runContactCompleteness(\'' + val + '\')">' + lbl + '</button>';
    };
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:10px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Contact Info Completeness</h3>'
      + '<div style="display:flex;gap:6px;">' + scopeBtn('active','All Active') + scopeBtn('member','Members Only') + '</div></div>'
      + '<div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:14px;">' + total.toLocaleString() + ' active people' + (scope === 'member' ? ' (members only)' : '') + '. Green bar = complete. Click a row to drill down to the list of missing records.</div>'
      + '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;">' + bars + '</div>'
    );
  });
}

function runContactCompletenessField(field, scope) {
  api('/admin/api/reports/contact-completeness?scope=' + encodeURIComponent(scope) + '&field=' + encodeURIComponent(field)).then(function(d) {
    var people = d.people || [];
    var fieldLabels = { email:'Email', phone:'Phone', address:'Address', dob:'DOB', photo:'Photo' };
    var rows = people.map(function(p) {
      var name = esc((p.first_name||'') + ' ' + (p.last_name||''));
      var mt = esc(p.member_type || '');
      return '<tr style="cursor:pointer;" onclick="openPersonDetail(' + p.id + ')">'
        + '<td><span style="color:var(--steel-anchor);font-weight:600;">' + name + '</span></td>'
        + '<td style="color:var(--warm-gray);">' + mt + '</td></tr>';
    }).join('');
    var trunc = people.length >= 500 ? '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:8px;font-style:italic;">Showing first 500. Fix some and re-run for more.</div>' : '';
    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Missing ' + esc(fieldLabels[field]||field) + ' &mdash; ' + people.length + (people.length >= 500 ? '+' : '') + ' people</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="runContactCompleteness(\'' + scope + '\')">&larr; Back</button></div>'
      + '<table class="rpt-table"><thead><tr><th>Name</th><th>Type</th></tr></thead><tbody>'
      + (rows || '<tr><td colspan="2" style="text-align:center;color:var(--warm-gray);padding:20px;">All records complete!</td></tr>')
      + '</tbody></table>' + trunc
    );
  });
}

// ── R2: Giving Insights ─────────────────────────────────────────────────
function runGivingInsights() {
  var yr = parseInt(document.getElementById('rpt-insights-year').value, 10);
  if (!yr) { alert('Please enter a year.'); return; }
  api('/admin/api/reports/giving-insights?year=' + yr).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var topRows = (d.top_givers||[]).map(function(r, i) {
      var name = esc((r.first_name||'') + ' ' + (r.last_name||''));
      return '<tr style="cursor:pointer;" onclick="openPersonDetail(' + r.id + ')">'
        + '<td style="color:var(--warm-gray);text-align:right;font-variant-numeric:tabular-nums;">' + (i+1) + '</td>'
        + '<td style="color:var(--steel-anchor);font-weight:600;">' + name + '</td>'
        + '<td>' + esc(r.member_type||'') + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + (r.gifts||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + fmtMoney(r.total_cents||0) + '</td></tr>';
    }).join('');
    var topTotal = (d.top_givers||[]).reduce(function(s,r){return s+(r.total_cents||0);},0);
    var topBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#127942; Top ' + (d.top_givers||[]).length + ' Givers — ' + yr + '</div>'
      + '<table class="rpt-table"><thead><tr><th style="text-align:right;">#</th><th>Name</th><th>Type</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th></tr></thead>'
      + '<tbody>' + (topRows || '<tr><td colspan="5" style="text-align:center;color:var(--warm-gray);padding:20px;">No giving data for ' + yr + '.</td></tr>') + '</tbody></table>'
      + '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:8px;">Top '+(d.top_givers||[]).length+' combined: ' + fmtMoney(topTotal) + '</div></div>';

    var lapsedRows = (d.lapsed||[]).map(function(r) {
      var name = esc((r.first_name||'') + ' ' + (r.last_name||''));
      return '<tr style="cursor:pointer;" onclick="openPersonDetail(' + r.id + ')">'
        + '<td style="color:var(--steel-anchor);font-weight:600;">' + name + '</td>'
        + '<td>' + esc(r.member_type||'') + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + (r.prior_gifts||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + fmtMoney(r.prior_total_cents||0) + '</td>'
        + '<td style="color:var(--warm-gray);font-size:.82rem;">' + esc(r.last_gift_date||'') + '</td></tr>';
    }).join('');
    var lapsedTotal = (d.lapsed||[]).reduce(function(s,r){return s+(r.prior_total_cents||0);},0);
    var lapsedBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#128276; Lapsed Givers — gave in ' + (yr-1) + ', nothing in ' + yr + '</div>'
      + '<table class="rpt-table"><thead><tr><th>Name</th><th>Type</th><th style="text-align:right;">' + (yr-1) + ' Gifts</th><th style="text-align:right;">' + (yr-1) + ' Total</th><th>Last Gift</th></tr></thead>'
      + '<tbody>' + (lapsedRows || '<tr><td colspan="5" style="text-align:center;color:var(--warm-gray);padding:20px;">No lapsed givers — everyone who gave last year gave this year too. &#127881;</td></tr>') + '</tbody></table>'
      + '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:8px;">' + (d.lapsed||[]).length + ' lapsed givers, ' + fmtMoney(lapsedTotal) + ' given in ' + (yr-1) + '.</div></div>';

    var totalGivers = (d.frequency||[]).reduce(function(s,b){return s+(b.n||0);}, 0);
    var freqRows = (d.frequency||[]).map(function(b) {
      var pct = totalGivers > 0 ? Math.round(b.n * 100 / totalGivers) : 0;
      return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">'
        + '<div style="flex:0 0 110px;font-size:.85rem;color:var(--charcoal);">' + esc(b.label) + '</div>'
        + '<div style="flex:1;background:var(--linen);border-radius:4px;height:16px;overflow:hidden;position:relative;">'
        + '<div style="background:#2E7EA6;height:100%;width:' + pct + '%;"></div></div>'
        + '<div style="flex:0 0 110px;text-align:right;font-size:.82rem;color:var(--warm-gray);font-variant-numeric:tabular-nums;">' + b.n + ' (' + pct + '%)</div></div>';
    }).join('');
    var freqBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:14px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#128200; Giving Frequency — ' + yr + ' (' + totalGivers + ' givers)</div>'
      + freqRows + '</div>';

    var trendRows = (d.trend||[]).map(function(r) {
      return '<tr>'
        + '<td>' + r.year + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + (r.givers||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + (r.gifts||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + fmtMoney(r.total_cents||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + fmtMoney(r.avg_gift_cents||0) + '</td>'
        + '<td style="text-align:right;font-variant-numeric:tabular-nums;">' + fmtMoney(r.avg_giver_cents||0) + '</td></tr>';
    }).join('');
    var trendBlock = '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;">'
      + '<div style="font-weight:700;color:var(--steel-anchor);font-size:.95rem;margin-bottom:8px;">&#128640; Average Gift Trends — last 5 years</div>'
      + '<table class="rpt-table"><thead><tr><th>Year</th><th style="text-align:right;">Givers</th><th style="text-align:right;">Gifts</th><th style="text-align:right;">Total</th><th style="text-align:right;">Avg / Gift</th><th style="text-align:right;">Avg / Giver</th></tr></thead>'
      + '<tbody>' + trendRows + '</tbody></table></div>';

    showRptOutput(
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving Insights — ' + yr + '</h3>'
      + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
      + topBlock + lapsedBlock + freqBlock + trendBlock
    );
  });
}

// ── R8: Giving × Attendance overlay ─────────────────────────────────────
function runGivingVsAttendance() {
  var from = document.getElementById('rpt-gva-from').value;
  var to   = document.getElementById('rpt-gva-to').value;
  if (!from || !to) { alert('Please select a date range.'); return; }
  api('/admin/api/reports/giving-vs-attendance?from=' + from + '&to=' + to).then(function(d) {
    if (d.error) { alert(d.error); return; }
    showRptOutput(renderGivingVsAttendance(d));
  });
}

function renderGivingVsAttendance(d) {
  var weeks = d.weeks || [];
  if (!weeks.length) return '<div style="padding:20px;color:var(--warm-gray);">No data in the selected range.</div>';
  var W = 820, H = 280, pL = 58, pR = 58, pT = 20, pB = 50, cW = W - pL - pR, cH = H - pT - pB;
  var maxAtt  = Math.max.apply(null, weeks.map(function(w){ return w.attendance || 0; }).concat([1])) * 1.1;
  var maxGive = Math.max.apply(null, weeks.map(function(w){ return w.giving_cents || 0; }).concat([1])) * 1.1;
  var bw = cW / weeks.length;
  // Gridlines + Y labels (left = attendance, right = giving)
  var grid = '', ylLbls = '', yrLbls = '';
  for (var i = 0; i <= 4; i++) {
    var yy = pT + cH - (cH * i / 4);
    grid += '<line x1="'+pL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+yy.toFixed(1)+'" stroke="#f0ece8" stroke-width="1"/>';
    ylLbls += '<text x="'+(pL-6)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end" fill="#5A9E6F" font-size="9">'+Math.round(maxAtt * i / 4).toLocaleString()+'</text>';
    yrLbls += '<text x="'+(W-pR+6)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="start" fill="#2E7EA6" font-size="9">$'+Math.round(maxGive * i / 4 / 100).toLocaleString()+'</text>';
  }
  // Attendance bars (green) + giving line (teal)
  var bars = '', linePts = [], xlbls = '', labelEvery = Math.max(1, Math.ceil(weeks.length / 16));
  weeks.forEach(function(w, i) {
    var x = pL + i * bw;
    var bh = (w.attendance || 0) / maxAtt * cH;
    var by = pT + cH - bh;
    bars += '<rect x="'+x.toFixed(1)+'" y="'+by.toFixed(1)+'" width="'+Math.max(1, bw-2).toFixed(1)+'" height="'+bh.toFixed(1)+'" fill="#5A9E6F" opacity="0.55">'
      + '<title>'+esc(w.week_start)+': attendance '+(w.attendance||0).toLocaleString()+'</title></rect>';
    var lx = x + bw/2;
    var ly = pT + cH - ((w.giving_cents || 0) / maxGive * cH);
    linePts.push({ x: lx, y: ly, v: w.giving_cents || 0, w: w.week_start });
    if (i % labelEvery === 0) {
      var d2 = new Date(w.week_start + 'T00:00:00');
      var label = (d2.getMonth()+1) + '/' + d2.getDate();
      xlbls += '<text x="'+lx.toFixed(1)+'" y="'+(H-pB+14)+'" text-anchor="middle" fill="#9A8A78" font-size="9" transform="rotate(-35 '+lx.toFixed(1)+','+(H-pB+14)+')">'+label+'</text>';
    }
  });
  var linePath = linePts.map(function(p,j){ return (j?'L ':'M ')+p.x.toFixed(1)+','+p.y.toFixed(1); }).join(' ');
  var line = '<path d="'+linePath+'" fill="none" stroke="#2E7EA6" stroke-width="2.25" stroke-linejoin="round"/>';
  linePts.forEach(function(p) {
    line += '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="3" fill="#2E7EA6"><title>'+esc(p.w)+': giving $'+Math.round(p.v/100).toLocaleString()+'</title></circle>';
  });
  // Axis titles
  var axisTitles = '<text x="'+(pL-40)+'" y="'+(pT+cH/2)+'" text-anchor="middle" fill="#5A9E6F" font-size="10" font-weight="700" transform="rotate(-90 '+(pL-40)+','+(pT+cH/2)+')">Attendance</text>'
    + '<text x="'+(W-pR+40)+'" y="'+(pT+cH/2)+'" text-anchor="middle" fill="#2E7EA6" font-size="10" font-weight="700" transform="rotate(90 '+(W-pR+40)+','+(pT+cH/2)+')">Giving ($)</text>';
  var svg = '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:'+H+'px;">'+grid+bars+line+xlbls+ylLbls+yrLbls+axisTitles+'</svg>';
  // Stats + simple Pearson correlation across weeks that have both non-zero
  var pairs = weeks.filter(function(w){ return (w.attendance||0) > 0 && (w.giving_cents||0) > 0; });
  var corr = null;
  if (pairs.length >= 3) {
    var n = pairs.length;
    var mx = pairs.reduce(function(s,w){return s+w.attendance;}, 0) / n;
    var my = pairs.reduce(function(s,w){return s+w.giving_cents;}, 0) / n;
    var num = 0, dx = 0, dy = 0;
    pairs.forEach(function(w) {
      num += (w.attendance - mx) * (w.giving_cents - my);
      dx  += (w.attendance - mx) * (w.attendance - mx);
      dy  += (w.giving_cents - my) * (w.giving_cents - my);
    });
    corr = (dx > 0 && dy > 0) ? (num / Math.sqrt(dx * dy)) : null;
  }
  var totalAtt = weeks.reduce(function(s,w){return s+(w.attendance||0);}, 0);
  var totalGive = weeks.reduce(function(s,w){return s+(w.giving_cents||0);}, 0);
  var avgPerAttender = totalAtt > 0 ? Math.round(totalGive / totalAtt) : 0;
  var corrLabel = corr === null ? '—' : (corr >= 0.7 ? 'Strong +' : corr >= 0.4 ? 'Moderate +' : corr >= 0.1 ? 'Weak +' : corr <= -0.7 ? 'Strong −' : corr <= -0.4 ? 'Moderate −' : corr <= -0.1 ? 'Weak −' : 'None');
  var corrVal = corr === null ? '—' : corr.toFixed(2);
  var overview = '<div class="rpt-overview">'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + weeks.length + '</div><div class="rpt-stat-lbl">Weeks</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + totalAtt.toLocaleString() + '</div><div class="rpt-stat-lbl">Total Attendance</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + fmtMoney(totalGive) + '</div><div class="rpt-stat-lbl">Total Given</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + fmtMoney(avgPerAttender) + '</div><div class="rpt-stat-lbl">Avg / Attender</div></div>'
    + '<div class="rpt-stat"><div class="rpt-stat-num">' + corrVal + '</div><div class="rpt-stat-lbl">Correlation — ' + corrLabel + '</div></div>'
    + '</div>';
  var legend = '<div style="display:flex;gap:18px;justify-content:center;margin-top:8px;font-size:.82rem;">'
    + '<span><span style="display:inline-block;width:14px;height:14px;background:#5A9E6F;opacity:.55;vertical-align:middle;margin-right:5px;"></span>Attendance (bars, left axis)</span>'
    + '<span><span style="display:inline-block;width:14px;height:3px;background:#2E7EA6;vertical-align:middle;margin-right:5px;"></span>Giving (line, right axis)</span>'
    + '</div>';
  return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
    + '<h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Giving × Attendance — ' + esc(fmtDate(d.from)) + ' to ' + esc(fmtDate(d.to)) + '</h3>'
    + '<button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="window.print()">Print</button></div>'
    + overview
    + '<div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;">' + svg + legend + '</div>';
}

var _stmtData = null;
function toggleStmtMode() {
  var mode = document.querySelector('input[name="rpt-stmt-mode"]:checked').value;
  document.getElementById('rpt-stmt-person-row').style.display = mode === 'person' ? '' : 'none';
  document.getElementById('rpt-stmt-hh-row').style.display = mode === 'household' ? '' : 'none';
}
function acSearchHH(inp) {
  var q = inp.value.trim();
  var drop = document.getElementById('rpt-hh-ac');
  if (!q) { drop.classList.remove('open'); return; }
  api('/admin/api/households?q=' + encodeURIComponent(q) + '&limit=10').then(function(d) {
    var items = (d.households || []);
    if (!items.length) { drop.classList.remove('open'); return; }
    drop.innerHTML = items.map(function(h) {
      var dn2 = h.display_name || h.name;
      return '<div class="ac-item" onclick="selectHHAc(' + h.id + ',&#39;' + esc(dn2) + '&#39;)">' + esc(dn2) + '</div>';
    }).join('');
    drop.classList.add('open');
  });
}
function selectHHAc(id, name) {
  document.getElementById('rpt-hh-id').value = id;
  document.getElementById('rpt-hh-search').value = name;
  document.getElementById('rpt-hh-ac').classList.remove('open');
}
function runGivingStatement() {
  var mode = (document.querySelector('input[name="rpt-stmt-mode"]:checked') || {}).value || 'person';
  var yr = document.getElementById('rpt-year').value;
  if (!yr) { alert('Please enter a year.'); return; }
  if (mode === 'household') {
    var hhid = document.getElementById('rpt-hh-id').value;
    if (!hhid) { alert('Please select a household.'); return; }
    api('/admin/api/reports/giving-statement-household?household_id=' + hhid + '&year=' + yr).then(function(d) {
      if (d.error) { alert(d.error); return; }
      _stmtData = d; _stmtData._mode = 'household';
      var hh = d.household || {};
      var rows = (d.entries||[]).map(function(e) {
        return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.first_name + ' ' + e.last_name) + '</td><td>' + esc(e.fund_name) + '</td><td style="text-align:right;">' + fmtMoney(e.amount) + '</td></tr>';
      }).join('');
      showRptOutput(
        '<div style="max-width:620px;margin:0 auto;">'
        + '<div style="text-align:center;margin-bottom:16px;"><div style="font-family:var(--font-head);font-size:1.2rem;color:var(--steel-anchor);">' + esc(_churchConfig.church_name || 'Timothy Lutheran Church') + '</div>'
        + '<div style="font-size:.9rem;color:var(--warm-gray);">Household Giving Statement — ' + esc(String(yr)) + '</div></div>'
        + '<div style="margin-bottom:14px;font-size:.9rem;"><div><strong>Household:</strong> ' + esc(hh.name) + '</div></div>'
        + '<table class="rpt-table"><thead><tr><th>Date</th><th>Person</th><th>Fund</th><th style="text-align:right;">Amount</th></tr></thead><tbody>'
        + rows
        + '<tr class="rpt-total"><td colspan="3">Total ' + esc(String(yr)) + '</td><td style="text-align:right;">' + fmtMoney(d.total_cents||0) + '</td></tr>'
        + '</tbody></table>'
        + '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:16px;font-style:italic;">No goods or services were provided in exchange for these contributions. Please retain for your tax records.</div>'
        + '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">'
        + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button>'
        + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatementLetter()">View Letter</button>'
        + '</div></div>'
      );
    });
    return;
  }
  var pid = document.getElementById('rpt-person-id').value;
  if (!pid) { alert('Please select a person.'); return; }
  api('/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr).then(function(d) {
    if (d.error) { alert(d.error); return; }
    _stmtData = d; _stmtData._mode = 'person';
    var p = d.person || {};
    var addr = [p.address1, p.city, p.state, p.zip].filter(Boolean).join(', ');
    var rows = (d.entries||[]).map(function(e) {
      return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.fund_name) + '</td><td style="text-align:right;">' + fmtMoney(e.amount) + '</td><td>' + esc(e.method) + '</td></tr>';
    }).join('');
    showRptOutput(
      '<div style="max-width:600px;margin:0 auto;">'
      + '<div style="text-align:center;margin-bottom:20px;">'
      + '<div style="font-family:var(--font-head);font-size:1.2rem;color:var(--steel-anchor);">' + esc(_churchConfig.church_name || 'Timothy Lutheran Church') + '</div>'
      + '<div style="font-size:.9rem;color:var(--warm-gray);">Charitable Contribution Statement — ' + esc(String(yr)) + '</div>'
      + '</div>'
      + '<div style="margin-bottom:16px;font-size:.9rem;">'
      + '<div><strong>Prepared for:</strong> ' + esc(p.first_name) + ' ' + esc(p.last_name) + '</div>'
      + (addr ? '<div><strong>Address:</strong> ' + esc(addr) + '</div>' : '')
      + '</div>'
      + '<table class="rpt-table"><thead><tr><th>Date</th><th>Fund</th><th style="text-align:right;">Amount</th><th>Method</th></tr></thead><tbody>'
      + rows
      + '<tr class="rpt-total"><td colspan="2">Total ' + esc(String(yr)) + '</td><td style="text-align:right;">' + fmtMoney(d.total_cents||0) + '</td><td></td></tr>'
      + '</tbody></table>'
      + '<div style="font-size:.78rem;color:var(--warm-gray);margin-top:16px;font-style:italic;">No goods or services were provided in exchange for these contributions. Please retain for your tax records.</div>'
      + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatementLetter()">View Letter</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="emailGivingLetter()">&#9993; Email Letter</button>'
      + '<button class="btn-secondary" style="font-size:.8rem;" onclick="downloadStatement()">Download CSV</button>'
      + '</div>'
      + '</div>'
    );
  });
}
function buildGiftTable(entries, mode) {
  if (!entries || !entries.length) return 'No contributions recorded for this period.';
  var header = mode === 'household'
    ? '<tr><th>Date</th><th>Person</th><th>Fund</th><th>Amount</th></tr>'
    : '<tr><th>Date</th><th>Fund</th><th>Amount</th><th>Method</th></tr>';
  var rows = entries.map(function(e) {
    if (mode === 'household')
      return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.first_name + ' ' + e.last_name) + '</td><td>' + esc(e.fund_name) + '</td><td>' + fmtMoney(e.amount) + '</td></tr>';
    return '<tr><td>' + esc(fmtDate(e.gift_date)) + '</td><td>' + esc(e.fund_name) + '</td><td>' + fmtMoney(e.amount) + '</td><td>' + esc(e.method) + '</td></tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:.9rem;"><thead style="background:#f5f5f5;">' + header + '</thead><tbody>' + rows + '</tbody></table>';
}
function renderLetterHTML(d) {
  var cfg = _churchConfig;
  var tpl = cfg.giving_letter_template || DEFAULT_LETTER_TEMPLATE;
  var name, total, year;
  if (d._mode === 'household') {
    name = (d.household || {}).name || 'Friend';
    total = fmtMoney(d.total_cents || 0);
    year = String(d.year || '');
  } else {
    var p = d.person || {};
    name = (p.first_name + ' ' + p.last_name).trim() || 'Friend';
    total = fmtMoney(d.total_cents || 0);
    year = String(d.year || '');
  }
  var giftTable = buildGiftTable(d.entries || [], d._mode);
  var ein = cfg.church_ein || '';
  var einLine = ein ? 'Our EIN/Tax ID is ' + ein + '. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.' : 'No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.';
  var today = new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'});
  var letter = tpl
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{year\}\}/g, year)
    .replace(/\{\{total\}\}/g, total)
    .replace(/\{\{ein\}\}/g, ein)
    .replace(/\{\{date\}\}/g, today)
    .replace(/\{\{gift_table\}\}/g, giftTable)
    .replace(/\{\{#if_ein\}\}[\s\S]*?\{\{\/if_ein\}\}/g, ein ? einLine : '');
  return letter.replace(/\\n/g, '<br>');
}
function runGivingStatementLetter() {
  if (!_stmtData) { alert('Run a giving statement first.'); return; }
  if (!_churchConfig.church_name) {
    // Load config if not yet loaded
    api('/admin/api/config/church').then(function(cfg) {
      _churchConfig = cfg || {};
      showGivingLetter();
    });
  } else {
    showGivingLetter();
  }
}
function showGivingLetter() {
  var d = _stmtData;
  var letterHtml = renderLetterHTML(d);
  var name, email, yr;
  yr = String(d.year || document.getElementById('rpt-year').value || '');
  if (d._mode === 'household') {
    name = (d.household || {}).name || '';
    email = '';
  } else {
    var p = d.person || {};
    name = (p.first_name + ' ' + p.last_name).trim();
    email = p.email || '';
  }
  var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
  showRptOutput(
    '<div style="max-width:640px;margin:0 auto;">'
    + '<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">'
    + '<button class="btn-secondary" style="font-size:.8rem;" onclick="runGivingStatement()">&#8592; Back to Statement</button>'
    + '<button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print Letter</button>'
    + (email ? '<button class="btn-primary" style="font-size:.8rem;" onclick="emailGivingLetter()">&#9993; Email to ' + esc(email) + '</button>' : '')
    + '<div id="letter-email-status" class="import-status" style="align-self:center;"></div>'
    + '</div>'
    + '<div id="letter-body" style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:28px 32px;font-size:.92rem;line-height:1.65;">'
    + '<div style="font-family:var(--font-head);font-size:1.1rem;color:var(--steel-anchor);margin-bottom:4px;">' + esc(churchName) + '</div>'
    + '<hr style="margin:12px 0;">'
    + letterHtml
    + '</div></div>'
  );
}
function emailGivingLetter() {
  if (!_stmtData) return;
  var p = _stmtData.person || {};
  var email = p.email || '';
  if (!email) { alert('No email address on file for this person.'); return; }
  var status = document.getElementById('letter-email-status');
  if (status) { status.textContent = 'Sending…'; status.className = 'import-status'; }
  var yr = String(_stmtData.year || '');
  var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
  var letterHtml = renderLetterHTML(_stmtData);
  var fullHtml = '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
    + '<div style="font-size:16px;font-weight:bold;margin-bottom:6px;">' + esc(churchName) + '</div>'
    + '<hr style="margin:10px 0;">'
    + letterHtml + '</div>';
  api('/admin/api/giving/send-statement', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      to_email: email,
      to_name: (p.first_name + ' ' + p.last_name).trim(),
      subject: yr + ' Charitable Contribution Statement — ' + churchName,
      html_body: fullHtml
    })
  }).then(function(d) {
    if (status) {
      if (d.ok) { status.textContent = 'Sent to ' + email; status.className = 'import-status ok'; }
      else { status.textContent = 'Error: ' + (d.error || 'unknown'); status.className = 'import-status err'; }
    }
  }).catch(function(e) {
    if (status) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; }
  });
}
function downloadStatement() {
  var mode = (document.querySelector('input[name="rpt-stmt-mode"]:checked') || {}).value || 'person';
  var yr = document.getElementById('rpt-year').value;
  if (!yr) { alert('Enter a year first.'); return; }
  if (mode === 'household') {
    alert('CSV download is only available for person statements. Use Print or View Letter for household statements.');
    return;
  }
  var pid = document.getElementById('rpt-person-id').value;
  if (!pid || !yr) { alert('Select a person and year first.'); return; }
  window.location = '/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr + '&format=csv';
}
`;
