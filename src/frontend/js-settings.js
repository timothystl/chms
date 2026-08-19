export const JS_SETTINGS = String.raw`// ── MEMBER TYPES (admin editor) ───────────────────────────────────────
// _memberTypes / loadMemberTypes() / refreshMemberTypeSelect() used to live here, but they are
// not settings code: they are boot state every role needs (the People filter chips and the
// person-edit form both read _memberTypes, and loadMemberTypes runs unconditionally in the
// window 'load' handler). They now live in js-core.js so the member-only bundle — which ships
// core+people+households and NOT this module — still has them. See html-chms.js.
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

// ── ROLE PERMISSIONS ─────────────────────────────────────────────────
// Admin editor for the granular per-feature access matrix. Each (role, item) cell is a
// tri-state level: No access / View only / Edit. See api-utils.js for the server-side
// defaults/resolution/enforcement and applyPermissionUI() in js-core.js for how the
// resolved levels drive tab visibility + edit affordances for whoever is logged in.
// Read-only items (Audit Log, Reports tab) offer only No access / View only.
// Member is the filtered directory view — it can never edit, and only the safe items
// (Reports tab) are toggleable; everything else is fixed at No access.
var ROLE_PERM_ITEMS = [
  { key: 'giving',     label: 'Giving',            editable: true  },
  { key: 'tuitionaid', label: 'Tuition Aid',       editable: true  },
  { key: 'finance',    label: 'Finance Overview',  editable: true  },
  { key: 'attendance', label: 'Attendance',        editable: true  },
  { key: 'followups',  label: 'Follow-ups',        editable: true  },
  { key: 'audit',      label: 'Audit Log',         editable: false },
  { key: 'register',   label: 'Register',          editable: true  },
  { key: 'reports',    label: 'Reports tab',       editable: false },
];
var ROLE_PERM_ROLES = ['finance', 'staff', 'council', 'member'];
// Items a member is even allowed to be granted (view only). Anything else is locked to none.
var MEMBER_ALLOWED_ITEMS = { reports: true };
function loadRolePermissions() {
  api('/admin/api/config/role-permissions').then(function(d) {
    renderRolePermTable(d && d.permissions);
  }).catch(function() {});
}
// 'anon' sits between No access and View, and only on Giving: aggregate figures with no
// donor named. Members are never offered it — they get no giving access at all — and it is
// meaningless on every other item, where the server normalizes it back down to 'none'.
var ANON_CAPABLE_ITEMS = { giving: true };
function rolePermLevelOptions(item, role, current) {
  var isMember = (role === 'member');
  var locked = isMember && !MEMBER_ALLOWED_ITEMS[item.key]; // member, non-safe item
  var opts = [{ v: 'none', t: 'No access' }];
  if (ANON_CAPABLE_ITEMS[item.key] && !isMember) opts.push({ v: 'anon', t: 'Totals only (no names)' });
  opts.push({ v: 'view', t: 'View only' });
  // Edit is offered only for editable items and never for members.
  if (item.editable && !isMember) opts.push({ v: 'edit', t: 'Edit' });
  var sel = current || 'none';
  if (locked) sel = 'none';
  var html = '<select id="rp-' + role + '-' + item.key + '"'
    + (locked ? ' disabled title="Members are read-only for this area"' : '')
    + ' style="font-size:.82rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">';
  html += opts.map(function(o) {
    return '<option value="' + o.v + '"' + (o.v === sel ? ' selected' : '') + '>' + o.t + '</option>';
  }).join('');
  html += '</select>';
  return html;
}
function renderRolePermTable(perms) {
  var tbody = document.getElementById('role-perm-tbody');
  if (!tbody || !perms) return;
  tbody.innerHTML = ROLE_PERM_ITEMS.map(function(item) {
    return '<tr style="border-bottom:1px solid var(--linen);">'
      + '<td style="padding:8px;">' + esc(item.label) + '</td>'
      + ROLE_PERM_ROLES.map(function(role) {
        var cur = (perms[role] && perms[role][item.key]) || 'none';
        return '<td style="padding:8px;text-align:center;">' + rolePermLevelOptions(item, role, cur) + '</td>';
      }).join('')
      + '</tr>';
  }).join('');
}
function saveRolePermissions() {
  var permissions = {};
  ROLE_PERM_ROLES.forEach(function(role) {
    permissions[role] = {};
    ROLE_PERM_ITEMS.forEach(function(item) {
      var sel = document.getElementById('rp-' + role + '-' + item.key);
      permissions[role][item.key] = (sel && sel.value) || 'none';
    });
  });
  api('/admin/api/config/role-permissions', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ permissions: permissions }) }).then(function(d) {
    if (d && d.ok) {
      setStatus('role-perm-status', 'Saved! Users with an active session will see the change on their next page load.', 'ok');
      setTimeout(function(){ setStatus('role-perm-status',''); }, 4000);
    } else {
      setStatus('role-perm-status', 'Error: ' + ((d && d.error) || 'unknown'), 'err');
    }
  }).catch(function() {
    setStatus('role-perm-status', 'Network error. Please try again.', 'err');
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
  var roleColors = { admin:'#0A3C5C', finance:'#1B4332', staff:'#1E40AF', council:'#8A5A00', member:'#4A1D6B' };
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
    + ['admin','finance','staff','council','member'].map(function(r){return '<option value="'+r+'"'+(u&&u.role===r?' selected':'')+'>'+r.charAt(0).toUpperCase()+r.slice(1)+'</option>';}).join('')
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
  if (_userRole === 'admin') { loadUsers(); loadRolePermissions(); }
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
  api('/admin/api/config/church').then(function(d) {
    _churchConfig = d || {};
    var el = document.getElementById('st-vol-address'); if (el) el.value = d.volunteer_address || '';
    el = document.getElementById('st-vol-email'); if (el) el.value = d.volunteer_public_email || '';
    el = document.getElementById('st-vol-phone'); if (el) el.value = d.volunteer_phone || '';
    el = document.getElementById('st-notify-new-signup'); if (el) el.checked = d.notify_new_signup === '1';
    el = document.getElementById('st-notify-weekly-digest'); if (el) el.checked = d.notify_weekly_digest === '1';
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
  // TinyMCE only writes its current content back into the underlying <textarea> on an
  // explicit save() call (or native form submit, which this SPA doesn't use) — sync both
  // letter editors first so the .value reads below see what's actually in the editor.
  syncLetterEditors();
  // Only include non-empty values — the API will skip saving empty strings,
  // preserving whatever was previously stored.
  var data = {};
  var v;
  v = (document.getElementById('st-church-name') || {}).value; if (v) data.church_name = v;
  v = (document.getElementById('st-ein') || {}).value; if (v) data.church_ein = v;
  v = (document.getElementById('st-from-name') || {}).value; if (v) data.church_from_name = v;
  v = (document.getElementById('st-from-email') || {}).value; if (v) data.church_from_email = v;
  v = (document.getElementById('st-letter-tpl') || {}).value || DEFAULT_LETTER_TEMPLATE; if (v) data.giving_letter_template = v;
  v = (document.getElementById('st-midyear-letter-tpl') || {}).value || DEFAULT_MIDYEAR_LETTER_TEMPLATE; if (v) data.giving_midyear_letter_template = v;
  v = (document.getElementById('st-giving-url') || {}).value; if (v) data.online_giving_url = v;
  api('/admin/api/config/church', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(d) {
    if (d.ok) { _churchConfig = data; setStatus('giv-settings-status', 'Saved!', 'ok'); setTimeout(function(){setStatus('giv-settings-status','');}, 2500); }
    else setStatus('giv-settings-status', 'Error: ' + (d.error||'unknown'), 'err');
  });
}
// Populates the Giving tab's Settings sub-view (Church Info + both letter templates) — moved
// out of the main Settings tab so giving-related config lives right where it's used, no more
// switching tabs to edit the letterhead/templates while sending statements. Called from
// givSetView('settings') (js-giving.js), not from loadSettings(), since this DOM now lives
// under #tab-giving instead of #tab-settings.
function loadGivingSettings() {
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
    initLetterEditor('st-letter-tpl', 'year_end', d.giving_letter_template || DEFAULT_LETTER_TEMPLATE);
    initLetterEditor('st-midyear-letter-tpl', 'midyear', d.giving_midyear_letter_template || DEFAULT_MIDYEAR_LETTER_TEMPLATE);
    el = document.getElementById('st-giving-url');
    if (el) el.value = d.online_giving_url || '';
    renderLetterheadLogoState(d.letterhead_logo_ext);
    document.querySelectorAll('[onclick="saveSettings()"]').forEach(function(b) { b.disabled = false; });
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
function renderLetterheadLogoState(ext) {
  var img = document.getElementById('st-logo-preview');
  var rmBtn = document.getElementById('st-logo-remove-btn');
  if (ext) {
    if (img) { img.src = '/admin/letterhead-logo?t=' + Date.now(); img.style.display = 'inline-block'; }
    if (rmBtn) rmBtn.style.display = 'inline-flex';
  } else {
    if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
    if (rmBtn) rmBtn.style.display = 'none';
  }
  _churchConfig.letterhead_logo_ext = ext || '';
}
var LOGO_WARN_BYTES = 300 * 1024; // 300 KB — mirrors the server-side soft threshold (api-import.js)
function uploadLetterheadLogo(file) {
  if (!file) return;
  var status = document.getElementById('st-logo-status');
  // Instant client-side feedback before the upload even starts — the server re-checks and
  // returns its own warning too (in case this ever gets bypassed), but there's no reason to
  // make the admin wait on a round-trip just to learn the file is too big for a small logo.
  if (file.size > LOGO_WARN_BYTES && status) {
    status.textContent = 'Heads up: this image is ' + (file.size / 1024 / 1024).toFixed(1) + ' MB — large for a small logo. Uploading anyway…';
    status.className = 'import-status warn';
  } else if (status) {
    status.textContent = 'Uploading…'; status.className = 'import-status';
  }
  var fd = new FormData();
  fd.append('logo', file, file.name || 'logo');
  api('/admin/api/config/letterhead-logo', { method: 'POST', body: fd, credentials: 'same-origin' }).then(function(d) {
    if (d && d.ok) {
      renderLetterheadLogoState(d.ext);
      if (status) {
        if (d.warning) {
          status.textContent = 'Uploaded — ' + d.warning;
          status.className = 'import-status warn';
        } else {
          status.textContent = 'Uploaded!'; status.className = 'import-status ok';
          setTimeout(function(){status.textContent='';}, 2500);
        }
      }
    } else {
      if (status) { status.textContent = 'Error: ' + ((d && d.error) || 'unknown'); status.className = 'import-status err'; }
    }
  }).catch(function() {
    if (status) { status.textContent = 'Upload failed. Please try again.'; status.className = 'import-status err'; }
  });
}
function removeLetterheadLogo() {
  if (!confirm('Remove the letterhead logo? Giving letters will go back to showing the plain church name.')) return;
  api('/admin/api/config/letterhead-logo', { method: 'DELETE' }).then(function(d) {
    if (d && d.ok) renderLetterheadLogoState('');
    else alert('Error: ' + ((d && d.error) || 'unknown'));
  });
}
function resetLetterTemplate() {
  setLetterEditorContent('st-letter-tpl', DEFAULT_LETTER_TEMPLATE);
}
function resetMidyearLetterTemplate() {
  setLetterEditorContent('st-midyear-letter-tpl', DEFAULT_MIDYEAR_LETTER_TEMPLATE);
}
function setLetterEditorContent(id, value) {
  var editor = window.tinymce && tinymce.get(id);
  if (editor) editor.setContent(value); else { var el = document.getElementById(id); if (el) el.value = value; }
}

// ── TinyMCE letter template editors (self-hosted — see /admin/vendor/tinymce/ route) ──
// Merge tokens are inserted as atomic, non-editable "chip" spans (contenteditable="false")
// so a user can't partially select/format half of {{name}} and silently split the token
// across tags. renderLetterHTML() (js-reports.js) unwraps these chips back to plain
// {{token}} text before running its substitution regexes, so the stored template stays a
// plain-text mini-template — same format the pre-TinyMCE textarea produced — just with
// real HTML (bold/lists/images) around it instead of a flat string.
var MCE_FIELDS_YEAR_END = [
  {label:'Name', token:'{{name}}'}, {label:'Year', token:'{{year}}'}, {label:'Total', token:'{{total}}'},
  {label:'Date', token:'{{date}}'}, {label:'Gift Table', token:'{{gift_table}}'}, {label:'EIN / Tax ID', token:'{{ein}}'}
];
var MCE_FIELDS_MIDYEAR = [
  {label:'Name', token:'{{name}}'}, {label:'Year', token:'{{year}}'}, {label:'Total', token:'{{total}}'},
  {label:'Date', token:'{{date}}'}, {label:'Gift Table', token:'{{gift_table}}'}, {label:'Online Giving URL', token:'{{giving_url}}'}
];
function mceTokenChip(token) {
  return '<span contenteditable="false" data-mce-token="' + token + '" '
    + 'style="display:inline-block;background:#EDF5F8;color:var(--color-navy);border:1px solid #B8D4E3;'
    + 'border-radius:4px;padding:0 5px;margin:0 1px;font-family:monospace;font-size:.85em;white-space:nowrap;">'
    + token + '</span>';
}
function mceConditionalHtml(letterType) {
  if (letterType === 'midyear') {
    return mceTokenChip('{{#if_giving_url}}') + '- Online recurring giving: ' + mceTokenChip('{{giving_url}}') + '<br>' + mceTokenChip('{{/if_giving_url}}');
  }
  return mceTokenChip('{{#if_ein}}') + 'Our EIN/Tax ID is ' + mceTokenChip('{{ein}}') + '. No goods or services were provided in exchange for these contributions. Please retain this letter for your tax records.' + mceTokenChip('{{/if_ein}}');
}
var _tinyLoading = null;
function ensureTinyMCE(cb) {
  if (window.tinymce) { cb(); return; }
  if (_tinyLoading) { _tinyLoading.push(cb); return; }
  _tinyLoading = [cb];
  var s = document.createElement('script');
  s.src = '/admin/vendor/tinymce/tinymce.min.js?v=' + DEPLOY_VERSION;
  s.onload = function() {
    var cbs = _tinyLoading; _tinyLoading = null;
    cbs.forEach(function(fn) { fn(); });
  };
  document.head.appendChild(s);
}
function initLetterEditor(id, letterType, value) {
  var existing = window.tinymce && tinymce.get(id);
  if (existing) { existing.setContent(value || ''); return; }
  var ta = document.getElementById(id);
  if (ta) ta.value = value || ''; // shown briefly until TinyMCE finishes loading/initializing
  ensureTinyMCE(function() {
    if (tinymce.get(id)) { tinymce.get(id).setContent(value || ''); return; }
    var fields = letterType === 'midyear' ? MCE_FIELDS_MIDYEAR : MCE_FIELDS_YEAR_END;
    tinymce.init({
      selector: '#' + id,
      base_url: '/admin/vendor/tinymce',
      suffix: '.min',
      license_key: 'gpl',
      height: 320,
      menubar: false,
      branding: false,
      promotion: false,
      plugins: 'lists link image code',
      // This editor is self-hosted from a deliberately minimal vendored TinyMCE subset (see
      // vendor/tinymce/ — only the code/image/link/lists plugins are actually present, not
      // the full package). Every button below is either one of those four plugins or a
      // core-registered command that needs no plugin file at all (confirmed present in the
      // vendored tinymce.min.js: forecolor, fontsize, blockquote) — deliberately NOT adding
      // table/charmap/searchreplace/etc., since those plugin files don't exist here and
      // requesting them would 404 and leave a broken button instead of a missing one.
      toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough subscript superscript | forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist indent outdent | blockquote removeformat | link image | mergefield | code',
      content_css: false,
      // 600px matches the actual printed/emailed letter's max-width (showGivingLetter's
      // wrapping div in js-reports.js) — constraining the editable body to the same width,
      // centered on a gray canvas with a page-like shadow, makes the real line-wrap and
      // margins visible while typing instead of only showing up once you print/preview.
      content_style: 'html{background:#e2e0da;}'
        + 'body{max-width:600px;margin:0 auto;background:#fff;font-family:Georgia,serif;font-size:14px;line-height:1.65;color:#222;padding:28px 32px;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 2px 10px rgba(0,0,0,.1);min-height:calc(100% - 40px);}'
        + '.mce-content-body span[data-mce-token]{user-select:all;}',
      // No upload endpoint — images (church logo, four-values graphic, etc.) are embedded as
      // base64 data: URIs directly in the stored template, same as drag-drop/paste already
      // does by default with no images_upload_handler configured. img-src already allows
      // data: under the existing CSP, so this needs no server changes and no new upload route.
      file_picker_types: 'image',
      file_picker_callback: function(callback, value, meta) {
        if (meta.filetype !== 'image') return;
        var input = document.createElement('input');
        input.type = 'file'; input.accept = 'image/*';
        input.onchange = function() {
          var file = input.files[0];
          if (!file) return;
          // No upload endpoint — the whole file becomes a base64 text blob embedded directly
          // in the saved template (see the comment above). A full-size photo easily produces
          // a template well past what a single D1 column value / request can hold, which
          // used to fail Save with a generic "Internal server error" and no indication why.
          // Cap the raw file here so the failure (if any) is an immediate, specific message
          // instead of a round-trip to the server.
          if (file.size > 400 * 1024) {
            alert('That image is too large (' + Math.round(file.size / 1024) + ' KB — max 400 KB). Please use a smaller image or compress it first; letter templates are limited in size since the image gets embedded directly in the saved letter and every email sent from it.');
            input.value = '';
            return;
          }
          var reader = new FileReader();
          reader.onload = function() { callback(reader.result, { alt: file.name }); };
          reader.readAsDataURL(file);
        };
        input.click();
      },
      setup: function(editor) {
        editor.ui.registry.addMenuButton('mergefield', {
          text: 'Insert Merge Field',
          fetch: function(callback) {
            var items = fields.map(function(f) {
              return { type: 'menuitem', text: f.label, onAction: function() { editor.insertContent(mceTokenChip(f.token)); } };
            });
            items.push({ type: 'menuitem', text: (letterType === 'midyear' ? 'Conditional: If Giving URL set' : 'Conditional: If EIN set'), onAction: function() { editor.insertContent(mceConditionalHtml(letterType)); } });
            callback(items);
          }
        });
        editor.on('init', function() { editor.setContent(value || ''); });
        editor.on('change input undo redo SetContent', function() {
          editor.save();
          liveUpdateLetterPreview(letterType);
        });
      }
    });
  });
}
function syncLetterEditors() {
  if (!window.tinymce) return;
  ['st-letter-tpl', 'st-midyear-letter-tpl'].forEach(function(id) {
    var editor = tinymce.get(id);
    if (editor) editor.save();
  });
}
function renderLetterPreview(letterType) {
  var tplId = letterType === 'midyear' ? 'st-midyear-letter-tpl' : 'st-letter-tpl';
  var cfgKey = letterType === 'midyear' ? 'giving_midyear_letter_template' : 'giving_letter_template';
  var editor = window.tinymce && tinymce.get(tplId);
  if (editor) editor.save();
  var tplVal = (document.getElementById(tplId) || {}).value
    || (letterType === 'midyear' ? DEFAULT_MIDYEAR_LETTER_TEMPLATE : DEFAULT_LETTER_TEMPLATE);
  var cfg = Object.assign({}, _churchConfig);
  cfg[cfgKey] = tplVal;
  var sampleGifts = [
    { gift_date: '2026-01-12', fund_name: 'General Fund', amount: 25000, method: 'Check' },
    { gift_date: '2026-03-08', fund_name: 'Building Fund', amount: 10000, method: 'Online' },
    { gift_date: '2026-05-24', fund_name: 'General Fund', amount: 25000, method: 'Check' }
  ];
  var sampleData = {
    _mode: 'person',
    person: { first_name: 'Jane', last_name: 'Sample' },
    year: new Date().getFullYear(),
    total_cents: sampleGifts.reduce(function(s,g){ return s + g.amount; }, 0),
    entries: sampleGifts
  };
  var letterHtml = renderLetterHTML(sampleData, letterType, cfg);
  var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
  var title = document.getElementById('letter-preview-title');
  if (title) title.textContent = (letterType === 'midyear' ? 'Mid-Year Giving Update' : 'Year-End Giving Statement') + ' Letter Preview';
  var body = document.getElementById('letter-preview-body');
  if (body) {
    body.innerHTML = letterheadImgHtml(false, churchName, 'font-family:var(--font-head);font-size:1.05rem;color:var(--steel-anchor);')
      + '<hr style="margin:10px 0;">' + letterHtml;
  }
}
function previewLetterTemplate(letterType) {
  var modal = document.getElementById('letter-preview-modal');
  if (modal) modal.dataset.previewType = letterType;
  renderLetterPreview(letterType);
  openModal('letter-preview-modal');
}
function liveUpdateLetterPreview(letterType) {
  var modal = document.getElementById('letter-preview-modal');
  if (!modal || !modal.classList.contains('open') || modal.dataset.previewType !== letterType) return;
  renderLetterPreview(letterType);
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
