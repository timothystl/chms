export const JS_SETTINGS = String.raw`// ── MEMBER TYPES ──────────────────────────────────────────────────────
var _memberTypes = ['Member','Attender','Visitor','Vietnamese Congregation','Other'];
function loadMemberTypes() {
  api('/admin/api/config/member-types').then(function(d) {
    _memberTypes = d.types || _memberTypes;
    refreshMemberTypeSelect();
  });
}
function refreshMemberTypeSelect() {
  var sel = document.getElementById('pm-type');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = _memberTypes.map(function(t) {
    var v = t.toLowerCase().replace(/\s+/g,'-');
    return '<option value="' + v + '"' + (v===cur?' selected':'') + '>' + esc(t) + '</option>';
  }).join('');
  updatePersonNameMode();
}
function renderMemberTypesList() {
  document.getElementById('member-types-list').innerHTML = _memberTypes.map(function(t, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linen);">'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t) + '</span>'
      + '<button onclick="deleteMemberType(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>'
      + '</div>';
  }).join('');
}
function addMemberType() {
  var name = document.getElementById('new-type-name').value.trim();
  if (!name) return;
  if (_memberTypes.some(function(t){return t.toLowerCase()===name.toLowerCase();})) {
    alert('That type already exists.'); return;
  }
  _memberTypes = _memberTypes.concat([name]);
  document.getElementById('new-type-name').value = '';
  saveMemberTypes();
}
function deleteMemberType(idx) {
  if (_memberTypes.length <= 1) { alert('Must have at least one member type.'); return; }
  _memberTypes = _memberTypes.filter(function(_,i){return i!==idx;});
  saveMemberTypes();
}
function saveMemberTypes() {
  api('/admin/api/config/member-types', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({types:_memberTypes})}).then(function() {
    refreshMemberTypeSelect();
    renderMemberTypesList();
  });
}

// ── USERS MANAGEMENT ──────────────────────────────────────────────────
var _usersData = [];
var _editingUserId = null;
function loadUsers() {
  api('/admin/api/users').then(function(d) {
    _usersData = d.users || [];
    renderUsersList();
  }).catch(function() {});
}
function renderUsersList() {
  var el = document.getElementById('st-users-list');
  if (!el) return;
  if (!_usersData.length) {
    el.innerHTML = '<p style="font-size:.85rem;color:var(--warm-gray);">No user accounts yet. Add one below.</p>';
    return;
  }
  var roleColors = { admin:'#0A3C5C', finance:'#1B4332', staff:'#1E40AF', office:'#8A5A00', member:'#4A1D6B' };
  el.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:.87rem;">'
    + '<thead><tr style="border-bottom:1px solid var(--border);">'
    + '<th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Username</th>'
    + '<th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Display Name</th>'
    + '<th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Email</th>'
    + '<th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Role</th>'
    + '<th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Status</th>'
    + '<th style="padding:6px 8px;"></th>'
    + '</tr></thead><tbody>'
    + _usersData.map(function(u) {
        var rc = roleColors[u.role] || '#666';
        var statusBadge = u.active
          ? '<span style="font-size:.7rem;padding:2px 7px;border-radius:99px;background:#D1FAE5;color:#065F46;font-weight:700;">Active</span>'
          : '<span style="font-size:.7rem;padding:2px 7px;border-radius:99px;background:var(--linen);color:var(--warm-gray);font-weight:700;">Inactive</span>';
        return '<tr style="border-bottom:1px solid var(--linen);">'
          + '<td style="padding:8px 8px;font-weight:600;">'+esc(u.username)+'</td>'
          + '<td style="padding:8px 8px;color:var(--warm-gray);">'+esc(u.display_name||'—')+'</td>'
          + '<td style="padding:8px 8px;color:var(--warm-gray);font-size:.82rem;">'+esc(u.email||'—')+'</td>'
          + '<td style="padding:8px 8px;"><span style="font-size:.7rem;padding:2px 7px;border-radius:99px;background:'+rc+'18;color:'+rc+';font-weight:700;">'+esc(u.role)+'</span></td>'
          + '<td style="padding:8px 8px;">'+statusBadge+'</td>'
          + '<td style="padding:8px 8px;text-align:right;white-space:nowrap;">'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 8px;" onclick="openUserForm('+u.id+')">Edit</button>'
          + ' <button class="btn-danger" style="font-size:.75rem;padding:3px 8px;" onclick="deleteUser('+u.id+')">Delete</button>'
          + '</td></tr>';
      }).join('')
    + '</tbody></table>';
}
function openUserForm(userId) {
  _editingUserId = userId;
  var u = userId ? (_usersData||[]).find(function(x){return x.id===userId;}) : null;
  var title = u ? 'Edit User: ' + u.username : 'Add User';
  document.getElementById('user-modal-title').textContent = title;
  document.getElementById('user-modal-save').textContent = u ? 'Save Changes' : 'Create User';
  var inp = 'width:100%;';
  document.getElementById('user-modal-body').innerHTML =
    (u ? '' : '<div class="field" style="margin-bottom:10px;"><label>Username</label><input type="text" id="um-username" placeholder="e.g. jsmith" autocomplete="off" style="'+inp+'"></div>')
    + '<div class="field" style="margin-bottom:10px;"><label>Display Name</label><input type="text" id="um-display" placeholder="e.g. Jane Smith" value="'+esc(u?u.display_name:'')+'" style="'+inp+'"></div>'
    + '<div class="field" style="margin-bottom:10px;"><label>Email <span style="color:var(--warm-gray);font-weight:400;">(for password reset)</span></label><input type="email" id="um-email" placeholder="e.g. jane@church.org" autocomplete="off" value="'+esc(u?(u.email||''):'')+'" style="'+inp+'"></div>'
    + '<div class="field" style="margin-bottom:10px;"><label>Role</label><select id="um-role" style="'+inp+'padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:.9rem;">'
    + ['admin','finance','staff','office','member'].map(function(r){return '<option value="'+r+'"'+(u&&u.role===r?' selected':'')+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>';}).join('')
    + '</select></div>'
    + '<div class="field" style="margin-bottom:10px;"><label>'+(u?'New Password (leave blank to keep)':'Password')+'</label><input type="password" id="um-password" placeholder="At least 8 characters" autocomplete="new-password" style="'+inp+'"></div>'
    + (u ? '<div style="margin-bottom:12px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem;"><input type="checkbox" id="um-active"'+(u.active?' checked':'')+'>Active</label></div>' : '');
  openModal('user-modal');
}
function saveUser() {
  var display  = (document.getElementById('um-display')||{}).value || '';
  var email    = ((document.getElementById('um-email')||{}).value || '').trim();
  var role     = (document.getElementById('um-role')||{}).value || 'staff';
  var pass     = (document.getElementById('um-password')||{}).value || '';
  var activeEl = document.getElementById('um-active');
  var payload  = { display_name: display, email: email, role: role };
  if (pass) payload.password = pass;
  if (activeEl) payload.active = activeEl.checked;
  if (!_editingUserId) {
    var username = ((document.getElementById('um-username')||{}).value||'').trim();
    if (!username) { alert('Username is required.'); return; }
    payload.username = username;
    if (!pass || pass.length < 8) { alert('Password must be at least 8 characters.'); return; }
  }
  var url    = _editingUserId ? '/admin/api/users/'+_editingUserId : '/admin/api/users';
  var method = _editingUserId ? 'PUT' : 'POST';
  api(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) })
    .then(function(r) {
      if (r.ok) { closeModal('user-modal'); loadUsers(); }
      else alert('Error: '+(r.error||'unknown'));
    });
}
function deleteUser(uid) {
  var u = (_usersData||[]).find(function(x){return x.id===uid;});
  var username = u ? u.username : 'this user';
  if (!confirm('Delete user "'+username+'"? This cannot be undone.')) return;
  api('/admin/api/users/'+uid, {method:'DELETE'}).then(function(r){
    if (r.ok) loadUsers(); else alert('Error: '+(r.error||'unknown'));
  });
}

// ── SETTINGS ──────────────────────────────────────────────────────────
function loadSettings() {
  if (_userRole === 'admin') loadUsers();
  // Populate giving export year dropdown
  var yrSel = document.getElementById('export-giving-year');
  if (yrSel && yrSel.options.length <= 1) {
    var thisYear = new Date().getFullYear();
    for (var y = thisYear; y >= 2010; y--) {
      var opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      if (y === thisYear) opt.selected = true;
      yrSel.appendChild(opt);
    }
  }
  // Disable save buttons until data has loaded to prevent saving empty values
  document.querySelectorAll('[onclick="saveSettings()"]').forEach(function(b) { b.disabled = true; });
  api('/admin/api/config/church').then(function(d) {
    _churchConfig = d || {};
    var el = document.getElementById('st-church-name');
    if (el) el.value = d.church_name || 'Timothy Lutheran Church';
    el = document.getElementById('st-ein');
    if (el) el.value = d.church_ein || '';
    el = document.getElementById('st-from-name');
    if (el) el.value = d.church_from_name || '';
    el = document.getElementById('st-from-email');
    if (el) el.value = d.church_from_email || '';
    el = document.getElementById('st-letter-tpl');
    if (el) el.value = d.giving_letter_template || DEFAULT_LETTER_TEMPLATE;
    el = document.getElementById('st-vol-address'); if (el) el.value = d.volunteer_address || '';
    el = document.getElementById('st-vol-email'); if (el) el.value = d.volunteer_public_email || '';
    el = document.getElementById('st-vol-phone'); if (el) el.value = d.volunteer_phone || '';
    el = document.getElementById('st-notify-new-signup'); if (el) el.checked = d.notify_new_signup === '1';
    el = document.getElementById('st-notify-weekly-digest'); if (el) el.checked = d.notify_weekly_digest === '1';
    // Re-enable save buttons now that fields are populated
    document.querySelectorAll('[onclick="saveSettings()"]').forEach(function(b) { b.disabled = false; });
  });
  api('/admin/api/tags').then(function(d) {
    allTags = d.tags || [];
    renderTagPills();
    renderSettingsTagsList();
  });
  renderSettingsMemberTypesList();
  loadMemberTypeMap();
  // HQ4: load headless household count
  api('/admin/api/households/no-head-count').then(function(d) {
    var el = document.getElementById('hq4-status-text');
    if (el) el.textContent = (d.count || 0) + ' household' + (d.count === 1 ? '' : 's') + ' have no Head of Household assigned.';
  });
}
function saveSettings() {
  // Only include non-empty values — the API will skip saving empty strings,
  // preserving whatever was previously stored.
  var data = {};
  var v;
  v = (document.getElementById('st-church-name') || {}).value; if (v) data.church_name = v;
  v = (document.getElementById('st-ein') || {}).value; if (v) data.church_ein = v;
  v = (document.getElementById('st-from-name') || {}).value; if (v) data.church_from_name = v;
  v = (document.getElementById('st-from-email') || {}).value; if (v) data.church_from_email = v;
  v = (document.getElementById('st-letter-tpl') || {}).value || DEFAULT_LETTER_TEMPLATE; if (v) data.giving_letter_template = v;
  api('/admin/api/config/church', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(d) {
    if (d.ok) { _churchConfig = data; setStatus('st-status', 'Saved!', 'ok'); setTimeout(function(){setStatus('st-status','');}, 2500); }
    else setStatus('st-status', 'Error: ' + (d.error||'unknown'), 'err');
  });
}
function saveVolunteerSettings() {
  var data = {};
  var v;
  v = (document.getElementById('st-vol-address') || {}).value; if (v) data.volunteer_address = v;
  v = (document.getElementById('st-vol-email') || {}).value; if (v) data.volunteer_public_email = v;
  v = (document.getElementById('st-vol-phone') || {}).value; if (v) data.volunteer_phone = v;
  data.notify_new_signup = (document.getElementById('st-notify-new-signup') || {}).checked ? '1' : '0';
  data.notify_weekly_digest = (document.getElementById('st-notify-weekly-digest') || {}).checked ? '1' : '0';
  api('/admin/api/config/church', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(d) {
    if (d.ok) { setStatus('st-status', 'Saved!', 'ok'); setTimeout(function(){setStatus('st-status','');}, 2500); }
    else setStatus('st-status', 'Error: ' + (d.error||'unknown'), 'err');
  });
}
function resetLetterTemplate() {
  var el = document.getElementById('st-letter-tpl');
  if (el) el.value = DEFAULT_LETTER_TEMPLATE;
}
function renderSettingsTagsList() {
  var c = document.getElementById('settings-tags-list');
  if (!c) return;
  if (!allTags.length) { c.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;">No tags yet.</p>'; return; }
  c.innerHTML = allTags.map(function(t) {
    return '<div id="tag-row-' + t.id + '" style="border-bottom:1px solid var(--linen);">'
      + '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;">'
      + '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' + esc(t.color) + ';flex-shrink:0;cursor:pointer;" onclick="toggleTagEdit(' + t.id + ')"></span>'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t.name) + ' <span style="color:var(--warm-gray);font-size:.78rem;">(' + (t.person_count||0) + ' people)</span></span>'
      + '<button onclick="toggleTagEdit(' + t.id + ')" style="background:none;border:none;color:var(--sky-steel);cursor:pointer;font-size:.82rem;padding:2px 6px;">&#9998; Edit</button>'
      + '<button onclick="deleteTagSettings(' + t.id + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;padding:2px 6px;">&#10005;</button>'
      + '</div>'
      + '<div id="tag-edit-' + t.id + '" style="display:none;padding:8px 0 12px;display:none;">'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<input type="color" id="tag-color-' + t.id + '" value="' + esc(t.color) + '" style="width:36px;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;">'
      + '<input type="text" id="tag-name-' + t.id + '" value="' + esc(t.name) + '" style="flex:1;min-width:120px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;">'
      + '<button class="btn-primary" style="font-size:.82rem;padding:6px 12px;" onclick="saveTagEdit(' + t.id + ')">Save</button>'
      + '<button class="btn-secondary" style="font-size:.82rem;padding:6px 12px;" onclick="toggleTagEdit(' + t.id + ')">Cancel</button>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}
function toggleTagEdit(id) {
  var el = document.getElementById('tag-edit-' + id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
function saveTagEdit(id) {
  var name = (document.getElementById('tag-name-' + id) || {}).value || '';
  var color = (document.getElementById('tag-color-' + id) || {}).value || '#5C8FA8';
  name = name.trim();
  if (!name) { alert('Tag name is required.'); return; }
  api('/admin/api/tags/' + id, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name: name, color: color })
  }).then(function(r) {
    if (r.ok) { loadSettings(); loadTags(); }
    else alert('Error: ' + (r.error||'unknown'));
  });
}
function createTagSettings() {
  var name = (document.getElementById('st-new-tag-name') || {}).value || '';
  var color = (document.getElementById('st-new-tag-color') || {}).value || '#2E7EA6';
  name = name.trim();
  if (!name) return;
  api('/admin/api/tags', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,color:color})}).then(function() {
    document.getElementById('st-new-tag-name').value = '';
    loadSettings();
    loadTags();
  });
}
function deleteTagSettings(id) {
  if (!confirm('Delete this tag? It will be removed from all people.')) return;
  api('/admin/api/tags/' + id, {method:'DELETE'}).then(function() { loadSettings(); loadTags(); });
}
function renderSettingsMemberTypesList() {
  var c = document.getElementById('settings-member-types-list');
  if (!c) return;
  c.innerHTML = _memberTypes.map(function(t, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--linen);">'
      + '<span style="flex:1;font-size:.9rem;">' + esc(t) + '</span>'
      + '<button onclick="deleteMemberTypeSettings(' + i + ')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:.85rem;">&#10005;</button>'
      + '</div>';
  }).join('');
}
function addMemberTypeSettings() {
  var name = ((document.getElementById('st-new-type-name') || {}).value || '').trim();
  if (!name) return;
  if (_memberTypes.some(function(t){return t.toLowerCase()===name.toLowerCase();})) {
    alert('That type already exists.'); return;
  }
  _memberTypes = _memberTypes.concat([name]);
  document.getElementById('st-new-type-name').value = '';
  saveMemberTypes();
  renderSettingsMemberTypesList();
}
function deleteMemberTypeSettings(idx) {
  if (_memberTypes.length <= 1) { alert('Must have at least one member type.'); return; }
  _memberTypes = _memberTypes.filter(function(_,i){return i!==idx;});
  saveMemberTypes();
  renderSettingsMemberTypesList();
}

// ── BREEZE STATUS → MEMBER TYPE MAPPING ──────────────────────────────
var _mtMapData = {};
function loadMemberTypeMap() {
  var c = document.getElementById('settings-mt-map-list');
  var h = document.getElementById('settings-mt-map-hint');
  if (!c) return;
  c.innerHTML = '<span style="color:var(--warm-gray);font-size:.85rem;">Loading\u2026</span>';
  api('/admin/api/config/member-type-map').then(function(d) {
    _mtMapData = d.map || {};
    var seen = d.seen || [];
    if (!seen.length) {
      c.innerHTML = '<p style="color:var(--warm-gray);font-size:.85rem;margin:0;">No Breeze statuses recorded yet. Run a Breeze import first, then return here to map them.</p>';
      if (h) h.textContent = '';
      return;
    }
    if (h) h.textContent = seen.length + ' distinct status value' + (seen.length !== 1 ? 's' : '') + ' seen from Breeze.';
    c.innerHTML = seen.map(function(status) {
      var mapped = _mtMapData[status] || '';
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--linen);">'
        + '<span style="flex:1;font-size:.9rem;">'+esc(status)+'</span>'
        + '<svg viewBox="0 0 16 16" style="width:14px;height:14px;flex-shrink:0;fill:var(--warm-gray);"><path d="M8 1l7 7-7 7M1 8h14" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>'
        + '<select data-mt-status="'+esc(status)+'" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.85rem;min-width:160px;">'
        + '<option value="">— no mapping —</option>'
        + _memberTypes.map(function(t) { return '<option value="'+esc(t)+'"'+(mapped===t?' selected':'')+'>'+esc(t)+'</option>'; }).join('')
        + '</select>'
        + '</div>';
    }).join('');
  });
}
// Delegated (CSP-safe, injection-safe) change listener: a Breeze status value can contain
// arbitrary characters, including a literal double-quote that would break out of an inline
// onchange="..." attribute (data-mt-status is HTML-escaped and read back via .dataset, which
// the browser decodes for us, never re-parsed as code). Registered once at module load, not
// per-render, so it doesn't accumulate duplicate listeners across repeated Settings visits.
document.addEventListener('change', function(e) {
  var sel = e.target.closest('select[data-mt-status]');
  if (sel) markMtMapChange(sel.dataset.mtStatus, sel.value);
});
function markMtMapChange(status, localType) {
  _mtMapData[status] = localType;
  var statusEl = document.getElementById('mt-map-status');
  if (statusEl) statusEl.textContent = 'Unsaved changes';
}
function saveMtMap() {
  var btn = document.getElementById('mt-map-save-btn');
  var statusEl = document.getElementById('mt-map-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  api('/admin/api/config/member-type-map', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({map: _mtMapData})
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Mapping'; }
    if (statusEl) { statusEl.textContent = 'Saved!'; statusEl.style.color = 'var(--teal)'; setTimeout(function(){ statusEl.textContent = ''; statusEl.style.color = ''; }, 2500); }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Mapping'; }
    if (statusEl) { statusEl.textContent = 'Error — try again'; statusEl.style.color = 'var(--danger)'; }
  });
}

// ── PRINT DIRECTORY ──────────────────────────────────────────────────
function printDirectory() {
  window.open('/admin/api/directory?types=member', '_blank');
}

// ── PUSH BROADCAST ──────────────────────────────────────────────────
function openPushBroadcastModal() {
  document.getElementById('push-broadcast-title').value = '';
  document.getElementById('push-broadcast-body').value = '';
  document.getElementById('push-broadcast-result').textContent = '';
  openModal('push-broadcast-modal');
}
function sendPushBroadcast() {
  var title = document.getElementById('push-broadcast-title').value.trim();
  var body  = document.getElementById('push-broadcast-body').value.trim();
  if (!title) { alert('Title is required.'); return; }
  var btn = document.getElementById('push-broadcast-send-btn');
  var res = document.getElementById('push-broadcast-result');
  btn.disabled = true; btn.textContent = 'Sending…';
  res.textContent = '';
  api('/admin/api/push-broadcast', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ title: title, body: body })
  }).then(function(d) {
    btn.disabled = false; btn.textContent = 'Send Notification';
    if (d && d.error) {
      res.textContent = 'Error: ' + d.error;
      res.style.color = 'var(--danger)';
    } else {
      var msg = 'Sent: ' + (d.sent||0) + ' delivered, ' + (d.failed||0) + ' failed, ' + (d.skipped||0) + ' skipped.';
      res.textContent = msg;
      res.style.color = 'var(--teal)';
      if ((d.sent||0) > 0) setTimeout(function(){ closeModal('push-broadcast-modal'); }, 2000);
    }
  }).catch(function() {
    btn.disabled = false; btn.textContent = 'Send Notification';
    res.textContent = 'Connection error. Try again.';
    res.style.color = 'var(--danger)';
  });
}

`;
