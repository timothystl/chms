export const JS_DASHBOARD = String.raw`// ── DASHBOARD ─────────────────────────────────────────────────────────
var _dashData = null;
var _dashMonth = new Date().getMonth() + 1; // 1-12, default current month
var DASH_PREF_DEFAULTS = {weeklyTasks:true, prayers:true, followUp:true, newContacts:true, reviewQueue:false, firstGivers:true, notSeen:true, birthdays:true, anniversaries:true, membership:true};
var DASH_PREF_LABELS = {weeklyTasks:'This Week\'s Tasks', prayers:'Prayer Requests', followUp:'Follow-up Queue', newContacts:'New Contacts', reviewQueue:'Visitor Review Batch', firstGivers:'First-Time Givers', notSeen:'Not Seen Recently', birthdays:'Birthdays', anniversaries:'Anniversaries', membership:'Membership by Type'};
function dashGetPrefs() {
  if (!_dashPrefs) {
    try { _dashPrefs = Object.assign({}, DASH_PREF_DEFAULTS, JSON.parse(localStorage.getItem('dashCardPrefs')||'{}')); }
    catch(e) { _dashPrefs = Object.assign({}, DASH_PREF_DEFAULTS); }
  }
  return _dashPrefs;
}
function dashSavePref(key, val) {
  _dashPrefs[key] = val;
  try { localStorage.setItem('dashCardPrefs', JSON.stringify(_dashPrefs)); } catch(e) {}
  if (_dashData) renderDashboard(_dashData);
}
function openDashCustomize() {
  var prefs = dashGetPrefs();
  var list = document.getElementById('dash-prefs-list');
  if (list) {
    list.innerHTML = Object.keys(DASH_PREF_LABELS).map(function(k) {
      return '<label style="display:flex;align-items:center;gap:10px;font-size:.9rem;cursor:pointer;">'
        + '<input type="checkbox" '+(prefs[k]?'checked':'')+' onchange="dashSavePref(\''+k+'\',this.checked)" style="width:16px;height:16px;">'
        + '<span>'+DASH_PREF_LABELS[k]+'</span></label>';
    }).join('');
  }
  openModal('dash-customize-modal');
}
function loadDashboard() {
  var body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Loading\u2026</div>';
  api('/admin/api/dashboard?month=' + _dashMonth).then(function(d) {
    _dashData = d;
    renderDashboard(d);
  }).catch(function(e) {
    var body2 = document.getElementById('dash-body');
    if (body2) body2.innerHTML = '<div style="color:var(--danger);padding:20px;">Could not load dashboard: '+esc(e.message||'error')+'</div>';
  });
}
function dashMonthNav(delta) {
  _dashMonth = ((_dashMonth - 1 + delta + 12) % 12) + 1;
  loadDashboard();
}

// ── Visitor Review Batch actions (DC1) — hidden by default ──────────────
function reviewMark(personId) {
  api('/admin/api/engagement/mark-reviewed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId })
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('rq-row-' + personId);
    if (row) row.remove();
    setTimeout(loadDashboard, 400);
  });
}

function reviewArchive(personId, name) {
  if (!confirm('Archive ' + (name || 'this person') + '? They will be hidden from the active list. You can restore later from their profile.')) return;
  api('/admin/api/people/' + personId + '/archive', { method: 'POST' }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('rq-row-' + personId);
    if (row) row.remove();
    setTimeout(loadDashboard, 400);
  });
}

// ── This Week's Tasks (engagement checklist) ────────────────────────
var _weekTasksWeekKey = '';
function taskToggle(id, completed) {
  api('/admin/api/engagement/tasks/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: completed ? 0 : 1 })
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('wt-row-' + id);
    if (row) {
      var cb = row.querySelector('.wt-cb');
      var lbl = row.querySelector('.wt-lbl');
      if (completed) {
        row.dataset.completed = '0';
        if (cb) cb.textContent = '□';
        if (lbl) lbl.style.textDecoration = '';
      } else {
        row.dataset.completed = '1';
        if (cb) cb.textContent = '☑';
        if (lbl) lbl.style.textDecoration = 'line-through';
      }
    }
  });
}
function taskDelete(id) {
  api('/admin/api/engagement/tasks/' + id, { method: 'DELETE' }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('wt-row-' + id);
    if (row) row.remove();
  });
}
function taskAddSubmit() {
  var inp = document.getElementById('wt-add-input');
  var urlInp = document.getElementById('wt-add-url');
  if (!inp) return;
  var title = inp.value.trim();
  if (!title) { inp.focus(); return; }
  api('/admin/api/engagement/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title, link_url: urlInp ? urlInp.value.trim() : '', week_key: _weekTasksWeekKey })
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    inp.value = '';
    if (urlInp) urlInp.value = '';
    loadDashboard();
  });
}
function dismissFirstGift(personId) {
  api('/admin/api/people/' + personId + '/dismiss-first-gift', { method: 'POST' }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('fg-row-' + personId);
    if (row) row.remove();
  });
}

// ── Prayer Requests (FU1) ──────────────────────────────────────────────
function prayerSetStatus(id, status) {
  var note = '';
  if (status === 'answered' || status === 'closed') {
    note = prompt('Resolution note (optional):', '');
    if (note === null) return; // user hit Cancel on prompt
    note = note || '';
  }
  var body = { status: status };
  if (note) body.resolution_note = note;
  api('/admin/api/prayer-requests/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    loadDashboard();
  });
}
function downloadPrayerCsv() {
  var status = prompt('Export which requests?\n\nType: all, open, praying, active (open+praying), answered, closed', 'all');
  if (status === null) return;
  status = (status || 'all').trim().toLowerCase();
  var allowed = ['all','open','praying','active','answered','closed'];
  if (!allowed.includes(status)) { alert('Invalid choice. Use: all, open, praying, active, answered, or closed'); return; }
  window.location.href = '/admin/api/prayer-requests/export.csv?status=' + encodeURIComponent(status);
}
function openAddPrayerModal() {
  var m = document.getElementById('prayer-modal');
  if (!m) return;
  document.getElementById('prayer-req-name').value  = '';
  document.getElementById('prayer-req-email').value = '';
  document.getElementById('prayer-req-text').value  = '';
  document.getElementById('prayer-req-date').value  = new Date().toISOString().slice(0, 10);
  document.getElementById('prayer-req-personid').value = '';
  document.getElementById('prayer-req-personlabel').textContent = '';
  openModal('prayer-modal');
  setTimeout(function(){ document.getElementById('prayer-req-name').focus(); }, 60);
}
function prayerPickPerson() {
  var q = prompt('Search for person by name or email:');
  if (!q) return;
  api('/admin/api/people?q=' + encodeURIComponent(q) + '&limit=5').then(function(d) {
    var rows = (d && d.people) || d || [];
    if (!rows.length) { alert('No matches.'); return; }
    var options = rows.slice(0, 5).map(function(p, i) {
      return (i+1) + '. ' + ((p.first_name||'') + ' ' + (p.last_name||'')).trim() + (p.email ? ' <' + p.email + '>' : '');
    }).join('\n');
    var pick = prompt('Pick a match (1-' + rows.length + '), or 0 to cancel:\n\n' + options);
    var idx = parseInt(pick, 10);
    if (!idx || idx < 1 || idx > rows.length) return;
    var chosen = rows[idx - 1];
    document.getElementById('prayer-req-personid').value = chosen.id;
    document.getElementById('prayer-req-personlabel').textContent = ((chosen.first_name||'') + ' ' + (chosen.last_name||'')).trim() + (chosen.email ? ' <' + chosen.email + '>' : '');
    if (!document.getElementById('prayer-req-name').value) {
      document.getElementById('prayer-req-name').value = ((chosen.first_name||'') + ' ' + (chosen.last_name||'')).trim();
    }
    if (!document.getElementById('prayer-req-email').value && chosen.email) {
      document.getElementById('prayer-req-email').value = chosen.email;
    }
  });
}
function prayerClearPerson() {
  document.getElementById('prayer-req-personid').value = '';
  document.getElementById('prayer-req-personlabel').textContent = '';
}
function savePrayerRequest() {
  var txt = document.getElementById('prayer-req-text').value.trim();
  if (!txt) { alert('Please enter the prayer request.'); return; }
  var pidStr = document.getElementById('prayer-req-personid').value;
  var body = {
    request_text: txt,
    requester_name:  document.getElementById('prayer-req-name').value.trim(),
    requester_email: document.getElementById('prayer-req-email').value.trim(),
    submitted_at:    document.getElementById('prayer-req-date').value
  };
  if (pidStr) body.person_id = parseInt(pidStr, 10);
  api('/admin/api/prayer-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    closeModal('prayer-modal');
    loadDashboard();
  });
}

// ── New Contacts follow-up actions (FU2) ──────────────────────────────
function followupMarkDone(personId) {
  api('/admin/api/engagement/update-followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId, followup_status: 'done' })
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    var row = document.getElementById('fu-row-' + personId);
    if (row) row.remove();
    setTimeout(loadDashboard, 400);
  });
}

function followupEditNotes(personId, currentNotes) {
  var next = prompt('Follow-up notes (saved to this contact):', currentNotes || '');
  if (next === null) return;
  api('/admin/api/engagement/update-followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId, followup_notes: next, followup_status: next ? 'in_progress' : '' })
  }).then(function(d) {
    if (d.error) { alert(d.error); return; }
    setTimeout(loadDashboard, 400);
  });
}
function _dashBulletinDate(dateStr, mnShort) {
  var parts = (dateStr||'').split('-');
  if (parts.length < 3) return dateStr;
  return mnShort[parseInt(parts[1])-1] + ' ' + String(parseInt(parts[2])).padStart(2,' ');
}
function dashCopyBirthdays() {
  var d = _dashData;
  if (!d) return;
  var yr = new Date().getFullYear();
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mn = monthNames[(_dashMonth - 1)];
  var bdList = d.birthdays || [];
  var lines = ['Birthdays \u2014 ' + mn + ' ' + yr, ''];
  if (bdList.length) {
    bdList.forEach(function(p) {
      var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
      lines.push('  ' + _dashBulletinDate(p.dob, mnShort) + '  ' + name);
    });
  } else {
    lines.push('  None this month.');
  }
  navigator.clipboard.writeText(lines.join('\n')).then(function() {
    var btn = document.getElementById('dash-copy-bd-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.innerHTML = '&#128203;'; }, 1500); }
  });
}
function dashCopyAnniversaries() {
  var d = _dashData;
  if (!d) return;
  var yr = new Date().getFullYear();
  var monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var mn = monthNames[(_dashMonth - 1)];
  var annList = d.anniversaries || [];
  var lines = ['Anniversaries \u2014 ' + mn + ' ' + yr, ''];
  if (annList.length) {
    annList.forEach(function(p) {
      var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
      lines.push('  ' + _dashBulletinDate(p.anniversary_date, mnShort) + '  ' + name);
    });
  } else {
    lines.push('  None this month.');
  }
  navigator.clipboard.writeText(lines.join('\n')).then(function() {
    var btn = document.getElementById('dash-copy-ann-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(function(){ btn.innerHTML = '&#128203;'; }, 1500); }
  });
}
function renderDashboard(d) {
  var body = document.getElementById('dash-body');
  if (!body) return;
  var prefs = dashGetPrefs();
  var pvColors = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
  var maxType = d.typeCounts && d.typeCounts.length ? d.typeCounts[0].n : 1;
  var yr = new Date().getFullYear();
  var html = '';
  _weekTasksWeekKey = d.weeklyTasksWeek || '';

  // ── Quick actions ──────────────────────────────────────────────
  var isFinanceRole = _userRole === 'admin' || _userRole === 'finance';
  var isStaffRole   = _userRole === 'admin' || _userRole === 'staff';
  var canEditRole   = _userRole === 'admin' || _userRole === 'finance' || _userRole === 'staff';
  html += '<div style="display:flex;justify-content:flex-end;margin-bottom:4px;">'
    + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 10px;" onclick="openDashCustomize()">&#9881; Customize</button>'
    + '</div>';
  html += '<div class="dash-quick">'
    + (canEditRole ? dashQBtn('<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>', 'Add Person', "openPersonEdit(null);showTab('people')") : '')
    + (isFinanceRole ? dashQBtn('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/>', 'Record Giving', "showTab('giving')") : '')
    + (isStaffRole ? dashQBtn('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>', 'Attendance', "showTab('attendance')") : '')
    + (canEditRole ? dashQBtn('<path d="M18 20V10M12 20V4M6 20v-6"/>', 'Reports', "showTab('reports')") : '')
    + '</div>';

  // ── Stat strip ─────────────────────────────────────────────────
  var svcs = (d.recentAttendance || []).slice(0, 2);
  html += '<div class="dash-stats">'
    + dashStat(d.memberCount !== undefined ? d.memberCount : d.totalPeople, 'Members', d.totalPeople + ' total people')
    + dashStat(d.memberHHCount !== undefined ? d.memberHHCount : d.totalHouseholds, 'Member Households', d.totalHouseholds + ' total households')
    + (isFinanceRole ? dashStat('$'+fmt$(d.gfYtd), yr+' Gen. Fund', yr-1+' YTD $'+fmt$(d.gfLastYearYtd), yr-1+' Full Year $'+fmt$(d.gfLastYearTotal)) : '')
    + (isStaffRole ? dashStatServices(svcs) : '')
    + '</div>';

  // ── This Week's Tasks (engagement checklist) — editors+ only ─────────
  if (canEditRole && prefs.weeklyTasks) {
    var wtTasks = d.weeklyTasks || [];
    var wtDone  = wtTasks.filter(function(t){ return t.completed; }).length;
    html += '<div class="dash-section-hdr">'
      + '<span>This Week\'s Tasks</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'
      + (wtTasks.length ? wtDone + ' / ' + wtTasks.length + ' done' : 'no tasks') + '</span>'
      + '</div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
    if (wtTasks.length) {
      html += wtTasks.map(function(t) {
        var done = t.completed ? 1 : 0;
        var lineThrough = done ? 'text-decoration:line-through;color:var(--warm-gray);' : '';
        var cbChar = done ? '&#9745;' : '&#9744;';
        var titleHtml = t.link_url
          ? '<a href="' + esc(t.link_url) + '" target="_blank" rel="noopener" style="color:var(--steel-anchor);text-decoration:none;' + lineThrough + '" class="wt-lbl">' + esc(t.title) + '</a>'
          : '<span class="wt-lbl" style="' + lineThrough + '">' + esc(t.title) + '</span>';
        return '<div class="dash-row-item" id="wt-row-' + t.id + '" data-completed="' + done + '"'
          + ' style="display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--linen);">'
          + '<span class="wt-cb" style="font-size:1.2rem;cursor:pointer;flex-shrink:0;color:var(--steel-anchor);" onclick="taskToggle(' + t.id + ',' + done + ')" title="Toggle complete">' + cbChar + '</span>'
          + '<div style="flex:1;min-width:0;font-size:.88rem;">' + titleHtml + '</div>'
          + '<button style="background:none;border:none;cursor:pointer;color:var(--faint);font-size:1rem;padding:0 4px;flex-shrink:0;" onclick="taskDelete(' + t.id + ')" title="Remove task">&#10005;</button>'
          + '</div>';
      }).join('');
    }
    html += '<div style="padding:10px 14px;border-top:' + (wtTasks.length ? '1px solid var(--linen)' : 'none') + ';display:flex;gap:6px;align-items:center;">'
      + '<input id="wt-add-input" type="text" placeholder="Add a task…" style="flex:1;min-width:0;padding:5px 8px;font-size:.83rem;border:1px solid var(--border);border-radius:5px;background:var(--linen);" onkeydown="if(event.key===\'Enter\')taskAddSubmit();">'
      + '<input id="wt-add-url" type="url" placeholder="Link (optional)" style="width:160px;padding:5px 8px;font-size:.83rem;border:1px solid var(--border);border-radius:5px;background:var(--linen);" onkeydown="if(event.key===\'Enter\')taskAddSubmit();">'
      + '<button class="btn-primary" style="padding:5px 12px;font-size:.83rem;white-space:nowrap;" onclick="taskAddSubmit()">Add</button>'
      + '</div>';
    html += '</div></div>';
  }

  // ── Prayer Requests (FU1) — editors+ only ─────────────────────
  if (canEditRole && prefs.prayers) {
    var pr       = d.prayerOpen || [];
    var prTotal  = d.prayerOpenTotal || 0;
    html += '<div class="dash-section-hdr">'
      + '<span>Prayer Requests</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'
      + (prTotal ? prTotal + ' open' : 'none open') + '</span>'
      + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 10px;margin-left:auto;" onclick="downloadPrayerCsv()">↓ CSV</button>'
      + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 10px;" onclick="openAddPrayerModal()">+ Add</button>'
      + '</div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
    if (pr.length) {
      html += pr.map(function(r) {
        var who = r.person_id
          ? ((r.first_name || '') + ' ' + (r.last_name || '')).trim()
          : (r.requester_name || '(anonymous)');
        var preview = (r.request_text || '').length > 140 ? (r.request_text.slice(0, 140) + '…') : r.request_text;
        var statusLabel = r.status === 'praying' ? 'Praying' : 'Open';
        var statusBg = r.status === 'praying' ? 'var(--pale-sage)' : 'var(--linen)';
        var srcLabel = r.source && r.source !== 'manual' ? ' · ' + r.source : '';
        return '<div class="dash-row-item" id="pr-row-' + r.id + '" style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--linen);">'
          + '<div style="flex:1;min-width:0;">'
          +   '<div style="font-weight:600;color:var(--steel-anchor);' + (r.person_id ? 'cursor:pointer;' : '') + '"'
          +     (r.person_id ? ' onclick="openPersonDetail(' + r.person_id + ')"' : '') + '>' + esc(who) + '</div>'
          +   '<div style="font-size:.78rem;color:var(--warm-gray);">' + esc(r.submitted_at || '') + ' · '
          +     '<span style="background:' + statusBg + ';padding:1px 6px;border-radius:4px;">' + statusLabel + '</span>' + esc(srcLabel) + '</div>'
          +   '<div style="font-size:.85rem;color:var(--charcoal);margin-top:5px;white-space:pre-wrap;">' + esc(preview) + '</div>'
          + '</div>'
          + '<div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">'
          +   (r.status === 'open'
              ? '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--pale-sage);border:1px solid var(--soft-sage);border-radius:6px;cursor:pointer;color:var(--on-pale-sage);" onclick="prayerSetStatus(' + r.id + ',\'praying\')" title="Mark as actively praying">Praying</button>'
              : '')
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="prayerSetStatus(' + r.id + ',\'answered\')" title="Mark answered">Answered</button>'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="prayerSetStatus(' + r.id + ',\'closed\')" title="Close without marking answered">Close</button>'
          + '</div></div>';
      }).join('');
    } else {
      html += '<div style="padding:14px 16px;color:var(--warm-gray);font-size:.85rem;">No open prayer requests. Click + Add to enter a paper card request.</div>';
    }
    html += '</div></div>';
  }

  // ── Follow-up queue — staff+ only ─────────────────────────────
  if (isStaffRole && prefs.followUp) {
  var fuItems = d.followUpItems || [];
  var fuTypeLabels = { pastoral_call:'Pastoral Call', prayer:'Prayer Follow-up', first_gift:'First Gift', not_seen:'Not Seen', newsletter:'Newsletter', general:'General' };
  var fuTypeColors = { pastoral_call:'#2E7EA6', prayer:'#9B59B6', first_gift:'#C9973A', not_seen:'#E87040', newsletter:'#5A9E6F', general:'#666' };
  html += '<div class="dash-section-hdr">'
    + '<span>Follow-up Queue</span>'
    + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'+(fuItems.length ? fuItems.length+' open' : 'all clear')+'</span>'
    + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 10px;margin-left:auto;" onclick="openAddFollowUp(null)">+ Add</button>'
    + '</div>';
  html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
  if (fuItems.length) {
    html += fuItems.map(function(item) {
      var name = item.first_name || item.last_name ? ((item.first_name||'')+' '+(item.last_name||'')).trim() : null;
      var typeLabel = fuTypeLabels[item.type] || item.type;
      var typeColor = fuTypeColors[item.type] || '#666';
      var age = item.created_at ? Math.floor((Date.now()-new Date(item.created_at))/86400000) : 0;
      var ageStr = age === 0 ? 'today' : age === 1 ? 'yesterday' : age+'d ago';
      return '<div class="dash-fu-item" id="fu-'+item.id+'">'
        + '<button class="dash-fu-check" onclick="completeFollowUp('+item.id+')" title="Mark complete">&#10003;</button>'
        + '<div style="flex:1;min-width:0;">'
        + '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">'
        + '<span style="font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px;background:'+typeColor+'18;color:'+typeColor+';">'+esc(typeLabel)+'</span>'
        + (name ? '<span class="dash-item-name" style="cursor:pointer;" onclick="openPersonDetail('+item.person_id+')">'+esc(name)+'</span>' : '')
        + '</div>'
        + (item.notes ? '<div style="font-size:12px;color:var(--warm-gray);margin-top:2px;white-space:pre-wrap;">'+esc(item.notes)+'</div>' : '')
        + '</div>'
        + '<div style="font-size:11px;color:var(--faint);flex-shrink:0;">'+ageStr+'</div>'
        + '</div>';
    }).join('');
  } else {
    html += '<div style="padding:18px;color:var(--faint);font-size:13px;font-style:italic;">No open follow-up items. Enjoy the quiet!</div>';
  }
  html += '</div></div>';
  } // end isStaffRole follow-up block

  // ── New Contacts follow-up (FU2/DB9) — editors+ only ──────────
  // Visitors/friends with a first_contact_date set, not yet marked done.
  // Newer contacts first so they get attention before going cold.
  if (canEditRole && prefs.newContacts) {
    var nc       = d.followupQueue || [];
    var ncTotal  = d.followupQueueTotal || 0;
    html += '<div class="dash-section-hdr">'
      + '<span>New Contacts</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'
      + (ncTotal ? ncTotal + ' awaiting follow-up' : 'all caught up') + '</span>'
      + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 10px;margin-left:auto;" onclick="openPersonEdit(null)" title="Enter a paper contact card">+ Add</button>'
      + '</div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
    if (nc.length) {
      html += nc.map(function(p) {
        var name = ((p.first_name||'') + ' ' + (p.last_name||'')).trim() || '(no name)';
        var days = p.first_contact_date
          ? Math.max(0, Math.floor((Date.now() - new Date(p.first_contact_date + 'T00:00:00')) / 86400000))
          : 0;
        var ageStr = days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago';
        var meta = [];
        meta.push(esc(p.member_type || ''));
        meta.push('first contact ' + ageStr);
        if (p.email) meta.push(esc(p.email));
        if (p.phone) meta.push(esc(p.phone));
        if (p.followup_status) meta.push('status: ' + esc(p.followup_status.replace(/_/g, ' ')));
        var notesEsc = (p.followup_notes || '').replace(/"/g, '&quot;');
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--linen);" id="fu-row-'+p.id+'">'
          + '<div style="flex:1;min-width:0;">'
          +   '<div style="font-weight:600;color:var(--steel-anchor);cursor:pointer;" onclick="openPersonDetail('+p.id+')">' + esc(name) + '</div>'
          +   '<div style="font-size:.75rem;color:var(--warm-gray);">' + meta.join(' · ') + '</div>'
          +   (p.followup_notes ? '<div style="font-size:.78rem;color:var(--charcoal);margin-top:4px;font-style:italic;">"' + esc(p.followup_notes) + '"</div>' : '')
          + '</div>'
          + '<div style="display:flex;gap:4px;flex-shrink:0;">'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="followupEditNotes('+p.id+',\''+notesEsc.replace(/\\\'/g,"\\\\'")+'\')" title="Add or edit notes">Notes</button>'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--pale-sage);border:1px solid var(--soft-sage);border-radius:6px;cursor:pointer;color:var(--on-pale-sage);" onclick="followupMarkDone('+p.id+')" title="Mark follow-up complete">Done</button>'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="openPersonDetail('+p.id+')" title="Open profile">Open</button>'
          + '</div></div>';
      }).join('');
    } else {
      html += '<div style="padding:14px 16px;color:var(--warm-gray);font-size:.85rem;">No new contacts awaiting follow-up.</div>';
    }
    html += '</div></div>';
  }

  // ── Visitor Review Batch (DC1) — editors+, off by default ─────────────
  if (canEditRole && prefs.reviewQueue) {
    var rq       = d.reviewQueue || [];
    var rqTotal  = d.reviewQueueTotal || 0;
    html += '<div class="dash-section-hdr">'
      + '<span>Visitor Review Batch</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">'
      + (rqTotal ? rqTotal + ' pending review' : 'all reviewed') + '</span></div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">';
    if (rq.length) {
      html += rq.map(function(p) {
        var name = ((p.first_name||'') + ' ' + (p.last_name||'')).trim() || '(no name)';
        var mt   = esc(p.member_type || '');
        var sinceAdd = p.created_at ? Math.floor((Date.now() - new Date(p.created_at)) / 86400000 / 30) : 0;
        var meta = [];
        meta.push(mt);
        if (sinceAdd >= 1) meta.push('added ' + sinceAdd + ' mo ago');
        if (p.last_gift_date) meta.push('last gift ' + p.last_gift_date);
        else meta.push('no giving');
        if (p.last_seen_date) meta.push('last seen ' + p.last_seen_date);
        if (p.last_reviewed_at) meta.push('reviewed ' + p.last_reviewed_at);
        else meta.push('never reviewed');
        return '<div class="dash-row-item" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--linen);" id="rq-row-'+p.id+'">'
          + '<div style="flex:1;min-width:0;">'
          +   '<div style="font-weight:600;color:var(--steel-anchor);cursor:pointer;" onclick="openPersonDetail('+p.id+')">' + esc(name) + '</div>'
          +   '<div style="font-size:.75rem;color:var(--warm-gray);">' + meta.map(esc).join(' · ') + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:4px;flex-shrink:0;">'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="reviewMark('+p.id+')" title="Mark as reviewed — keep as is">Reviewed</button>'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="reviewArchive('+p.id+',\''+esc(name).replace(/\\\'/g,"\\\\'")+'\')" title="Archive this record">Archive</button>'
          +   '<button class="btn-sm" style="padding:3px 8px;font-size:.72rem;background:var(--linen);border:1px solid var(--border);border-radius:6px;cursor:pointer;" onclick="openPersonDetail('+p.id+')" title="Open profile">Open</button>'
          + '</div></div>';
      }).join('');
    } else {
      html += '<div style="padding:14px 16px;color:var(--warm-gray);font-size:.85rem;">Nothing to review this week. &#127881;</div>';
    }
    html += '</div></div>';
  }

  // ── First-time givers — finance+ only ─────────────────────────
  var firstGivers = isFinanceRole ? (d.firstGivers || []) : [];
  if (prefs.firstGivers && firstGivers.length) {
    html += '<div class="dash-section-hdr"><span>First-Time Givers</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">last 60 days</span></div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">'
      + firstGivers.map(function(p) {
          var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
          var bg = pvColors[p.id % pvColors.length];
          var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
          return '<div class="dash-row-item" id="fg-row-'+p.id+'" style="cursor:pointer;" onclick="openPersonDetail('+p.id+')">'
            + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
            + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div>'
            + '<div class="dash-item-sub">First gift '+esc(p.first_gift_date||'')+'</div></div>'
            + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;margin-right:4px;" onclick="event.stopPropagation();addFollowUpForPerson('+p.id+',\''+esc(name)+'\',\'first_gift\')">Follow up</button>'
            + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="event.stopPropagation();dismissFirstGift('+p.id+')" title="Dismiss from this card">&#10005;</button>'
            + '</div>';
        }).join('')
      + '</div></div>';
  }

  // ── Not seen recently ──────────────────────────────────────────
  var notSeen = d.notSeenRecently || [];
  if (prefs.notSeen && notSeen.length) {
    html += '<div class="dash-section-hdr"><span>Not Seen Recently</span>'
      + '<span style="font-size:12px;color:var(--warm-gray);font-weight:400;">>8 weeks since last visit</span></div>';
    html += '<div class="dash-card" style="padding:0;"><div class="dash-card-body">'
      + notSeen.map(function(p) {
          var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
          var bg = pvColors[p.id % pvColors.length];
          var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
          return '<div class="dash-row-item" style="cursor:pointer;" onclick="openPersonDetail('+p.id+')">'
            + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
            + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div>'
            + '<div class="dash-item-sub">Last seen: '+esc(p.last_seen_date||'unknown')+'</div></div>'
            + '<button class="btn-secondary" style="font-size:.72rem;padding:3px 8px;" onclick="event.stopPropagation();addFollowUpForPerson('+p.id+',\''+esc(name)+'\',\'not_seen\')">Call</button>'
            + '</div>';
        }).join('')
      + '</div></div>';
  }

  // ── Bottom row: birthdays + anniversaries + membership ─────────
  html += '<div class="dash-row">';

  var mnArr = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var mnShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var curMonth = d.dashMonth || _dashMonth;
  var navBtn = 'background:none;border:1px solid var(--border);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:14px;color:var(--charcoal);';
  var bdList = d.birthdays || [], annList = d.anniversaries || [];

  // ── Birthdays card ─────────────────────────────────────────────
  if (prefs.birthdays) {
    html += '<div class="dash-card">'
      + '<div class="dash-card-hdr" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">'
      + '<span>Birthdays</span>'
      + '<div style="display:flex;align-items:center;gap:4px;">'
      + '<button style="'+navBtn+'" onclick="dashMonthNav(-1)" title="Previous month">&#8249;</button>'
      + '<span style="font-size:12px;font-weight:600;min-width:66px;text-align:center;">'+mnArr[curMonth-1]+'</span>'
      + '<button style="'+navBtn+'" onclick="dashMonthNav(1)" title="Next month">&#8250;</button>'
      + '<button id="dash-copy-bd-btn" style="'+navBtn+'margin-left:2px;" onclick="dashCopyBirthdays()" title="Copy for bulletin">&#128203;</button>'
      + '</div></div>'
      + '<div class="dash-card-body">';
    if (!bdList.length) {
      html += '<div style="padding:16px 18px;color:var(--faint);font-size:13px;font-style:italic;">No birthdays in '+mnArr[curMonth-1]+'.</div>';
    } else {
      html += bdList.map(function(p) {
        var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
        var ini = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
        var bg = pvColors[p.id % pvColors.length];
        var parts = (p.dob||'').split('-');
        var dateStr = parts.length >= 3 ? mnShort[parseInt(parts[1])-1]+' '+parseInt(parts[2]) : p.dob;
        return '<div class="dash-bday" onclick="openPersonDetail('+p.id+')" style="cursor:pointer;">'
          + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
          + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div></div>'
          + '<div style="font-size:12px;color:var(--warm-gray);">'+dateStr+'</div>'
          + '</div>';
      }).join('');
    }
    html += '</div></div>';
  }

  // ── Anniversaries card ─────────────────────────────────────────
  if (prefs.anniversaries) {
    html += '<div class="dash-card">'
      + '<div class="dash-card-hdr" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">'
      + '<span>Anniversaries</span>'
      + '<div style="display:flex;align-items:center;gap:4px;">'
      + '<span style="font-size:12px;font-weight:400;color:var(--warm-gray);">'+mnArr[curMonth-1]+'</span>'
      + '<button id="dash-copy-ann-btn" style="'+navBtn+'margin-left:2px;" onclick="dashCopyAnniversaries()" title="Copy for bulletin">&#128203;</button>'
      + '</div></div>'
      + '<div class="dash-card-body">';
    if (!annList.length) {
      html += '<div style="padding:16px 18px;color:var(--faint);font-size:13px;font-style:italic;">No anniversaries in '+mnArr[curMonth-1]+'.</div>';
    } else {
      html += annList.map(function(p) {
        var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
        var ini = (p.first_name||'').split(' ').map(function(n){return n.charAt(0);}).join('').slice(0,2).toUpperCase() || (p.last_name||'').charAt(0).toUpperCase();
        var bg = pvColors[p.id % pvColors.length];
        var parts = (p.anniversary_date||'').split('-');
        var dateStr = parts.length >= 3 ? mnShort[parseInt(parts[1])-1]+' '+parseInt(parts[2]) : p.anniversary_date;
        return '<div class="dash-bday" onclick="openPersonDetail('+p.id+')" style="cursor:pointer;">'
          + '<div class="dash-avatar" style="background:'+bg+';">'+ini+'</div>'
          + '<div style="flex:1;"><div class="dash-item-name">'+esc(name)+'</div></div>'
          + '<div style="font-size:12px;color:var(--warm-gray);">'+dateStr+'</div>'
          + '</div>';
      }).join('');
    }
    html += '</div></div>';
  }

  // Membership breakdown
  if (prefs.membership) html += '<div class="dash-card"><div class="dash-card-hdr">'
    + '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:var(--teal);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'
    + 'Membership by Type</div>'
    + '<div class="dash-type-bar">'
    + (d.typeCounts||[]).map(function(r) {
        var pct = Math.round((r.n / Math.max(maxType,1)) * 100);
        var lbl = r.member_type ? (r.member_type.charAt(0).toUpperCase()+r.member_type.slice(1)) : 'Unknown';
        return '<div class="dash-bar-row">'
          + '<div class="dash-bar-lbl" onclick="setFdMt(\''+r.member_type+'\');showTab(\'people\')" style="cursor:pointer;color:var(--sky-steel);" title="View '+lbl+' people">'+esc(lbl)+'</div>'
          + '<div class="dash-bar-track"><div class="dash-bar-fill" style="width:'+pct+'%;"></div></div>'
          + '<div class="dash-bar-n">'+r.n+'</div>'
          + '</div>';
      }).join('')
    + '</div></div>';

  html += '</div>'; // /dash-row
  body.innerHTML = html;
}
// ── Follow-up helpers ──────────────────────────────────────────────────
function completeFollowUp(id) {
  api('/admin/api/followup/'+id, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({completed:true}) })
    .then(function() {
      var el = document.getElementById('fu-'+id);
      if (el) { el.style.opacity='0.4'; el.style.textDecoration='line-through'; setTimeout(function(){el.remove();},600); }
    });
}
function addFollowUpForPerson(pid, name, type) {
  api('/admin/api/followup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({person_id:pid, type:type, notes:''}) })
    .then(function() {
      showErrorBanner('\u2713 Follow-up added for '+esc(name)+'.'); // reuse banner in success mode
      loadDashboard();
    });
}
function openAddFollowUp(pid, name, type) {
  var modal = document.getElementById('followup-modal');
  if (!modal) return;
  document.getElementById('fu-modal-pid').value = pid || '';
  document.getElementById('fu-modal-name').value = name || '';
  document.getElementById('fu-modal-type').value = type || 'general';
  document.getElementById('fu-modal-notes').value = '';
  openModal('followup-modal');
}
function markSeenToday(personId) {
  var today = new Date().toISOString().slice(0,10);
  api('/admin/api/people/'+personId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(Object.assign({}, _currentPvPerson, {last_seen_date: today}))
  }).then(function(r) {
    if (r && r.ok) {
      var el = document.getElementById('pv-last-seen');
      if (el) el.textContent = today;
      if (_currentPvPerson) _currentPvPerson.last_seen_date = today;
    }
  });
}
function saveFollowUpModal() {
  var btn = document.querySelector('#followup-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  var pid = document.getElementById('fu-modal-pid').value;
  var nameSearch = document.getElementById('fu-modal-name').value.trim();
  var type = document.getElementById('fu-modal-type').value;
  var notes = document.getElementById('fu-modal-notes').value.trim();
  function reEnable() { if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
  // If name was typed, search for person first
  if (nameSearch && !pid) {
    api('/admin/api/people?q='+encodeURIComponent(nameSearch)+'&limit=1').then(function(d) {
      var p = d.people && d.people[0];
      saveFollowUpItem(p ? p.id : null, type, notes, reEnable);
    }).catch(reEnable);
  } else {
    saveFollowUpItem(pid ? parseInt(pid) : null, type, notes, reEnable);
  }
}
function saveFollowUpItem(pid, type, notes, onErr) {
  api('/admin/api/followup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({person_id:pid||null,type:type,notes:notes}) })
    .then(function() { closeModal('followup-modal'); loadDashboard(); })
    .catch(function() { if (onErr) onErr(); });
}
function fmtServiceTime(t) {
  if (!t) return '';
  var parts = String(t).split(':');
  var h = parseInt(parts[0], 10);
  var m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) return '';
  var suffix = h >= 12 ? 'PM' : 'AM';
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return m ? h12 + ':' + String(m).padStart(2,'0') + ' ' + suffix : h12 + ' ' + suffix;
}
function dashStatServices(svcs) {
  if (!svcs.length) return dashStat('\u2014', 'Last Service', 'No attendance yet');
  var total = svcs.reduce(function(s,x){return s+(x.attendance||0);},0);
  var date = svcs[0].service_date || '';
  var ordered = svcs.slice().sort(function(a,b){ return String(a.service_time||'').localeCompare(String(b.service_time||'')); });
  var lines = ordered.map(function(s){
    var label = fmtServiceTime(s.service_time) || s.service_name || 'Service';
    return '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--warm-gray);margin-top:3px;">'
      +'<span>'+esc(label)+'</span>'
      +'<span style="font-weight:600;">'+s.attendance+'</span>'
      +'</div>';
  }).join('');
  return '<div class="dash-stat">'
    +'<div class="dash-stat-val">'+total+'</div>'
    +'<div class="dash-stat-lbl">Last Sunday</div>'
    +'<div class="dash-stat-sub">'+esc(date)+'</div>'
    +lines
    +'</div>';
}
function dashStat(val, lbl, sub, sub2) {
  return '<div class="dash-stat">'
    + '<div class="dash-stat-val">'+esc(String(val))+'</div>'
    + '<div class="dash-stat-lbl">'+esc(lbl)+'</div>'
    + (sub ? '<div class="dash-stat-sub">'+esc(sub)+'</div>' : '')
    + (sub2 ? '<div class="dash-stat-sub">'+esc(sub2)+'</div>' : '')
    + '</div>';
}
function dashQBtn(svgPath, label, onclick) {
  return '<button class="dash-quick-btn" onclick="'+onclick+'">'
    + '<svg viewBox="0 0 24 24">'+svgPath+'</svg>'
    + esc(label)+'</button>';
}
function fmt$(cents) {
  if (!cents) return '0';
  return (cents/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0});
}

`;
