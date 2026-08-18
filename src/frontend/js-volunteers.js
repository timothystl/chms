export const JS_VOLUNTEERS = String.raw`// ── VOLUNTEERS TAB ────────────────────────────────────────────────────
var _volCurrentTab = 'all';
var _volStatusFilter = 'all';
var _volDupVisible = false;
var _volTemplates = [];
var _volSignupsCache = [];

// ── Ministry labels ───────────────────────────────────────────────────
var VOL_MINISTRY_LABELS = {all:'All',worship:'Worship',events:'Events',education:'Education',
  acceptance:'Acceptance',outreach:'Outreach',transportation:'Transportation',general:'General'};
var VOL_STATUS_LABELS = {new:'New',contacted:'Contacted',confirmed:'Confirmed',declined:'Declined'};

// JSON.stringify wraps in double quotes, which breaks out of a double-quoted onclick="" attribute.
// HTML-entity-encoding those quotes lets the browser decode them back to real quotes when it
// reads the attribute value, without ever closing the attribute early.
function volJsAttr(v) {
  return JSON.stringify(v).replace(/"/g, '&quot;');
}

function volShowSection(section, btn) {
  ['signups', 'mroles', 'events', 'templates'].forEach(function(s) {
    var panel = document.getElementById('vol-panel-' + s);
    if (panel) panel.style.display = (s === section) ? '' : 'none';
  });
  document.querySelectorAll('#vol-subnav .vol-subtab-btn').forEach(function(b) {
    b.classList.toggle('active', b === btn);
  });
}

function volSetStatusFilter(status) {
  _volStatusFilter = status;
  volRenderSignupsList();
}

function volRenderStatusPills() {
  var pillsEl = document.getElementById('vol-status-pills');
  if (!pillsEl) return;
  var counts = { all: _volSignupsCache.length, new: 0, contacted: 0, confirmed: 0, declined: 0 };
  _volSignupsCache.forEach(function(s) { var st = s.status || 'new'; if (counts[st] !== undefined) counts[st]++; });
  var order = ['all','new','contacted','confirmed'];
  if (counts.declined) order.push('declined');
  pillsEl.innerHTML = order.map(function(st) {
    var label = st === 'all' ? 'All' : VOL_STATUS_LABELS[st];
    var cls = st === 'all' ? 'background:' + (_volStatusFilter==='all'?'var(--navy)':'var(--linen)') + ';color:' + (_volStatusFilter==='all'?'#fff':'var(--charcoal)') + ';' : '';
    var pillClass = st === 'all' ? '' : ' status-pill status-' + st;
    var activeRing = _volStatusFilter === st ? 'box-shadow:0 0 0 2px rgba(30,45,74,.4);' : '';
    return '<span class="' + pillClass + '" style="cursor:pointer;font-size:.78rem;font-weight:600;padding:4px 12px;border-radius:99px;' + cls + activeRing + '" onclick="volSetStatusFilter(' + volJsAttr(st) + ')">' + label + ' (' + counts[st] + ')</span>';
  }).join('');
}

function volLoadSignups() {
  var url = '/admin/api/signups' + (_volCurrentTab !== 'all' ? '?ministry=' + _volCurrentTab : '');
  var listEl = document.getElementById('vol-signups-list');
  if (listEl) listEl.innerHTML = '<span style="color:var(--warm-gray);">Loading…</span>';
  api(url)
    .then(function(d) {
      _volSignupsCache = d.signups || [];
      _volStatusFilter = 'all';
      var titleEl = document.getElementById('vol-signups-title');
      if (titleEl) titleEl.innerHTML = (VOL_MINISTRY_LABELS[_volCurrentTab]||_volCurrentTab) + ' Volunteers <span id="vol-signups-count" style="background:var(--navy);color:#fff;border-radius:99px;padding:1px 8px;font-size:.75rem;margin-left:4px;">' + _volSignupsCache.length + '</span>';
      volRenderStatusPills();
      volRenderSignupsList();
    })
    .catch(function() { if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading sign-ups.</span>'; });
}

function volSetSignupStatus(id, status) {
  api('/admin/api/signups/' + id + '/status', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status }) })
    .then(function(d) {
      if (!d.ok) { alert(d.error || 'Could not update status.'); return; }
      var s = _volSignupsCache.find(function(x){ return x.id === id; });
      if (s) s.status = status;
      volRenderStatusPills();
      volRenderSignupsList();
    });
}

function volRenderSignupsList() {
  var listEl = document.getElementById('vol-signups-list');
  if (!listEl) return;
  var items = _volStatusFilter === 'all' ? _volSignupsCache : _volSignupsCache.filter(function(s){ return (s.status||'new') === _volStatusFilter; });
  if (!items.length) {
    listEl.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--warm-gray);">No sign-ups' + (_volStatusFilter !== 'all' ? ' with this status' : '') + '.</div>';
    return;
  }
  listEl.innerHTML = items.map(function(s) {
        var roles = []; try { roles = JSON.parse(s.roles || '[]'); } catch {}
        var sundays = []; try { sundays = JSON.parse(s.sundays || '[]'); } catch {}
        var meta = [];
        if (s.email) meta.push('<strong>Email:</strong> <a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>');
        if (s.phone) meta.push('<strong>Phone:</strong> ' + esc(s.phone));
        if (s.service) meta.push('<strong>Service:</strong> ' + esc(s.service));
        if (sundays.length) meta.push('<strong>Sundays:</strong> ' + sundays.map(esc).join(', '));
        if (s.event_name) meta.push('<strong>Event:</strong> ' + esc(s.event_name));
        if (s.slot_details && s.slot_details.length) {
          var shiftList = s.slot_details.map(function(sl){ return esc(sl.name) + (sl.start_time ? ' (' + esc(sl.start_time) + '–' + esc(sl.end_time) + ')' : ''); }).join(', ');
          meta.push('<strong>Shifts:</strong> ' + shiftList);
        }
        if (s.shirt_wanted) meta.push('<strong>T-shirt:</strong> ' + (s.shirt_size || 'Yes'));
        if (s.sms_reminder_opt_in) meta.push('🔔 Wants a reminder before serving');
        // Person link badge
        var personBadge = s.person_id
          ? '<span style="font-size:.72rem;background:rgba(46,126,166,.12);color:var(--sky-steel);border:1px solid rgba(46,126,166,.25);border-radius:6px;padding:1px 7px;cursor:pointer;" onclick="openPersonProfile(' + s.person_id + ')" title="Open profile">✓ ' + esc(s.linked_person_name || 'Person') + '</span>'
          : '<span style="font-size:.72rem;color:var(--warm-gray);">Not in People</span>';
        // Contact count badge
        var contactBadge = s.contact_count > 0
          ? '<span style="font-size:.72rem;background:rgba(39,174,96,.1);color:#1a7a3a;border:1px solid rgba(39,174,96,.25);border-radius:6px;padding:1px 7px;" title="Last: ' + esc((s.contacted_at||'').slice(0,10)) + '">✉ ' + s.contact_count + '×</span>'
          : '';
        var status = s.status || 'new';
        var statusSelect = '<select class="status-pill status-' + status + '" onchange="volSetSignupStatus(' + s.id + ',this.value)" onclick="event.stopPropagation()">'
          + Object.keys(VOL_STATUS_LABELS).map(function(st) { return '<option value="' + st + '"' + (st===status?' selected':'') + '>' + VOL_STATUS_LABELS[st] + '</option>'; }).join('')
          + '</select>';
        return '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">'
          + '<div class="vol-sig-head">'
          + '<div class="vol-sig-ident"><div style="font-weight:600;font-size:.92rem;">' + esc(s.name) + '</div>'
          + '<div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--sky-steel);">' + esc(s.ministry) + '</div>'
          + '<div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;">' + personBadge + (contactBadge ? ' ' + contactBadge : '') + '</div>'
          + '</div>'
          + '<div class="vol-sig-actions">'
          + statusSelect
          + '<span style="font-size:.75rem;color:var(--warm-gray);">' + esc((s.created_at||'').slice(0,10)) + '</span>'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;" onclick="volOpenLinkPerson(' + s.id + ',' + volJsAttr(esc(s.name)) + ',' + volJsAttr(esc(s.email)) + ',' + (s.person_id||'null') + ',' + volJsAttr(esc(s.linked_person_name||'')) + ')" title="Link to person record">'
          + (s.person_id ? '↩ Relink' : '+ Link') + '</button>'
          + (s.email ? '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--teal);border-color:rgba(46,126,166,.3);" data-sig-id="' + s.id + '" data-sig-name="' + esc(s.name) + '" data-sig-email="' + esc(s.email) + '" data-sig-ministry="' + esc(s.ministry) + '" onclick="volOpenSendEmail(this)">✉ Email</button>' : '')
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--danger);border-color:rgba(192,57,43,.3);" onclick="volDeleteSignup(' + s.id + ')">Remove</button>'
          + '</div></div>'
          + (meta.length ? '<div style="font-size:.82rem;color:#4A4860;margin-top:6px;line-height:1.6;">' + meta.join(' &nbsp;&bull;&nbsp; ') + '</div>' : '')
          + (roles.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + roles.map(function(r){ return '<span style="background:rgba(30,45,74,.07);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:.78rem;">' + esc(r) + '</span>'; }).join('') + '</div>' : '')
          + (s.notes ? '<div style="font-size:.82rem;color:#6A6880;font-style:italic;margin-top:4px;">"' + esc(s.notes) + '"</div>' : '')
          + '</div>';
      }).join('');
}

function volDeleteSignup(id) {
  if (!confirm('Remove this volunteer sign-up?')) return;
  api('/admin/api/signups/' + id, { method: 'DELETE' })
    .then(function() { volLoadSignups(); });
}

function volToggleDuplicates() {
  _volDupVisible = !_volDupVisible;
  var panel = document.getElementById('vol-duplicates-panel');
  var btn = document.getElementById('vol-dup-btn');
  if (!_volDupVisible) { panel.style.display = 'none'; if (btn) btn.textContent = 'Show Duplicates'; return; }
  if (btn) btn.textContent = 'Hide Duplicates';
  api('/admin/api/signups')
    .then(function(data) {
      var items = data.signups || [];
      var byEmail = {};
      items.forEach(function(s) {
        var key = (s.email || '').toLowerCase().trim();
        if (!key) return;
        if (!byEmail[key]) byEmail[key] = [];
        byEmail[key].push(s);
      });
      var dups = Object.keys(byEmail).filter(function(k) { return byEmail[k].length > 1; });
      var listEl = document.getElementById('vol-duplicates-list');
      if (!dups.length) {
        if (listEl) listEl.innerHTML = '<p style="font-size:.88rem;color:#6a6a6a;">No duplicate emails found.</p>';
      } else {
        if (listEl) listEl.innerHTML = dups.map(function(emailKey) {
          var rows = byEmail[emailKey];
          return '<div style="margin-bottom:10px;padding:8px 10px;background:#fff;border-radius:8px;border:1px solid #e8d0a0;">'
            + '<div style="font-weight:600;font-size:.85rem;color:#8a5000;margin-bottom:4px;">' + esc(emailKey) + ' — ' + rows.length + ' signups</div>'
            + rows.map(function(s) {
              var roles = []; try { roles = JSON.parse(s.roles||'[]'); } catch {}
              return '<div style="font-size:.8rem;color:#444;padding:2px 0;">' + esc(s.name) + ' • ' + esc(s.ministry) + (roles.length ? ' • ' + roles.map(esc).join(', ') : '')
                + ' <span style="color:#aaa;">' + esc((s.created_at||'').slice(0,10)) + '</span>'
                + ' <button class="btn-secondary" style="font-size:.72rem;padding:1px 7px;margin-left:6px;color:var(--danger);" onclick="volDeleteSignup(' + s.id + ')">Remove</button></div>';
            }).join('')
            + '</div>';
        }).join('');
      }
      if (panel) panel.style.display = '';
    })
    .catch(function() {
      var listEl = document.getElementById('vol-duplicates-list');
      if (listEl) listEl.innerHTML = '<p style="font-size:.88rem;color:var(--danger);">Error loading data.</p>';
      if (panel) panel.style.display = '';
    });
}

// One-time cleanup for sign-ups created before an additional shift/role
// merged into an existing sign-up instead of being rejected as "already
// signed up" — consolidates any (email, event) pair, or off-event (email,
// ministry-interest) pair, still sitting as separate rows. Preview-then-
// confirm, same pattern as the giving tab's force-remove-orphans tool.
function volMergeDuplicateSignups() {
  var btn = document.getElementById('vol-merge-dup-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  api('/admin/api/signups/duplicates')
    .then(function(data) {
      var groups = data.groups || [];
      if (btn) { btn.disabled = false; btn.textContent = 'Merge Duplicate Sign-ups…'; }
      if (!groups.length) { alert('No duplicate sign-ups found — nothing to merge.'); return; }
      var lines = groups.slice(0, 12).map(function(g) {
        var where = g.event_id ? (g.event_name || ('event #' + g.event_id)) : (g.ministry || 'ministry interest');
        return '• ' + g.email + ' — ' + g.count + ' sign-ups for ' + where;
      });
      if (groups.length > 12) lines.push('…and ' + (groups.length - 12) + ' more.');
      var msg = 'Found ' + groups.length + ' email' + (groups.length === 1 ? '' : 's') + ' with duplicate sign-ups:\n\n'
        + lines.join('\n')
        + '\n\nMerging combines each person\'s duplicate rows into one — every shift and role they picked is kept, nothing is dropped, and the extra rows are removed. This cannot be undone. Merge now?';
      if (!confirm(msg)) return;
      if (btn) { btn.disabled = true; btn.textContent = 'Merging…'; }
      api('/admin/api/signups/merge-duplicates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_count: groups.length }),
      }).then(function(res) {
        if (btn) { btn.disabled = false; btn.textContent = 'Merge Duplicate Sign-ups…'; }
        if (res && res.error) { alert(res.error + ' Please try again — the duplicate count may have changed.'); return; }
        alert('Merged ' + res.groups_merged + ' duplicate sign-up' + (res.groups_merged === 1 ? '' : 's') + ' (' + res.signups_removed + ' extra row' + (res.signups_removed === 1 ? '' : 's') + ' removed).');
        loadSignups();
        if (_volDupVisible) { _volDupVisible = false; volToggleDuplicates(); }
      }).catch(function() {
        if (btn) { btn.disabled = false; btn.textContent = 'Merge Duplicate Sign-ups…'; }
        alert('Could not merge duplicates. Please try again.');
      });
    })
    .catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Merge Duplicate Sign-ups…'; }
      alert('Could not check for duplicates. Please try again.');
    });
}

// ── LINK PERSON MODAL ─────────────────────────────────────────────────
var _volLinkSignupId = 0;

function volOpenLinkPerson(signupId, name, email, currentPersonId, currentPersonName) {
  _volLinkSignupId = signupId;
  document.getElementById('vol-link-signup-name').textContent = name;
  var searchEl = document.getElementById('vol-link-search');
  if (searchEl) { searchEl.value = email || name; }
  document.getElementById('vol-link-results').innerHTML = '';
  document.getElementById('vol-link-current').style.display = currentPersonId ? '' : 'none';
  if (currentPersonId) {
    document.getElementById('vol-link-current-name').textContent = currentPersonName || 'Person #' + currentPersonId;
    document.getElementById('vol-link-current-id').textContent = currentPersonId;
  }
  openModal('vol-link-person-modal');
  if (email || name) volSearchPeople();
}

function volSearchPeople() {
  var q = (document.getElementById('vol-link-search')||{}).value || '';
  if (!q.trim()) return;
  var resultsEl = document.getElementById('vol-link-results');
  if (resultsEl) resultsEl.innerHTML = '<span style="color:var(--warm-gray);font-size:.85rem;">Searching…</span>';
  api('/admin/api/people?q=' + encodeURIComponent(q) + '&limit=10&archived=0')
    .then(function(d) {
      var people = d.people || [];
      if (!people.length) {
        if (resultsEl) resultsEl.innerHTML = '<div style="font-size:.85rem;color:var(--warm-gray);padding:6px 0;">No matches found.</div>';
        return;
      }
      if (resultsEl) resultsEl.innerHTML = people.map(function(p) {
        var label = esc(p.first_name + ' ' + p.last_name) + ' <span style="color:var(--warm-gray);font-size:.8rem;">(' + esc(p.member_type || '') + (p.email ? ' · ' + esc(p.email) : '') + ')</span>';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--linen);">'
          + '<span style="font-size:.85rem;">' + label + '</span>'
          + '<button class="btn-primary" style="font-size:.75rem;padding:2px 10px;" onclick="volDoLinkPerson(' + p.id + ')">Link</button>'
          + '</div>';
      }).join('');
    });
}

function volDoLinkPerson(personId) {
  api('/admin/api/signups/' + _volLinkSignupId + '/link-person', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: personId })
  }).then(function(d) {
    if (!d.ok) { alert(d.error || 'Link failed'); return; }
    closeModal('vol-link-person-modal');
    volLoadSignups();
  });
}

function volDoCreatePerson() {
  if (!confirm('Create a new Visitor profile from this sign-up data?')) return;
  api('/admin/api/signups/' + _volLinkSignupId + '/link-person', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ create: true })
  }).then(function(d) {
    if (!d.ok) { alert(d.error || 'Create failed'); return; }
    closeModal('vol-link-person-modal');
    volLoadSignups();
  });
}

function volDoUnlinkPerson() {
  if (!confirm('Remove the link to this person?')) return;
  api('/admin/api/signups/' + _volLinkSignupId + '/link-person', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ person_id: null, unlink: true })
  }).then(function(d) {
    if (!d.ok) { alert(d.error || 'Unlink failed'); return; }
    closeModal('vol-link-person-modal');
    volLoadSignups();
  });
}

// ── SEND EMAIL MODAL ──────────────────────────────────────────────────
var _volSendSignupId = 0;
var _volSendName = '';
var _volSendEmail = '';
var _volSendMinistry = '';
var _volSendRoles = '';
var _volSendService = '';
var _volSendSundays = '';
var _volSendNotes = '';

function volOpenSendEmail(btn) {
  var signupId = parseInt(btn.dataset.sigId, 10);
  var name     = btn.dataset.sigName;
  var email    = btn.dataset.sigEmail;
  var ministry = btn.dataset.sigMinistry;
  _volSendSignupId = signupId;
  _volSendName = name;
  _volSendEmail = email;
  _volSendMinistry = ministry;
  // Look up extra signup data from cache
  var cached = _volSignupsCache.find(function(s) { return s.id === signupId; });
  if (cached) {
    var roles = []; try { roles = JSON.parse(cached.roles || '[]'); } catch {}
    var sundays = []; try { sundays = JSON.parse(cached.sundays || '[]'); } catch {}
    _volSendRoles   = roles.join(', ');
    _volSendService = cached.service || '';
    _volSendSundays = sundays.join(', ');
    _volSendNotes   = cached.notes || '';
  } else {
    _volSendRoles = _volSendService = _volSendSundays = _volSendNotes = '';
  }
  document.getElementById('vol-send-to').textContent = name + ' <' + email + '>';
  // Reset fields
  document.getElementById('vol-send-subject').value = '';
  document.getElementById('vol-send-body').value = '';
  document.getElementById('vol-send-status').textContent = '';
  document.getElementById('vol-send-template-select').value = '';
  openModal('vol-send-email-modal');
  // Load templates if not yet loaded
  if (!_volTemplates.length) {
    volLoadTemplates(function() { volPopulateTemplateSelect(); });
  } else {
    volPopulateTemplateSelect();
  }
}

function volPopulateTemplateSelect() {
  var sel = document.getElementById('vol-send-template-select');
  if (!sel) return;
  // Filter to matching ministry or 'all' templates
  var relevant = _volTemplates.filter(function(t) { return !t.ministry || t.ministry === _volSendMinistry || t.ministry === 'all'; });
  var others = _volTemplates.filter(function(t) { return t.ministry && t.ministry !== _volSendMinistry && t.ministry !== 'all'; });
  var options = '<option value="">— Select a template —</option>';
  if (relevant.length) {
    options += '<optgroup label="This ministry">' + relevant.map(function(t) { return '<option value="' + t.id + '">' + esc(t.name) + '</option>'; }).join('') + '</optgroup>';
  }
  if (others.length) {
    options += '<optgroup label="Other ministries">' + others.map(function(t) { return '<option value="' + t.id + '">' + esc(t.name) + ' (' + esc(VOL_MINISTRY_LABELS[t.ministry]||t.ministry) + ')</option>'; }).join('') + '</optgroup>';
  }
  sel.innerHTML = options;
}

function volApplyTemplate() {
  var sel = document.getElementById('vol-send-template-select');
  var tid = sel ? parseInt(sel.value) : 0;
  if (!tid) return;
  var tmpl = _volTemplates.find(function(t) { return t.id === tid; });
  if (!tmpl) return;
  // Variable substitution
  var parts = _volSendName.trim().split(/\s+/);
  var firstName = parts[0] || _volSendName;
  var lastName = parts.slice(1).join(' ');
  var ministryLabel = VOL_MINISTRY_LABELS[_volSendMinistry] || _volSendMinistry || '';
  function subst(str) {
    return str.replace(/\{\{first_name\}\}/g, firstName)
              .replace(/\{\{last_name\}\}/g, lastName)
              .replace(/\{\{name\}\}/g, _volSendName)
              .replace(/\{\{ministry\}\}/g, ministryLabel)
              .replace(/\{\{roles\}\}/g, _volSendRoles)
              .replace(/\{\{service\}\}/g, _volSendService)
              .replace(/\{\{sundays\}\}/g, _volSendSundays)
              .replace(/\{\{notes\}\}/g, _volSendNotes);
  }
  document.getElementById('vol-send-subject').value = subst(tmpl.subject);
  document.getElementById('vol-send-body').value = subst(tmpl.body);
}

function volDoSendEmail() {
  var subject = (document.getElementById('vol-send-subject').value || '').trim();
  var body    = (document.getElementById('vol-send-body').value    || '').trim();
  var statusEl = document.getElementById('vol-send-status');
  if (!subject || !body) { if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Subject and message are required.'; } return; }
  var btn = document.getElementById('vol-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (statusEl) { statusEl.style.color = ''; statusEl.textContent = ''; }
  api('/admin/api/signups/' + _volSendSignupId + '/send-email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: subject, body: body })
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    if (d.ok) {
      if (statusEl) { statusEl.style.color = 'var(--teal)'; statusEl.textContent = '✓ Sent to ' + _volSendEmail; }
      setTimeout(function() { closeModal('vol-send-email-modal'); volLoadSignups(); }, 1200);
    } else {
      if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = d.error || 'Send failed.'; }
    }
  }).catch(function() {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    if (statusEl) { statusEl.style.color = 'var(--danger)'; statusEl.textContent = 'Network error.'; }
  });
}

// ── EMAIL TEMPLATE MANAGEMENT ─────────────────────────────────────────
var _volEditingTemplateId = 0;

function volLoadTemplates(cb) {
  api('/admin/api/volunteer-templates').then(function(d) {
    _volTemplates = d.templates || [];
    volRenderTemplates();
    if (cb) cb();
  });
}

function volRenderTemplates() {
  var listEl = document.getElementById('vol-templates-list');
  if (!listEl) return;
  if (!_volTemplates.length) {
    listEl.innerHTML = '<div style="font-size:.85rem;color:var(--warm-gray);padding:10px 0;">No templates yet. Add one below.</div>';
    return;
  }
  listEl.innerHTML = _volTemplates.map(function(t) {
    var ministryLabel = t.ministry ? ' <span style="font-size:.72rem;color:var(--sky-steel);text-transform:uppercase;letter-spacing:.05em;">(' + esc(VOL_MINISTRY_LABELS[t.ministry]||t.ministry) + ')</span>' : '';
    return '<div class="vol-tpl-row">'
      + '<div style="min-width:0;">'
      + '<div style="font-weight:600;font-size:.88rem;">' + esc(t.name) + ministryLabel + '</div>'
      + '<div style="font-size:.8rem;color:#6A6880;margin-top:2px;">' + esc(t.subject) + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:5px;flex-shrink:0;">'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;" onclick="volEditTemplate(' + t.id + ')">Edit</button>'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--danger);border-color:rgba(192,57,43,.3);" onclick="volDeleteTemplate(' + t.id + ')">Del</button>'
      + '</div>'
      + '</div>';
  }).join('');
}

function volEditTemplate(id) {
  var tmpl = _volTemplates.find(function(t) { return t.id === id; });
  if (!tmpl) return;
  _volEditingTemplateId = id;
  document.getElementById('vol-tmpl-name').value = tmpl.name;
  document.getElementById('vol-tmpl-ministry').value = tmpl.ministry || '';
  document.getElementById('vol-tmpl-subject').value = tmpl.subject;
  document.getElementById('vol-tmpl-body').value = tmpl.body;
  document.getElementById('vol-tmpl-save-btn').textContent = 'Save Changes';
  document.getElementById('vol-tmpl-cancel-btn').style.display = '';
  document.getElementById('vol-tmpl-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function volCancelEditTemplate() {
  _volEditingTemplateId = 0;
  ['vol-tmpl-name','vol-tmpl-subject','vol-tmpl-body'].forEach(function(id){ var el=document.getElementById(id); if(el)el.value=''; });
  document.getElementById('vol-tmpl-ministry').value = '';
  document.getElementById('vol-tmpl-save-btn').textContent = 'Add Template';
  document.getElementById('vol-tmpl-cancel-btn').style.display = 'none';
}

function volSaveTemplate() {
  var name    = (document.getElementById('vol-tmpl-name').value || '').trim();
  var ministry= (document.getElementById('vol-tmpl-ministry').value || '');
  var subject = (document.getElementById('vol-tmpl-subject').value || '').trim();
  var body    = (document.getElementById('vol-tmpl-body').value || '').trim();
  if (!name || !subject || !body) { alert('Name, subject, and body are required.'); return; }
  var method = _volEditingTemplateId ? 'PUT' : 'POST';
  var url = '/admin/api/volunteer-templates' + (_volEditingTemplateId ? '/' + _volEditingTemplateId : '');
  api(url, {
    method: method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, ministry: ministry, subject: subject, body: body })
  }).then(function(d) {
    if (!d.ok && !d.id) { alert(d.error || 'Save failed'); return; }
    volCancelEditTemplate();
    volLoadTemplates();
  });
}

function volDeleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  api('/admin/api/volunteer-templates/' + id, { method: 'DELETE' })
    .then(function() { volLoadTemplates(); });
}

// ── EVENTS (master-detail shell + day-grouped shift modal) ────────────
var _volEventsCache = [];
var _volActiveEventId = null;
var _volEditingShift = null; // { eventId, roleId, dayDate } — roleId null means "add new"

function volLoadEvents(selectEvId) {
  api('/admin/api/events')
    .then(function(data) {
      _volEventsCache = data.events || [];
      var cntEl = document.getElementById('vol-events-count');
      if (cntEl) cntEl.textContent = _volEventsCache.length;
      if (selectEvId) _volActiveEventId = selectEvId;
      else if (!_volActiveEventId || !_volEventsCache.some(function(e){return e.id===_volActiveEventId;})) {
        _volActiveEventId = _volEventsCache.length ? _volEventsCache[0].id : null;
      }
      volRenderEventsList();
      volRenderEventDetail();
    })
    .catch(function() {
      var listEl = document.getElementById('vol-events-list');
      if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading events.</span>';
    });
}

function volRenderEventsList() {
  var listEl = document.getElementById('vol-events-list');
  if (!listEl) return;
  if (!_volEventsCache.length) {
    listEl.innerHTML = '<div style="padding:20px 10px;text-align:center;color:var(--warm-gray);font-size:.85rem;">No events yet.</div>';
    return;
  }
  listEl.innerHTML = _volEventsCache.map(function(ev) {
    return '<div class="ev-list-row' + (ev.id===_volActiveEventId?' active':'') + '" onclick="volSelectEvent(' + ev.id + ')">'
      + '<div class="ev-list-name">' + esc(ev.name) + '</div>'
      + '<div class="ev-list-meta">' + (ev.event_date ? fmtDate(ev.event_date) : 'No date') + ' &middot; ' + (ev.hidden ? 'Hidden' : 'Visible') + '</div>'
      + '</div>';
  }).join('');
}

function volSelectEvent(evId) {
  _volActiveEventId = evId;
  volRenderEventsList();
  volRenderEventDetail();
}

function volActiveEvent() { return _volEventsCache.find(function(e){ return e.id === _volActiveEventId; }) || null; }

function volEventDayGroups(ev) {
  var groups = {}, order = [];
  (ev.roles||[]).forEach(function(r) {
    var key = r.role_date || '';
    if (!(key in groups)) { groups[key] = []; order.push(key); }
    groups[key].push(r);
  });
  order.sort(function(a,b){ return a < b ? -1 : a > b ? 1 : 0; });
  return order.map(function(dateStr){ return { date: dateStr, roles: groups[dateStr] }; });
}

// Short-link placeholder text: guess from the event's own name (matches the
// site's existing single-word slug convention — "christmasmarket", "foodpantry")
// instead of always showing the same hardcoded example regardless of event.
function volSuggestSlug(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function volRenderEventDetail() {
  var detailEl = document.getElementById('vol-event-detail');
  if (!detailEl) return;
  var ev = volActiveEvent();
  if (!ev) { detailEl.innerHTML = '<div style="padding:20px 10px;text-align:center;color:var(--warm-gray);font-size:.85rem;">Select an event, or add a new one.</div>'; return; }
  var useTs = (ev.use_time_slots === undefined || ev.use_time_slots === null) ? 1 : ev.use_time_slots;

  var topBar = '<div class="ev-detail-topbar">'
    + '<span class="' + (ev.hidden ? 'ev-badge-hidden' : 'ev-badge-visible') + '">' + (ev.hidden ? 'Hidden' : 'Visible on site') + '</span>'
    + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
    + '<button class="ev-btn-secondary" onclick="volToggleEventVisibility(' + ev.id + ',' + (ev.hidden?0:1) + ')">' + (ev.hidden?'Show event':'Hide event') + '</button>'
    + '<a href="javascript:void(0)" class="ev-delete-link" onclick="volDeleteEvent(' + ev.id + ')">Delete</a>'
    + '<button class="ev-btn-primary" onclick="volSaveEvent(' + ev.id + ')">Save changes</button>'
    + '</div></div>';

  var slugUrl = 'serve.timothystl.org/' + (ev.slug || '');
  var fields = '<div class="ev-field-row">'
    + '<div><label>Event name</label><input type="text" id="vol-ev-name" value="' + esc(ev.name) + '"></div>'
    + '<div><label>Date</label><input type="date" id="vol-ev-date" value="' + esc(ev.event_date||'') + '"></div>'
    + '</div>'
    + '<div class="ev-field-row" style="grid-template-columns:1fr;margin-bottom:10px;"><div><label>Description</label><textarea id="vol-ev-desc" style="min-height:56px;">' + esc(ev.description||'') + '</textarea></div></div>'
    + '<div class="ev-field-row" style="grid-template-columns:1fr;margin-bottom:10px;"><div>'
    + '<label>Short link <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></label>'
    + '<div style="display:flex;align-items:center;gap:8px;">'
    + '<span style="font-size:.82rem;color:var(--warm-gray);white-space:nowrap;">serve.timothystl.org/</span>'
    + '<input type="text" id="vol-ev-slug" value="' + esc(ev.slug||'') + '" placeholder="' + esc(volSuggestSlug(ev.name)) + '" style="flex:1;min-width:0;">'
    + (ev.slug ? '<button type="button" class="ev-btn-secondary" style="padding:6px 10px;font-size:.75rem;white-space:nowrap;" onclick="volCopyEventLink(this,\'' + slugUrl.replace(/'/g,'') + '\')">Copy link</button>' : '')
    + '</div></div></div>'
    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:14px;"><input type="checkbox" id="vol-ev-ts"' + (useTs ? ' checked' : '') + ' style="width:auto;margin:0;" onchange="volSaveEvent(' + ev.id + ')"><label for="vol-ev-ts" style="font-size:.82rem;cursor:pointer;">Roles have scheduled time slots</label></div>';

  var body;
  if (useTs) {
    var groups = volEventDayGroups(ev);
    body = groups.map(function(g) {
      var label = g.date ? volFormatDayLabel(g.date) : 'No date set';
      var dateArg = "'" + (g.date||'').replace(/'/g,'') + "'";
      return '<div class="ev-day-header"><h4>Shifts &mdash; ' + esc(label) + '</h4>'
        + '<button class="ev-btn-secondary" style="padding:6px 12px;font-size:.75rem;" onclick="volOpenShiftModal(' + ev.id + ',' + dateArg + ',null)">+ Add shift</button></div>'
        + g.roles.map(function(r) {
            var pct = r.slots > 0 ? Math.round(((r.filled_count||0) / r.slots) * 100) : 0;
            var full = r.slots > 0 && (r.filled_count||0) >= r.slots;
            var barColor = full ? '#8C8880' : '#4A5E3A';
            return '<div class="ev-shift-row" onclick="volOpenShiftModal(' + ev.id + ',' + dateArg + ',' + r.id + ')">'
              + '<div><div class="ev-shift-name">' + esc(r.name) + '</div>' + (r.start_time ? '<div class="ev-shift-time">' + esc(r.start_time) + '&ndash;' + esc(r.end_time||'') + '</div>' : '') + '</div>'
              + '<div class="ev-fill-bar"><div style="width:' + pct + '%;background:' + barColor + ';"></div></div>'
              + '<div class="ev-fill-count" style="color:' + barColor + ';">' + (r.filled_count||0) + ' / ' + (r.slots||0) + '</div>'
              + '<div class="ev-edit-link">Edit</div>'
              + '</div>';
          }).join('');
    }).join('') || '<p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:10px;">No shifts yet.</p>';
    body += '<div style="margin-top:10px;"><button class="ev-btn-secondary" onclick="volOpenShiftModal(' + ev.id + ',null,null)">+ Add shift on a new day</button></div>';
  } else {
    // Simple (non-shift) event: role checkboxes, still live-editable per row (unchanged pattern —
    // out of scope per the shift-modal handoff, which only covers time-slotted events).
    body = '<div id="vol-roles-list-' + ev.id + '">'
      + (ev.roles||[]).map(function(r) {
          return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--linen);" id="vol-role-row-' + r.id + '">'
            + '<span style="font-size:.72rem;font-weight:600;color:var(--sky-steel);white-space:nowrap;min-width:36px;text-align:center;">' + (r.filled_count||0) + '/' + (r.slots||'∞') + '</span>'
            + '<input type="text" class="form-input" style="flex:1;min-width:100px;" id="vol-role-name-' + r.id + '" value="' + esc(r.name) + '" placeholder="Role name">'
            + '<input type="text" class="form-input" style="flex:2;min-width:120px;" id="vol-role-desc-' + r.id + '" value="' + esc(r.description||'') + '" placeholder="Description">'
            + '<input type="number" class="form-input" style="flex:0 0 56px;" id="vol-role-slots-' + r.id + '" value="' + (r.slots||0) + '" min="0" title="Slots">'
            + '<button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="volSaveRole(' + ev.id + ',' + r.id + ')">Save</button>'
            + '<button class="btn-secondary" style="font-size:.78rem;padding:4px 8px;color:var(--danger);" onclick="volDeleteRole(' + ev.id + ',' + r.id + ')">Del</button>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
      + '<input type="text" class="form-input" style="flex:1;min-width:100px;" id="vol-new-role-name-' + ev.id + '" placeholder="Role name…">'
      + '<input type="text" class="form-input" style="flex:2;min-width:120px;" id="vol-new-role-desc-' + ev.id + '" placeholder="Description…">'
      + '<input type="number" class="form-input" style="flex:0 0 56px;" id="vol-new-role-slots-' + ev.id + '" value="0" min="0" title="Slots">'
      + '<button class="btn-primary" style="font-size:.8rem;" onclick="volAddRole(' + ev.id + ')">+ Role</button>'
      + '</div>';
    var totalSlots = (ev.roles||[]).reduce(function(sum,r){ return sum + (r.slots||0); }, 0);
    var totalFilled = (ev.roles||[]).reduce(function(sum,r){ return sum + (r.filled_count||0); }, 0);
    body += '<div style="display:flex;gap:24px;margin:16px 0;">'
      + '<div><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);">Slots filled</div><div style="font-family:var(--font-head);font-size:1.25rem;color:var(--steel-anchor);">' + totalFilled + ' / ' + totalSlots + '</div></div>'
      + '<div id="vol-ev-signups-stat-' + ev.id + '"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);">Signups</div><div style="font-family:var(--font-head);font-size:1.25rem;color:var(--steel-anchor);">&hellip;</div></div>'
      + '</div>'
      + '<h4 style="font-family:var(--font-head);font-size:.92rem;color:var(--steel-anchor);margin:0 0 8px;">Volunteers signed up</h4>'
      + '<div id="vol-ev-roster-' + ev.id + '" style="font-size:.85rem;color:var(--warm-gray);">Loading&hellip;</div>';
    volLoadEventRoster(ev.id);
  }

  detailEl.innerHTML = topBar + fields + body;
}

function volLoadEventRoster(evId) {
  api('/admin/api/signups?ministry=events').then(function(d) {
    var rows = (d.signups||[]).filter(function(s){ return s.event_id === evId; });
    var el = document.getElementById('vol-ev-roster-' + evId);
    var statEl = document.getElementById('vol-ev-signups-stat-' + evId);
    if (statEl) statEl.querySelector('div:last-child').textContent = rows.length;
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<div style="padding:10px 0;color:var(--warm-gray);">No signups yet.</div>'; return; }
    el.innerHTML = rows.map(function(s) {
      var roles = []; try { roles = JSON.parse(s.roles || '[]'); } catch {}
      var status = s.status || 'new';
      var statusSelect = '<select class="status-pill status-' + status + '" onchange="volSetSignupStatus(' + s.id + ',this.value)">'
        + Object.keys(VOL_STATUS_LABELS).map(function(st) { return '<option value="' + st + '"' + (st===status?' selected':'') + '>' + VOL_STATUS_LABELS[st] + '</option>'; }).join('')
        + '</select>';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--linen);">'
        + '<div><div style="font-weight:600;color:var(--charcoal);">' + esc(s.name) + '</div>'
        + '<div style="font-size:.78rem;color:var(--warm-gray);">' + (roles.length ? esc(roles.join(', ')) : 'No role specified') + (s.email ? ' &middot; ' + esc(s.email) : '') + '</div></div>'
        + statusSelect
        + '</div>';
    }).join('');
  });
}

function volFormatDayLabel(dateStr) {
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  var p = dateStr.split('-');
  var d = new Date(parseInt(p[0],10),parseInt(p[1],10)-1,parseInt(p[2],10));
  return days[d.getDay()] + ', ' + months[parseInt(p[1],10)] + ' ' + parseInt(p[2],10);
}

// ── Add/Edit shift modal ────────────────────────────────────────────
function volOpenShiftModal(evId, dayDate, roleId) {
  var ev = _volEventsCache.find(function(e){ return e.id === evId; });
  if (!ev) return;
  var role = roleId ? (ev.roles||[]).find(function(r){ return r.id === roleId; }) : null;
  _volEditingShift = { eventId: evId, roleId: roleId, dayDate: dayDate };

  document.getElementById('vol-shift-modal-title').textContent = role ? 'Edit shift' : 'Add shift';
  document.getElementById('vol-shift-day-label').textContent = dayDate ? volFormatDayLabel(dayDate) : (role && role.role_date ? volFormatDayLabel(role.role_date) : 'New day');
  document.getElementById('vol-shift-name').value = role ? role.name : '';
  document.getElementById('vol-shift-desc').value = role ? (role.description||'') : '';
  document.getElementById('vol-shift-date').value = role ? (role.role_date||'') : (dayDate || '');
  document.getElementById('vol-shift-start').value = volToTimeInput(role ? (role.start_time||'') : '');
  document.getElementById('vol-shift-end').value = volToTimeInput(role ? (role.end_time||'') : '');
  document.getElementById('vol-shift-slots').value = role ? (role.slots||0) : 0;
  document.getElementById('vol-shift-filled-hint').textContent = role
    ? ((role.filled_count||0) + ' of ' + (role.slots||0) + ' filled · safe to change spot count any time')
    : 'New shift · starts with 0 filled';
  document.getElementById('vol-shift-delete').style.display = role ? '' : 'none';
  openModal('vol-shift-modal');
}

function volSaveShift() {
  var s = _volEditingShift;
  if (!s) return;
  var body = {
    name: (document.getElementById('vol-shift-name').value || '').trim(),
    description: document.getElementById('vol-shift-desc').value || '',
    role_date: document.getElementById('vol-shift-date').value || '',
    start_time: volFromTimeInput(document.getElementById('vol-shift-start').value || ''),
    end_time: volFromTimeInput(document.getElementById('vol-shift-end').value || ''),
    slots: parseInt(document.getElementById('vol-shift-slots').value || '0', 10) || 0,
  };
  if (!body.name) { alert('Please enter a shift name.'); return; }
  var url = '/admin/api/events/' + s.eventId + '/roles' + (s.roleId ? '/' + s.roleId : '');
  api(url, { method: s.roleId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(d) {
      if (!d.ok) { alert(d.error || 'Save failed.'); return; }
      closeModal('vol-shift-modal');
      volLoadEvents(s.eventId);
    }).catch(function(){ alert('Network error saving shift.'); });
}

function volDeleteShift() {
  var s = _volEditingShift;
  if (!s || !s.roleId) return;
  if (!confirm('Delete this shift?')) return;
  api('/admin/api/events/' + s.eventId + '/roles/' + s.roleId, { method: 'DELETE' })
    .then(function() { closeModal('vol-shift-modal'); volLoadEvents(s.eventId); });
}

function volToTimeInput(str) {
  if (!str) return '';
  var m = str.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return str;
  var h = parseInt(m[1],10), min = m[2], ampm = m[3].toUpperCase();
  if (ampm === 'AM') { if (h === 12) h = 0; } else { if (h !== 12) h += 12; }
  return (h < 10 ? '0' : '') + h + ':' + min;
}
function volFromTimeInput(str) {
  if (!str) return '';
  var parts = str.split(':'); if (parts.length < 2) return str;
  var h = parseInt(parts[0],10), min = parts[1];
  var ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12; if (h === 0) h = 12;
  return h + ':' + min + ' ' + ampm;
}

function volCopyEventLink(btnEl, url) {
  var full = 'https://' + url;
  var done = function() {
    var orig = btnEl.textContent;
    btnEl.textContent = 'Copied!';
    setTimeout(function(){ btnEl.textContent = orig; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(full).then(done).catch(function(){ prompt('Copy this link:', full); });
  } else {
    prompt('Copy this link:', full);
  }
}

function volSaveEvent(evId) {
  var ev = _volEventsCache.find(function(e){ return e.id === evId; }) || {};
  var name = (document.getElementById('vol-ev-name')||{}).value || '';
  var date = (document.getElementById('vol-ev-date')||{}).value || '';
  var desc = (document.getElementById('vol-ev-desc')||{}).value || '';
  var slug = (document.getElementById('vol-ev-slug')||{}).value || '';
  var tsEl = document.getElementById('vol-ev-ts');
  var useTimeSlots = tsEl ? (tsEl.checked?1:0) : 1;
  api('/admin/api/events/' + evId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,event_date:date,description:desc,slug:slug,hidden:ev.hidden?1:0,sort_order:ev.sort_order||0,use_time_slots:useTimeSlots})
  }).then(function(d) {
    if (!d.ok) { alert('Save failed: ' + (d.error || 'Unknown error')); return; }
    volLoadEvents(evId);
  }).catch(function(e){alert('Save error: '+e);});
}

function volToggleEventVisibility(evId, hidden) {
  var ev = _volEventsCache.find(function(e){ return e.id === evId; }) || {};
  var name = (document.getElementById('vol-ev-name')||{}).value || ev.name || '';
  var date = (document.getElementById('vol-ev-date')||{}).value || ev.event_date || '';
  var desc = (document.getElementById('vol-ev-desc')||{}).value || ev.description || '';
  var slug = (document.getElementById('vol-ev-slug')||{}).value || ev.slug || '';
  var tsEl = document.getElementById('vol-ev-ts');
  var useTimeSlots = tsEl ? (tsEl.checked?1:0) : 1;
  api('/admin/api/events/' + evId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,event_date:date,description:desc,slug:slug,hidden:hidden,sort_order:ev.sort_order||0,use_time_slots:useTimeSlots})
  }).then(function(d) {
    if (!d.ok) { alert('Error: ' + (d.error || 'Unknown error')); return; }
    volLoadEvents(evId);
  }).catch(function(e){alert('Error: '+e);});
}

function volDeleteEvent(evId) {
  if (!confirm('Delete this event and all its roles? This cannot be undone.')) return;
  api('/admin/api/events/' + evId, {method:'DELETE'})
    .then(function(){volLoadEvents();});
}

function volShowAddEventForm() {
  var f = document.getElementById('vol-add-event-form');
  if (f) f.style.display = f.style.display === 'none' ? '' : 'none';
}

function volSaveNewEvent() {
  var nameEl = document.getElementById('vol-new-ev-name');
  var name = nameEl ? nameEl.value.trim() : '';
  if (!name) { alert('Please enter an event name.'); return; }
  var date = (document.getElementById('vol-new-ev-date')||{}).value || '';
  var desc = (document.getElementById('vol-new-ev-desc')||{}).value || '';
  var tsEl = document.getElementById('vol-new-ev-time-slots');
  var useTimeSlots = tsEl ? (tsEl.checked?1:0) : 1;
  api('/admin/api/events', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,event_date:date,description:desc,use_time_slots:useTimeSlots})
  }).then(function(d){
    ['vol-new-ev-name','vol-new-ev-date','vol-new-ev-desc'].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
    if (tsEl) tsEl.checked = true;
    document.getElementById('vol-add-event-form').style.display = 'none';
    volLoadEvents(d.id);
  });
}

function volSaveRole(evId, roleId) {
  var name  = (document.getElementById('vol-role-name-'  + roleId)||{}).value||'';
  var desc  = (document.getElementById('vol-role-desc-'  + roleId)||{}).value||'';
  var slots = parseInt((document.getElementById('vol-role-slots-' + roleId)||{}).value||'0',10);
  var row = document.getElementById('vol-role-row-' + roleId);
  var saveBtn = row ? row.querySelector('.btn-secondary') : null;
  if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }
  api('/admin/api/events/' + evId + '/roles/' + roleId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,description:desc,slots:slots})
  }).then(function(d) {
    if (!d.ok) { alert('Error saving role.'); if (saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    if (saveBtn) { saveBtn.textContent='Saved!'; saveBtn.style.background='var(--teal)'; saveBtn.style.color='#fff'; setTimeout(function(){saveBtn.disabled=false;saveBtn.textContent='Save';saveBtn.style.background='';saveBtn.style.color='';},1500); }
  }).catch(function(){alert('Network error saving role.');if(saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';}});
}

function volDeleteRole(evId, roleId) {
  if (!confirm('Delete this role?')) return;
  api('/admin/api/events/' + evId + '/roles/' + roleId, {method:'DELETE'})
    .then(function(){volLoadEvents(evId);});
}

function volAddRole(evId) {
  var name  = (document.getElementById('vol-new-role-name-' +evId)||{}).value||'';
  var desc  = (document.getElementById('vol-new-role-desc-' +evId)||{}).value||'';
  var slots = parseInt((document.getElementById('vol-new-role-slots-'+evId)||{}).value||'0',10);
  if (!name.trim()) { alert('Please enter a role name.'); return; }
  api('/admin/api/events/' + evId + '/roles', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,description:desc,slots:slots})
  }).then(function(d){
    if (!d.ok){alert('Add role failed: ' + (d.error||'Unknown error'));return;}
    volLoadEvents(evId);
  }).catch(function(e){alert('Error: '+e);});
}

// ── MINISTRY ROLES (master-detail: searchable list + side edit panel) ──
var _volMRolesCache = [];
var _volActiveMRoleId = null; // number = editing that role, 'new' = blank add form, null = nothing selected
var _volMRoleSearch = '';
var _volMRoleCollapsed = {}; // ministry key -> true if that group's roles are collapsed
var MR_MINISTRY_LABELS = {worship:'Worship',education:'Christian Ed',acceptance:'Acceptance',outreach:'Outreach',general:'General'};

function volToggleMRoleGroup(key) {
  _volMRoleCollapsed[key] = !_volMRoleCollapsed[key];
  volRenderMRolesList();
}

function volLoadMinistryRoles() {
  api('/admin/api/ministry-roles?ministry=')
    .then(function(d) {
      _volMRolesCache = d.roles || [];
      if (_volActiveMRoleId !== 'new' && !_volMRolesCache.some(function(r){ return r.id === _volActiveMRoleId; })) {
        _volActiveMRoleId = _volMRolesCache.length ? _volMRolesCache[0].id : null;
      }
      volRenderMRolesList();
      volRenderMRoleDetail();
    })
    .catch(function() {
      var listEl = document.getElementById('vol-mroles-list');
      if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading roles.</span>';
    });
}

function volFilterMRoles(q) {
  _volMRoleSearch = q || '';
  volRenderMRolesList();
}

function volRenderMRolesList() {
  var listEl = document.getElementById('vol-mroles-list');
  var countEl = document.getElementById('vol-mroles-count');
  if (!listEl) return;
  var q = _volMRoleSearch.trim().toLowerCase();
  var roles = _volMRolesCache.filter(function(r) {
    if (!q) return true;
    return (r.name||'').toLowerCase().indexOf(q) !== -1 || (MR_MINISTRY_LABELS[r.ministry]||r.ministry||'').toLowerCase().indexOf(q) !== -1;
  });
  if (countEl) countEl.textContent = _volMRolesCache.length;
  if (!roles.length) {
    listEl.innerHTML = '<div style="padding:14px 10px;text-align:center;color:var(--warm-gray);font-size:.85rem;">' + (_volMRolesCache.length ? 'No roles match your search.' : 'No roles yet — click "Add role" to create one.') + '</div>';
    return;
  }
  // Group by ministry (Worship, Christian Ed, Acceptance, Outreach, ...) so the list reads as
  // categorized sections instead of one flat run of roles.
  var order = Object.keys(MR_MINISTRY_LABELS);
  var groups = {};
  roles.forEach(function(r) {
    var key = r.ministry || '';
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });
  var orderedKeys = order.filter(function(k) { return groups[k]; })
    .concat(Object.keys(groups).filter(function(k) { return order.indexOf(k) === -1; }));
  // While searching, always show matches expanded regardless of collapsed state.
  listEl.innerHTML = orderedKeys.map(function(key) {
    var label = MR_MINISTRY_LABELS[key] || key || 'Other';
    var collapsed = !q && !!_volMRoleCollapsed[key];
    var hasActive = collapsed && groups[key].some(function(r){ return r.id === _volActiveMRoleId; });
    return '<div class="ev-list-group-hdr' + (collapsed ? ' collapsed' : '') + '" onclick="volToggleMRoleGroup(' + volJsAttr(key) + ')" title="' + (hasActive ? 'Contains the selected role' : '') + '">'
      + '<span class="ev-list-group-chevron">&#9662;</span>' + esc(label)
      + (hasActive ? '<span class="ev-list-group-active-dot" aria-label="Contains the selected role"></span>' : '') + '</div>'
      + (collapsed ? '' : groups[key].map(function(r) {
          return '<div class="ev-list-row' + (r.id===_volActiveMRoleId?' active':'') + '" onclick="volSelectMRole(' + r.id + ')">'
            + '<div class="ev-list-name">' + esc(r.name) + '</div>'
            + '<div class="ev-list-meta">' + (r.active ? 'Open' : 'Hidden') + '</div>'
            + '</div>';
        }).join(''));
  }).join('');
}

function volNewMinistryRole() {
  _volActiveMRoleId = 'new';
  volRenderMRolesList();
  volRenderMRoleDetail();
}

function volSelectMRole(id) {
  _volActiveMRoleId = id;
  volRenderMRolesList();
  volRenderMRoleDetail();
}

function volRenderMRoleDetail() {
  var detailEl = document.getElementById('vol-mrole-detail');
  if (!detailEl) return;
  if (_volActiveMRoleId === null) { detailEl.innerHTML = '<div style="padding:20px 10px;text-align:center;color:var(--warm-gray);font-size:.85rem;">Select a role, or add a new one.</div>'; return; }
  var isNew = _volActiveMRoleId === 'new';
  var role = isNew ? { name:'', ministry:'worship', description:'', commitment:'', training:'', active:1 } : _volMRolesCache.find(function(r){ return r.id === _volActiveMRoleId; });
  if (!role) { detailEl.innerHTML = ''; return; }
  var ministryOptions = Object.keys(MR_MINISTRY_LABELS).map(function(k) {
    return '<option value="' + k + '"' + (role.ministry===k?' selected':'') + '>' + MR_MINISTRY_LABELS[k] + '</option>';
  }).join('');

  detailEl.innerHTML = '<div class="ev-detail-topbar">'
    + '<span class="' + (role.active ? 'ev-badge-open' : 'ev-badge-hidden') + '">' + (role.active ? 'Open on site' : 'Hidden') + '</span>'
    + (isNew ? '' : '<a href="javascript:void(0)" class="ev-delete-link" onclick="volDeleteMinistryRole(' + role.id + ')">Delete role</a>')
    + '</div>'
    + '<div class="ev-fields">'
    + '<div><label>Role name</label><input type="text" id="vol-mrole-name" value="' + esc(role.name) + '" placeholder="e.g. Sunday Worship Care"></div>'
    + '<div><label>Ministry</label><select id="vol-mrole-ministry-sel" style="max-width:220px;">' + ministryOptions + '</select></div>'
    + '<div><label>Description</label><textarea id="vol-mrole-desc" placeholder="Brief description of this role…">' + esc(role.description||'') + '</textarea></div>'
    + '<div><label>Commitment / schedule</label><input type="text" id="vol-mrole-commitment" value="' + esc(role.commitment||'') + '" placeholder="e.g. Weekly, Thursday rehearsal"></div>'
    + '<div><label>Training</label><input type="text" id="vol-mrole-training" value="' + esc(role.training||'') + '" placeholder="e.g. 15-minute walk-through"></div>'
    + '<label class="toggle-switch ev-toggle-row"><input type="checkbox" id="vol-mrole-active"' + (role.active?' checked':'') + '><span class="toggle-track"></span><span style="font-size:.78rem;font-weight:600;color:#1E2D4A;">Visible on the volunteer site</span></label>'
    + '<div style="display:flex;gap:10px;margin-top:2px;">'
    + '<button class="ev-btn-primary" onclick="volSaveMinistryRole()">' + (isNew ? 'Save role' : 'Save changes') + '</button>'
    + (isNew ? '<button class="ev-btn-secondary" onclick="volSelectMRole(' + (_volMRolesCache[0] ? _volMRolesCache[0].id : 'null') + ')">Cancel</button>' : '')
    + '</div></div>';
}

function volSaveMinistryRole() {
  var isNew = _volActiveMRoleId === 'new';
  var name = ((document.getElementById('vol-mrole-name')||{}).value || '').trim();
  if (!name) { alert('Role name is required.'); return; }
  var ministry = (document.getElementById('vol-mrole-ministry-sel')||{}).value || 'worship';
  var desc = (document.getElementById('vol-mrole-desc')||{}).value || '';
  var commitment = (document.getElementById('vol-mrole-commitment')||{}).value || '';
  var training = (document.getElementById('vol-mrole-training')||{}).value || '';
  var active = (document.getElementById('vol-mrole-active')||{}).checked !== false;
  var method = isNew ? 'POST' : 'PUT';
  var url = '/admin/api/ministry-roles' + (isNew ? '' : '/' + _volActiveMRoleId);
  api(url, {
    method: method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, ministry: ministry, description: desc, commitment: commitment, training: training, active: active })
  }).then(function(d) {
    if (!d.ok && !d.id) { alert(d.error || 'Save failed'); return; }
    if (isNew && d.id) _volActiveMRoleId = d.id;
    volLoadMinistryRoles();
  }).catch(function(e) { alert('Error: ' + e); });
}

function volDeleteMinistryRole(id) {
  if (!confirm('Delete this role? Existing sign-ups will not be affected.')) return;
  api('/admin/api/ministry-roles/' + id, { method: 'DELETE' })
    .then(function() { _volActiveMRoleId = null; volLoadMinistryRoles(); });
}
</script>
`;
