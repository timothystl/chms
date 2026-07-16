export const JS_HOUSEHOLDS = String.raw`// ── HOUSEHOLDS ────────────────────────────────────────────────────────
var _hhMemberFilter = 'all';
function setHHFilter(f) {
  _hhMemberFilter = f;
  ['all','member'].forEach(function(v) {
    var b = document.getElementById('hh-filter-'+v);
    if (b) b.classList.toggle('active', v === f);
  });
  loadHouseholds(true);
}
function debounceHouseholds() {
  clearTimeout(_hDebounce);
  _hDebounce = setTimeout(function() { loadHouseholds(true); }, 300);
}
function loadHouseholds(resetPage) {
  if (resetPage) _hhOffset = 0;
  var q = document.getElementById('h-search').value;
  var sort = (document.getElementById('h-sort') || {value:'name'}).value;
  var mtParam = _hhMemberFilter !== 'all' ? '&member_type=' + encodeURIComponent(_hhMemberFilter) : '';
  setStatus('h-status', 'Loading…');
  api('/admin/api/households?q=' + encodeURIComponent(q) + '&sort=' + sort + '&limit=50&offset=' + _hhOffset + mtParam).then(function(d) {
    setStatus('h-status', '');
    _hhTotal = d.total || 0;
    renderHouseholds(d.households || []);
    renderHouseholdPager();
  }).catch(function() { setStatus('h-status', 'Error loading households.', 'err'); });
}
function renderHouseholdPager() {
  var el = document.getElementById('h-pager');
  if (!el) return;
  var limit = 50, offset = _hhOffset, total = _hhTotal;
  if (total <= limit) { el.innerHTML = '<span style="color:var(--warm-gray);font-size:.82rem;">' + total + ' household' + (total !== 1 ? 's' : '') + '</span>'; return; }
  var from = offset + 1, to = Math.min(offset + limit, total);
  el.innerHTML = '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="hhPage(-1)" ' + (offset===0?'disabled':'') + '>&#8592; Prev</button>'
    + '<span style="font-size:.82rem;color:var(--warm-gray);margin:0 10px;">' + from + '–' + to + ' of ' + total + '</span>'
    + '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="hhPage(1)" ' + (to>=total?'disabled':'') + '>Next &#8594;</button>';
}
function hhPage(dir) {
  _hhOffset = Math.max(0, _hhOffset + dir * 50);
  loadHouseholds();
}
function renderHouseholds(rows, targetId) {
  var c = document.getElementById(targetId || 'h-grid');
  if (!c) return;
  if (!rows.length) { c.innerHTML = '<div class="empty"><div class="empty-icon">&#127968;</div>No households found</div>'; return; }
  c.innerHTML = rows.map(function(h) {
    var addr = [h.address1, h.city, h.state].filter(Boolean).join(', ');
    var photo = h.photo_url
      ? '<div style="height:80px;overflow:hidden;background:var(--linen);border-radius:12px 12px 0 0;">'
        + '<img src="'+esc(photoSrc(h.photo_url))+'" alt="" style="width:100%;height:80px;object-fit:cover;display:block;" onerror="this.parentNode.style.display=\'none\'">'
        + '</div>'
      : '';
    return '<div class="h-card" onclick="openHouseholdDetail(' + h.id + ')" style="padding:0;overflow:hidden;cursor:pointer;">'
      + photo
      + '<div style="padding:10px 12px;">'
      + '<div class="h-name">' + esc(h.display_name || h.name) + '</div>'
      + (addr ? '<div class="h-addr">' + esc(addr) + '</div>' : '')
      + '<div style="font-size:.78rem;color:var(--warm-gray);">' + (h.member_count||0) + ' member' + (h.member_count !== 1 ? 's' : '') + '</div>'
      + '</div></div>';
  }).join('');
}
var _currentHousehold = null;
function openHouseholdDetail(id) {
  api('/admin/api/households/' + id).then(function(h) {
    if (!h || !h.id) return;
    showHouseholdView(h);
  });
}
function closeHouseholdView() {
  _currentHousehold = null;
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('hv-mode');
}
function showHouseholdView(h) {
  _currentHousehold = h;
  var members = (h.members || []).slice();
  var addr = [h.address1, h.city, h.state && h.zip ? h.state + ' ' + h.zip : (h.state || h.zip || '')].filter(Boolean).join(', ');
  var roleOrder = {head:0, spouse:1, child:2, other:3};
  members.sort(function(a,b){ return (roleOrder[a.family_role]??4)-(roleOrder[b.family_role]??4) || (a.last_name||'').localeCompare(b.last_name||''); });
  var dispName = h.display_name || h.name;
  var tn = document.getElementById('hv-topbar-name');
  if (tn) tn.textContent = dispName;
  var iconEl = document.getElementById('hv-icon-tile');
  if (iconEl) {
    iconEl.innerHTML = h.photo_url
      ? '<img src="'+esc(photoSrc(h.photo_url))+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px;" onerror="this.parentNode.innerHTML=&#39;&#127968;&#39;">'
      : '&#127968;';
  }
  var nameEl = document.getElementById('hv-name');
  if (nameEl) nameEl.textContent = dispName;
  var addrEl = document.getElementById('hv-addr');
  if (addrEl) addrEl.textContent = addr;
  var editBtn = document.getElementById('hv-edit-btn');
  if (editBtn) editBtn.setAttribute('onclick', 'editHouseholdById(' + h.id + ')');
  var membersEl = document.getElementById('hv-members');
  if (membersEl) {
    membersEl.innerHTML = members.length ? members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'').charAt(0)+(m.last_name||'').charAt(0)).toUpperCase();
      var mTint = avatarTint(m.id);
      var role = m.family_role ? m.family_role.charAt(0).toUpperCase()+m.family_role.slice(1) : '';
      return '<div class="hv-member-row" onclick="openPersonDetail('+m.id+')">'
        + '<div class="hv-member-avatar" style="background:'+mTint.bg+';color:'+mTint.fg+';">'+ini+'</div>'
        + '<div style="flex:1;min-width:0;"><div class="hv-member-name">'+esc(mName)+'</div>'
        + (role ? '<div class="hv-member-role">'+esc(role)+'</div>' : '')
        + '</div>'
        + '<div style="flex-shrink:0;">'+typeDotHtml(m.member_type)+'</div>'
        + '</div>';
    }).join('') : '<div style="color:var(--warm-meta);font-size:.88rem;padding:10px 0;">No members</div>';
  }
  // Desktop-only summary strip: current-year giving (finance+ only), envelope #, anniversary
  var summaryEl = document.getElementById('hv-summary');
  if (summaryEl) {
    var isFinanceUser = (_userRole === 'admin' || _userRole === 'finance');
    var curYear = new Date().getFullYear().toString();
    var curYearGiving = isFinanceUser ? ((h.giving_years||[]).find(function(g){ return String(g.yr) === curYear; }) || {}).total_cents || 0 : null;
    var tiles = '';
    if (isFinanceUser) tiles += '<div><div class="hv-summary-lbl">'+curYear+' Giving</div><div class="hv-summary-val">$'+(curYearGiving/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'</div></div>';
    if (h.envelope_number) tiles += '<div><div class="hv-summary-lbl">Envelope #</div><div class="hv-summary-val">'+esc(h.envelope_number)+'</div></div>';
    if (h.anniversary_date) tiles += '<div><div class="hv-summary-lbl">Anniversary</div><div class="hv-summary-val">'+fmtDate(h.anniversary_date)+'</div></div>';
    summaryEl.innerHTML = tiles;
    summaryEl.style.display = tiles ? 'flex' : 'none';
  }
  var ca = document.querySelector('.content-area');
  if (ca) { ca.classList.remove('pv-mode', 'ov-mode'); ca.classList.add('hv-mode'); }
}
function editHouseholdById(id) {
  api('/admin/api/households/' + id).then(function(h) { openHouseholdEdit(h); });
}
function openHouseholdEdit(h) {
  var isNew = !h || !h.id;
  document.getElementById('hh-modal-title').textContent = isNew ? 'New Household' : h.name;
  document.getElementById('hm-id').value = isNew ? '' : h.id;
  document.getElementById('hm-name').value = isNew ? '' : (h.name||'');
  document.getElementById('hm-addr1').value = isNew ? '' : (h.address1||'');
  document.getElementById('hm-addr2').value = isNew ? '' : (h.address2||'');
  document.getElementById('hm-city').value = isNew ? '' : (h.city||'');
  document.getElementById('hm-state').value = isNew ? 'MO' : (h.state||'MO');
  document.getElementById('hm-zip').value = isNew ? '' : (h.zip||'');
  document.getElementById('hm-notes').value = isNew ? '' : (h.notes||'');
  _editingHouseholdId = isNew ? null : h.id;
  var photoUrl = isNew ? '' : (h.photo_url||'');
  document.getElementById('hm-photo').value = photoUrl;
  var prevEl = document.getElementById('hm-photo-preview');
  if (prevEl) { prevEl.src = photoUrl ? photoSrc(photoUrl) : ''; prevEl.style.display = photoUrl ? 'block' : 'none'; }
  var upBtn = document.getElementById('hm-photo-upload-btn');
  if (upBtn) upBtn.style.display = isNew ? 'none' : 'inline-flex';
  var pickBtn = document.getElementById('hm-photo-pick-btn');
  if (pickBtn) pickBtn.style.display = isNew ? 'none' : 'inline-flex';
  var rcBtn = document.getElementById('hm-photo-recrop-btn');
  if (rcBtn) rcBtn.style.display = (!isNew && photoUrl) ? 'inline-flex' : 'none';
  var rmBtn = document.getElementById('hm-photo-remove-btn');
  if (rmBtn) rmBtn.style.display = (!isNew && photoUrl) ? 'inline-flex' : 'none';
  var applyBtn = document.getElementById('hm-apply-photo-btn');
  if (applyBtn) applyBtn.style.display = isNew ? 'none' : 'inline-flex';
  // Stash members with photos so the picker can render without a refetch
  _hhEditMembers = (h && h.members) ? h.members : [];
  document.getElementById('hm-del-btn').style.display = isNew ? 'none' : 'inline-flex';
  document.getElementById('hm-push-addr-row').style.display = isNew ? 'none' : '';
  var mc = document.getElementById('hm-members');
  if (h && h.members && h.members.length) {
    mc.innerHTML = '<div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--warm-gray);margin-bottom:6px;">Members</div>'
      + '<div style="display:flex;flex-wrap:wrap;gap:6px;">'
      + h.members.map(function(m) {
        return '<span class="h-member-pill" style="cursor:pointer;" onclick="closeModal(&#39;hh-modal&#39;);openPersonDetail(' + m.id + ')">'
          + esc(m.first_name) + ' ' + esc(m.last_name) + ' (' + esc(m.family_role||'—') + ')</span>';
      }).join('') + '</div>';
  } else { mc.innerHTML = ''; }
  openModal('hh-modal');
}
function saveHousehold() {
  var id = document.getElementById('hm-id').value;
  var data = {
    name: document.getElementById('hm-name').value.trim(),
    address1: document.getElementById('hm-addr1').value.trim(),
    address2: document.getElementById('hm-addr2').value.trim(),
    city: document.getElementById('hm-city').value.trim(),
    state: document.getElementById('hm-state').value.trim(),
    zip: document.getElementById('hm-zip').value.trim(),
    notes: document.getElementById('hm-notes').value,
    photo_url: document.getElementById('hm-photo').value.trim()
  };
  if (!data.name) { alert('Family name is required.'); return; }
  var url = id ? '/admin/api/households/' + id : '/admin/api/households';
  var meth = id ? 'PUT' : 'POST';
  api(url, {method:meth, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(r) {
    if (r.ok) {
      closeModal('hh-modal');
      loadHouseholds();
      if (_currentHousehold && String(_currentHousehold.id) === String(id)) openHouseholdDetail(id);
    } else alert('Error: ' + (r.error||'unknown'));
  });
}
function deleteHousehold() {
  var id = document.getElementById('hm-id').value;
  if (!confirm('Delete this household?')) return;
  api('/admin/api/households/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) {
      closeModal('hh-modal');
      if (_currentHousehold && String(_currentHousehold.id) === String(id)) closeHouseholdView();
      loadHouseholds();
    } else alert(r.error || 'Cannot delete.');
  });
}
function hhPushAddress() {
  var id = document.getElementById('hm-id').value;
  if (!id) return;
  var addr1 = document.getElementById('hm-addr1').value.trim();
  if (!addr1) { alert('No address to push — fill in the street address first.'); return; }
  var data = {
    address1: addr1,
    city: document.getElementById('hm-city').value.trim(),
    state: document.getElementById('hm-state').value.trim() || 'MO',
    zip: document.getElementById('hm-zip').value.trim()
  };
  api('/admin/api/households/' + id + '/sync-address', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(data)
  }).then(function(r) {
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    var n = r.updated || 0;
    if (n > 0) alert('Address pushed to ' + n + ' member' + (n !== 1 ? 's' : '') + ' who had no address on file.');
    else alert('All household members already have an address — nothing was changed.');
  });
}
var _hhEditMembers = [];
function openHHPhotoPicker() {
  var hid = _editingHouseholdId;
  if (!hid) return;
  var members = _hhEditMembers || [];
  var withPhotos = members.filter(function(m){ return m.photo_url; });
  if (!withPhotos.length) {
    alert('No household members have a photo on their profile yet. Upload a profile photo to a member, or use the Upload Photo button to set the household photo directly.');
    return;
  }
  // Sort head first, then by last+first
  withPhotos.sort(function(a, b) {
    var ha = a.family_role === 'head' ? 0 : 1, hb = b.family_role === 'head' ? 0 : 1;
    if (ha !== hb) return ha - hb;
    return ((a.last_name||'') + (a.first_name||'')).localeCompare((b.last_name||'') + (b.first_name||''));
  });
  var list = document.getElementById('hh-photo-pick-list');
  list.innerHTML = withPhotos.map(function(m) {
    var name = ((m.first_name||'') + ' ' + (m.last_name||'')).trim();
    var role = m.family_role ? ' · ' + m.family_role : '';
    return '<div onclick="useMemberPhoto(' + m.id + ')" style="cursor:pointer;width:120px;text-align:center;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--white);">'
      + '<img src="' + esc(photoSrc(m.photo_url)) + '" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:50%;display:block;margin:0 auto 6px;">'
      + '<div style="font-size:.85rem;font-weight:600;color:var(--charcoal);">' + esc(name) + '</div>'
      + '<div style="font-size:.72rem;color:var(--warm-gray);text-transform:capitalize;">' + esc(role.replace(/^ \xb7 /, '')) + '</div>'
      + '</div>';
  }).join('');
  openModal('hh-photo-pick-modal');
}
function useMemberPhoto(memberId) {
  var hid = _editingHouseholdId;
  if (!hid || !memberId) return;
  api('/admin/api/households/' + hid + '/use-member-photo', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ member_id: memberId })
  }).then(function(r) {
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    closeModal('hh-photo-pick-modal');
    document.getElementById('hm-photo').value = r.photo_url || '';
    var prevEl = document.getElementById('hm-photo-preview');
    if (prevEl) { prevEl.src = photoSrc(r.photo_url) + '?t=' + Date.now(); prevEl.style.display = 'block'; }
    document.getElementById('hm-photo-recrop-btn').style.display = 'inline-flex';
    document.getElementById('hm-photo-remove-btn').style.display = 'inline-flex';
  });
}
function applyHHPhotoToMembers() {
  var id = document.getElementById('hm-id').value;
  if (!id) return;
  var photoUrl = document.getElementById('hm-photo').value;
  if (!photoUrl) { alert('No household photo to apply — upload one first.'); return; }
  api('/admin/api/households/' + id + '/apply-photo-to-members', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: '{}'
  }).then(function(r) {
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    var n = r.updated || 0;
    if (n > 0) {
      alert('Photo applied to ' + n + ' family member' + (n !== 1 ? 's' : '') + ' who had no photo.');
      loadHouseholds();
    } else alert('All family members already have a photo — nothing was changed.');
  });
}

// ── ORGANIZATIONS ─────────────────────────────────────────────────────
var _orgPage = 0, _orgLimit = 25, _orgTotal = 0, _orgDebounce = null;
var _orgRows = [];
function debounceOrgs() {
  clearTimeout(_orgDebounce);
  _orgDebounce = setTimeout(function() { loadOrganizations(true); }, 300);
}
function loadOrganizations(reset) {
  if (reset) _orgPage = 0;
  var q = (document.getElementById('org-search') || {}).value || '';
  var offset = _orgPage * _orgLimit;
  api('/admin/api/organizations?q=' + encodeURIComponent(q) + '&offset=' + offset + '&limit=' + _orgLimit).then(function(d) {
    _orgTotal = d.total || 0;
    var grid = document.getElementById('org-grid');
    var pager = document.getElementById('org-pager');
    if (!grid) return;
    var orgs = d.organizations || [];
    _orgRows = orgs;
    if (!orgs.length) {
      grid.innerHTML = '<div style="color:var(--warm-gray);padding:32px;text-align:center;">' + (q ? 'No organizations match "' + esc(q) + '".' : 'No organizations yet. Click "+ New Organization" to add one.') + '</div>';
      if (pager) pager.innerHTML = '';
      return;
    }
    grid.innerHTML = orgs.map(function(o, idx) {
      var typeBadge = o.type ? ' <span style="font-size:.68rem;background:var(--linen);color:var(--warm-gray);border-radius:99px;padding:1px 8px;font-weight:600;">'+esc(o.type)+'</span>' : '';
      var contact = o.contact_name ? esc(o.contact_name) : '';
      var info = [o.phone, o.email].filter(Boolean).map(esc).join(' &middot; ');
      var addr = [o.city, o.state].filter(Boolean).join(', ');
      return '<div class="h-card" onclick="openOrgRow(' + idx + ')">'
        + '<div class="h-name">'+esc(o.name)+typeBadge+'</div>'
        + (contact ? '<div class="h-addr">'+contact+'</div>' : '')
        + (info ? '<div class="h-addr">'+info+'</div>' : '')
        + (addr ? '<div class="h-addr">'+esc(addr)+'</div>' : '')
        + '</div>';
    }).join('');
    // Pager
    if (pager) {
      var pages = Math.ceil(_orgTotal / _orgLimit);
      var cur = _orgPage;
      pager.innerHTML = (cur > 0 ? '<button class="btn-sm" onclick="_orgPage--;loadOrganizations()">&#8249; Prev</button>' : '')
        + '<span style="font-size:.82rem;color:var(--warm-gray);">' + (offset+1) + '–' + Math.min(offset+_orgLimit,_orgTotal) + ' of ' + _orgTotal + '</span>'
        + (cur < pages-1 ? '<button class="btn-sm" onclick="_orgPage++;loadOrganizations()">Next &#8250;</button>' : '');
    }
  }).catch(function() {
    var grid = document.getElementById('org-grid');
    if (grid) grid.innerHTML = '<div style="color:var(--danger);padding:32px;text-align:center;">Error loading organizations.</div>';
  });
}
function openOrgRow(idx) {
  var o = _orgRows[idx];
  if (!o) return;
  if (o.source === 'person') {
    api('/admin/api/people/' + o.id).then(function(p) {
      if (p && p.id) showProfile(p);
    });
    return;
  }
  showOrganizationView(o, idx);
}
// ── ORGANIZATION VIEW (full page, mirrors Household View) ──────────────
function closeOrganizationView() {
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('ov-mode');
}
function showOrganizationView(o, idx) {
  var addr = [o.address1, o.city, o.state].filter(Boolean).join(', ');
  var tn = document.getElementById('ov-topbar-name');
  if (tn) tn.textContent = o.name;
  var nameEl = document.getElementById('ov-name');
  if (nameEl) nameEl.textContent = o.name;
  var addrEl = document.getElementById('ov-addr');
  if (addrEl) addrEl.textContent = addr;
  var editBtn = document.getElementById('ov-edit-btn');
  if (editBtn) editBtn.setAttribute('onclick', 'openOrgEdit(_orgRows[' + idx + '])');
  var detailsEl = document.getElementById('ov-details');
  if (detailsEl) {
    function row(key, valHtml) {
      if (!valHtml) return '';
      return '<div class="pv-row"><div class="pv-row-key">' + esc(key) + '</div><div class="pv-row-val">' + valHtml + '</div></div>';
    }
    var website = (o.website && /^https?:\/\//i.test(o.website))
      ? '<a href="' + esc(o.website) + '" target="_blank">' + esc(o.website.replace(/^https?:\/\//, '')) + '</a>' : '';
    var html = row('Type', o.type ? esc(o.type) : '')
      + row('Contact', o.contact_name ? esc(o.contact_name) : '')
      + row('Phone', o.phone ? '<a href="tel:' + esc(o.phone.replace(/\D/g, '')) + '">' + esc(o.phone) + '</a>' : '')
      + row('Email', o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '')
      + row('Website', website)
      + row('Notes', o.notes ? esc(o.notes) : '');
    detailsEl.innerHTML = html || '<div style="color:var(--warm-meta);font-size:.88rem;padding:10px 0;">No details on file</div>';
  }
  var ca = document.querySelector('.content-area');
  if (ca) { ca.classList.remove('pv-mode', 'hv-mode'); ca.classList.add('ov-mode'); }
}
function openOrgEdit(o) {
  var isNew = !o || !o.id;
  document.getElementById('org-modal-title').textContent = isNew ? 'New Organization' : o.name;
  document.getElementById('om-id').value = isNew ? '' : o.id;
  document.getElementById('om-name').value = isNew ? '' : (o.name||'');
  document.getElementById('om-type').value = isNew ? '' : (o.type||'');
  document.getElementById('om-contact').value = isNew ? '' : (o.contact_name||'');
  document.getElementById('om-phone').value = isNew ? '' : (o.phone||'');
  document.getElementById('om-email').value = isNew ? '' : (o.email||'');
  document.getElementById('om-website').value = isNew ? '' : (o.website||'');
  document.getElementById('om-addr1').value = isNew ? '' : (o.address1||'');
  document.getElementById('om-city').value = isNew ? '' : (o.city||'');
  document.getElementById('om-state').value = isNew ? 'MO' : (o.state||'MO');
  document.getElementById('om-zip').value = isNew ? '' : (o.zip||'');
  document.getElementById('om-notes').value = isNew ? '' : (o.notes||'');
  document.getElementById('om-del-btn').style.display = isNew ? 'none' : 'inline-flex';
  openModal('org-modal');
}
function saveOrg() {
  var id = document.getElementById('om-id').value;
  var name = document.getElementById('om-name').value.trim();
  if (!name) { alert('Organization name is required.'); return; }
  var body = {
    name: name,
    type: document.getElementById('om-type').value,
    contact_name: document.getElementById('om-contact').value.trim(),
    phone: document.getElementById('om-phone').value.trim(),
    email: document.getElementById('om-email').value.trim(),
    website: document.getElementById('om-website').value.trim(),
    address1: document.getElementById('om-addr1').value.trim(),
    city: document.getElementById('om-city').value.trim(),
    state: document.getElementById('om-state').value.trim() || 'MO',
    zip: document.getElementById('om-zip').value.trim(),
    notes: document.getElementById('om-notes').value.trim()
  };
  var url = id ? '/admin/api/organizations/' + id : '/admin/api/organizations';
  var method = id ? 'PUT' : 'POST';
  api(url, { method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(function(r) {
    if (r.ok) { closeModal('org-modal'); loadOrganizations(); }
    else alert(r.error || 'Save failed.');
  });
}
function deleteOrg() {
  var id = document.getElementById('om-id').value;
  if (!id) return;
  var name = document.getElementById('om-name').value;
  if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
  api('/admin/api/organizations/' + id, { method: 'DELETE' }).then(function(r) {
    if (r.ok) { closeModal('org-modal'); loadOrganizations(); }
    else alert(r.error || 'Delete failed.');
  });
}

// ── HOUSEHOLD AUTOCOMPLETE (in person modal) ──────────────────────────
function acHouseholdSearch() {
  var q = document.getElementById('pm-hh-search').value;
  var ac = document.getElementById('pm-hh-ac');
  if (q.length < 1) { ac.classList.remove('open'); return; }
  api('/admin/api/households?q=' + encodeURIComponent(q)).then(function(d) {
    var rows = d.households || [];
    ac.innerHTML = rows.slice(0,8).map(function(h) {
      var dn = h.display_name || h.name;
      return '<div class="ac-item" onclick="selectHousehold(' + h.id + ',&#39;' + esc(dn) + '&#39;)">' + esc(dn) + '</div>';
    }).join('') + '<div class="ac-item" style="color:var(--sage);" onclick="createHouseholdFromPerson()">+ Create new household…</div>';
    ac.classList.toggle('open', rows.length > 0 || true);
  });
}
function selectHousehold(id, name) {
  document.getElementById('pm-hh-id').value = id;
  document.getElementById('pm-hh-search').value = name;
  document.getElementById('pm-hh-ac').classList.remove('open');
}
function createHouseholdFromPerson() {
  var last = document.getElementById('pm-last').value.trim();
  var first = document.getElementById('pm-first').value.trim();
  var proposed = last ? last + ' Family' : (first ? first + ' Family' : 'New Family');
  var name = prompt('New household name:', proposed);
  if (!name || !name.trim()) return;
  name = name.trim();
  document.getElementById('pm-hh-ac').classList.remove('open');
  api('/admin/api/households', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name }) }).then(function(d) {
    if (d && d.id) {
      selectHousehold(d.id, name);
    } else {
      alert('Failed to create household: ' + (d && d.error ? d.error : 'unknown error'));
    }
  });
}

// ── PERSON AUTOCOMPLETE (for reports/giving) ──────────────────────────
function acSearch(input, dropId, hidId) {
  var q = input.value;
  var ac = document.getElementById(dropId);
  if (q.length < 2) { ac.classList.remove('open'); return; }
  api('/admin/api/people?q=' + encodeURIComponent(q)).then(function(d) {
    var rows = (d.people||[]).slice(0,10);
    ac.innerHTML = rows.map(function(p) {
      var n = esc(p.last_name) + ', ' + esc(p.first_name);
      return '<div class="ac-item" onclick="selectPerson(this,&#39;' + hidId + '&#39;,&#39;' + dropId + '&#39;,' + p.id + ',&#39;' + n.replace(/'/g,'&#39;') + '&#39;)">' + n + '</div>';
    }).join('');
    ac.classList.toggle('open', rows.length > 0);
  });
}
function selectPerson(el, hidId, dropId, id, name) {
  document.getElementById(hidId).value = id;
  el.closest('.ac-wrap').querySelector('input[type=text]').value = name;
  document.getElementById(dropId).classList.remove('open');
}
</script>
`;
