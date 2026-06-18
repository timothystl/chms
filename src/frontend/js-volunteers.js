export const JS_VOLUNTEERS = String.raw`// ── VOLUNTEERS TAB ────────────────────────────────────────────────────
var _volCurrentTab = 'all';
var _volDupVisible = false;
var _volTemplates = [];
var _volSignupsCache = [];

// ── Ministry labels ───────────────────────────────────────────────────
var VOL_MINISTRY_LABELS = {all:'All',worship:'Worship',events:'Events',education:'Education',
  acceptance:'Acceptance',outreach:'Outreach',transportation:'Transportation',general:'General'};

function volSetTab(tab, btn) {
  _volCurrentTab = tab;
  document.querySelectorAll('#vol-ministry-tabs .btn-secondary').forEach(function(b) {
    b.classList.toggle('active', b === btn);
    b.style.background = b === btn ? 'var(--navy)' : '';
    b.style.color = b === btn ? '#fff' : '';
  });
  var exportLink = document.getElementById('vol-export-link');
  if (exportLink) exportLink.href = '/admin/api/export.csv' + (tab !== 'all' ? '?ministry=' + tab : '');
  volLoadSignups();
}

function volLoadSignups() {
  var url = '/admin/api/signups' + (_volCurrentTab !== 'all' ? '?ministry=' + _volCurrentTab : '');
  var listEl = document.getElementById('vol-signups-list');
  if (listEl) listEl.innerHTML = '<span style="color:var(--warm-gray);">Loading…</span>';
  api(url)
    .then(function(d) {
      var items = d.signups || [];
      _volSignupsCache = items;
      var titleEl = document.getElementById('vol-signups-title');
      if (titleEl) titleEl.innerHTML = (VOL_MINISTRY_LABELS[_volCurrentTab]||_volCurrentTab) + ' Volunteers <span id="vol-signups-count" style="background:var(--navy);color:#fff;border-radius:99px;padding:1px 8px;font-size:.75rem;margin-left:4px;">' + items.length + '</span>';
      if (!items.length) {
        if (listEl) listEl.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--warm-gray);">No sign-ups yet.</div>';
        return;
      }
      if (listEl) listEl.innerHTML = items.map(function(s) {
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
        // Person link badge
        var personBadge = s.person_id
          ? '<span style="font-size:.72rem;background:rgba(46,126,166,.12);color:var(--sky-steel);border:1px solid rgba(46,126,166,.25);border-radius:6px;padding:1px 7px;cursor:pointer;" onclick="openPersonProfile(' + s.person_id + ')" title="Open profile">✓ ' + esc(s.linked_person_name || 'Person') + '</span>'
          : '<span style="font-size:.72rem;color:var(--warm-gray);">Not in People</span>';
        // Contact count badge
        var contactBadge = s.contact_count > 0
          ? '<span style="font-size:.72rem;background:rgba(39,174,96,.1);color:#1a7a3a;border:1px solid rgba(39,174,96,.25);border-radius:6px;padding:1px 7px;" title="Last: ' + esc((s.contacted_at||'').slice(0,10)) + '">✉ ' + s.contact_count + '×</span>'
          : '';
        return '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;">'
          + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
          + '<div><div style="font-weight:600;font-size:.92rem;">' + esc(s.name) + '</div>'
          + '<div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--sky-steel);">' + esc(s.ministry) + '</div>'
          + '<div style="display:flex;gap:5px;margin-top:4px;flex-wrap:wrap;">' + personBadge + (contactBadge ? ' ' + contactBadge : '') + '</div>'
          + '</div>'
          + '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end;">'
          + '<span style="font-size:.75rem;color:var(--warm-gray);">' + esc((s.created_at||'').slice(0,10)) + '</span>'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;" onclick="volOpenLinkPerson(' + s.id + ',' + JSON.stringify(esc(s.name)) + ',' + JSON.stringify(esc(s.email)) + ',' + (s.person_id||'null') + ',' + JSON.stringify(esc(s.linked_person_name||'')) + ')" title="Link to person record">'
          + (s.person_id ? '↩ Relink' : '+ Link') + '</button>'
          + (s.email ? '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--teal);border-color:rgba(46,126,166,.3);" data-sig-id="' + s.id + '" data-sig-name="' + esc(s.name) + '" data-sig-email="' + esc(s.email) + '" data-sig-ministry="' + esc(s.ministry) + '" onclick="volOpenSendEmail(this)">✉ Email</button>' : '')
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--danger);border-color:rgba(192,57,43,.3);" onclick="volDeleteSignup(' + s.id + ')">Remove</button>'
          + '</div></div>'
          + (meta.length ? '<div style="font-size:.82rem;color:#4A4860;margin-top:6px;line-height:1.6;">' + meta.join(' &nbsp;&bull;&nbsp; ') + '</div>' : '')
          + (roles.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">' + roles.map(function(r){ return '<span style="background:rgba(30,45,74,.07);border:1px solid var(--border);border-radius:6px;padding:2px 8px;font-size:.78rem;">' + esc(r) + '</span>'; }).join('') + '</div>' : '')
          + (s.notes ? '<div style="font-size:.82rem;color:#6A6880;font-style:italic;margin-top:4px;">"' + esc(s.notes) + '"</div>' : '')
          + '</div>';
      }).join('');
    })
    .catch(function() { if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading sign-ups.</span>'; });
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
  var signupId = btn.dataset.sigId;
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
    return '<div style="background:var(--white);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
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

// ── EVENTS ────────────────────────────────────────────────────────────
function volLoadEvents(expandEvId) {
  api('/admin/api/events')
    .then(function(data) {
      var events = data.events || [];
      var cntEl = document.getElementById('vol-events-count');
      if (cntEl) cntEl.textContent = events.length;
      var listEl = document.getElementById('vol-events-list');
      if (!events.length) {
        if (listEl) listEl.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--warm-gray);">No events yet.</div>';
        return;
      }
      var preserved = {};
      document.querySelectorAll('[id^="vr-start-"],[id^="vr-end-"],[id^="vr-date-"]').forEach(function(el) { if (el.value) preserved[el.id] = el.value; });
      if (listEl) listEl.innerHTML = events.map(function(ev) {
        var useTs = (ev.use_time_slots === undefined || ev.use_time_slots === null) ? 1 : ev.use_time_slots;
        var tsHide = useTs ? '' : 'display:none;';
        var statusLabel = ev.hidden ? 'Hidden' : 'Visible';
        var statusColor = ev.hidden ? 'color:#c0392b;background:rgba(192,57,43,.1);' : 'color:var(--teal);background:rgba(46,126,166,.1);';
        return '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;overflow:hidden;" id="vol-ev-' + ev.id + '" data-hidden="' + (ev.hidden?1:0) + '" data-sort-order="' + (ev.sort_order||0) + '" data-use-time-slots="' + useTs + '">'
          + '<button onclick="volToggleEv(' + ev.id + ')" aria-expanded="false" id="vol-ev-hdr-' + ev.id + '" style="width:100%;display:flex;align-items:center;gap:10px;padding:12px 14px;background:none;border:none;cursor:pointer;text-align:left;">'
          + '<span style="font-weight:600;font-size:.9rem;flex:1;">' + esc(ev.name) + '</span>'
          + '<span style="font-size:.78rem;color:var(--warm-gray);">' + (ev.event_date || 'No date') + '</span>'
          + '<span style="font-size:.72rem;font-weight:600;border-radius:99px;padding:1px 8px;' + statusColor + '">' + statusLabel + '</span>'
          + '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:currentColor;stroke-width:2.5;fill:none;flex-shrink:0;transition:transform .2s;" id="vol-ev-chevron-' + ev.id + '"><polyline points="6 9 12 15 18 9"/></svg>'
          + '</button>'
          + '<div id="vol-ev-body-' + ev.id + '" style="display:none;border-top:1px solid var(--border);padding:14px;">'
          + '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">'
          + '<div style="flex:1;min-width:180px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Event Name</label><input type="text" id="vol-ev-name-' + ev.id + '" class="form-input" style="width:100%;" value="' + esc(ev.name) + '"></div>'
          + '<div style="flex:0 0 150px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Date</label><input type="date" id="vol-ev-date-' + ev.id + '" class="form-input" style="width:100%;" value="' + esc(ev.event_date||'') + '"></div>'
          + '</div>'
          + '<div style="margin-bottom:8px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Description</label><textarea id="vol-ev-desc-' + ev.id + '" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;height:56px;resize:vertical;">' + esc(ev.description||'') + '</textarea></div>'
          + '<input type="hidden" id="vol-ev-hidden-' + ev.id + '" value="' + (ev.hidden?1:0) + '">'
          + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><input type="checkbox" id="vol-ev-ts-' + ev.id + '"' + (useTs ? ' checked' : '') + ' style="width:auto;margin:0;" onchange="volToggleTsFields(' + ev.id + ',this.checked)"><label for="vol-ev-ts-' + ev.id + '" style="font-size:.82rem;cursor:pointer;">Roles have scheduled time slots</label></div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'
          + '<button class="btn-primary" style="font-size:.8rem;" onclick="volSaveEvent(' + ev.id + ')">Save Changes</button>'
          + '<button class="btn-secondary" style="font-size:.8rem;" onclick="volToggleEventVisibility(' + ev.id + ',' + (ev.hidden?0:1) + ')">' + (ev.hidden?'Make Visible':'Hide Event') + '</button>'
          + '<button class="btn-secondary" style="font-size:.8rem;color:var(--danger);" onclick="volDeleteEvent(' + ev.id + ')">Delete Event</button>'
          + '</div>'
          + '<div style="font-size:.82rem;font-weight:600;color:var(--charcoal);margin-bottom:6px;">Roles</div>'
          + '<div id="vol-roles-list-' + ev.id + '">'
          + (ev.roles||[]).map(function(r) {
              return '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--linen);" id="vol-role-row-' + r.id + '" data-sort-order="' + (r.sort_order||0) + '">'
                + '<span style="font-size:.72rem;font-weight:600;color:var(--sky-steel);white-space:nowrap;min-width:36px;text-align:center;">' + (r.filled_count||0) + '/' + (r.slots||'∞') + '</span>'
                + '<input type="text" class="form-input" style="flex:1;min-width:100px;" id="vol-role-name-' + r.id + '" value="' + esc(r.name) + '" placeholder="Role name">'
                + '<input type="text" class="form-input" style="flex:2;min-width:120px;" id="vol-role-desc-' + r.id + '" value="' + esc(r.description||'') + '" placeholder="Description">'
                + '<input type="date" class="form-input vr-time-field" style="flex:1;min-width:110px;' + tsHide + '" id="vr-date-' + r.id + '" value="' + esc(r.role_date||'') + '" title="Date">'
                + '<input type="time" class="form-input vr-time-field" style="flex:0 0 84px;' + tsHide + '" id="vr-start-' + r.id + '" data-raw="' + esc(r.start_time||'') + '" title="Start">'
                + '<input type="time" class="form-input vr-time-field" style="flex:0 0 84px;' + tsHide + '" id="vr-end-' + r.id + '" data-raw="' + esc(r.end_time||'') + '" title="End">'
                + '<input type="number" class="form-input" style="flex:0 0 56px;" id="vol-role-slots-' + r.id + '" value="' + (r.slots||0) + '" min="0" title="Slots">'
                + '<button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="volSaveRole(' + ev.id + ',' + r.id + ')">Save</button>'
                + '<button class="btn-secondary" style="font-size:.78rem;padding:4px 8px;color:var(--danger);" onclick="volDeleteRole(' + ev.id + ',' + r.id + ')">Del</button>'
                + '</div>';
            }).join('')
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">'
          + '<input type="text" class="form-input" style="flex:1;min-width:100px;" id="vol-new-role-name-' + ev.id + '" placeholder="Role name…">'
          + '<input type="text" class="form-input" style="flex:2;min-width:120px;" id="vol-new-role-desc-' + ev.id + '" placeholder="Description…">'
          + '<input type="date" class="form-input vr-time-field" style="flex:1;min-width:110px;' + tsHide + '" id="vol-new-role-date-' + ev.id + '" title="Date">'
          + '<input type="time" class="form-input vr-time-field" style="flex:0 0 84px;' + tsHide + '" id="vol-new-role-start-' + ev.id + '" title="Start">'
          + '<input type="time" class="form-input vr-time-field" style="flex:0 0 84px;' + tsHide + '" id="vol-new-role-end-' + ev.id + '" title="End">'
          + '<input type="number" class="form-input" style="flex:0 0 56px;" id="vol-new-role-slots-' + ev.id + '" value="0" min="0" title="Slots">'
          + '<button class="btn-primary" style="font-size:.8rem;" onclick="volAddRole(' + ev.id + ')">+ Role</button>'
          + '</div>'
          + '</div>'
          + '</div>';
      }).join('');
      // Set time input values via JS (innerHTML doesn't reliably set type=time values)
      events.forEach(function(ev) {
        (ev.roles||[]).forEach(function(r) {
          var startEl = document.getElementById('vr-start-' + r.id);
          var endEl   = document.getElementById('vr-end-'   + r.id);
          if (startEl) startEl.value = volToTimeInput(r.start_time || '');
          if (endEl)   endEl.value   = volToTimeInput(r.end_time   || '');
        });
      });
      // Restore preserved values
      Object.keys(preserved).forEach(function(id) {
        var el = document.getElementById(id); if (el && preserved[id]) el.value = preserved[id];
      });
      if (expandEvId) {
        var body = document.getElementById('vol-ev-body-' + expandEvId);
        var hdr  = document.getElementById('vol-ev-hdr-' + expandEvId);
        if (body) body.style.display = '';
        if (hdr)  hdr.setAttribute('aria-expanded','true');
        var chev = document.getElementById('vol-ev-chevron-' + expandEvId);
        if (chev) chev.style.transform = 'rotate(180deg)';
      }
    })
    .catch(function() {
      var listEl = document.getElementById('vol-events-list');
      if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading events.</span>';
    });
}

function volToggleEv(evId) {
  var body = document.getElementById('vol-ev-body-' + evId);
  var hdr  = document.getElementById('vol-ev-hdr-'  + evId);
  var chev = document.getElementById('vol-ev-chevron-' + evId);
  var isOpen = body && body.style.display !== 'none';
  document.querySelectorAll('[id^="vol-ev-body-"]').forEach(function(el) { el.style.display = 'none'; });
  document.querySelectorAll('[id^="vol-ev-hdr-"]').forEach(function(b) { b.setAttribute('aria-expanded','false'); });
  document.querySelectorAll('[id^="vol-ev-chevron-"]').forEach(function(c) { c.style.transform = ''; });
  if (!isOpen) {
    if (body) body.style.display = '';
    if (hdr)  hdr.setAttribute('aria-expanded','true');
    if (chev) chev.style.transform = 'rotate(180deg)';
  }
}

function volToggleTsFields(evId, show) {
  var card = document.getElementById('vol-ev-' + evId);
  if (!card) return;
  card.querySelectorAll('.vr-time-field').forEach(function(el) { el.style.display = show ? '' : 'none'; });
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

function volSaveEvent(evId) {
  var name = (document.getElementById('vol-ev-name-' + evId)||{}).value || '';
  var date = (document.getElementById('vol-ev-date-' + evId)||{}).value || '';
  var desc = (document.getElementById('vol-ev-desc-' + evId)||{}).value || '';
  var card = document.getElementById('vol-ev-' + evId);
  var hidden = card ? parseInt(card.dataset.hidden||'0',10) : 0;
  var sortOrder = card ? parseInt(card.dataset.sortOrder||'0',10) : 0;
  var tsEl = document.getElementById('vol-ev-ts-' + evId);
  var useTimeSlots = tsEl ? (tsEl.checked?1:0) : 1;
  api('/admin/api/events/' + evId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,event_date:date,description:desc,hidden:hidden,sort_order:sortOrder,use_time_slots:useTimeSlots})
  }).then(function(d) {
    if (!d.ok) { alert('Save failed: ' + (d.error || 'Unknown error')); return; }
    volLoadEvents(evId);
  }).catch(function(e){alert('Save error: '+e);});
}

function volToggleEventVisibility(evId, hidden) {
  var name = (document.getElementById('vol-ev-name-' + evId)||{}).value || '';
  var date = (document.getElementById('vol-ev-date-' + evId)||{}).value || '';
  var desc = (document.getElementById('vol-ev-desc-' + evId)||{}).value || '';
  var card = document.getElementById('vol-ev-' + evId);
  var sortOrder = card ? parseInt(card.dataset.sortOrder||'0',10) : 0;
  var tsEl = document.getElementById('vol-ev-ts-' + evId);
  var useTimeSlots = tsEl ? (tsEl.checked?1:0) : 1;
  api('/admin/api/events/' + evId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,event_date:date,description:desc,hidden:hidden,sort_order:sortOrder,use_time_slots:useTimeSlots})
  }).then(function(d) {
    if (!d.ok) { alert('Error: ' + (d.error || 'Unknown error')); return; }
    volLoadEvents();
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
  var name   = (document.getElementById('vol-role-name-'  + roleId)||{}).value||'';
  var desc   = (document.getElementById('vol-role-desc-'  + roleId)||{}).value||'';
  var date   = (document.getElementById('vr-date-'  + roleId)||{}).value||'';
  var startEl = document.getElementById('vr-start-' + roleId);
  var endEl   = document.getElementById('vr-end-'   + roleId);
  var start = startEl ? (startEl.value ? volFromTimeInput(startEl.value) : (startEl.dataset.raw||'')) : '';
  var end   = endEl   ? (endEl.value   ? volFromTimeInput(endEl.value)   : (endEl.dataset.raw  ||'')) : '';
  var slots = parseInt((document.getElementById('vol-role-slots-' + roleId)||{}).value||'0',10);
  var row = document.getElementById('vol-role-row-' + roleId);
  var sortOrder = row ? parseInt(row.dataset.sortOrder||'0',10) : 0;
  var saveBtn = row ? row.querySelector('.btn-secondary') : null;
  if (saveBtn) { saveBtn.disabled=true; saveBtn.textContent='Saving…'; }
  api('/admin/api/events/' + evId + '/roles/' + roleId, {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,description:desc,slots:slots,role_date:date,start_time:start,end_time:end,sort_order:sortOrder})
  }).then(function(d) {
    if (!d.ok) { alert('Error saving role.'); if (saveBtn){saveBtn.disabled=false;saveBtn.textContent='Save';} return; }
    if (startEl && startEl.value) startEl.dataset.raw = start;
    if (endEl   && endEl.value)   endEl.dataset.raw   = end;
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
  var date  = (document.getElementById('vol-new-role-date-' +evId)||{}).value||'';
  var start = volFromTimeInput((document.getElementById('vol-new-role-start-'+evId)||{}).value||'');
  var end   = volFromTimeInput((document.getElementById('vol-new-role-end-'  +evId)||{}).value||'');
  var slots = parseInt((document.getElementById('vol-new-role-slots-'+evId)||{}).value||'0',10);
  if (!name.trim()) { alert('Please enter a role name.'); return; }
  api('/admin/api/events/' + evId + '/roles', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:name,description:desc,slots:slots,role_date:date,start_time:start,end_time:end})
  }).then(function(d){
    if (!d.ok){alert('Add role failed: ' + (d.error||'Unknown error'));return;}
    ['vol-new-role-name-','vol-new-role-desc-','vol-new-role-date-','vol-new-role-start-','vol-new-role-end-','vol-new-role-slots-'].forEach(function(pfx){var el=document.getElementById(pfx+evId);if(el)el.value='';});
    volLoadEvents(evId);
  }).catch(function(e){alert('Error: '+e);});
}

// ── MINISTRY ROLES ─────────────────────────────────────────────────────

function volLoadMinistryRoles() {
  var ministry = (document.getElementById('vol-mroles-ministry')||{}).value || 'worship';
  var listEl = document.getElementById('vol-mroles-list');
  var countEl = document.getElementById('vol-mroles-count');
  if (listEl) listEl.innerHTML = '<span style="color:var(--warm-gray);">Loading…</span>';
  api('/admin/api/ministry-roles?ministry=' + encodeURIComponent(ministry))
    .then(function(d) {
      var roles = d.roles || [];
      if (countEl) countEl.textContent = roles.length;
      if (!roles.length) {
        if (listEl) listEl.innerHTML = '<div style="padding:14px 0;text-align:center;color:var(--warm-gray);font-size:.85rem;">No roles yet. Click “+ Add Role” to create one.</div>';
        return;
      }
      if (listEl) listEl.innerHTML = roles.map(function(r) {
        var activeBadge = r.active
          ? '<span style="font-size:.7rem;background:rgba(39,174,96,.1);color:#1a7a3a;border:1px solid rgba(39,174,96,.3);border-radius:6px;padding:1px 7px;">Visible</span>'
          : '<span style="font-size:.7rem;background:rgba(192,57,43,.08);color:var(--danger);border:1px solid rgba(192,57,43,.2);border-radius:6px;padding:1px 7px;">Hidden</span>';
        var meta = [];
        if (r.commitment) meta.push('<strong>Commitment:</strong> ' + esc(r.commitment));
        if (r.training) meta.push('<strong>Training:</strong> ' + esc(r.training));
        return '<div style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:7px;">'
          + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">'
          + '<div style="min-width:0;">'
          + '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;">'
          + '<span style="font-weight:600;font-size:.9rem;">' + esc(r.name) + '</span>' + activeBadge
          + '</div>'
          + (r.description ? '<div style="font-size:.82rem;color:#4A4860;margin-top:3px;">' + esc(r.description) + '</div>' : '')
          + (meta.length ? '<div style="font-size:.8rem;color:var(--warm-gray);margin-top:3px;">' + meta.join(' &nbsp;&bull;&nbsp; ') + '</div>' : '')
          + '</div>'
          + '<div style="display:flex;gap:5px;flex-shrink:0;">'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;" onclick="volEditMinistryRole(' + r.id + ')">Edit</button>'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--danger);border-color:rgba(192,57,43,.3);" onclick="volDeleteMinistryRole(' + r.id + ')">Del</button>'
          + '</div></div></div>';
      }).join('');
    })
    .catch(function() { if (listEl) listEl.innerHTML = '<span style="color:var(--danger);">Error loading roles.</span>'; });
}

function volShowMRoleForm() {
  var ministry = (document.getElementById('vol-mroles-ministry')||{}).value || 'worship';
  var editingEl = document.getElementById('vol-mrole-editing-id');
  if (editingEl) editingEl.value = '';
  var titleEl = document.getElementById('vol-mrole-form-title');
  if (titleEl) titleEl.textContent = 'Add Role';
  var saveBtn = document.getElementById('vol-mrole-save-btn');
  if (saveBtn) saveBtn.textContent = 'Save Role';
  var sel = document.getElementById('vol-mrole-ministry-sel');
  if (sel) sel.value = ministry;
  ['vol-mrole-name','vol-mrole-desc','vol-mrole-commitment','vol-mrole-training'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
  var activeEl = document.getElementById('vol-mrole-active');
  if (activeEl) activeEl.checked = true;
  var formEl = document.getElementById('vol-mrole-form');
  if (formEl) { formEl.style.display = ''; formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function volCancelMRoleForm() {
  var formEl = document.getElementById('vol-mrole-form');
  if (formEl) formEl.style.display = 'none';
  var editingEl = document.getElementById('vol-mrole-editing-id');
  if (editingEl) editingEl.value = '';
}

function volEditMinistryRole(id) {
  api('/admin/api/ministry-roles?ministry=')
    .then(function(d) {
      var role = (d.roles || []).find(function(r) { return r.id === id; });
      if (!role) { alert('Role not found.'); return; }
      var editingEl = document.getElementById('vol-mrole-editing-id');
      if (editingEl) editingEl.value = id;
      var titleEl = document.getElementById('vol-mrole-form-title');
      if (titleEl) titleEl.textContent = 'Edit Role';
      var saveBtn = document.getElementById('vol-mrole-save-btn');
      if (saveBtn) saveBtn.textContent = 'Save Changes';
      var nameEl = document.getElementById('vol-mrole-name'); if (nameEl) nameEl.value = role.name || '';
      var descEl = document.getElementById('vol-mrole-desc'); if (descEl) descEl.value = role.description || '';
      var commEl = document.getElementById('vol-mrole-commitment'); if (commEl) commEl.value = role.commitment || '';
      var trainEl = document.getElementById('vol-mrole-training'); if (trainEl) trainEl.value = role.training || '';
      var activeEl = document.getElementById('vol-mrole-active'); if (activeEl) activeEl.checked = role.active !== 0;
      var sel = document.getElementById('vol-mrole-ministry-sel'); if (sel) sel.value = role.ministry || 'worship';
      var formEl = document.getElementById('vol-mrole-form');
      if (formEl) { formEl.style.display = ''; formEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
}

function volSaveMinistryRole() {
  var editingId = parseInt((document.getElementById('vol-mrole-editing-id')||{}).value || '0');
  var name = ((document.getElementById('vol-mrole-name')||{}).value || '').trim();
  if (!name) { alert('Role name is required.'); return; }
  var ministry = (document.getElementById('vol-mrole-ministry-sel')||{}).value || 'worship';
  var desc = (document.getElementById('vol-mrole-desc')||{}).value || '';
  var commitment = (document.getElementById('vol-mrole-commitment')||{}).value || '';
  var training = (document.getElementById('vol-mrole-training')||{}).value || '';
  var active = (document.getElementById('vol-mrole-active')||{}).checked !== false;
  var saveBtn = document.getElementById('vol-mrole-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  var method = editingId ? 'PUT' : 'POST';
  var url = '/admin/api/ministry-roles' + (editingId ? '/' + editingId : '');
  api(url, {
    method: method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, ministry: ministry, description: desc, commitment: commitment, training: training, active: active })
  }).then(function(d) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editingId ? 'Save Changes' : 'Save Role'; }
    if (!d.ok && !d.id) { alert(d.error || 'Save failed'); return; }
    // Switch ministry filter to match saved role and reload
    var filterSel = document.getElementById('vol-mroles-ministry');
    if (filterSel) filterSel.value = ministry;
    volCancelMRoleForm();
    volLoadMinistryRoles();
  }).catch(function(e) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = editingId ? 'Save Changes' : 'Save Role'; }
    alert('Error: ' + e);
  });
}

function volDeleteMinistryRole(id) {
  if (!confirm('Delete this role? Existing sign-ups will not be affected.')) return;
  api('/admin/api/ministry-roles/' + id, { method: 'DELETE' })
    .then(function() { volLoadMinistryRoles(); });
}
</script>
`;
