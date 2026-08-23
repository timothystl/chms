import { DEPLOY_VERSION } from '../frontend/js-core.js';
export const PUBLIC_SCRIPTS = `<script src="/serve-app.js?v=${DEPLOY_VERSION}"></script>
</body>
</html>`;


export const PUBLIC_APP_JS = `
// ── Page navigation ───────────────────────────────────────────────────
var _dynRolesLoaded = {};
function loadDynamicMinistryRoles(ministry) {
  if (_dynRolesLoaded[ministry]) return;
  var grid = document.querySelector('#page-' + ministry + ' .role-grid');
  if (!grid) return;
  _dynRolesLoaded[ministry] = true;
  fetch('/api/ministry-roles?ministry=' + ministry)
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var roles = data.roles || [];
      if (!roles.length) return;
      var html = roles.map(function(r) {
        var idKey = 'r-dyn-' + r.id;
        var meta = '';
        if (r.commitment) meta += '<div class="role-meta-item"><strong>Commitment:</strong> ' + escH(r.commitment) + '</div>';
        if (r.training) meta += '<div class="role-meta-item"><strong>Training:</strong> ' + escH(r.training) + '</div>';
        return '<label class="role-card" for="' + idKey + '">'
          + '<input type="checkbox" id="' + idKey + '" name="roles" value="' + escH(r.name) + '" data-ministry="' + ministry + '">'
          + '<div class="role-card-top"><div class="role-check" aria-hidden="true"></div><span class="role-name">' + escH(r.name) + '</span></div>'
          + (r.description ? '<p class="role-desc">' + escH(r.description) + '</p>' : '')
          + (meta ? '<div class="role-meta">' + meta + '</div>' : '')
          + '</label>';
      }).join('');
      grid.insertAdjacentHTML('beforeend', html);
    })
    .catch(function() {});
}

var _eventPageRe = /^event-(\\d+)$/;

function showPageAndLoad(pageId) {
  document.querySelectorAll('.app-page').forEach(function(p) { p.hidden = true; });
  var target = document.getElementById('page-' + pageId);
  if (target) { target.hidden = false; }
  window.scrollTo({ top: 0, behavior: 'instant' });
  if (pageId === 'events') { loadDynamicEvents(); }
  if (pageId === 'worship' || pageId === 'education' || pageId === 'acceptance' || pageId === 'outreach') {
    loadDynamicMinistryRoles(pageId);
  }
  if (pageId === 'landing') { svWizardInit(); }
  if (pageId === 'market') { svMktInit(); svMktLoad(); }
  else { document.body.classList.remove('sv-market-open'); }
  svUpdateHeaderCta(pageId);
}

function navigate(pageId) {
  var m = pageId.match(_eventPageRe);
  if (m) { openEventPage(parseInt(m[1], 10)); return; }
  showPageAndLoad(pageId);
  history.pushState({ page: pageId }, '', pageId === 'landing' ? location.pathname : '#' + pageId);
}

window.addEventListener('popstate', function(e) {
  var pageId = (e.state && e.state.page) ? e.state.page : 'landing';
  var m = pageId.match(_eventPageRe);
  if (m) { openEventPage(parseInt(m[1], 10), true); return; }
  showPageAndLoad(pageId);
});

(function() {
  var hash = location.hash.replace('#', '');
  var m = hash.match(_eventPageRe);
  if (m) {
    openEventPage(parseInt(m[1], 10), true);
  } else if (hash && document.getElementById('page-' + hash)) {
    showPageAndLoad(hash);
    history.replaceState({ page: hash }, '', '#' + hash);
  } else {
    history.replaceState({ page: 'landing' }, '', location.pathname);
  }
})();

// ── Menu drawer (hamburger nav) ────────────────────────────────────────
function openDrawer() {
  var d = document.getElementById('menu-drawer');
  var b = document.getElementById('drawer-backdrop');
  if (d) { d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
  if (b) b.classList.add('open');
  document.body.classList.add('drawer-open');
}
function closeDrawer() {
  var d = document.getElementById('menu-drawer');
  var b = document.getElementById('drawer-backdrop');
  if (d) { d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
  if (b) b.classList.remove('open');
  document.body.classList.remove('drawer-open');
}
document.addEventListener('click', function(e) {
  if (e.target.closest('#hamburger-btn')) { openDrawer(); return; }
  if (e.target.closest('#drawer-close-btn')) { closeDrawer(); return; }
  if (e.target.id === 'drawer-backdrop') { closeDrawer(); return; }
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeDrawer();
});

// ── Role card checkbox toggle ────────────────────────────────────────
document.addEventListener('change', function(e) {
  var t = e.target;
  if (t.type === 'checkbox' && t.name === 'roles') {
    var card = t.closest('.role-card');
    if (card) { card.classList.toggle('selected', t.checked); var chk = card.querySelector('.role-check'); if (chk) chk.textContent = t.checked ? '\\u2713' : ''; }
    updatePreviews();
  }
  if (t.type === 'checkbox' && t.name && t.name.indexOf('ev-role-') === 0) {
    var evRoleCard = t.closest('.role-card');
    if (evRoleCard) { evRoleCard.classList.toggle('selected', t.checked); var evChk = evRoleCard.querySelector('.role-check'); if (evChk) evChk.textContent = t.checked ? '\\u2713' : ''; }
  }
  if (t.type === 'checkbox' && t.name && t.name.indexOf('ev-slot-') === 0) {
    var slotCard = t.closest('.role-card');
    if (slotCard) { slotCard.classList.toggle('selected', t.checked); var slotChk = slotCard.querySelector('.role-check'); if (slotChk) slotChk.textContent = t.checked ? '\\u2713' : ''; }
    updateShiftCount(t.name.slice('ev-slot-'.length));
  }
  if (t.type === 'radio' && t.name === 'svc') { document.querySelectorAll('#svc-chips .chip-label').forEach(function(l) { l.classList.toggle('checked', l.querySelector('input').checked); }); }
  if (t.type === 'checkbox' && t.name === 'sun') { t.closest('.chip-label').classList.toggle('checked', t.checked); }
  if (t.type === 'checkbox' && (t.name === 'acc-trans-svc' || t.name === 'acc-trans-avail')) { t.closest('.chip-label').classList.toggle('checked', t.checked); }
  if (t.type === 'radio' && t.name === 'acc-trans-wc') { document.querySelectorAll('#acc-trans-wc-chips .chip-label').forEach(function(l) { l.classList.toggle('checked', l.querySelector('input').checked); }); }
  if (t.type === 'radio' && t.name === 'ff-time') { document.querySelectorAll('#ff-time-chips .chip-label').forEach(function(l) { l.classList.toggle('checked', l.querySelector('input').checked); }); }
});

// ── Find Your Fit (guided 2-tap intake) ────────────────────────────────
var FF_MINISTRY_META = {
  worship: { label: 'Worship' }, education: { label: 'Christian Education' },
  acceptance: { label: 'Acceptance' }, outreach: { label: 'Outreach' },
};
var FF_TIME_LABELS = { hour: 'An hour on Sunday', month: 'A few hours a month', unsure: 'Flexible on time' };

function ffShowResults() {
  var interests = Array.from(document.querySelectorAll('input[name="ff-interest"]:checked')).map(function(c){ return c.value; });
  if (!interests.length) { alert('Please select at least one area that draws you \\u2014 or tap "Skip" to browse everything.'); return; }
  var timeEl = document.querySelector('input[name="ff-time"]:checked');
  var time = timeEl ? timeEl.value : 'unsure';
  var subhead = document.getElementById('ff-results-subhead');
  if (subhead) subhead.textContent = FF_TIME_LABELS[time] + ' \\u00B7 ' + interests.map(function(i){ return (FF_MINISTRY_META[i]||{}).label || i; }).join(', ');
  var listEl = document.getElementById('ff-results-list');
  if (listEl) listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">Finding roles\\u2026</p>';
  document.getElementById('ff-step1').hidden = true;
  document.getElementById('ff-step2').hidden = false;
  window.scrollTo({ top: 0, behavior: 'instant' });

  Promise.all(interests.map(function(m) {
    return fetch('/api/ministry-roles?ministry=' + m).then(function(r) { return r.json(); })
      .then(function(d) { return (d.roles || []).map(function(role) { role._ministry = m; return role; }); })
      .catch(function() { return []; });
  })).then(function(results) {
    var roles = [].concat.apply([], results);
    if (!roles.length) {
      listEl.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:1rem;">No open roles listed in those areas right now \\u2014 but we would still love your help. <a href="javascript:void(0)" data-nav-page="general" style="color:var(--teal);font-weight:600;">Tell us about yourself</a>.</p>';
      return;
    }
    listEl.innerHTML = roles.map(function(role) {
      var meta = FF_MINISTRY_META[role._ministry] || { label: role._ministry };
      return '<a href="javascript:void(0)" data-nav-page="' + role._ministry + '" class="role-card" style="display:block;text-decoration:none;">'
        + '<div class="role-card-top"><span class="role-name">' + escH(role.name) + '</span></div>'
        + (role.description ? '<p class="role-desc">' + escH(role.description) + '</p>' : '')
        + '<span style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--teal);">' + meta.label + (role.commitment ? ' &middot; ' + escH(role.commitment) : '') + '</span>'
        + '</a>';
    }).join('');
  });
}

function roleTag(r, bg, border) { return '<span style="display:inline-flex;align-items:center;gap:.3rem;background:'+bg+';border:1px solid '+border+';border-radius:6px;padding:.2rem .65rem;font-size:.82rem;margin:.2rem .2rem 0 0;">'+r+'</span>'; }
function syncPreview(sel, previewId, formId, bg, border, emptyMsg, alwaysShow) {
  var checked = Array.from(document.querySelectorAll(sel+':checked'));
  var preview = document.getElementById(previewId); var form = document.getElementById(formId);
  if (!preview) return;
  preview.innerHTML = checked.length ? checked.map(function(cb){return roleTag(cb.value,bg,border);}).join('') : '<em>'+emptyMsg+'</em>';
  if (form && !alwaysShow) form.classList.toggle('visible', checked.length > 0);
}
function updatePreviews() {
  syncPreview('input[name="roles"][data-ministry="worship"]','roles-preview',null,'rgba(30,45,74,0.08)','rgba(30,45,74,0.18)','No worship roles selected yet \\u2014 click a card above.',true);
  syncPreview('input[name="roles"][data-ministry="education"]','edu-roles-preview',null,'rgba(201,151,58,0.08)','rgba(201,151,58,0.25)','No roles selected yet.',true);
  syncPreview('input[name="roles"][data-ministry="acceptance"]','acc-roles-preview',null,'rgba(74,94,58,0.08)','rgba(74,94,58,0.2)','No roles selected yet.',true);
  syncPreview('input[name="roles"][data-ministry="outreach"]','out-roles-preview',null,'rgba(58,78,92,0.08)','rgba(58,78,92,0.2)','No roles selected yet.',true);
  syncPreview('input[name="roles"][data-ministry="lasm"]','lasm-roles-preview',null,'rgba(58,78,92,0.08)','rgba(58,78,92,0.2)','No roles selected yet.',true);
  syncPreview('input[name="roles"][data-ministry="wol"]','wol-roles-preview',null,'rgba(201,151,58,0.08)','rgba(201,151,58,0.25)','No roles selected yet.',true);
  syncPreview('input[name="roles"][data-ministry="cfna"]','cfna-roles-preview',null,'rgba(46,126,166,0.08)','rgba(46,126,166,0.2)','No roles selected yet.',true);
}

// ── Volunteer form submission ─────────────────────────────────────────
function showThankYou(formEl, body) {
  body = body || {};
  var signupId = body.signup_id;
  var calBtn = signupId ? '<a href="/serve/calendar/'+signupId+'" download style="display:inline-flex;align-items:center;gap:.5rem;background:var(--teal);color:#fff;text-decoration:none;padding:.65rem 1.25rem;border-radius:8px;font-weight:600;font-size:.95rem;margin-top:1rem;">\\uD83D\\uDCC5 Add to Calendar (.ics)</a>' : '';
  var heading, sub;
  if (body.merged) {
    heading = 'Added!';
    sub = 'We\\'ve added this to your sign-up — thanks for volunteering in one more way.';
  } else if (body.already_signed_up) {
    heading = 'You\\'re already signed up';
    sub = 'We already have this on file for you — no changes needed. Contact us if something needs to be different.';
  } else {
    heading = 'Thank you!';
    sub = 'We\\'ve received your interest and will be in touch soon.';
  }
  var roles = Array.isArray(body.all_roles) ? body.all_roles.filter(Boolean) : [];
  var rolesHtml = roles.length
    ? '<div style="text-align:left;background:var(--cream);border-radius:10px;padding:.9rem 1.1rem;margin-top:1rem;">'
      + '<div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:.4rem;">You\\'re signed up for</div>'
      + roles.map(function(r){ return '<div style="font-size:.9rem;padding:.15rem 0;">' + escH(r) + '</div>'; }).join('')
      + '</div>'
    : '';
  formEl.innerHTML = '<div style="text-align:center;padding:2.5rem 1rem;">'
    + '<div style="font-size:2.5rem;margin-bottom:.75rem;color:var(--gold);">\\u2713</div>'
    + '<h3 style="margin-bottom:.5rem;">' + heading + '</h3>'
    + '<p style="color:var(--text-muted);">' + sub + '</p>'
    + rolesHtml
    + calBtn
    + '</div>';
}

function submitVolunteer(data, formEl, btnEl) {
  if (!data.name || !data.name.trim()) { alert('Please enter your name.'); return; }
  if (!data.email || !data.email.trim()) { alert('Please enter your email address.'); return; }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email.trim())) { alert('Please enter a valid email address.'); return; }
  var origHtml = btnEl.innerHTML; btnEl.disabled = true; btnEl.textContent = 'Sending\\u2026';
  fetch('/serve/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) })
    .then(function(r){return r.json().then(function(res){return {ok:r.ok,body:res};});})
    .then(function(r){
      if (r.body.ok) { showThankYou(formEl, r.body); }
      else { btnEl.disabled=false; btnEl.innerHTML=origHtml; alert(r.body.error||'Something went wrong. Please try again.'); }
    })
    .catch(function(){ btnEl.disabled=false; btnEl.innerHTML=origHtml; alert('Could not connect to server. Please check your internet connection and try again.'); });
}

// Worship
document.querySelector('#volunteer-form .btn-submit').addEventListener('click', function() {
  var svcEl = document.querySelector('[name=svc]:checked');
  submitVolunteer({ ministry:'worship', name:document.getElementById('f-name').value, email:document.getElementById('f-email').value, phone:document.getElementById('f-phone').value, service:svcEl?svcEl.value:'both', sundays:Array.from(document.querySelectorAll('[name=sun]:checked')).map(function(c){return c.value;}), roles:Array.from(document.querySelectorAll('#page-worship [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('f-notes').value }, document.getElementById('volunteer-form'), this);
});
// Christian Education
document.querySelector('#edu-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'education', name:document.getElementById('edu-name').value, email:document.getElementById('edu-email').value, roles:Array.from(document.querySelectorAll('#page-education [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('edu-notes').value }, document.getElementById('edu-volunteer-form'), this);
});
// Acceptance
document.querySelector('#acc-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'acceptance', name:document.getElementById('acc-name').value, email:document.getElementById('acc-email').value, roles:Array.from(document.querySelectorAll('#page-acceptance [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('acc-notes').value }, document.getElementById('acc-volunteer-form'), this);
});
// Outreach
document.querySelector('#out-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'outreach', name:document.getElementById('out-name').value, email:document.getElementById('out-email').value, roles:Array.from(document.querySelectorAll('#page-outreach [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('out-notes').value }, document.getElementById('out-volunteer-form'), this);
});
// LASM
document.querySelector('#lasm-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'lasm', name:document.getElementById('lasm-name').value, email:document.getElementById('lasm-email').value, phone:document.getElementById('lasm-phone').value, roles:Array.from(document.querySelectorAll('#page-lasm [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('lasm-notes').value }, document.getElementById('lasm-volunteer-form'), this);
});
// Word of Life
document.querySelector('#wol-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'wol', name:document.getElementById('wol-name').value, email:document.getElementById('wol-email').value, phone:document.getElementById('wol-phone').value, roles:Array.from(document.querySelectorAll('#page-wol [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('wol-notes').value }, document.getElementById('wol-volunteer-form'), this);
});
// CFNA
document.querySelector('#cfna-volunteer-form .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'cfna', name:document.getElementById('cfna-name').value, email:document.getElementById('cfna-email').value, phone:document.getElementById('cfna-phone').value, roles:Array.from(document.querySelectorAll('#page-cfna [name=roles]:checked')).map(function(c){return c.value;}), notes:document.getElementById('cfna-notes').value }, document.getElementById('cfna-volunteer-form'), this);
});
// General Interest
document.querySelector('#page-general .btn-submit').addEventListener('click', function() {
  submitVolunteer({ ministry:'general', name:document.getElementById('gen-name').value, email:document.getElementById('gen-email').value, phone:document.getElementById('gen-phone').value }, document.querySelector('#page-general .signup-section'), this);
});

// ── Multi-step signup forms ───────────────────────────────────────────
var _STEP_CFGS = {
  worship:    {formId:'volunteer-form',      nameId:'f-name',     emailId:'f-email',    phoneId:'f-phone',    hasPhone:true,  hasService:true,  hasSundays:true},
  education:  {formId:'edu-volunteer-form',  nameId:'edu-name',   emailId:'edu-email',  hasPhone:false},
  acceptance: {formId:'acc-volunteer-form',  nameId:'acc-name',   emailId:'acc-email',  hasPhone:false},
  outreach:   {formId:'out-volunteer-form',  nameId:'out-name',   emailId:'out-email',  hasPhone:false},
  lasm:       {formId:'lasm-volunteer-form', nameId:'lasm-name',  emailId:'lasm-email', phoneId:'lasm-phone', hasPhone:true},
  wol:        {formId:'wol-volunteer-form',  nameId:'wol-name',   emailId:'wol-email',  phoneId:'wol-phone',  hasPhone:true},
  cfna:       {formId:'cfna-volunteer-form', nameId:'cfna-name',  emailId:'cfna-email', phoneId:'cfna-phone', hasPhone:true},
};

function goToStep2(ministry) {
  var cfg = _STEP_CFGS[ministry]; if (!cfg) return;
  var name  = ((document.getElementById(cfg.nameId)||{}).value||'').trim();
  var email = ((document.getElementById(cfg.emailId)||{}).value||'').trim();
  if (!name)  { alert('Please enter your name.'); return; }
  if (!email) { alert('Please enter your email address.'); return; }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { alert('Please enter a valid email address.'); return; }
  var s1 = document.getElementById('step1-'+ministry), s2 = document.getElementById('step2-'+ministry);
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = '';
  window.scrollTo({top:0, behavior:'instant'});
}

// Acceptance ministry's optional "Interested in driving?" fields — read once, shared
// between the step-3 confirm summary (so the answers are actually shown back to the
// user, not just silently folded into notes) and the final submit handler.
function getAccTransFields() {
  var wcEl = document.querySelector('[name=acc-trans-wc]:checked');
  var capEl = document.getElementById('acc-trans-capacity');
  return {
    services: Array.from(document.querySelectorAll('[name=acc-trans-svc]:checked')).map(function(x){return x.value;}),
    availability: Array.from(document.querySelectorAll('[name=acc-trans-avail]:checked')).map(function(x){return x.value;}),
    wheelchair: !!(wcEl && wcEl.value === 'yes'),
    capacity: capEl ? capEl.value : ''
  };
}

function goToStep3(cfg, ministry) {
  var name  = ((document.getElementById(cfg.nameId)||{}).value||'');
  var email = ((document.getElementById(cfg.emailId)||{}).value||'');
  var phone = cfg.phoneId ? ((document.getElementById(cfg.phoneId)||{}).value||'') : '';
  var roles = Array.from(document.querySelectorAll('#page-'+ministry+' [name=roles]:checked')).map(function(x){ return x.value; });
  var rows = [['Name', name], ['Email', email]];
  if (phone) rows.push(['Phone', phone]);
  var driving = [];
  if (ministry === 'acceptance') {
    var acc = getAccTransFields();
    if (acc.services.length) driving.push(['Services attended', acc.services.join(', ')]);
    if (acc.availability.length) driving.push(['Driving availability', acc.availability.join(', ')]);
    if (acc.wheelchair) driving.push(['Wheelchair-accessible vehicle', 'Yes']);
    if (acc.capacity) driving.push(['Vehicle capacity', acc.capacity]);
  }
  var summaryEl = document.getElementById('step3-summary-'+ministry);
  if (summaryEl) {
    summaryEl.innerHTML = '<p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:1rem;">Here\\'s what a leader will see. Anything look off?</p>'
      + '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.85rem;">'
      + rows.map(function(r, i){
          return (i > 0 ? '<div style="height:1px;background:var(--border);margin:.6rem 0;"></div>' : '')
            + '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;"><span style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">' + r[0] + '</span><span style="font-size:.9rem;color:var(--text-primary);font-weight:600;">' + escH(r[1]) + '</span></div>';
        }).join('')
      + '</div>'
      + (roles.length
          ? '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.85rem;"><div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:.5rem;">Roles selected</div>'
            + roles.map(function(r){ return '<span style="display:inline-block;background:rgba(30,45,74,.06);border-radius:6px;padding:.25rem .65rem;font-size:.82rem;margin:0 .3rem .3rem 0;">' + escH(r) + '</span>'; }).join('') + '</div>'
          : '')
      + (driving.length
          ? '<div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:.85rem;">'
            + '<div style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:.5rem;">Interested in driving?</div>'
            + driving.map(function(r, i){
                return (i > 0 ? '<div style="height:1px;background:var(--border);margin:.6rem 0;"></div>' : '')
                  + '<div style="display:flex;justify-content:space-between;gap:1rem;align-items:baseline;"><span style="font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">' + r[0] + '</span><span style="font-size:.9rem;color:var(--text-primary);font-weight:600;">' + escH(r[1]) + '</span></div>';
              }).join('')
            + '</div>'
          : '');
  }
  document.getElementById('step2-'+ministry).style.display = 'none';
  document.getElementById('step3-'+ministry).style.display = '';
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function goToStep1(ministry) {
  var s1 = document.getElementById('step1-'+ministry), s2 = document.getElementById('step2-'+ministry);
  if (s2) s2.style.display = 'none';
  if (s1) s1.style.display = '';
  window.scrollTo({top:0, behavior:'instant'});
}

function _makeStepIndicator(step) {
  var d = document.createElement('div'); d.className = 'step-indicator';
  if (step === 1) {
    d.innerHTML = '<div class="step-dot s-active">1</div><div class="step-line"></div><div class="step-dot">2</div><div class="step-line"></div><div class="step-dot">3</div><span class="step-label">Your Information</span>';
  } else if (step === 2) {
    d.innerHTML = '<div class="step-dot s-done">\\u2713</div><div class="step-line s-done"></div><div class="step-dot s-active">2</div><div class="step-line"></div><div class="step-dot">3</div><span class="step-label">Select Roles</span>';
  } else {
    d.innerHTML = '<div class="step-dot s-done">\\u2713</div><div class="step-line s-done"></div><div class="step-dot s-done">\\u2713</div><div class="step-line s-done"></div><div class="step-dot s-active">3</div><span class="step-label">Confirm</span>';
  }
  return d;
}

function initStepForms() {
  Object.keys(_STEP_CFGS).forEach(function(ministry) {
    var cfg = _STEP_CFGS[ministry];
    var page = document.getElementById('page-'+ministry);
    var form = document.getElementById(cfg.formId);
    if (!page || !form) return;

    // Remove notes textarea
    var ta = form.querySelector('textarea');
    if (ta) { var fp = ta.closest('.form-field') || ta.parentElement; if (fp && fp !== form) fp.remove(); else ta.remove(); }

    // Remove roles-preview + its section label (worship only)
    var rp = form.querySelector('.selected-roles-preview');
    if (rp) { var fsl = form.querySelector('.form-section-label'); if (fsl) fsl.remove(); rp.remove(); }

    // Remove old submit button (dead code path, but clean up)
    var oldBtn = form.querySelector('.btn-submit'); if (oldBtn) oldBtn.remove();

    // Ensure form is visible (signup-section needs .visible class)
    form.classList.add('visible');

    // Build step1: step indicator + contact form + Next button
    var step1 = document.createElement('div');
    step1.id = 'step1-'+ministry; step1.className = 'step-container';
    step1.appendChild(_makeStepIndicator(1));
    form.parentNode.insertBefore(step1, form);
    step1.appendChild(form);
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.className = 'btn-submit'; nextBtn.style.marginTop = '1.25rem';
    nextBtn.innerHTML = 'Next \\u2192';
    (function(m){ nextBtn.addEventListener('click', function(){ goToStep2(m); }); })(ministry);
    form.appendChild(nextBtn);

    // Build step2: step indicator + role cards + Back/Submit buttons
    var step2 = document.createElement('div');
    step2.id = 'step2-'+ministry; step2.className = 'step-container'; step2.style.display = 'none';
    step2.appendChild(_makeStepIndicator(2));
    var mainEl = page.querySelector('main');
    if (mainEl) {
      var roleWrap = document.createElement('div');
      Array.from(mainEl.children).forEach(function(child){ if (child !== step1) roleWrap.appendChild(child); });
      step2.appendChild(roleWrap);
      mainEl.appendChild(step2);
    }

    var btnRow = document.createElement('div'); btnRow.className = 'step2-btn-row';
    var backBtn = document.createElement('button');
    backBtn.type = 'button'; backBtn.className = 'btn-back'; backBtn.innerHTML = '\\u2190 Back';
    (function(m){ backBtn.addEventListener('click', function(){ goToStep1(m); }); })(ministry);
    var reviewBtn = document.createElement('button');
    reviewBtn.type = 'button'; reviewBtn.className = 'btn-submit'; reviewBtn.textContent = 'Review & Continue';
    (function(c, m, rb){ rb.addEventListener('click', function(){ goToStep3(c, m); }); })(cfg, ministry, reviewBtn);
    btnRow.appendChild(backBtn); btnRow.appendChild(reviewBtn);
    step2.appendChild(btnRow);

    // Build step3: confirm-and-submit — read-back summary, reminder opt-in, final submit
    var step3 = document.createElement('div');
    step3.id = 'step3-'+ministry; step3.className = 'step-container'; step3.style.display = 'none';
    step3.appendChild(_makeStepIndicator(3));
    var summaryEl = document.createElement('div');
    summaryEl.id = 'step3-summary-'+ministry;
    step3.appendChild(summaryEl);
    var reminderLabel = document.createElement('label');
    reminderLabel.style.cssText = 'display:flex;align-items:flex-start;gap:.6rem;background:var(--cream);border-radius:10px;padding:.75rem .9rem;margin:0 0 1.25rem;cursor:pointer;';
    reminderLabel.innerHTML = '<input type="checkbox" id="step3-reminder-'+ministry+'" style="margin-top:2px;width:auto;">'
      + '<span style="font-size:.85rem;color:var(--text-secondary);">I\\'d like a reminder before I get started \\u2014 a ministry leader may follow up by text or email.</span>';
    step3.appendChild(reminderLabel);
    var btnRow3 = document.createElement('div'); btnRow3.className = 'step2-btn-row';
    var backBtn3 = document.createElement('button');
    backBtn3.type = 'button'; backBtn3.className = 'btn-back'; backBtn3.innerHTML = '\\u2190 Back to edit info';
    (function(m){ backBtn3.addEventListener('click', function(){ document.getElementById('step3-'+m).style.display = 'none'; document.getElementById('step2-'+m).style.display = ''; window.scrollTo({top:0, behavior:'instant'}); }); })(ministry);
    var confirmBtn = document.createElement('button');
    confirmBtn.type = 'button'; confirmBtn.className = 'btn-submit'; confirmBtn.textContent = 'Confirm sign-up';
    (function(c, m, cb){
      cb.addEventListener('click', function(){
        var data = { ministry: m };
        data.name  = ((document.getElementById(c.nameId)||{}).value||'');
        data.email = ((document.getElementById(c.emailId)||{}).value||'');
        if (c.phoneId)   data.phone   = ((document.getElementById(c.phoneId)||{}).value||'');
        if (c.hasService){ var svc = document.querySelector('[name=svc]:checked'); data.service = svc ? svc.value : 'both'; }
        if (c.hasSundays) data.sundays = Array.from(document.querySelectorAll('[name=sun]:checked')).map(function(x){return x.value;});
        data.roles = Array.from(document.querySelectorAll('#page-'+m+' [name=roles]:checked')).map(function(x){return x.value;});
        data.sms_reminder_opt_in = (document.getElementById('step3-reminder-'+m)||{}).checked ? 1 : 0;
        if (m === 'acceptance') {
          var acc = getAccTransFields();
          var extra = [];
          if (acc.services.length) extra.push('Services attended: ' + acc.services.join(', '));
          if (acc.availability.length) extra.push('Driving availability: ' + acc.availability.join(', '));
          if (acc.wheelchair) extra.push('Wheelchair-accessible vehicle: yes');
          if (acc.capacity) extra.push('Vehicle capacity: ' + acc.capacity);
          if (extra.length) data.notes = extra.join('\\n');
        }
        submitVolunteer(data, document.getElementById('step3-'+m), cb);
      });
    })(cfg, ministry, confirmBtn);
    btnRow3.appendChild(backBtn3); btnRow3.appendChild(confirmBtn);
    step3.appendChild(btnRow3);
    if (mainEl) mainEl.appendChild(step3);
  });

  // Remove notes from general interest form (single-step, no roles)
  var genPage = document.getElementById('page-general');
  if (genPage) { var gta = genPage.querySelector('textarea'); if (gta) { var gp = gta.closest('.form-field') || gta.parentElement; if (gp && gp !== genPage) gp.remove(); else gta.remove(); } }
}

initStepForms();

// ── Dynamic community events ─────────────────────────────────────────
var _eventsLoaded = false;
var _currentSort = 'time'; // 'time' or 'role'
var _eventsData = null;
var _currentDynEventId = null;

function escH(str) { return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// Shared events fetch — used by the events list page and by direct event-page
// links (openEventPage) so a fresh deep link doesn't require visiting the list first.
function ensureEventsData() {
  if (_eventsData) return Promise.resolve(_eventsData);
  return fetch('/api/events')
    .then(function(r){ return r.json(); })
    .then(function(data){ _eventsData = data.events || []; _eventsLoaded = true; return _eventsData; });
}

function loadDynamicEvents() {
  if (_eventsLoaded) return;
  var container = document.getElementById('dynamic-events-container');
  if (!container) return;
  ensureEventsData()
    .then(function(events) {
      if (!events.length) {
        container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:2rem;">No upcoming events posted yet \\u2014 check back soon!</p>';
        return;
      }
      renderEventList(container);
    })
    .catch(function(){ container.innerHTML='<p style="color:var(--text-muted);text-align:center;padding:2rem;">Could not load events. Please refresh.</p>'; });
}

function renderEventList(container) {
  // Hidden events still resolve at their own direct link (locked, "registrations
  // on hold") — they just don't belong in the browsable grid itself.
  var visible = _eventsData.filter(function(ev) { return !ev.hidden; });
  if (!visible.length) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">No upcoming events posted yet — check back soon!</p>';
    return;
  }
  var html = '<div class="event-volunteer-list">';
  visible.forEach(function(ev) {
    var dateHtml = '';
    if (ev.event_date) { var p=ev.event_date.split('-'); var months=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; if(p.length>=2){dateHtml='<div class="ev-card-date"><span class="month">'+months[parseInt(p[1],10)]+'</span><span class="day">'+(p[2]?parseInt(p[2],10):'')+'</span></div>';} }
    // Every event — shift-based or simple — is its own directly-linkable page now
    // (see openEventPage), rather than expanding inline in this list.
    html += '<div class="ev-card" id="ev-card-'+ev.id+'">'
      + '<button class="ev-card-header" onclick="openEventPage('+ev.id+')">'
      + dateHtml
      + '<div class="ev-card-info"><h3>'+escH(ev.name)+'</h3>'+(ev.description?'<p>'+escH(ev.description)+'</p>':'')+'</div>'
      + '<div class="ev-card-cta"><span class="ev-volunteer-label">Volunteer for this</span>'
      + '<svg class="ev-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></div>'
      + '</button>'
      + '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function isTimeSlotted(ev) {
  return ev.roles && ev.roles.some(function(r){ return r.start_time; });
}

// Shared contact-info card, used both by the inline shift-picker (time-slotted events)
// and the dedicated simple-event page.
function buildContactCard(evId) {
  return '<div style="margin-bottom:1.5rem;padding:1.25rem;background:var(--cream);border-radius:12px;border:1px solid var(--border);">'
    + '<h4 style="font-family:Lora,serif;font-size:1rem;font-weight:600;color:var(--navy);margin-bottom:1rem;">Your Contact Info</h4>'
    + '<div class="form-row"><div class="form-field"><label class="form-label">Full Name *</label><input type="text" id="ev-name-'+evId+'" class="form-input" placeholder="Jane Smith" autocomplete="name"></div>'
    + '<div class="form-field"><label class="form-label">Email *</label><input type="email" id="ev-email-'+evId+'" class="form-input" placeholder="jane@example.com" autocomplete="email"></div></div>'
    + '<div class="form-field"><label class="form-label">Phone <span style="font-weight:400;">(optional)</span></label><input type="tel" id="ev-phone-'+evId+'" class="form-input" placeholder="(314) 555-0123" autocomplete="tel"></div>'
    + '</div>';
}

// Only ever called for time-slotted events — see renderEventDetailPage, which
// picks this vs. a simple role checklist based on isTimeSlotted(ev).
function renderEventExpanded(ev) {
  var contactForm = buildContactCard(ev.id);

  // Time-slotted event: always-visible day toggle (defaults to the first day), contact card,
  // sort toggle, then the shift grid for the active day — no gating step before the form shows.
  var uniqueDates = getUniqueDates(ev);
  var activeDate = _selectedDays[ev.id] || uniqueDates[0] || null;
  _selectedDays[ev.id] = activeDate;
  var dayToggleHtml = '';
  if (uniqueDates.length > 1) {
    var weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var dayBtns = uniqueDates.map(function(dateStr) {
      var p = dateStr.split('-');
      var d = new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
      var label = weekdays[d.getDay()]+' '+months[parseInt(p[1])]+' '+parseInt(p[2]);
      return '<div class="day-btn'+(dateStr===activeDate?' active':'')+'" data-ev="'+ev.id+'" data-date="'+dateStr+'" onclick="selectDay('+ev.id+',this.getAttribute(\\'data-date\\'))">'+label+'</div>';
    }).join('');
    dayToggleHtml = '<div class="day-toggle" data-ev="'+ev.id+'">'+dayBtns+'</div>';
  }
  var sortBar = '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:1.25rem;flex-wrap:wrap;">'
    + '<span style="font-size:.88rem;color:var(--text-muted);margin-right:.25rem;">Sort by:</span>'
    + '<button id="sort-time-'+ev.id+'" onclick="setSort(\\'time\\','+ev.id+')" class="sort-btn sort-active">By Time</button>'
    + '<button id="sort-role-'+ev.id+'" onclick="setSort(\\'role\\','+ev.id+')" class="sort-btn">By Role</button>'
    + '<span id="shift-count-'+ev.id+'" style="margin-left:auto;font-size:.85rem;font-weight:600;color:var(--teal);"></span>'
    + '</div>';
  var grid = '<div id="slot-grid-'+ev.id+'">'+renderSlotsByTime(ev, activeDate)+'</div>';
  var notes = '<div class="form-field" style="margin-top:1rem;"><label class="form-label">Notes <span style="font-weight:400;">(optional)</span></label><textarea id="ev-notes-'+ev.id+'" class="form-textarea" placeholder="Any questions or constraints?"></textarea></div>';
  var submitBtn = '<button class="btn-submit" type="button" onclick="submitTimeSlottedEvent('+ev.id+',this)" style="margin-top:1rem;">Sign Up for Selected Shifts <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
  return dayToggleHtml + contactForm + sortBar + grid + notes + submitBtn;
}

// ── Dedicated simple-event page (Easter Egg Hunt, VBS, etc. — no day/shift data) ──
function formatFullDateLabel(dateStr) {
  if (!dateStr) return '';
  var months = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var p = dateStr.split('-');
  var d = new Date(parseInt(p[0],10),parseInt(p[1],10)-1,parseInt(p[2],10));
  return days[d.getDay()]+', '+months[parseInt(p[1],10)]+' '+parseInt(p[2],10);
}

// Shared "registrations are on hold" lock, shown in place of any signup form
// for an event marked hidden — used here and by the Christmas Market page.
function registrationsHoldHtml() {
  return '<div style="margin:1rem 0;padding:1.5rem;background:var(--cream);border:1px solid var(--border);border-radius:12px;text-align:center;">'
    + '<h4 style="font-family:Lora,serif;font-size:1.1rem;font-weight:600;color:var(--navy);margin-bottom:.5rem;">Registrations are on hold</h4>'
    + '<p style="color:var(--text-muted);margin:0;">Sign-ups for this event aren\\u2019t open right now. Check back soon, or contact the church office if you have questions.</p>'
    + '</div>';
}

// Renders either event type (shift-based or simple) into the shared event-detail
// page container. Shift events reuse the existing day-toggle/shift-grid picker
// (renderEventExpanded); simple events get a compact role checklist.
function renderEventDetailPage(ev) {
  document.getElementById('event-simple-eyebrow').textContent = formatFullDateLabel(ev.event_date) || 'Community Event';
  document.getElementById('event-simple-title').textContent = ev.name;
  document.getElementById('event-simple-desc').textContent = ev.description || '';

  if (ev.hidden) {
    document.getElementById('event-simple-body').innerHTML = registrationsHoldHtml();
    return;
  }

  var bodyHtml;
  if (isTimeSlotted(ev)) {
    bodyHtml = '<div class="ev-card-roles" style="border-top:none;padding:0;">' + renderEventExpanded(ev) + '</div>';
  } else {
    var rolesHtml = '';
    if (ev.roles && ev.roles.length) {
      rolesHtml = '<div class="form-section-label" style="margin-bottom:.75rem;">How would you like to help? <span style="font-weight:400;text-transform:none;letter-spacing:0;">(pick any)</span></div>'
        + '<div class="simple-role-list">'
        + ev.roles.map(function(role) {
            var rid = 'r-simple-'+ev.id+'-'+role.id;
            return '<label class="role-card compact-row" for="'+rid+'"><input type="checkbox" id="'+rid+'" name="ev-role-'+ev.id+'" value="'+escH(role.name)+'"><div class="role-card-top"><div class="role-check" aria-hidden="true"></div><span class="role-name">'+escH(role.name)+'</span></div></label>';
          }).join('')
        + '</div>';
    }
    var submitBtn = '<button class="hero-scroll" type="button" data-simple-event-submit data-event-id="'+ev.id+'" data-event-name="'+escH(ev.name)+'" style="border:none;cursor:pointer;font-family:inherit;font-size:.95rem;">Sign Up <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
    bodyHtml = '<div class="ev-card-roles" style="border-top:none;padding:0;">' + buildContactCard(ev.id) + rolesHtml + submitBtn + '</div>';
  }
  document.getElementById('event-simple-body').innerHTML = bodyHtml;
}

// Opens a specific event's dedicated, directly-linkable page (#event-<id>) —
// works both from a card click (data already loaded) and from a fresh page
// load at that URL (fetches first). replaceHistory avoids pushing a duplicate
// history entry when restoring from a hash on load or from popstate.
function openEventPage(evId, replaceHistory) {
  ensureEventsData().then(function(events) {
    var ev = events.find(function(e){ return e.id === evId; });
    if (ev && ev.name === 'Christmas Market') {
      svMkt.ev = ev;
      showPageAndLoad('market');
      history[replaceHistory ? 'replaceState' : 'pushState']({ page: 'market' }, '', '#market');
      return;
    }
    document.querySelectorAll('.app-page').forEach(function(p) { p.hidden = true; });
    if (!ev) {
      // Bad/stale link (event removed) — fall back to the events list instead of a dead page.
      var fallback = document.getElementById('page-events');
      if (fallback) fallback.hidden = false;
      loadDynamicEvents();
      window.scrollTo({ top: 0, behavior: 'instant' });
      history.replaceState({ page: 'events' }, '', '#events');
      return;
    }
    renderEventDetailPage(ev);
    document.getElementById('page-event-simple').hidden = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    history[replaceHistory ? 'replaceState' : 'pushState']({ page: 'event-' + evId }, '', '#event-' + evId);
  }).catch(function() {
    document.getElementById('event-simple-body').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Could not load this event. Please refresh.</p>';
    document.querySelectorAll('.app-page').forEach(function(p) { p.hidden = true; });
    document.getElementById('page-event-simple').hidden = false;
  });
}

function parseTimeToMinutes(t) {
  if (!t) return 0;
  var s = t.trim();
  // 12-hour: "9:00 AM", "9:00AM"
  var m = s.match(/^(\\d{1,2}):(\\d{2})\\s*(am|pm)$/i);
  if (m) {
    var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
    var isPm = m[3].toLowerCase() === 'pm';
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return h * 60 + min;
  }
  // 24-hour: "09:00", "13:30"
  var m2 = s.match(/^(\\d{1,2}):(\\d{2})$/);
  if (m2) { return parseInt(m2[1], 10) * 60 + parseInt(m2[2], 10); }
  return 0;
}

function renderSlotsByTime(ev, dateFilter) {
  // Group roles by date + time window
  var groupMap = {};
  var groups = [];
  var roles = dateFilter ? ev.roles.filter(function(r){ return r.role_date === dateFilter; }) : ev.roles;
  roles.forEach(function(role) {
    var key = (role.role_date||'') + '|' + (role.start_time||'') + '|' + (role.end_time||'');
    if (!groupMap[key]) {
      // Precompute sort minutes from role directly; fall back to end_time if start is absent
      var mins = parseTimeToMinutes(role.start_time||'');
      if (!mins) mins = parseTimeToMinutes(role.end_time||'');
      groupMap[key] = { date: role.role_date||'', startT: role.start_time||'', endT: role.end_time||'', mins: mins, roles: [] };
      groups.push(key);
    }
    groupMap[key].roles.push(role);
  });
  // Sort by date then by start time numerically
  groups.sort(function(a, b) {
    var ga = groupMap[a], gb = groupMap[b];
    if (ga.date < gb.date) return -1;
    if (ga.date > gb.date) return 1;
    return ga.mins - gb.mins;
  });
  var html = '';
  groups.forEach(function(key) {
    var g = groupMap[key];
    var dayLabel = formatDayLabel(g.date, g.startT, g.endT);
    html += '<div class="slot-group"><div class="slot-group-header">'+dayLabel+'</div><div class="slot-cards">';
    g.roles.forEach(function(role) {
      html += renderSlotCard(ev.id, role);
    });
    html += '</div></div>';
  });
  return html;
}

function renderSlotsByRole(ev, dateFilter) {
  // Group roles by name
  var groups = {};
  var order = [];
  var roles = dateFilter ? ev.roles.filter(function(r){ return r.role_date === dateFilter; }) : ev.roles;
  roles.forEach(function(role) {
    var key = role.name;
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(role);
  });
  // Deduplicate order
  order = order.filter(function(v, i, a){ return a.indexOf(v) === i; });
  var html = '';
  order.forEach(function(roleName) {
    html += '<div class="slot-group"><div class="slot-group-header">'+escH(roleName)+'</div><div class="slot-cards">';
    groups[roleName].forEach(function(role) {
      html += renderSlotCard(ev.id, role);
    });
    html += '</div></div>';
  });
  return html;
}

function spotsBadge(role) {
  if (!(role.slots > 0)) return '';
  var remaining = role.slots - (role.filled_count||0);
  if (remaining <= 0) return '<span class="slots-full">Full</span>';
  if (remaining <= 3) return '<span class="slots-low">'+remaining+' left</span>';
  return '<span class="slots-left">'+remaining+' left</span>';
}

function renderSlotCard(evId, role) {
  var available = role.slots > 0 ? role.slots - (role.filled_count||0) : 999;
  var isFull = role.slots > 0 && available <= 0;
  var spotsLabel = spotsBadge(role);
  var timeLabel = role.start_time ? role.start_time+(role.end_time?' \\u2013 '+role.end_time:'') : '';
  var dateLabel = role.role_date ? formatShortDate(role.role_date) + (timeLabel?' &nbsp;\\u00B7\\u00A0' + timeLabel : '') : timeLabel;

  if (isFull) {
    return '<div class="role-card slot-card full"><div class="role-card-top"><div class="role-check" aria-hidden="true">\\u2715</div><span class="role-name">'+escH(role.name)+'</span>'+spotsLabel+'</div>'+(role.description?'<p class="role-desc">'+escH(role.description)+'</p>':'')+(dateLabel?'<div class="slot-time">'+dateLabel+'</div>':'')+'</div>';
  }
  return '<label class="role-card slot-card" for="slot-'+role.id+'"><input type="checkbox" id="slot-'+role.id+'" name="ev-slot-'+evId+'" value="'+role.id+'" '+(isFull?'disabled':'')+'><div class="role-card-top"><div class="role-check" aria-hidden="true"></div><span class="role-name">'+escH(role.name)+'</span>'+spotsLabel+'</div>'+(role.description?'<p class="role-desc">'+escH(role.description)+'</p>':'')+(dateLabel?'<div class="slot-time">'+dateLabel+'</div>':'')+'</label>';
}

function formatDayLabel(dateStr, startT, endT) {
  if (!dateStr) return (startT ? startT + (endT ? ' \\u2013 ' + endT : '') : 'Shift');
  var months = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var p = dateStr.split('-');
  var d = new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
  var dayName = days[d.getDay()];
  var monName = months[parseInt(p[1])];
  var timeRange = startT ? startT + (endT ? ' \\u2013 ' + endT : '') : '';
  return '<strong>'+dayName+', '+monName+' '+parseInt(p[2])+'</strong>'+(timeRange ? ' &nbsp;\\u00B7&nbsp; ' + timeRange : '');
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  var months = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var p = dateStr.split('-');
  var d = new Date(parseInt(p[0]),parseInt(p[1])-1,parseInt(p[2]));
  return days[d.getDay()]+' '+months[parseInt(p[1])]+' '+parseInt(p[2]);
}

function setSort(mode, evId) {
  _currentSort = mode;
  document.getElementById('sort-time-'+evId).className = 'sort-btn' + (mode==='time'?' sort-active':'');
  document.getElementById('sort-role-'+evId).className = 'sort-btn' + (mode==='role'?' sort-active':'');
  var ev = _eventsData.find(function(e){return e.id===evId;});
  if (!ev) return;
  var dateFilter = _selectedDays[evId] || null;
  var grid = document.getElementById('slot-grid-'+evId);
  if (grid) grid.innerHTML = mode==='time' ? renderSlotsByTime(ev, dateFilter) : renderSlotsByRole(ev, dateFilter);
  // Restore checked state (pass active day so per-day storage is used)
  restoreCheckedSlots(evId, dateFilter, grid);
}

var _checkedSlots = {};
var _checkedSlotsByDay = {}; // keyed by evId+'|'+dateStr — persists per-day selections across tab switches
var _selectedDays = {};

function getUniqueDates(ev) {
  var seen = {}, dates = [];
  (ev.roles||[]).forEach(function(r){ if (r.role_date && !seen[r.role_date]) { seen[r.role_date]=true; dates.push(r.role_date); } });
  return dates;
}

function selectDay(evId, dateStr) {
  // Save current day's selections before switching away from it
  var prevDate = _selectedDays[evId];
  if (prevDate) {
    var grid0 = document.getElementById('slot-grid-'+evId);
    if (grid0) {
      var prevChecked = Array.from(grid0.querySelectorAll('input[type="checkbox"]:checked')).map(function(cb){return cb.value;});
      _checkedSlotsByDay[evId+'|'+prevDate] = prevChecked;
    }
  }
  _selectedDays[evId] = dateStr;
  // Update pill highlight
  document.querySelectorAll('.day-toggle[data-ev="'+evId+'"] .day-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.date === dateStr);
  });
  // Re-render the grid filtered to this day
  var ev = _eventsData.find(function(e){return e.id===evId;});
  if (!ev) return;
  var grid = document.getElementById('slot-grid-'+evId);
  if (grid) {
    grid.innerHTML = _currentSort === 'role' ? renderSlotsByRole(ev, dateStr) : renderSlotsByTime(ev, dateStr);
    restoreCheckedSlots(evId, dateStr, grid);
  }
}

function restoreCheckedSlots(evId, dateStr, container) {
  // When a dateStr is given use per-day storage; otherwise fall back to the flat list (sort-toggle case)
  var ids = (dateStr && _checkedSlotsByDay[evId+'|'+dateStr]) ? _checkedSlotsByDay[evId+'|'+dateStr] : (_checkedSlots[evId] || []);
  ids.forEach(function(rid) {
    var cb = container ? container.querySelector('[id="slot-'+rid+'"]') : document.getElementById('slot-'+rid);
    if (cb && !cb.disabled) { cb.checked = true; var card = cb.closest('.role-card'); if (card) { card.classList.add('selected'); var chk = card.querySelector('.role-check'); if (chk) chk.textContent = '\\u2713'; } }
  });
}

function updateShiftCount(evId) {
  var checked = document.querySelectorAll('input[type="checkbox"][name="ev-slot-'+evId+'"]:checked');
  var countEl = document.getElementById('shift-count-'+evId);
  if (countEl) countEl.textContent = checked.length > 0 ? checked.length+' shift'+(checked.length===1?'':'s')+' selected' : '';
  // Track checked for sort toggle restoration (flat list)
  _checkedSlots[evId] = Array.from(checked).map(function(cb){return cb.value;});
  // Also persist to per-day storage so day-tab switches can restore them
  var activeDay = _selectedDays[evId];
  if (activeDay) {
    _checkedSlotsByDay[evId+'|'+activeDay] = _checkedSlots[evId].slice();
  }
}

function submitTimeSlottedEvent(evId, btnEl) {
  var name  = (document.getElementById('ev-name-'+evId)||{}).value||'';
  var email = (document.getElementById('ev-email-'+evId)||{}).value||'';
  var phone = (document.getElementById('ev-phone-'+evId)||{}).value||'';
  var notes = (document.getElementById('ev-notes-'+evId)||{}).value||'';
  var roleIds = Array.from(document.querySelectorAll('input[name="ev-slot-'+evId+'"]:checked')).map(function(c){return parseInt(c.value,10);});
  if (!roleIds.length) { alert('Please select at least one shift.'); return; }
  var ev = _eventsData.find(function(e){return e.id===evId;});
  var formEl = btnEl.closest('.ev-card-roles');
  submitVolunteer({ ministry:'events', event_id:evId, event_name:ev?ev.name:'', name:name, email:email, phone:phone, role_ids:roleIds, notes:notes }, formEl, btnEl);
}

function submitSimpleEvent(evId, evName, btnEl) {
  var name  = (document.getElementById('ev-name-'+evId)||{}).value||'';
  var email = (document.getElementById('ev-email-'+evId)||{}).value||'';
  var phone = (document.getElementById('ev-phone-'+evId)||{}).value||'';
  var notes = (document.getElementById('ev-notes-'+evId)||{}).value||'';
  var roles = Array.from(document.querySelectorAll('input[name="ev-role-'+evId+'"]:checked')).map(function(c){return c.value;});
  var formEl = btnEl.closest('.ev-card-roles');
  submitVolunteer({ ministry:'events', event_id:evId, event_name:evName, name:name, email:email, phone:phone, roles:roles, notes:notes }, formEl, btnEl);
}

// ══════════════════════════════════════════════════════════════════
// SERVE REDESIGN — volunteer wizard (page-landing) + Christmas Market
// shift picker (page-market). See design_handoff_serve_timothy.
// ══════════════════════════════════════════════════════════════════
function svValidEmail(v) { return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v); }

function svUpdateHeaderCta(pageId) {
  var btn = document.getElementById('sv-header-cta');
  if (!btn) return;
  if (pageId === 'market') {
    btn.textContent = 'Take a shift';
    btn.removeAttribute('data-nav-page');
    btn.onclick = function() { var el = document.getElementById('sv-mkt-shifts'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  } else {
    btn.textContent = 'Start';
    btn.setAttribute('data-nav-page', 'landing');
    btn.onclick = null;
  }
}

// ── Volunteer wizard state ──────────────────────────────────────────
var SV_CATEGORIES = [
  { key: 'worship',    label: 'Worship' },
  { key: 'education',  label: 'Christian Education' },
  { key: 'acceptance', label: 'Acceptance' },
  { key: 'outreach',   label: 'Outreach' },
  { key: 'partner',    label: 'Partner ministries' }
];
var SV_PARTNER_ROLES = [
  { ministry: 'lasm', name: 'LASM Volunteer',           description: 'Companionship, transportation, and community care for aging neighbors, alongside four other neighborhood churches.', commitment: 'As your schedule allows' },
  { ministry: 'wol',  name: 'Word of Life Volunteer',   description: 'Support Christian education for the students of Word of Life Lutheran School.', commitment: 'As your schedule allows' },
  { ministry: 'cfna', name: 'CFNA Volunteer',           description: 'English classes, tutoring, transportation, and friendship for immigrants and refugees in St. Louis.', commitment: 'As your schedule allows' }
];
var svState = { step: 1, cat: 'worship', name: '', email: '', phone: '', notes: '', roles: [], catRoles: {}, _init: false };

function svFetchCatRoles(cat) {
  if (svState.catRoles[cat]) return Promise.resolve(svState.catRoles[cat]);
  if (cat === 'partner') { svState.catRoles[cat] = SV_PARTNER_ROLES; return Promise.resolve(SV_PARTNER_ROLES); }
  return fetch('/api/ministry-roles?ministry=' + cat).then(function(r) { return r.json(); })
    .then(function(d) { var roles = d.roles || []; svState.catRoles[cat] = roles; return roles; })
    .catch(function() { return []; });
}

function svPickedLabel(cat) {
  var found = null;
  SV_CATEGORIES.forEach(function(c) { if (c.key === cat) found = c; });
  return found ? found.label : cat;
}

function svRenderChips() {
  var wrap = document.getElementById('sv-chips'); if (!wrap) return;
  wrap.innerHTML = SV_CATEGORIES.map(function(c) {
    return '<button type="button" class="sv-chip' + (c.key === svState.cat ? ' active' : '') + '" data-cat="' + c.key + '">' + escH(c.label) + '</button>';
  }).join('');
}

function svRenderRoleGroup() {
  var wrap = document.getElementById('sv-role-groups'); if (!wrap) return;
  wrap.innerHTML = '<div class="sv-role-grid" id="sv-role-grid"></div>';
  svFetchCatRoles(svState.cat).then(function(roles) {
    var grid = document.getElementById('sv-role-grid'); if (!grid) return;
    if (!roles.length) { grid.innerHTML = '<p style="font-family:var(--sv-sans);color:var(--sv-warm-gray);">No open roles listed here yet.</p>'; return; }
    grid.innerHTML = roles.map(function(r, i) {
      return '<button type="button" class="sv-role-card" data-role-idx="' + i + '">'
        + '<span class="sv-role-title">' + escH(r.name) + '</span>'
        + (r.description ? '<span class="sv-role-blurb">' + escH(r.description) + '</span>' : '')
        + (r.commitment ? '<span class="sv-role-commit">' + escH(r.commitment) + '</span>' : '')
        + '</button>';
    }).join('');
  });
}

function svSelectCategory(cat) {
  svState.cat = cat;
  svRenderChips();
  svRenderRoleGroup();
}

function svAddRoleFromCard(idx) {
  var roles = svState.catRoles[svState.cat] || [];
  var r = roles[idx]; if (!r) return;
  var catLabel = svPickedLabel(svState.cat);
  var ministry = svState.cat === 'partner' ? r.ministry : svState.cat;
  var already = svState.roles.some(function(x) { return x.label === r.name && x.category === catLabel; });
  if (!already) svState.roles.push({ category: catLabel, ministry: ministry, label: r.name, commitment: r.commitment || '' });
  svGoStep(3);
}

function svRemoveRole(i) {
  svState.roles.splice(i, 1);
  if (!svState.roles.length) { svGoStep(2); return; }
  svRenderStep3();
}

function svRenderStep2Heading() {
  var h = document.getElementById('sv-step2-h2');
  if (h) h.textContent = svState.roles.length ? 'Add another role' : 'What sounds like you?';
  var doneBtn = document.getElementById('sv-step2-done');
  var countEl = document.getElementById('sv-step2-count');
  if (doneBtn) doneBtn.hidden = !svState.roles.length;
  if (countEl) countEl.textContent = svState.roles.length;
}

function svRenderStep3() {
  var wrap = document.getElementById('sv-picked-roles'); if (!wrap) return;
  var h = document.getElementById('sv-step3-h2');
  if (h) h.textContent = svState.roles.length + (svState.roles.length === 1 ? ' role, ready to send' : ' roles, ready to send');
  wrap.innerHTML = svState.roles.map(function(r, i) {
    return '<div class="sv-picked-row"><div class="sv-picked-text"><span class="sv-picked-label">' + escH(r.category) + ': ' + escH(r.label) + '</span>'
      + (r.commitment ? '<span class="sv-picked-meta">' + escH(r.commitment) + '</span>' : '') + '</div>'
      + '<button type="button" class="sv-remove-btn" data-remove-role="' + i + '" aria-label="Remove">&times;</button></div>';
  }).join('');
}

function svGoStep(n) {
  ['sv-step1', 'sv-step2', 'sv-step3', 'sv-step-done'].forEach(function(id, idx) {
    var el = document.getElementById(id);
    if (el) el.hidden = (idx + 1) !== n;
  });
  document.querySelectorAll('#sv-steprail span').forEach(function(s) {
    s.classList.toggle('active', parseInt(s.dataset.step, 10) === n);
  });
  if (n === 2) { svRenderChips(); svRenderRoleGroup(); svRenderStep2Heading(); }
  if (n === 3) svRenderStep3();
  var shell = document.getElementById('sv-wizard');
  if (shell) window.scrollTo({ top: Math.max(0, shell.getBoundingClientRect().top + window.scrollY - 84), behavior: 'smooth' });
}

function svStep1Next() {
  var name = document.getElementById('sv-name').value.trim();
  var email = document.getElementById('sv-email').value.trim();
  var errEl = document.getElementById('sv-step1-error');
  if (name.length < 2 || !svValidEmail(email)) {
    if (errEl) errEl.innerHTML = '<p class="sv-error">We need a name and an email address to follow up with you.</p>';
    return;
  }
  if (errEl) errEl.innerHTML = '';
  svState.name = name; svState.email = email;
  svState.phone = document.getElementById('sv-phone').value.trim();
  svGoStep(2);
}

function svSubmitWizard() {
  var btn = document.getElementById('sv-step3-send');
  svState.notes = document.getElementById('sv-notes').value.trim();
  var cats = [];
  svState.roles.forEach(function(r) { if (cats.indexOf(r.category) === -1) cats.push(r.category); });
  var data = {
    ministry: cats.join(', ') || 'general',
    name: svState.name, email: svState.email, phone: svState.phone, notes: svState.notes,
    roles: svState.roles.map(function(r) { return r.category + ': ' + r.label; })
  };
  var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
  fetch('/serve/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(function(r) { return r.json().then(function(res) { return { ok: r.ok, body: res }; }); })
    .then(function(r) {
      if (r.body.ok) { svShowDone(r.body); }
      else { btn.disabled = false; btn.textContent = orig; var e = document.getElementById('sv-step3-error'); if (e) e.innerHTML = '<p class="sv-error">' + escH(r.body.error || 'Something went wrong. Please try again.') + '</p>'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = orig; var e = document.getElementById('sv-step3-error'); if (e) e.innerHTML = '<p class="sv-error">Could not connect to the server. Please check your internet connection and try again.</p>'; });
}

function svShowDone(body) {
  body = body || {};
  var h = document.getElementById('sv-done-h2');
  if (h) {
    if (body.merged) h.textContent = 'Added, ' + (svState.name.split(' ')[0] || '') + ' — thanks for volunteering in one more way.';
    else if (body.already_signed_up) h.textContent = 'You’re already on our list, ' + (svState.name.split(' ')[0] || '') + '.';
    else h.textContent = 'We’ve got it, ' + (svState.name.split(' ')[0] || '') + '.';
  }
  var rolesWrap = document.getElementById('sv-done-roles');
  var roles = Array.isArray(body.all_roles) ? body.all_roles.filter(Boolean) : [];
  if (rolesWrap) {
    rolesWrap.innerHTML = roles.length
      ? roles.map(function(r) { return '<p>' + escH(r) + '</p>'; }).join('')
      : '';
    rolesWrap.hidden = !roles.length;
  }
  ['sv-step1', 'sv-step2', 'sv-step3'].forEach(function(id) { var el = document.getElementById(id); if (el) el.hidden = true; });
  var done = document.getElementById('sv-step-done'); if (done) done.hidden = false;
  document.querySelectorAll('#sv-steprail span').forEach(function(s) { s.classList.remove('active'); });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function svReset() {
  var cache = svState.catRoles;
  svState = { step: 1, cat: 'worship', name: '', email: '', phone: '', notes: '', roles: [], catRoles: cache, _init: true };
  ['sv-name', 'sv-email', 'sv-phone', 'sv-notes'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  var btn = document.getElementById('sv-step3-send'); if (btn) { btn.disabled = false; btn.textContent = 'Send my interest'; }
  ['sv-step1-error', 'sv-step3-error'].forEach(function(id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });
  svGoStep(1);
}

function svWizardInit() {
  if (svState._init) return; svState._init = true;
  document.getElementById('sv-step1-next').addEventListener('click', svStep1Next);
  document.getElementById('sv-step2-back').addEventListener('click', function() { svGoStep(1); });
  document.getElementById('sv-step2-done').addEventListener('click', function() { svGoStep(3); });
  document.getElementById('sv-step3-add').addEventListener('click', function() { svGoStep(2); });
  document.getElementById('sv-step3-send').addEventListener('click', svSubmitWizard);
  document.getElementById('sv-signup-another').addEventListener('click', svReset);
  document.getElementById('sv-chips').addEventListener('click', function(e) {
    var b = e.target.closest('[data-cat]'); if (b) svSelectCategory(b.dataset.cat);
  });
  document.getElementById('sv-role-groups').addEventListener('click', function(e) {
    var b = e.target.closest('[data-role-idx]'); if (b) svAddRoleFromCard(parseInt(b.dataset.roleIdx, 10));
  });
  document.getElementById('sv-picked-roles').addEventListener('click', function(e) {
    var b = e.target.closest('[data-remove-role]'); if (b) svRemoveRole(parseInt(b.dataset.removeRole, 10));
  });
}

// ── Christmas Market shift picker (page-market) ─────────────────────
var svMkt = { ev: null, mode: 'job', openJob: null, openWin: null, day: null, shifts: [], submitted: false, toastTimer: null, _init: false };

function svMktEnsureEvent() {
  if (svMkt.ev) return Promise.resolve(svMkt.ev);
  return ensureEventsData().then(function(events) {
    var found = null;
    events.forEach(function(e) { if (e.name === 'Christmas Market') found = e; });
    svMkt.ev = found;
    return found;
  });
}

function svMktTimeLabel(r) { return (r.start_time || '') + (r.end_time ? '–' + r.end_time : ''); }
function svMktDateLabel(r) { return r.role_date ? formatShortDate(r.role_date) : ''; }
function svMktAvailable(r) { return r.slots > 0 ? (r.slots - (r.filled_count || 0)) : 999; }
function svMktIsFullServer(r) { return r.slots > 0 && svMktAvailable(r) <= 0; }
function svMktIsClaimed(r) { var claimed = false; svMkt.shifts.forEach(function(s) { if (s.id === r.id) claimed = true; }); return claimed; }

function svMktSpotsText(r) {
  if (svMktIsFullServer(r) && !svMktIsClaimed(r)) return 'Full';
  if (r.slots > 0) return (r.slots - svMktAvailable(r)) + ' of ' + r.slots + ' spots filled';
  return '';
}

function svMktToast(kind, role) {
  var toast = document.getElementById('mkt-toast'); if (!toast) return;
  var badge = document.getElementById('mkt-toast-badge');
  var text = document.getElementById('mkt-toast-text');
  badge.className = 'sv-toast-badge ' + kind;
  badge.textContent = kind === 'add' ? '✓' : '–';
  var when = svMktDateLabel(role) + (svMktTimeLabel(role) ? ' ' + svMktTimeLabel(role) : '');
  text.textContent = (kind === 'add' ? 'Added — ' : 'Removed — ') + role.name + (when ? ' · ' + when : '');
  toast.classList.add('show');
  if (svMkt.toastTimer) clearTimeout(svMkt.toastTimer);
  svMkt.toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2200);
}

function svMktToggleClaim(role, flashEl) {
  var idx = -1;
  svMkt.shifts.forEach(function(s, i) { if (s.id === role.id) idx = i; });
  if (idx !== -1) {
    svMkt.shifts.splice(idx, 1);
    svMktToast('remove', role);
  } else {
    if (svMktIsFullServer(role)) return;
    svMkt.shifts.push({ id: role.id, name: role.name, dateLabel: svMktDateLabel(role), timeLabel: svMktTimeLabel(role) });
    svMktToast('add', role);
    if (flashEl) { flashEl.classList.add('flash'); setTimeout(function() { if (flashEl) flashEl.classList.remove('flash'); }, 420); }
    if (navigator.vibrate) navigator.vibrate(18);
  }
  svMktRenderModeBody();
  svMktRenderSummary();
}

function svMktSlotRowHtml(role) {
  var claimed = svMktIsClaimed(role);
  var full = svMktIsFullServer(role) && !claimed;
  var cls = 'sv-slot' + (full ? ' full' : '') + (claimed ? ' claimed' : '');
  var label = claimed ? '✓ You’re on it — tap to undo' : svMktSpotsText(role);
  var when = svMktDateLabel(role) + (svMktTimeLabel(role) ? ' · ' + svMktTimeLabel(role) : '');
  return '<div class="' + cls + '" data-role-id="' + role.id + '"><span class="t">' + escH(role.name)
    + (when ? ' <span style="font-weight:400;color:var(--sv-warm-gray);font-size:.85em;">(' + escH(when) + ')</span>' : '')
    + '</span><span class="n">' + label + '</span></div>';
}

function svMktJobGroups() {
  var order = [], groups = {};
  (svMkt.ev.roles || []).forEach(function(r) { if (!groups[r.name]) { groups[r.name] = []; order.push(r.name); } groups[r.name].push(r); });
  return { order: order, groups: groups };
}

function svMktRenderByJob() {
  var g = svMktJobGroups();
  var html = '<div class="sv-job-grid">';
  g.order.forEach(function(jobName) {
    var windows = g.groups[jobName];
    var openCount = 0;
    windows.forEach(function(r) { if (!svMktIsFullServer(r) || svMktIsClaimed(r)) openCount++; });
    var foot = openCount === 0 ? 'All shifts full' : (openCount === 1 ? '1 time open' : openCount + ' times open');
    var isOpen = svMkt.openJob === jobName;
    html += '<div>';
    html += '<button type="button" class="sv-job-card' + (isOpen ? ' expanded' : '') + '" data-job="' + escH(jobName) + '">'
      + '<span class="sv-role-title">' + escH(jobName) + '</span>'
      + (windows[0].description ? '<span class="sv-role-blurb">' + escH(windows[0].description) + '</span>' : '')
      + '<span class="sv-job-foot">' + foot + '</span></button>';
    if (isOpen) {
      html += '<div class="sv-panel"><div class="sv-panel-head">When can you take it? Tap a time to claim the shift.</div>';
      windows.slice().sort(function(a, b) { return (a.role_date + a.start_time) < (b.role_date + b.start_time) ? -1 : 1; }).forEach(function(r) {
        html += svMktSlotRowHtml(r);
      });
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function svMktDayLabelHtml(dateStr, idx, total) {
  var d = new Date(dateStr + 'T00:00:00');
  var weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  var wd = weekdays[d.getDay()] || '';
  var suffix = (idx === total - 1) ? 'MARKET DAY' : 'SETUP';
  return wd + ' · ' + suffix;
}

function svMktRenderByTime() {
  var dates = getUniqueDates(svMkt.ev);
  var html = '<div class="sv-time-cols">';
  dates.forEach(function(dateStr, di) {
    html += '<div class="sv-time-col"><h3>' + svMktDayLabelHtml(dateStr, di, dates.length) + '</h3>';
    var winMap = {}, order = [];
    svMkt.ev.roles.filter(function(r) { return r.role_date === dateStr; }).forEach(function(r) {
      var key = r.start_time + '|' + r.end_time;
      if (!winMap[key]) { winMap[key] = []; order.push(key); }
      winMap[key].push(r);
    });
    order.sort(function(a, b) { return parseTimeToMinutes(a.split('|')[0]) - parseTimeToMinutes(b.split('|')[0]); });
    order.forEach(function(key) {
      var rows = winMap[key];
      var openCount = 0;
      rows.forEach(function(r) { if (!svMktIsFullServer(r) || svMktIsClaimed(r)) openCount++; });
      var winId = dateStr + '|' + key;
      var isOpen = svMkt.openWin === winId;
      var t = rows[0].start_time + (rows[0].end_time ? '–' + rows[0].end_time : '');
      html += '<div class="sv-time-row' + (isOpen ? ' expanded' : '') + '" data-win="' + escH(winId) + '"><span class="t">' + escH(t) + '</span><span class="n">' + (openCount ? openCount + ' job' + (openCount === 1 ? '' : 's') + ' open' : 'all full') + '</span></div>';
      if (isOpen) {
        html += '<div class="sv-panel"><div class="sv-panel-head">Jobs open at ' + escH(t) + ' — tap one to take it</div>';
        rows.forEach(function(r) { html += svMktSlotRowHtml(r); });
        html += '</div>';
      }
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

function svMktRenderByDay() {
  var dates = getUniqueDates(svMkt.ev);
  if (!svMkt.day || dates.indexOf(svMkt.day) === -1) svMkt.day = dates[0];
  var weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var html = '<div class="sv-day-pills">';
  dates.forEach(function(dateStr, di) {
    var d = new Date(dateStr + 'T00:00:00');
    var label = weekdays[d.getDay()] + (di === dates.length - 1 ? ' — market day' : ' — setup evening');
    html += '<button type="button" class="sv-day-pill' + (svMkt.day === dateStr ? ' active' : '') + '" data-day="' + dateStr + '">' + escH(label) + '</button>';
  });
  html += '</div>';
  var d2 = new Date(svMkt.day + 'T00:00:00');
  html += '<div class="sv-panel" style="margin-top:1rem;"><div class="sv-panel-head">Everything open on ' + weekdays[d2.getDay()] + '</div>';
  svMkt.ev.roles.filter(function(r) { return r.role_date === svMkt.day; })
    .sort(function(a, b) { return parseTimeToMinutes(a.start_time) - parseTimeToMinutes(b.start_time); })
    .forEach(function(r) { html += svMktSlotRowHtml(r); });
  html += '</div>';
  return html;
}

function svMktRenderModeBody() {
  var wrap = document.getElementById('mkt-mode-body'); if (!wrap || !svMkt.ev) return;
  if (svMkt.mode === 'job') wrap.innerHTML = svMktRenderByJob();
  else if (svMkt.mode === 'time') wrap.innerHTML = svMktRenderByTime();
  else wrap.innerHTML = svMktRenderByDay();
}

function svMktRenderModeToggle() {
  document.querySelectorAll('#mkt-mode-toggle button').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === svMkt.mode); });
}

function svMktRenderSummary() {
  var rows = document.getElementById('mkt-shift-rows');
  var heading = document.getElementById('mkt-summary-heading');
  if (heading) heading.textContent = svMkt.shifts.length === 0 ? 'Your shifts' : (svMkt.shifts.length === 1 ? 'Your shift' : 'Your ' + svMkt.shifts.length + ' shifts');
  if (rows) {
    rows.innerHTML = svMkt.shifts.length ? svMkt.shifts.map(function(s) {
      return '<div class="sv-picked-row"><div class="sv-picked-text"><span class="sv-picked-label">' + escH(s.name) + '</span>'
        + '<span class="sv-picked-meta">' + escH(s.dateLabel) + (s.timeLabel ? ' · ' + escH(s.timeLabel) : '') + '</span></div>'
        + '<button type="button" class="sv-remove-btn" data-unclaim="' + s.id + '" aria-label="Remove">&times;</button></div>';
    }).join('') : '<p class="sv-summary-empty">Nothing yet — pick a job or a time above and your shifts collect here.</p>';
  }
  var bar = document.getElementById('mkt-stickybar');
  var count = document.getElementById('mkt-stickybar-count');
  var showBar = svMkt.shifts.length > 0 && !svMkt.submitted;
  if (bar) bar.hidden = !showBar;
  if (count) count.textContent = svMkt.shifts.length + (svMkt.shifts.length === 1 ? ' shift picked' : ' shifts picked');
  document.body.classList.toggle('sv-market-open', showBar);
}

function svMktValidateWho() {
  var nameInput = document.getElementById('mkt-name');
  var name = nameInput.value.trim();
  var email = document.getElementById('mkt-email').value.trim();
  var errEl = document.getElementById('mkt-who-error');
  if (name.length < 2 || !svValidEmail(email)) {
    if (errEl) errEl.innerHTML = '<p class="sv-error">We need a name and an email address to follow up with you.</p>';
    window.scrollTo({ top: Math.max(0, nameInput.getBoundingClientRect().top + window.scrollY - 140), behavior: 'smooth' });
    nameInput.focus();
    return false;
  }
  if (errEl) errEl.innerHTML = '';
  return true;
}

function svMktSubmit() {
  var shiftErr = document.getElementById('mkt-shift-error');
  if (!svMkt.shifts.length) {
    if (shiftErr) shiftErr.innerHTML = '<p class="sv-error">Pick at least one shift below first.</p>';
    return;
  }
  if (shiftErr) shiftErr.innerHTML = '';
  if (!svMktValidateWho()) return;
  var btn = document.getElementById('mkt-submit-btn');
  var name = document.getElementById('mkt-name').value.trim();
  var email = document.getElementById('mkt-email').value.trim();
  var phone = document.getElementById('mkt-phone').value.trim();
  var notes = document.getElementById('mkt-notes').value.trim();
  var data = { ministry: 'events', event_id: svMkt.ev.id, event_name: svMkt.ev.name, name: name, email: email, phone: phone, notes: notes, role_ids: svMkt.shifts.map(function(s) { return s.id; }) };
  var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
  fetch('/serve/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(function(r) { return r.json().then(function(res) { return { ok: r.ok, body: res }; }); })
    .then(function(r) {
      if (r.body.ok) { svMktShowDone(name, r.body); }
      else { btn.disabled = false; btn.textContent = orig; if (shiftErr) shiftErr.innerHTML = '<p class="sv-error">' + escH(r.body.error || 'Something went wrong. Please try again.') + '</p>'; }
    })
    .catch(function() { btn.disabled = false; btn.textContent = orig; if (shiftErr) shiftErr.innerHTML = '<p class="sv-error">Could not connect to the server. Please check your internet connection and try again.</p>'; });
}

function svMktShowDone(name, body) {
  body = body || {};
  svMkt.submitted = true;
  document.getElementById('sv-mkt-you').hidden = true;
  document.getElementById('sv-mkt-shifts').hidden = true;
  var bar = document.getElementById('mkt-stickybar'); if (bar) bar.hidden = true;
  document.body.classList.remove('sv-market-open');
  var done = document.getElementById('mkt-done'); done.hidden = false;
  var h = document.getElementById('mkt-done-h2');
  if (h) {
    if (body.merged) h.textContent = 'Added, ' + (name.split(' ')[0] || '') + ' — thanks for picking up more time.';
    else if (body.already_signed_up) h.textContent = 'You’re already signed up, ' + (name.split(' ')[0] || '') + '.';
    else h.textContent = 'Thank you, ' + (name.split(' ')[0] || '') + '.';
  }
  // Rebuild the full shift list from every role id now on file (this
  // submission's picks plus anything already claimed in an earlier
  // sign-up), not just what was picked in this browser session — a
  // returning volunteer should see everything they're down for, not
  // only the shift they just added.
  var allIds = Array.isArray(body.all_role_ids) ? body.all_role_ids : svMkt.shifts.map(function(s) { return s.id; });
  var byId = {}; svMkt.shifts.forEach(function(s) { byId[s.id] = s; });
  var allShifts = allIds.map(function(rid) {
    if (byId[rid]) return byId[rid];
    var role = (svMkt.ev.roles || []).filter(function(r) { return r.id === rid; })[0];
    if (!role) return null;
    return { id: role.id, name: role.name, dateLabel: svMktDateLabel(role), timeLabel: svMktTimeLabel(role) };
  }).filter(Boolean);
  var list = document.getElementById('mkt-done-shifts');
  if (list) list.innerHTML = allShifts.map(function(s) {
    return '<p>' + escH(s.name) + ' — <em>' + escH(s.dateLabel) + (s.timeLabel ? ' ' + escH(s.timeLabel) : '') + '</em></p>';
  }).join('');
  window.scrollTo(0, 0);
}

function svMktResetAll() {
  var ev = svMkt.ev;
  svMkt = { ev: ev, mode: 'job', openJob: null, openWin: null, day: null, shifts: [], submitted: false, toastTimer: null, _init: true };
  ['mkt-name', 'mkt-email', 'mkt-phone', 'mkt-notes'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  ['mkt-who-error', 'mkt-shift-error'].forEach(function(id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });
  var btn = document.getElementById('mkt-submit-btn'); if (btn) { btn.disabled = false; btn.textContent = 'Sign me up'; }
  document.getElementById('sv-mkt-you').hidden = false;
  document.getElementById('sv-mkt-shifts').hidden = false;
  document.getElementById('mkt-done').hidden = true;
  svMktRenderModeToggle();
  svMktRenderModeBody();
  svMktRenderSummary();
  window.scrollTo(0, 0);
}

function svMktLoad() {
  svMktEnsureEvent().then(function(ev) {
    var body = document.getElementById('mkt-mode-body');
    if (!ev) { if (body) body.innerHTML = '<p style="font-family:var(--sv-sans);color:var(--sv-warm-gray);">Christmas Market sign-ups aren’t open yet — check back soon.</p>'; return; }
    var hold = document.getElementById('mkt-hold');
    var you = document.getElementById('sv-mkt-you');
    var shifts = document.getElementById('sv-mkt-shifts');
    if (ev.hidden) {
      if (hold) hold.hidden = false;
      if (you) you.hidden = true;
      if (shifts) shifts.hidden = true;
      return;
    }
    if (hold) hold.hidden = true;
    if (you) you.hidden = false;
    if (shifts) shifts.hidden = false;
    svMktRenderModeToggle();
    svMktRenderModeBody();
    svMktRenderSummary();
  });
}

function svMktInit() {
  if (svMkt._init) return; svMkt._init = true;
  document.getElementById('mkt-mode-toggle').addEventListener('click', function(e) {
    var b = e.target.closest('[data-mode]'); if (!b) return;
    svMkt.mode = b.dataset.mode; svMkt.openJob = null; svMkt.openWin = null;
    svMktRenderModeToggle(); svMktRenderModeBody();
  });
  document.getElementById('mkt-mode-body').addEventListener('click', function(e) {
    var jobBtn = e.target.closest('[data-job]');
    if (jobBtn) { svMkt.openJob = svMkt.openJob === jobBtn.dataset.job ? null : jobBtn.dataset.job; svMktRenderModeBody(); return; }
    var winRow = e.target.closest('[data-win]');
    if (winRow) { svMkt.openWin = svMkt.openWin === winRow.dataset.win ? null : winRow.dataset.win; svMktRenderModeBody(); return; }
    var dayPill = e.target.closest('[data-day]');
    if (dayPill) { svMkt.day = dayPill.dataset.day; svMktRenderModeBody(); return; }
    var slot = e.target.closest('[data-role-id]');
    if (slot) {
      var rid = parseInt(slot.dataset.roleId, 10);
      var role = null;
      svMkt.ev.roles.forEach(function(r) { if (r.id === rid) role = r; });
      if (role) svMktToggleClaim(role, slot);
    }
  });
  document.getElementById('mkt-shift-rows').addEventListener('click', function(e) {
    var b = e.target.closest('[data-unclaim]'); if (!b) return;
    var rid = parseInt(b.dataset.unclaim, 10);
    var role = null;
    svMkt.ev.roles.forEach(function(r) { if (r.id === rid) role = r; });
    if (role) svMktToggleClaim(role, null);
  });
  document.getElementById('mkt-submit-btn').addEventListener('click', svMktSubmit);
  document.getElementById('mkt-stickybar-btn').addEventListener('click', function() {
    var row = document.getElementById('mkt-submit-row');
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('mkt-signup-another').addEventListener('click', svMktResetAll);
}

(function() {
  var initialVisible = document.querySelector('.app-page:not([hidden])');
  var initialPageId = initialVisible ? initialVisible.id.replace('page-', '') : 'landing';
  svWizardInit();
  svUpdateHeaderCta(initialPageId);
  if (initialPageId === 'market') { svMktInit(); svMktLoad(); }
})();

// ── Navigation event delegation (CSP-safe: no inline onclick needed) ─────────
document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-nav-page]');
  if (el) {
    e.preventDefault();
    closeDrawer();
    navigate(el.dataset.navPage);
    var scrollTo = el.dataset.scrollTo;
    if (scrollTo) {
      setTimeout(function() {
        var target = document.getElementById(scrollTo);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
    return;
  }
  var submitEl = e.target.closest('[data-simple-event-submit]');
  if (submitEl) {
    submitSimpleEvent(parseInt(submitEl.dataset.eventId, 10), submitEl.dataset.eventName, submitEl);
    return;
  }
});
`;
