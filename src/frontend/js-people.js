export const JS_PEOPLE = String.raw`// ── FUNDS ──────────────────────────────────────────────────────────────
function loadFunds() {
  api('/admin/api/funds').then(function(d) { allFunds = d.funds || []; }).catch(function(){});
}

// ── PEOPLE ────────────────────────────────────────────────────────────
function setPeopleFilter(btn, mt) {
  // Legacy – still works if called from old code
  peopleFilter.mt = mt;
  loadPeople(true);
  renderActiveFilterChips();
  updateFilterBadge();
}
function debouncePeople() {
  clearTimeout(_pDebounce);
  _pDebounce = setTimeout(function() {
    var v = document.getElementById('p-search').value;
    // oninput can fire without the effective query changing (e.g. trailing
    // whitespace typed then removed) — don't pay for a round trip for that.
    if (v === peopleFilter.q) return;
    peopleFilter.q = v;
    loadPeople(true);
  }, 300);
}
// Stale-response guard: the debounce only cancels a *pending* timer, not an
// already-issued request. Without this, a slow broad query ("s") can land after
// a fast narrow one ("smith") and repaint the list with the wrong results —
// which reads to the user as the search being laggy or plain wrong.
var _pLoadSeq = 0;
function loadPeople(resetPage) {
  if (resetPage) peopleFilter.offset = 0;
  var mySeq = ++_pLoadSeq;
  var params = new URLSearchParams();
  if (peopleFilter.q) params.set('q', peopleFilter.q);
  if (peopleFilter.mt) params.set('member_type', peopleFilter.mt);
  if (peopleFilter.tagIds && peopleFilter.tagIds.length) params.set('tag_ids', peopleFilter.tagIds.join(','));
  if (peopleFilter.missingFields && peopleFilter.missingFields.length) params.set('missing_fields', peopleFilter.missingFields.join(','));
  if (peopleFilter.gender) params.set('gender', peopleFilter.gender);
  if (peopleFilter.ageRange) params.set('age_range', peopleFilter.ageRange);
  if (peopleFilter.householdSize) params.set('household_size', peopleFilter.householdSize);
  if (peopleFilter.sacrament) params.set('sacrament', peopleFilter.sacrament);
  params.set('limit', peopleFilter.limit);
  params.set('offset', peopleFilter.offset);
  params.set('sort', peopleFilter.sort || 'last_name');
  params.set('dir', peopleFilter.dir || 'asc');
  if (_archiveView) params.set('archived', '1');
  setStatus('p-status', 'Loading…');
  api('/admin/api/people?' + params).then(function(d) {
    if (mySeq !== _pLoadSeq) return; // a newer search has since been issued
    setStatus('p-status', '');
    if (d.offline) document.getElementById('offline-banner').style.display = 'block';
    _peopleTotal = d.total || 0;
    var people = d.people || [];
    renderPeopleDesktop(people);
    renderPeopleMobile(people);
    renderPeoplePager();
    updateFdCount();
    renderActiveFilterChips();
    updateFilterBadge();
  }).catch(function() {
    if (mySeq !== _pLoadSeq) return;
    _peopleTotal = 0;
    renderPeopleDesktop([], true);
    renderPeopleMobile([]);
    renderPeoplePager();
  });
}
function renderPeoplePager() {
  var el = document.getElementById('p-pager');
  if (!el) return;
  var total = _peopleTotal, limit = peopleFilter.limit, offset = peopleFilter.offset;
  var from = offset + 1, to = Math.min(offset + limit, total);
  var countHtml = total ? '<span style="font-size:14px;color:var(--muted);">Showing ' + from + '–' + to + ' of ' + total + ' people</span>' : '';
  var prevDisabled = offset === 0 ? ' disabled' : '';
  var nextDisabled = to >= total ? ' disabled' : '';
  var navHtml = total <= limit ? '' :
    '<div style="display:flex;gap:6px;">'
    + '<button class="btn-secondary"' + prevDisabled + ' onclick="peoplePage(-1)">Previous</button>'
    + '<button class="btn-secondary"' + nextDisabled + ' onclick="peoplePage(1)">Next</button>'
    + '</div>';
  el.innerHTML = countHtml + navHtml;
  // Mirror the count into the phone-only element near the search box. On a phone the pager is
  // ordered below the list, so this is the only way to see how many results a search returned
  // without scrolling past every card. Hidden on desktop by CSS, where the pager is visible.
  var mob = document.getElementById('p-count-mobile');
  if (mob) mob.textContent = total ? (total === 1 ? '1 person' : total + ' people') : '';
}
function peoplePage(dir) {
  peopleFilter.offset = Math.max(0, peopleFilter.offset + dir * peopleFilter.limit);
  loadPeople();
}
function sortPeople(col) {
  if (peopleFilter.sort === col) {
    peopleFilter.dir = peopleFilter.dir === 'asc' ? 'desc' : 'asc';
  } else {
    peopleFilter.sort = col;
    peopleFilter.dir = 'asc';
  }
  loadPeople(true);
}
function toggleArchiveView() {
  _archiveView = !_archiveView;
  var btn = document.getElementById('p-archive-btn');
  if (btn) btn.setAttribute('aria-pressed', _archiveView ? 'true' : 'false');
  loadPeople(true);
}
// Open Sky People list (OS2): one person per row — name, household, member type (plain text),
// phone, email. Card and Household views were retired 2026-09-25 (Andrew's decision); the
// Households tab is where household browsing lives.
function personAvatarHtml(p, size) {
  var isOrg = (p.member_type||'').toLowerCase() === 'organization';
  size = size || 40;
  var inner = isOrg
    ? '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/></svg>'
    : (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name));
  return '<span class="dir-avatar' + (isOrg ? ' dir-avatar-org' : '') + '" style="width:' + size + 'px;height:' + size + 'px;" aria-hidden="true">' + inner + '</span>';
}
function personStatusBadge(p) {
  if (p.status === 'archived') return ' <span class="os-badge os-badge-neutral">Archived</span>';
  if (p.status === 'deceased' || p.deceased) return ' <span class="os-badge os-badge-neutral">Deceased</span>';
  return '';
}
function renderPeopleDesktop(people, failed) {
  _loadedPeople = people;
  var c = document.getElementById('p-grid');
  if (failed) {
    c.innerHTML = '<div class="os-state" role="alert"><div class="os-state-title">People could not be loaded.</div>'
      + '<div class="os-state-msg">Your search and filters have been kept. Try again in a moment.</div>'
      + '<button class="btn-secondary" onclick="loadPeople()">Try again</button></div>';
    return;
  }
  if (!people.length) {
    var filtered = !!(peopleFilter.q || peopleFilter.tagIds.length || peopleFilter.missingFields.length || peopleFilter.gender || peopleFilter.ageRange || peopleFilter.householdSize || peopleFilter.sacrament);
    c.innerHTML = '<div class="os-state"><div class="os-state-title">' + (_archiveView ? 'No archived people match.' : filtered ? 'No people match.' : 'No people yet.') + '</div>'
      + '<div class="os-state-msg">' + (filtered ? 'Try another search, or clear the filters.' : (_archiveView ? 'Archived and deceased people will appear here.' : 'Add the first person to start the directory.')) + '</div>'
      + (filtered ? '<button class="btn-secondary" onclick="clearPeopleSearchAndFilters()">Clear search and filters</button>' : '') + '</div>';
    return;
  }
  var rows = people.map(function(p) {
    var isOrg = (p.member_type||'').toLowerCase() === 'organization';
    var isSelected = _selectedPeople.has(p.id);
    var displayName = isOrg
      ? esc(p.first_name || p.last_name)
      : esc(p.last_name) + (p.last_name && p.first_name ? ', ' : '') + esc(p.first_name);
    var clickHandler = _selectMode
      ? 'onclick="togglePersonSelect(' + p.id + ', this)"'
      : 'onclick="openPersonQuickView(' + p.id + ')"';
    var rowClsList = [];
    if (isSelected) rowClsList.push('dir-row-selected');
    if (p.id === _qvPersonId) rowClsList.push('dir-row-qv');
    var trCls = rowClsList.length ? ' class="' + rowClsList.join(' ') + '"' : '';
    var phone = p.phone ? '<a href="tel:' + esc(p.phone.replace(/\D/g,'')) + '" onclick="event.stopPropagation()">' + esc(p.phone) + '</a>' : '<span class="dir-none">Not on file</span>';
    var email = p.email ? '<a href="mailto:' + esc(p.email) + '" onclick="event.stopPropagation()">' + esc(p.email) + '</a>' : '<span class="dir-none">Not on file</span>';
    var hh = p.household_name ? esc(p.household_name) : '<span class="dir-none">None</span>';
    return '<tr' + trCls + ' ' + clickHandler + ' ondblclick="openPersonDetail(' + p.id + ')">'
      + '<td class="dir-cb" onclick="event.stopPropagation()"' + (_selectMode ? '' : ' hidden') + '><input type="checkbox" name="person-select" aria-label="Select ' + displayName + '"' + (isSelected ? ' checked' : '') + ' onchange="togglePersonSelect(' + p.id + ',this.closest(&#39;tr&#39;))" onclick="event.stopPropagation()"></td>'
      + '<th scope="row"><div class="dir-name-cell">' + personAvatarHtml(p) + '<button type="button" class="dir-name-link" aria-pressed="' + (p.id === _qvPersonId ? 'true' : 'false') + '">' + displayName + '</button>' + personStatusBadge(p) + '</div></th>'
      + '<td class="dir-col-hh">' + hh + '</td>'
      + '<td>' + typeDotHtml(p.member_type) + '</td>'
      + '<td class="dir-col-phone">' + phone + '</td>'
      + '<td class="dir-col-email">' + email + '</td>'
      + '</tr>';
  }).join('');
  var cbAll = '<input type="checkbox" id="p-check-all" aria-label="Select everyone on this page" onchange="selectAllVisible(this.checked)">';
  function sortTh(label, col, cls) {
    var active = peopleFilter.sort === col;
    var dir = active ? (peopleFilter.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    var arrow = active ? (peopleFilter.dir === 'asc' ? ' &#8593;' : ' &#8595;') : '';
    return '<th scope="col" aria-sort="' + dir + '"' + (cls ? ' class="' + cls + '"' : '') + '><button type="button" class="dir-sort" onclick="sortPeople(\'' + col + '\')">' + label + '<span aria-hidden="true">' + arrow + '</span></button></th>';
  }
  c.innerHTML = '<table class="dir-table"><caption class="sr-only">People</caption><thead><tr>'
    + '<th scope="col" class="dir-cb"' + (_selectMode ? '' : ' hidden') + '>' + cbAll + '</th>'
    + sortTh('Name','last_name') + sortTh('Household','household','dir-col-hh') + sortTh('Member type','member_type')
    + '<th scope="col" class="dir-col-phone">Phone</th><th scope="col" class="dir-col-email">Email</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
}
function clearPeopleSearchAndFilters() {
  var si = document.getElementById('p-search');
  if (si) si.value = '';
  peopleFilter.q = '';
  clearAllFilters();
}
// Phone: Members only / Archived / Select / Print directory sit behind "More" (CSS shows them
// inline on wider screens and ignores this toggle there).
function togglePeopleMoreTools() {
  var el = document.getElementById('ppl-more-tools');
  var btn = document.getElementById('p-more-btn');
  if (!el || !btn) return;
  var open = !el.classList.contains('open');
  el.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
// ── Quick-view panel (RDS2 master-detail) — right-side preview shown on
// row/card click instead of navigating straight to the full Person Profile.
// "Full Profile" inside the panel still calls the existing openPersonDetail().
var _qvPersonId = null;
var _QV_EMPTY_HTML = '';
function closePersonQuickView() {
  _qvPersonId = null;
  var el = document.getElementById('ppl-quickview');
  if (el) { el.innerHTML = ''; el.classList.add('is-empty'); }
  renderPeopleDesktop(_loadedPeople || []);
}
function openPersonQuickView(id) {
  _qvPersonId = id;
  renderPeopleDesktop(_loadedPeople || []);
  var el = document.getElementById('ppl-quickview');
  if (!el) return;
  el.classList.remove('is-empty');
  el.innerHTML = '<div class="ppl-qv-empty" role="status">Loading&#8230;</div>';
  api('/admin/api/people/' + id).then(function(p) {
    if (_qvPersonId !== id) return; // selection changed while this was in flight
    if (p && p.error) { el.innerHTML = '<div class="ppl-qv-empty">Could not load person.</div>'; return; }
    renderPersonQuickView(p);
  }).catch(function() {
    if (_qvPersonId === id) el.innerHTML = '<div class="ppl-qv-empty">Could not load person.</div>';
  });
}
function renderPersonQuickView(p) {
  var el = document.getElementById('ppl-quickview');
  if (!el) return;
  var isOrg = (p.member_type||'').toLowerCase() === 'organization';
  var name = isOrg ? esc(p.first_name || p.last_name) : (esc(p.first_name) + ' ' + esc(p.last_name)).trim();
  var avInner = p.photo_url
    ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">'
    : initials(p.first_name, p.last_name);
  var hhLabel = p.household_display_name || p.household_name || 'Household';
  var hhLink = p.household_id ? ' <span aria-hidden="true">&middot;</span> <a href="#" onclick="event.preventDefault();openHouseholdDetail(' + p.household_id + ')">' + esc(hhLabel) + '</a>' : '';
  var contactRows = '';
  if (p.phone) contactRows += '<div class="ppl-qv-row"><a href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '">' + esc(p.phone) + '</a></div>';
  if (p.email) contactRows += '<div class="ppl-qv-row"><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></div>';
  if (!contactRows) contactRows = '<div class="ppl-qv-row dir-none">No phone or email on file</div>';
  // Location: same address parts + static-map proxy as the full profile. Only rendered when
  // there's a usable address and the viewer can load the map (member role can't hit the proxy).
  var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
  var mapEnc = (addrParts.length >= 2 && _userRole !== 'member') ? encodeURIComponent(addrParts.join(', ')) : '';
  var locSection = '';
  if (mapEnc) {
    locSection = '<div class="ppl-qv-section"><h3 class="ppl-qv-section-lbl">Location</h3>'
      + '<div class="ppl-qv-row" style="margin-bottom:8px;"><a href="https://maps.google.com/?q=' + mapEnc + '" target="_blank" rel="noopener">' + esc(addrParts.join(', ')) + '</a></div>'
      + '<div id="ppl-qv-map" class="ppl-qv-map"><div style="padding:8px;font-size:14px;color:var(--muted);">Loading map&#8230;</div></div></div>';
  }
  el.innerHTML = '<div class="ppl-qv-head"><div class="ppl-qv-avatar">' + avInner + '</div>'
    + '<button type="button" class="ppl-qv-close" onclick="closePersonQuickView()" aria-label="Close preview"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></div>'
    + '<h2 class="ppl-qv-name">' + name + '</h2>'
    + '<div class="ppl-qv-meta">' + typeDotHtml(p.member_type) + hhLink + '</div>'
    + '<div class="ppl-qv-actions">'
    + '<button type="button" class="btn-primary" onclick="openPersonDetail(' + p.id + ')">Open profile</button>'
    + (p.phone ? '<a class="btn-secondary" href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '">Call</a>' : '')
    + '</div>'
    + '<div class="ppl-qv-section"><h3 class="ppl-qv-section-lbl">Contact</h3>' + contactRows + '</div>'
    + locSection
    + (p.household_id ? '<div class="ppl-qv-section"><h3 class="ppl-qv-section-lbl">Household</h3><div class="ppl-qv-hh-names" id="ppl-qv-hh-chips">Loading&#8230;</div></div>' : '');
  if (mapEnc) loadQuickViewMap(p.id, mapEnc);
  if (p.household_id) loadQuickViewHousehold(p.household_id, p.id);
}
// Auto-load the static map into the quick-view Location section (no toggle — the panel is compact).
function loadQuickViewMap(personId, encAddr) {
  var el = document.getElementById('ppl-qv-map');
  if (!el) return;
  // Members never get the embedded map. Two reasons it could not work for them anyway
  // (utils/static-map is outside the member allowlist, and the handler itself requires
  // canEdit), and one reason we would not want it to: it is a paid per-request Google Static
  // Maps call, and members are the largest user tier. The link below opens the device's own
  // maps app, costs nothing, needs no API key, and is what someone on a phone actually wants.
  if (_userRole === 'member') { el.innerHTML = openInMapsHtml(encAddr); return; }
  var img = new Image();
  img.onload = function() {
    if (_qvPersonId !== personId) return; // selection changed while loading
    el.innerHTML = '';
    img.style.cssText = 'width:100%;height:auto;display:block;';
    el.appendChild(img);
  };
  img.onerror = function() {
    if (_qvPersonId !== personId) return;
    showMapError(el, encAddr);
  };
  img.src = '/admin/api/utils/static-map?address=' + encAddr;
}
function loadQuickViewHousehold(hhId, selfId) {
  api('/admin/api/households/' + hhId).then(function(hh) {
    var chipsEl = document.getElementById('ppl-qv-hh-chips');
    if (!chipsEl || _qvPersonId !== selfId) return; // stale response, selection changed
    var members = hh.members || [];
    chipsEl.innerHTML = members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var isSelf = m.id === selfId;
      return isSelf
        ? '<div class="ppl-qv-hh-name is-self" aria-current="true">' + esc(mName || 'Unnamed') + '</div>'
        : '<button type="button" class="ppl-qv-hh-name" onclick="openPersonQuickView(' + m.id + ')">' + esc(mName || 'Unnamed') + '</button>';
    }).join('') || '<span class="dir-none">No other members</span>';
  }).catch(function() {});
}
// ── MULTI-SELECT ──────────────────────────────────────────────────────
function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.setAttribute('aria-pressed', _selectMode ? 'true' : 'false');
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = _selectMode ? 'flex' : 'none';
  if (_selectMode) {
    _qvPersonId = null;
    var qvEl = document.getElementById('ppl-quickview');
    if (qvEl) { qvEl.innerHTML = ''; qvEl.classList.add('is-empty'); }
    var cnt = document.getElementById('p-bulk-count'); if (cnt) cnt.textContent = '0 selected';
    // Populate member type dropdown
    var sel = document.getElementById('p-bulk-mt');
    if (sel) {
      sel.innerHTML = '<option value="">Change member type…</option>'
        + _memberTypes.map(function(t) {
          var v = t.toLowerCase().replace(/\s+/g,'-');
          return '<option value="' + v + '">' + esc(t) + '</option>';
        }).join('');
    }
    // Populate tags
    renderBulkTagsPanel();
  }
  renderPeopleDesktop(_loadedPeople || []);
}
var _loadedPeople = [];
function clearSelection() {
  _selectMode = false;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.setAttribute('aria-pressed', 'false');
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = 'none';
  var panel = document.getElementById('p-bulk-tags-panel');
  if (panel) panel.style.display = 'none';
  renderPeopleDesktop(_loadedPeople || []);
}
function togglePersonSelect(id, el) {
  if (_selectedPeople.has(id)) _selectedPeople.delete(id); else _selectedPeople.add(id);
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
  // Full re-render keeps the row checkmark state in sync (lists are page-sized, cheap to redraw).
  renderPeopleDesktop(_loadedPeople || []);
}
function selectAllVisible(checked) {
  (_loadedPeople || []).forEach(function(p) {
    if (checked) _selectedPeople.add(p.id); else _selectedPeople.delete(p.id);
  });
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
  renderPeopleDesktop(_loadedPeople || []);
}
function applyBulkMemberType() {
  var mt = document.getElementById('p-bulk-mt').value;
  if (!mt) { alert('Please choose a member type.'); return; }
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  if (!confirm('Change member type to "' + mt + '" for ' + _selectedPeople.size + ' people?')) return;
  var ids = Array.from(_selectedPeople);
  api('/admin/api/people/bulk-member-type', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids:ids, member_type:mt})}).then(function() {
    clearSelection(); loadPeople();
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function renderBulkTagsPanel() {
  var c = document.getElementById('p-bulk-tags-list');
  if (!c) return;
  c.innerHTML = allTags.map(function(t) {
    return '<span data-btid="' + t.id + '" data-btstate="0" onclick="cycleBulkTag(this)" style="cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:100px;font-size:.8rem;background:var(--linen);color:var(--warm-gray);user-select:none;">'
      + '<span class="tag-dot" style="background:' + esc(t.color) + '"></span>' + esc(t.name) + '</span>';
  }).join('');
}
function cycleBulkTag(el) {
  var state = parseInt(el.dataset.btstate || '0');
  state = (state + 1) % 3; // 0=no change, 1=add, 2=remove
  el.dataset.btstate = state;
  if (state === 0) { el.style.background='var(--linen)'; el.style.color='var(--warm-gray)'; el.style.borderColor='var(--border)'; el.title=''; }
  if (state === 1) { el.style.background='#d5f5e3'; el.style.color='#196f3d'; el.style.borderColor='#196f3d'; el.title='Will ADD to all selected'; }
  if (state === 2) { el.style.background='#fadbd8'; el.style.color='#922b21'; el.style.borderColor='#922b21'; el.title='Will REMOVE from all selected'; }
}
function openBulkTagsPanel() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  renderBulkTagsPanel();
  var panel = document.getElementById('p-bulk-tags-panel');
  if (panel) panel.style.display = '';
}
function openBulkSacramentPanel() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  document.querySelectorAll('input[name="bulk-bap"]').forEach(function(r){ r.checked = (r.value === ''); });
  document.querySelectorAll('input[name="bulk-con"]').forEach(function(r){ r.checked = (r.value === ''); });
  var panel = document.getElementById('p-bulk-sacrament-panel');
  if (panel) panel.style.display = '';
}
function applyBulkSacrament() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  var bap = (document.querySelector('input[name="bulk-bap"]:checked')||{}).value || '';
  var con = (document.querySelector('input[name="bulk-con"]:checked')||{}).value || '';
  if (!bap && !con) {
    document.getElementById('p-bulk-sacrament-panel').style.display = 'none';
    return;
  }
  var ids = Array.from(_selectedPeople);
  var body = { ids: ids };
  if (bap) body.baptized = bap;
  if (con) body.confirmed = con;
  api('/admin/api/people/bulk-sacrament', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r) {
    document.getElementById('p-bulk-sacrament-panel').style.display = 'none';
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    var msg = [];
    if (bap) msg.push('Baptized ' + (bap === 'set' ? 'set' : 'cleared') + ' on ' + r.baptized_updated + ' people.');
    if (con) msg.push('Confirmed ' + (con === 'set' ? 'set' : 'cleared') + ' on ' + r.confirmed_updated + ' people.');
    alert(msg.join('\n'));
    clearSelection();
    loadPeople();
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function openBulkCommPanel() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  // Reset the form each time
  document.querySelectorAll('input[name="bulk-sms"]').forEach(function(r){ r.checked = (r.value === ''); });
  document.querySelectorAll('input[name="bulk-news"]').forEach(function(r){ r.checked = (r.value === ''); });
  var panel = document.getElementById('p-bulk-comm-panel');
  if (panel) panel.style.display = '';
}
function applyBulkComm() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  var sms = (document.querySelector('input[name="bulk-sms"]:checked')||{}).value || '';
  var news = (document.querySelector('input[name="bulk-news"]:checked')||{}).value || '';
  if (!sms && !news) {
    document.getElementById('p-bulk-comm-panel').style.display = 'none';
    return;
  }
  var ids = Array.from(_selectedPeople);
  var body = { ids: ids };
  if (sms)  body.sms = sms;
  if (news) body.newsletter = news;
  api('/admin/api/people/bulk-comm-opt', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r) {
    document.getElementById('p-bulk-comm-panel').style.display = 'none';
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    var msg = [];
    if (sms) msg.push('SMS ' + (sms === 'in' ? 'opt-in' : 'opt-out') + ' set on ' + r.sms_updated + ' people.');
    if (news) {
      msg.push('Newsletter: added ' + r.newsletter_added + (r.newsletter_skipped_no_email ? ' (skipped ' + r.newsletter_skipped_no_email + ' with no email)' : '') + '.');
      if (r.newsletter_error) msg.push('Newsletter error: ' + r.newsletter_error);
    }
    alert(msg.join('\n'));
    clearSelection();
    loadPeople();
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function applyBulkTags() {
  if (!_selectedPeople.size) { alert('No people selected.'); return; }
  var adds = [], removes = [];
  document.querySelectorAll('#p-bulk-tags-list [data-btid]').forEach(function(el) {
    var state = parseInt(el.dataset.btstate || '0');
    var tid = parseInt(el.dataset.btid);
    if (state === 1) adds.push(tid);
    if (state === 2) removes.push(tid);
  });
  if (!adds.length && !removes.length) {
    document.getElementById('p-bulk-tags-panel').style.display = 'none'; return;
  }
  var ids = Array.from(_selectedPeople);
  api('/admin/api/people/bulk-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids, add: adds, remove: removes })
  }).then(function() {
    document.getElementById('p-bulk-tags-panel').style.display = 'none';
    clearSelection(); loadPeople();
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function renderPeopleMobile(people) {
  var c = document.getElementById('p-contact-list');
  if (!people.length) { c.innerHTML = '<div class="os-state"><div class="os-state-title">' + (_archiveView ? 'No archived people match.' : 'No people match.') + '</div><div class="os-state-msg">Try another search, or clear the filters.</div></div>'; return; }
  c.innerHTML = people.map(function(p) {
    var isOrg = (p.member_type||'').toLowerCase() === 'organization';
    var addr = [p.address1, p.city, p.state].filter(Boolean).join(', ');
    if (!addr && p.household_address) addr = p.household_address;
    var url = mapUrl(addr);
    var avInner = p.photo_url
      ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">'
      : initials(p.first_name, p.last_name);
    var actions = '<div class="c-actions">'
      + (p.phone ? '<a href="tel:' + esc(p.phone.replace(/\D/g,'')) + '" class="c-btn c-btn-call" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.37 1.18 2 2 0 012.34 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.28-.78a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>Call</a>' : '')
      + (p.email ? '<a href="mailto:' + esc(p.email) + '" class="c-btn c-btn-outline" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>Email</a>' : '')
      + (addr && url ? '<a href="' + esc(url) + '" class="c-btn c-btn-outline" target="_blank" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Map</a>' : '')
      + '</div>';
    return '<div class="c-card" onclick="openPersonDetail(' + p.id + ')">'
      + '<div class="c-avatar">' + avInner + '</div>'
      + '<div class="c-info"><div class="c-name">' + esc(p.first_name) + (p.last_name ? ' ' + esc(p.last_name) : '') + (p.deceased ? ' <span style="font-size:14px;color:var(--muted);font-weight:400;">Died ' + esc(p.death_date||'') + '</span>' : '') + '</div>'
      + '<div class="c-type">' + typeDotHtml(p.member_type, 7) + '</div>'
      + actions
      + '</div></div>';
  }).join('');
}

// ── PERSON DETAIL ─────────────────────────────────────────────────────
// Read a date input that may have a paired "year unknown" checkbox.
// Returns "0001-MM-DD" when the box is checked so backend math/display can detect it.
function pmReadDate(inputId, cbId) {
  var el = document.getElementById(inputId);
  if (!el) return '';
  var v = el.value;
  if (!v) return '';
  var parts = v.split('-');
  // Precision select (exact / monthday / year) wins when present; the older paired
  // "Year unknown" checkbox is still honored for any field that hasn't got one.
  var prec = document.getElementById(inputId + '-prec');
  var mode = prec ? prec.value : '';
  if (!mode) {
    var cb = document.getElementById(cbId);
    mode = (cb && cb.checked) ? 'monthday' : 'exact';
  }
  if (mode === 'monthday' && parts.length === 3) return '0001-' + parts[1] + '-' + parts[2];
  if (mode === 'year' && parts.length === 3) return parts[0] + '-00-00';
  return v;
}
// Which of the three precisions a stored value represents.
function pmDatePrecision(val) {
  if (!val) return 'exact';
  if (String(val).indexOf('0001-') === 0) return 'monthday';
  if (/^\d{4}-00-00$/.test(String(val).slice(0, 10))) return 'year';
  return 'exact';
}
// A partial date can't go in a native <input type="date">, which only accepts a real
// calendar date — so a placeholder is substituted for the unknown part. pmReadDate puts
// the sentinel back on save, so the placeholder is never what gets stored.
function pmDateInputValue(val) {
  if (!val) return '';
  var prec = pmDatePrecision(val);
  if (prec === 'monthday') return '2000' + String(val).slice(4, 10);
  if (prec === 'year') return String(val).slice(0, 4) + '-01-01';
  return String(val).slice(0, 10);
}
// Show/hide the day and month parts as meaningless for the chosen precision, and seed a
// usable value when switching onto a partial precision from an empty field.
function pmDatePrecChanged(inputId) {
  var inp = document.getElementById(inputId);
  var prec = document.getElementById(inputId + '-prec');
  if (!inp || !prec) return;
  if (!inp.value) {
    var t = new Date();
    var mm = String(t.getMonth() + 1).padStart(2, '0');
    var dd = String(t.getDate()).padStart(2, '0');
    if (prec.value === 'monthday') inp.value = '2000-' + mm + '-' + dd;
    else if (prec.value === 'year') inp.value = t.getFullYear() + '-01-01';
  }
  var note = document.getElementById(inputId + '-note');
  if (note) {
    note.textContent = prec.value === 'monthday' ? 'Year ignored — month & day only'
      : prec.value === 'year' ? 'Month & day ignored — year only' : '';
  }
}
// Tri-state Yes / No / Not recorded control for baptized & confirmed.
// A plain checkbox can't say "no" — unchecked has to stand for both "no" and
// "we don't know", which are different pastoral facts.
var SACRAMENT_OPTS = [['1', 'Yes'], ['2', 'No'], ['0', 'Not recorded']];
function pmSacramentSelect(id, label, val, styleAttr) {
  var cur = String(Number(val) === 1 ? 1 : Number(val) === 2 ? 2 : 0);
  return '<label for="' + id + '" class="pv-field-card-lbl">' + label + '</label>'
    + '<select id="' + id + '" name="' + id + '" style="' + (styleAttr || '') + '">'
    + SACRAMENT_OPTS.map(function (o) {
        return '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('')
    + '</select>';
}
function pmReadSacrament(id) {
  var el = document.getElementById(id);
  if (!el) return 0;
  var n = Number(el.value);
  return (n === 1 || n === 2) ? n : 0;
}
// How a stored flag + date reads on the profile. A date always implies "yes"; with no
// date the flag is the only thing that can speak, and "not recorded" stays blank rather
// than claiming a "no" nobody entered.
function pmSacramentDisplay(flag, dateStr) {
  if (dateStr) return fmtDate(dateStr);
  if (Number(flag) === 1) return 'Yes (date unknown)';
  if (Number(flag) === 2) return 'No';
  return '';
}
// (The old pmYearUnknownChanged lived here. Every date field now carries a precision
//  select instead of a "Year unknown" checkbox, so it had no remaining call sites;
//  pmDatePrecChanged above does the equivalent seeding for all three precisions.
//  pmReadDate still honors a checkbox if one is ever paired with a field again.)
// Explicitly clear a date field (and its paired "Year unknown" checkbox, if any).
// Native <input type="date"> has no obvious "delete" affordance, so this gives
// staff a reliable way to remove a date — e.g. an erroneous anniversary on a
// person with no partner. Saving an empty date field stores '' server-side.
function clearDateField(inputId, cbId) {
  var inp = document.getElementById(inputId);
  if (inp) inp.value = '';
  if (cbId) { var cb = document.getElementById(cbId); if (cb) cb.checked = false; }
  var prec = document.getElementById(inputId + '-prec');
  if (prec) { prec.value = 'exact'; pmDatePrecChanged(inputId); }
}
// Render a field-card date input with paired "Year unknown" checkbox.
// Used by the inline Demographics editor on the profile page.
function pedDateField(idBase, label, val) {
  var prec = pmDatePrecision(val);
  var inp = 'width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;background:var(--white);';
  var sel = 'font-size:11px;padding:1px 4px;border:1px solid var(--border);border-radius:4px;background:var(--white);font-family:inherit;';
  var opts = [['exact', 'Exact date'], ['monthday', 'Month &amp; day only'], ['year', 'Year only']];
  return '<div class="pv-field-card"><label for="' + idBase + '" class="pv-field-card-lbl">' + label + '</label>'
    + '<input type="date" id="' + idBase + '" value="' + esc(pmDateInputValue(val)) + '" style="' + inp + '">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;">'
    + '<select id="' + idBase + '-prec" aria-label="' + esc(label) + ' precision" style="' + sel + '" onchange="pmDatePrecChanged(\'' + idBase + '\')">'
    + opts.map(function (o) { return '<option value="' + o[0] + '"' + (prec === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
    + '</select>'
    + '<button type="button" class="pv-date-clear" onclick="clearDateField(\'' + idBase + '\',\'' + idBase + '-noyear\')" style="background:none;border:none;color:var(--teal,#2E7EA6);font-size:11px;cursor:pointer;padding:0;text-decoration:underline;">Clear</button>'
    + '</div>'
    + '<div id="' + idBase + '-note" style="font-size:10px;color:var(--warm-gray);margin-top:2px;">'
    + (prec === 'monthday' ? 'Year ignored — month &amp; day only' : prec === 'year' ? 'Month &amp; day ignored — year only' : '')
    + '</div></div>';
}
function calcAge(ds) {
  if (!ds) return '';
  // Partial dates carry no computable age (year-unknown has no year; year-only has no
  // month/day, so an age would be off by up to a year in either direction).
  if (pmDatePrecision(ds) !== 'exact') return '';
  var d = new Date(ds), now = new Date();
  var age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 0 ? ' (age '+age+')' : '';
}
function showProfile(p) {
  _currentPvPerson = p;
  var isOrg = (p.member_type||'').toLowerCase() === 'organization';
  // A preferred name that just repeats the first name isn't shown (redundant).
  var _prefN = (p.preferred_name||'').trim();
  var _showPref = _prefN && _prefN.toLowerCase() !== (p.first_name||'').trim().toLowerCase();
  var displayName = isOrg ? (p.first_name||p.last_name||'Unnamed')
    : ((p.first_name||'')+(_showPref ? ' "'+_prefN+'"' : '')+' '+(p.last_name||'')).trim();
  var tn = document.getElementById('pv-topbar-name');
  if (tn) tn.textContent = displayName;
  var photoEl = document.getElementById('pv-photo');
  if (photoEl) {
    var pvTint = avatarTint(p.id);
    if (p.photo_url) {
      var pvi = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      photoEl.style.background = pvTint.bg;
      var img = document.createElement('img');
      img.src = photoSrc(p.photo_url);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      img.onerror = function() {
        photoEl.innerHTML = '<span style="color:'+pvTint.fg+';font-size:28px;font-weight:700;line-height:1;">'+pvi+'</span>';
      };
      photoEl.innerHTML = '';
      photoEl.appendChild(img);
    } else if (isOrg) {
      photoEl.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:36px;height:36px;fill:none;stroke:var(--muted);stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/></svg>';
      photoEl.style.background = 'var(--linen)';
    } else {
      var initials = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      photoEl.innerHTML = '<span style="color:'+pvTint.fg+';font-size:28px;font-weight:700;line-height:1;">'+initials+'</span>';
      photoEl.style.background = pvTint.bg;
    }
    // Photo editing is now a single discreet edit button + on-click menu
    // (was four always-on corner buttons). Gated on 'directory' like the rest of the
    // profile's write affordances, not just membership.
    var canEditPhoto = permEdit('directory');
    var overlayEl = document.getElementById('pv-photo-overlay');
    if (overlayEl) overlayEl.style.display = canEditPhoto ? 'flex' : 'none';
    var editBtn = document.getElementById('pv-photo-edit-btn');
    if (editBtn) editBtn.style.display = canEditPhoto ? 'flex' : 'none';
    closePvPhotoMenu();
    _pvPhotoState = { hasPhoto: !!p.photo_url, hasHousehold: !!p.household_id };
  }
  var fnEl = document.getElementById('pv-fullname');
  if (fnEl) fnEl.textContent = displayName;
  var bdEl = document.getElementById('pv-badge');
  var mt = p.member_type||'visitor';
  if (bdEl) {
    var statusHtml = '';
    if (p.status === 'archived') statusHtml = ' <span class="os-badge os-badge-neutral">Archived</span>';
    else if (p.status === 'deceased') statusHtml = ' <span class="os-badge os-badge-neutral">Deceased' + (p.death_date ? ' ' + esc(fmtDate(p.death_date)) : '') + '</span>';
    bdEl.innerHTML = typeDotHtml(mt) + statusHtml;
  }
  var haEl = document.getElementById('pv-hdr-actions');
  if (haEl) {
    var telDigits = (p.phone||'').replace(/[^0-9]/g,'');
    var ic = function(d) { return '<svg viewBox="0 0 24 24" aria-hidden="true" class="btn-ic">' + d + '</svg>'; };
    haEl.innerHTML = (p.phone ? '<a class="btn-secondary" href="tel:'+telDigits+'">' + ic('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>') + 'Call</a>' : '')
      + (p.phone ? '<a class="btn-secondary" href="sms:'+telDigits+'">' + ic('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>') + 'Text</a>' : '')
      + (p.email ? '<a class="btn-secondary" href="mailto:'+esc(p.email)+'">' + ic('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>') + 'Email</a>' : '')
      + pvMoreActionsHtml(p);
  }
  var hhEl = document.getElementById('pv-hh');
  if (hhEl) {
    var hhName = p.household_display_name || p.household_name;
    hhEl.innerHTML = hhName
      ? '<span class="pv-meta-sep" aria-hidden="true">&middot;</span> <a href="#" onclick="event.preventDefault();openHouseholdDetail('+p.household_id+')">'+esc(hhName)+'</a>'
      : '';
  }
  var roleEl = document.getElementById('pv-role');
  if (roleEl) roleEl.textContent = p.family_role ? ' \u00b7 '+pvRoleLabel(p.family_role) : '';
  // Info tab — redesigned single-screen card layout with sticky jump-nav + inline per-field edit.
  pvfRenderInfo(p);
  // The right-rail aside's content (giving summary, mark-seen, follow-ups) now lives in cards,
  // so hide it in the redesigned layout and let the card grid span the full width.
  var asideHide = document.getElementById('pv-aside');
  if (asideHide) asideHide.style.display = 'none';
  var ca = document.querySelector('.content-area');
  if (ca) { ca.classList.remove('hv-mode', 'ov-mode'); ca.classList.add('pv-mode'); }
  showPvTab('info');
}
function pvRoleLabel(r) {
  var m = { head:'Head of household', spouse:'Spouse', child:'Child', other:'Other' };
  return m[String(r||'').toLowerCase()] || r;
}
// "More actions" menu on the person header (Open Sky decision 2026-09-25): the record-level
// actions that used to be a row of small buttons, plus Print, Send statement and Breeze.
function pvMoreActionsHtml(p) {
  var items = [];
  var mt = (p.member_type||'').toLowerCase();
  var st = p.status || 'active';
  var canEdit = permEdit('directory');
  var isAdminStaff = _userRole === 'admin' || _userRole === 'staff';
  if (canEdit && isAdminStaff && mt === 'member' && st === 'active' && p.email) items.push(['Invite to Connect', 'sendConnectInvite(' + p.id + ')']);
  if ((_userRole === 'admin' || _userRole === 'finance') && p.email) items.push(['Send giving statement', 'sendGivingStatement(' + p.id + ',\'' + new Date().getFullYear() + '\')']);
  if (canEdit && isAdminStaff) items.push(['Push to Breeze', 'pushPersonToBreeze(' + p.id + ')']);
  items.push(['Print', 'window.print()']);
  if (canEdit) {
    if (st === 'active') {
      items.push(['Archive', 'archivePerson(' + p.id + ')', true]);
      items.push(['Mark deceased', 'markPersonDeceased(' + p.id + ')', true]);
    } else {
      items.push(['Reactivate', 'unarchivePerson(' + p.id + ')', true]);
    }
  }
  return '<div class="pv-more">'
    + '<button type="button" class="btn-secondary" id="pv-more-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="pv-more-menu" onclick="togglePvMoreMenu()">More actions'
    + '<svg viewBox="0 0 24 24" aria-hidden="true" class="btn-ic"><path d="m6 9 6 6 6-6"/></svg></button>'
    + '<div class="pv-more-menu" id="pv-more-menu" role="menu" hidden>'
    + items.map(function(it, i) {
        return (it[2] && !(items[i-1] && items[i-1][2]) ? '<div class="pv-more-sep" role="separator"></div>' : '')
          + '<button type="button" role="menuitem" class="pv-more-item" onclick="closePvMoreMenu();' + it[1] + '">' + esc(it[0]) + '</button>';
      }).join('')
    + '</div></div>';
}
function togglePvMoreMenu() {
  var m = document.getElementById('pv-more-menu');
  if (!m) return;
  if (m.hidden) {
    m.hidden = false;
    document.getElementById('pv-more-btn').setAttribute('aria-expanded', 'true');
    var first = m.querySelector('.pv-more-item'); if (first) first.focus();
  } else closePvMoreMenu(true);
}
function closePvMoreMenu(refocus) {
  var m = document.getElementById('pv-more-menu');
  var b = document.getElementById('pv-more-btn');
  if (!m || m.hidden) return;
  m.hidden = true;
  if (b) { b.setAttribute('aria-expanded', 'false'); if (refocus) b.focus(); }
}
document.addEventListener('click', function(e) {
  var wrap = e.target && e.target.closest ? e.target.closest('.pv-more') : null;
  if (!wrap) closePvMoreMenu();
});
document.addEventListener('keydown', function(e) {
  var m = document.getElementById('pv-more-menu');
  if (!m || m.hidden) return;
  if (e.key === 'Escape') { closePvMoreMenu(true); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    var items = Array.prototype.slice.call(m.querySelectorAll('.pv-more-item'));
    var i = items.indexOf(document.activeElement);
    i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[i].focus(); e.preventDefault();
  }
});
function pvRow(key, val) {
  return '<div class="pv-row"><div class="pv-row-key">'+key+'</div>'
    + '<div class="pv-row-val'+(val?'':' empty')+'">'+(val||'—')+'</div></div>';
}
function pvField(label, val) {
  var safe = val ? esc(val) : '';
  return '<div class="pv-field-card"><div class="pv-field-card-lbl">'+label+'</div>'
    + '<div class="pv-field-card-val'+(val?'':' empty')+'">'+(safe||'—')+'</div></div>';
}
function pvFieldHtml(label, html) {
  return '<div class="pv-field-card"><div class="pv-field-card-lbl">'+label+'</div>'
    + '<div class="pv-field-card-val'+(html?'':' empty')+'">'+(html||'—')+'</div></div>';
}
// ── PROFILE REDESIGN: inline per-field edit engine ─────────────────────
// Registry of editable fields on the current person, keyed by field id. Rebuilt on each
// showProfile() render. Each cfg drives the read-only display, the inline editor, and the
// single-field PATCH save. Gated on the 'directory' permission item, same as the rest of the
// person/household/organization write affordances (.require-edit in applyPermissionUI) --
// this bypassed that item entirely until 2026-09-09, checking only _userRole !== 'member',
// so a role holding directory:'view' (council's own default) still got a working pencil-edit
// on every profile field even though the server-side PATCH gate in api-chms.js correctly
// rejected it -- a working-looking control that always failed on save.
var _pvFields = {};
function pvfCanEdit() { return permEdit('directory'); }
function pvfYearsAgo(v) {
  if (!v) return '';
  // A month/day-only date parses as a real year 1, which rendered as "2024 years ago"
  // under a baptism the card had just printed as "Jul 31". Neither partial shape can
  // support an elapsed-time figure, so neither gets one.
  if (pmDatePrecision(v) !== 'exact') return '';
  var d = new Date(v); if (isNaN(d)) return '';
  var y = Math.floor((Date.now() - d.getTime()) / (365.25 * 864e5));
  return y > 0 ? y + ' year' + (y === 1 ? '' : 's') + ' ago' : '';
}
// Build the field registry from a person record + configured member types.
function pvfBuildRegistry(p) {
  var mtOpts = [{value:'', label:'—'}].concat((typeof _memberTypes !== 'undefined' ? _memberTypes : ['Member','Attender','Visitor']).map(function(t){
    return { value: t.toLowerCase(), label: t };
  }));
  var genderOpts = [{value:'',label:'—'},{value:'Male',label:'Male'},{value:'Female',label:'Female'},{value:'Other',label:'Other'}];
  var maritalOpts = [{value:'',label:'—'},{value:'Single',label:'Single'},{value:'Married',label:'Married'},{value:'Divorced',label:'Divorced'},{value:'Widowed',label:'Widowed'}];
  var roleOpts = [{value:'',label:'—'},{value:'head',label:'Head'},{value:'spouse',label:'Spouse'},{value:'child',label:'Child'},{value:'other',label:'Other'}];
  function dateSub(v) { return pvfYearsAgo(v); }
  // Yes / No / Not recorded. 0 renders through the card's usual gray "Not set", so an
  // unanswered field never reads as an answered one.
  var sacramentOpts = [{value:'1',label:'Yes'},{value:'2',label:'No'},{value:'0',label:'Not recorded'}];
  var defs = [
    {id:'family_role', label:'Role in household', type:'select', options:roleOpts},
    {id:'first_name', label:'First name', type:'text'},
    {id:'last_name', label:'Last name', type:'text'},
    {id:'preferred_name', label:'Preferred name', type:'text', ph:'Nickname'},
    {id:'middle_name', label:'Middle name', type:'text', ph:'Middle'},
    {id:'gender', label:'Gender', type:'select', options:genderOpts},
    {id:'marital_status', label:'Marital status', type:'select', options:maritalOpts},
    {id:'member_type', label:'Member type', type:'select', options:mtOpts},
    {id:'dob', label:'Birthdate', type:'date', sub:function(v){ return v ? (pvfYearsAgo(v).replace(' ago',' old')) : ''; }},
    {id:'phone', label:'Phone', type:'tel'},
    {id:'email', label:'Email', type:'email'},
    {id:'address1', label:'Street', type:'text'},
    {id:'address2', label:'Apt / unit', type:'text'},
    {id:'city', label:'City', type:'text'},
    {id:'state', label:'State', type:'text'},
    {id:'zip', label:'ZIP', type:'text'},
    {id:'baptized', label:'Baptized', type:'select', options:sacramentOpts, blankVals:['0','']},
    {id:'baptism_date', label:'Baptism date', type:'date', sub:dateSub},
    {id:'confirmed', label:'Confirmed', type:'select', options:sacramentOpts, blankVals:['0','']},
    {id:'confirmation_date', label:'Confirmation date', type:'date', sub:dateSub},
    {id:'anniversary_date', label:'Anniversary', type:'date', sub:dateSub},
    {id:'envelope_number', label:'Envelope #', type:'text'},
    {id:'public_directory', label:'In the directory', checkLabel:'Include in the member directory and printed directory', type:'check'},
    {id:'dir_hide_address', label:'Hide address', checkLabel:'Hide address', type:'check'},
    {id:'dir_hide_phone', label:'Hide phone', checkLabel:'Hide phone', type:'check'},
    {id:'dir_hide_email', label:'Hide email', checkLabel:'Hide email', type:'check'},
    {id:'dir_hide_dob', label:'Hide birthday', checkLabel:'Hide birthday', type:'check'},
    {id:'dir_hide_anniversary', label:'Hide anniversary', checkLabel:'Hide anniversary', type:'check'},
  ];
  _pvFields = {};
  defs.forEach(function(d){ _pvFields[d.id] = d; });
}
function pvfRawVal(id) {
  var p = _currentPvPerson || {};
  return p[id] == null ? '' : p[id];
}
function pvfDisplay(cfg, val) {
  if (val === '' || val == null) return '';
  // A select whose "nothing recorded" choice is a real stored value (0, not '') still
  // has to read as unanswered rather than as an answer.
  if (cfg.blankVals && cfg.blankVals.indexOf(String(val)) >= 0) return '';
  if (cfg.type === 'select') {
    var o = (cfg.options || []).find(function(x){ return String(x.value) === String(val); });
    return o ? o.label : String(val);
  }
  if (cfg.type === 'date') return fmtDate(val);
  if (cfg.type === 'check') return String(val) === '1' ? 'Yes' : 'No';
  return String(val);
}
// Read-only row for one field. Editing is per SECTION now (OS3, 2026-09-25): the section's
// Edit button swaps every field in the card into a form with one Save — see pvfSectionEdit.
function pvfRowHtml(id) {
  var cfg = _pvFields[id]; if (!cfg) return '';
  var val = pvfRawVal(id);
  var disp = pvfDisplay(cfg, val);
  var empty = !disp;
  var sub = (cfg.sub && val) ? cfg.sub(val) : '';
  return '<div class="pv2-frow"><div class="pv2-flabel">' + esc(cfg.label) + '</div>'
    + '<div class="pv2-fval" id="pvf-' + id + '"><div class="pv2-ro' + (empty ? ' empty' : '') + '">'
    + (empty ? 'Not on file' : esc(disp)) + '</div>'
    + (sub ? '<div class="pv2-sub">' + esc(sub) + '</div>' : '')
    + '</div></div>';
}
// ── Section-level editing ──────────────────────────────────────────────
// Each editable section is a list of registry field ids. Edit swaps the card body for a form,
// Save PATCHes only the fields that changed in one request, and the card shows the Timothy
// Workspace save states: Unsaved changes / Saving… / Saved / Not saved (edits kept).
var _pvSections = {};
var _pvSectionBodies = {};
var _pvSectionOpen = {};
function pvfInputHtml(id) {
  var cfg = _pvFields[id]; if (!cfg) return '';
  var val = pvfRawVal(id);
  var fid = 'pvse-' + id;
  var onDirty = ' oninput="pvfSectionDirty(this)" onchange="pvfSectionDirty(this)"';
  var ctl;
  if (cfg.type === 'check') {
    return '<label class="pv2-check"><input type="checkbox" id="' + fid + '"' + (String(val) === '1' ? ' checked' : '') + onDirty + '> ' + esc(cfg.checkLabel || cfg.label) + '</label>';
  }
  if (cfg.type === 'select') {
    ctl = '<select class="pv2-inp sel" id="' + fid + '"' + onDirty + '>'
      + (cfg.options || []).map(function(o){
          return '<option value="' + esc(String(o.value)) + '"' + (String(o.value) === String(val) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('')
      + '</select>';
  } else if (cfg.type === 'date') {
    // A date picker can only hold a complete calendar date, so the precision select beside
    // it is what lets a record say "1994, month unknown" without inventing a January 1st.
    var prec = pmDatePrecision(val);
    ctl = '<div class="pv2-date-row"><input class="pv2-inp" id="' + fid + '" type="date" value="' + esc(pmDateInputValue(val)) + '"' + onDirty + '>'
      + '<select class="pv2-inp sel pv2-prec" id="' + fid + '-prec" aria-label="' + esc(cfg.label) + ' precision" onchange="pmDatePrecChanged(\'' + fid + '\');pvfSectionDirty(this)">'
      + [['exact','Exact date'],['monthday','Month &amp; day only'],['year','Year only']].map(function(o){
          return '<option value="' + o[0] + '"' + (prec === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select></div>';
  } else if (cfg.type === 'textarea') {
    ctl = '<textarea class="pv2-inp" id="' + fid + '" rows="4"' + onDirty + '>' + esc(String(val)) + '</textarea>';
  } else {
    ctl = '<input class="pv2-inp" id="' + fid + '" type="' + esc(cfg.type || 'text') + '" value="' + esc(String(val)) + '"'
      + (cfg.ph ? ' placeholder="' + esc(cfg.ph) + '"' : '') + onDirty + (cfg.type === 'tel' ? ' onblur="formatPhoneOnBlur(this)"' : '') + '>';
  }
  return '<div class="pv2-edit-field"><label for="' + fid + '">' + esc(cfg.label) + '</label>' + ctl + '</div>';
}
function pvfReadInput(id) {
  var cfg = _pvFields[id];
  var el = document.getElementById('pvse-' + id);
  if (!cfg || !el) return null;
  if (cfg.type === 'check') return el.checked ? 1 : 0;
  if (cfg.type === 'date') return pmReadDate('pvse-' + id, null);
  return el.value;
}
function pvfSectionEdit(secId) {
  if (!pvfCanEdit()) return;
  var ids = _pvSections[secId]; if (!ids) return;
  var body = document.getElementById('pvf-body-' + secId); if (!body) return;
  _pvSectionOpen[secId] = true;
  var extra = secId === 'contact'
    ? '<div class="pv2-edit-inline"><button type="button" class="btn-secondary" id="pvse-validate-btn" onclick="pvfValidateSectionAddress()">Validate address</button><span id="pvse-addr-status" role="status" class="pv2-edit-note"></span></div>'
    : '';
  body.innerHTML = '<form class="pv2-edit" onsubmit="event.preventDefault();pvfSectionSave(\'' + secId + '\')" data-sec="' + secId + '">'
    + '<div class="pv2-edit-grid">' + ids.map(pvfInputHtml).join('') + '</div>'
    + extra
    + '<div class="pv2-edit-err" id="pvse-err-' + secId + '" role="alert" hidden></div>'
    + '<div class="pv2-edit-actions">'
    + '<span class="pv2-save-state" id="pvse-state-' + secId + '" aria-live="polite"></span>'
    + '<button type="button" class="btn-secondary" onclick="pvfSectionCancel(\'' + secId + '\')">Cancel</button>'
    + '<button type="submit" class="btn-primary" id="pvse-save-' + secId + '">Save changes</button>'
    + '</div></form>';
  var editBtn = document.getElementById('pvf-edit-' + secId); if (editBtn) editBtn.hidden = true;
  var first = body.querySelector('input,select,textarea'); if (first) first.focus();
}
function pvfSectionDirty(el) {
  var form = el && el.closest ? el.closest('form.pv2-edit') : null;
  if (!form) return;
  var st = document.getElementById('pvse-state-' + form.dataset.sec);
  if (st && st.dataset.state !== 'saving') { st.dataset.state = 'dirty'; st.innerHTML = '<span class="os-badge os-badge-info">Unsaved changes</span>'; }
}
function pvfSectionRender(secId) {
  var body = document.getElementById('pvf-body-' + secId);
  if (body && _pvSectionBodies[secId]) body.innerHTML = _pvSectionBodies[secId](_currentPvPerson);
  var editBtn = document.getElementById('pvf-edit-' + secId); if (editBtn) editBtn.hidden = false;
}
function pvfSectionCancel(secId) {
  var st = document.getElementById('pvse-state-' + secId);
  if (st && st.dataset.state === 'dirty' && !confirm('Discard your unsaved changes?')) return;
  _pvSectionOpen[secId] = false;
  pvfSectionRender(secId);
  var editBtn = document.getElementById('pvf-edit-' + secId); if (editBtn) editBtn.focus();
}
function pvfSectionSave(secId) {
  var ids = _pvSections[secId]; if (!ids) return;
  var p = _currentPvPerson; if (!p) return;
  var body = {}, changed = [];
  ids.forEach(function(id) {
    var v = pvfReadInput(id);
    if (v === null) return;
    if (String(v) !== String(pvfRawVal(id))) { body[id] = v; changed.push(id); }
  });
  var st = document.getElementById('pvse-state-' + secId);
  var err = document.getElementById('pvse-err-' + secId);
  var saveBtn = document.getElementById('pvse-save-' + secId);
  if (secId === 'personal' && 'first_name' in body && !String(body.first_name).trim()) {
    if (err) { err.hidden = false; err.textContent = 'Enter a first name.'; }
    return;
  }
  if (!changed.length) { _pvSectionOpen[secId] = false; pvfSectionRender(secId); return; }
  if (err) err.hidden = true;
  if (st) { st.dataset.state = 'saving'; st.innerHTML = '<span class="os-badge os-badge-neutral">Saving…</span>'; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.setAttribute('aria-busy', 'true'); saveBtn.textContent = 'Saving…'; }
  api('/admin/api/people/' + p.id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
    .then(function(r) {
      if (r && r.error) throw new Error(r.error);
      changed.forEach(function(id) {
        // The server normalizes phone numbers and lowercases member type; mirror what it stores.
        var v = body[id];
        if (id === 'member_type') v = String(v).toLowerCase();
        _currentPvPerson[id] = v;
      });
      _pvSectionOpen[secId] = false;
      pvfSectionRender(secId);
      pvfToast();
      if (changed.some(function(id){ return ['first_name','last_name','preferred_name','member_type','family_role'].indexOf(id) >= 0; })) pvfRefreshHeader();
      if (secId === 'contact') {
        var loc = document.getElementById('pvf-body-location');
        if (loc) { loc.innerHTML = pvfLocationBody(_currentPvPerson); if (document.getElementById('pv-map-' + p.id)) togglePersonMap(p.id); }
      }
      if (typeof loadPeople === 'function') loadPeople();
    }).catch(function(e) {
      if (st) { st.dataset.state = 'dirty'; st.innerHTML = '<span class="os-badge os-badge-warning">Not saved</span>'; }
      if (err) { err.hidden = false; err.textContent = 'Changes were not saved. Your edits are still here.' + (e && e.message && e.message !== 'Unauthorized' ? ' (' + e.message + ')' : ''); }
      if (saveBtn) { saveBtn.disabled = false; saveBtn.removeAttribute('aria-busy'); saveBtn.textContent = 'Save changes'; }
    });
}
// USPS / Census address check for the Contact section form (fills the fields; nothing is saved
// until Save changes).
function pvfValidateSectionAddress() {
  var btn = document.getElementById('pvse-validate-btn');
  var status = document.getElementById('pvse-addr-status');
  var g = function(id) { var el = document.getElementById('pvse-' + id); return el ? el.value.trim() : ''; };
  if (!g('address1')) { if (status) status.textContent = 'Enter a street address first.'; return; }
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Checking…';
  api('/admin/api/utils/validate-address', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ address1: g('address1'), address2: g('address2'), city: g('city'), state: g('state'), zip: g('zip') })
  }).then(function(r) {
    if (btn) btn.disabled = false;
    if (!r.ok) { if (status) status.textContent = r.error || 'Could not validate this address.'; return; }
    var set = function(id, v) { var el = document.getElementById('pvse-' + id); if (el) { el.value = v || ''; pvfSectionDirty(el); } };
    set('address1', r.address1); set('address2', r.address2); set('city', r.city); set('state', r.state);
    set('zip', r.zip + (r.zip4 ? '-' + r.zip4 : ''));
    if (status) status.innerHTML = validateAddrResultMsg(r);
  }).catch(function(e) {
    if (btn) btn.disabled = false;
    if (status) status.textContent = ((e && e.message) || 'Request failed') + '. Try again, or ask an administrator to configure address validation.';
  });
}
var _pvToastTimer = null;
function pvfToast() {
  var t = document.getElementById('pv2-toast');
  if (!t) return;
  t.classList.add('show');
  clearTimeout(_pvToastTimer);
  _pvToastTimer = setTimeout(function(){ t.classList.remove('show'); }, 1400);
}
// ── Newsletter (Brevo) status + toggle on the profile header ─────────────
// Checks whether the person is already on the newsletter list and renders the
// header button to match: "On newsletter ✓" (click to remove) vs "Add to
// newsletter" (click to add). All state comes from _currentPvPerson so no
// person data is embedded in an onclick (VUXBUG2 class).
// Cache the last-known newsletter state per person id so re-rendering the Tags &
// Groups card (e.g. on a tag add/remove) repaints the button without a refetch.
var _pvfNewsletterState = {};
function pvfNewsletterInit(id) {
  var p = _currentPvPerson;
  if (!p || String(p.id) !== String(id) || !p.email) return;
  var cached = _pvfNewsletterState[id];
  if (cached === 'on' || cached === 'off') { pvfNewsletterRender(id, cached); return; }
  pvfNewsletterRender(id, 'checking');
  api('/admin/api/brevo/contact-status?email=' + encodeURIComponent(p.email)).then(function(r){
    if (r && r.ok) { _pvfNewsletterState[id] = r.subscribed ? 'on' : 'off'; pvfNewsletterRender(id, _pvfNewsletterState[id]); }
    else pvfNewsletterRender(id, 'off', (r && r.error) || '');
  }).catch(function(){ pvfNewsletterRender(id, 'off'); });
}
function pvfNewsletterRender(id, state, errNote) {
  var wrap = document.getElementById('pv-newsletter-wrap');
  if (wrap) {
    if (state === 'checking') {
      wrap.innerHTML = '<button type="button" class="pv2-toggle" disabled>Checking…</button>';
    } else if (state === 'on') {
      wrap.innerHTML = '<button type="button" class="pv2-toggle" aria-pressed="true" title="On the newsletter list. Click to remove." onclick="pvfNewsletterToggle(' + id + ',true)">On the newsletter list</button>';
    } else {
      wrap.innerHTML = '<button type="button" class="pv2-toggle" aria-pressed="false" onclick="pvfNewsletterToggle(' + id + ',false)">Not on the list. Add</button>';
    }
  }
  var st = document.getElementById('pv-newsletter-status');
  if (st) st.textContent = errNote ? ('Newsletter unavailable: ' + errNote) : '';
}
function pvfNewsletterToggle(id, currentlyOn) {
  var p = _currentPvPerson;
  if (!p || String(p.id) !== String(id) || !p.email) return;
  var st = document.getElementById('pv-newsletter-status');
  if (currentlyOn) {
    var who = ((p.first_name||'') + ' ' + (p.last_name||'')).trim() || 'this person';
    if (!confirm('Remove ' + who + ' from the newsletter list?')) return;
    if (st) st.textContent = 'Removing…';
    api('/admin/api/brevo/remove-contact', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: p.email }) })
      .then(function(r){
        if (r && r.ok) { if (st) st.textContent = ''; _pvfNewsletterState[id] = 'off'; pvfNewsletterRender(id, 'off'); pvfToast(); }
        else { if (st) st.textContent = 'Error: ' + ((r && r.error) || 'unknown'); }
      }).catch(function(){ if (st) st.textContent = 'Request failed.'; });
  } else {
    if (st) st.textContent = 'Adding…';
    api('/admin/api/brevo/sync-contact', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: p.email, first_name: p.first_name||'', last_name: p.last_name||'' }) })
      .then(function(r){
        if (r && r.ok) { if (st) st.textContent = ''; _pvfNewsletterState[id] = 'on'; pvfNewsletterRender(id, 'on'); pvfToast(); }
        else { if (st) st.textContent = 'Error: ' + ((r && r.error) || 'unknown'); }
      }).catch(function(){ if (st) st.textContent = 'Request failed.'; });
  }
}
// Mobile "Jump to" dropdown (mirrors the desktop side rail). Shared by the
// Person Profile, Household, and Organization views — the option value is the
// target section element's id, so one handler works for every view.
function pvfNavSelectHtml(navDefs, prefix) {
  return '<select class="pv2-nav-select" onchange="pvfNavSelect(this)" aria-label="Jump to section">'
    + '<option value="" disabled selected>Jump to…</option>'
    + navDefs.map(function(n){ return '<option value="' + prefix + n[0] + '">' + esc(n[1]) + '</option>'; }).join('')
    + '</select>';
}
function pvfNavSelect(sel) {
  var el = sel && sel.value ? document.getElementById(sel.value) : null;
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Smooth-scroll the info panel to a section card and mark its nav button active.
function pvfGo(id) {
  document.querySelectorAll('.pv2-nav-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.sec === id); });
  var el = document.getElementById('pvf-sec-' + id);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// Re-render the header name/crumb after an inline edit of a header field.
// (The old pill/badge row at the top of the profile was removed per request —
// status/marital live in the Personal card and tags in the Tags card.)
function pvfRefreshHeader() {
  var p = _currentPvPerson; if (!p) return;
  var isOrg = (p.member_type||'').toLowerCase() === 'organization';
  var displayName = isOrg ? (p.first_name||p.last_name||'Unnamed')
    : ((p.first_name||'')+' '+(p.last_name||'')).trim();
  var fnEl = document.getElementById('pv-fullname'); if (fnEl) fnEl.textContent = displayName || 'Unnamed';
  var tn = document.getElementById('pv-topbar-name'); if (tn) tn.textContent = displayName;
  var cr = document.getElementById('pvf-crumb'); if (cr) cr.textContent = displayName;
  var roleEl = document.getElementById('pv-role'); if (roleEl) roleEl.textContent = p.family_role ? ' · ' + pvRoleLabel(p.family_role) : '';
  var bdEl = document.getElementById('pv-badge');
  if (bdEl) { var st = bdEl.querySelector('.os-badge'); bdEl.innerHTML = typeDotHtml(p.member_type||'visitor') + (st ? ' ' + st.outerHTML : ''); }
}
// Generic section card wrapper. opts.edit adds the section's Edit button (hidden while editing).
function pvfCard(id, title, opts) {
  opts = opts || {};
  var editBtn = (opts.edit && pvfCanEdit())
    ? '<button type="button" class="btn-secondary pv2-card-btn" id="pvf-edit-' + id + '" onclick="pvfSectionEdit(\'' + id + '\')" aria-label="Edit ' + esc(title) + '"><svg viewBox="0 0 24 24" aria-hidden="true" class="btn-ic"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>Edit</button>'
    : '';
  return '<section class="pv2-card" id="pvf-sec-' + id + '" aria-labelledby="pvf-h-' + id + '">'
    + '<div class="pv2-card-hd"><h2 id="pvf-h-' + id + '">' + esc(title) + '</h2><div class="sp"></div>'
    + (opts.tag ? '<span class="pv2-card-hd-tag">' + esc(opts.tag) + '</span>' : '')
    + (opts.headerBtns || '') + editBtn
    + '</div>'
    + '<div class="pv2-card-bd' + (opts.pad ? ' pad' : '') + '" id="pvf-body-' + id + '">' + (opts.body || '') + '</div>'
    + '</section>';
}
// ── Custom card bodies ─────────────────────────────────────────────────
function pvfContactExtras(p) {
  var out = '';
  if (p.phone && _userRole !== 'member') {
    out += '<div class="pv2-extra-row"><span class="pv2-flabel">Text messages</span>'
      + '<button type="button" id="pv-sms-badge" class="pv2-toggle" aria-pressed="' + (p.sms_opt_in ? 'true' : 'false') + '" onclick="togglePVSms()"' + (permEdit('directory') ? '' : ' disabled') + '>'
      + (p.sms_opt_in ? 'Birthday and anniversary texts on' : 'Birthday and anniversary texts off') + '</button></div>';
  }
  if (p.household_id && (p.address1||'').trim() && permEdit('directory')) {
    out += '<div class="pv2-extra-actions">'
      + '<button class="btn-secondary" onclick="applyAddressToHousehold(' + p.id + ',' + p.household_id + ')">Use this address for household members</button>'
      + '<button class="btn-secondary" onclick="syncPersonAddrToHousehold(' + p.household_id + ')">Make this the household address</button></div>';
  }
  return out;
}
function pvfFamilyBody(p) {
  if (p.household_id) {
    // "Role in household" (head/spouse/child/other) is inline-editable here;
    // the member list loads async into #pv-family-members below it.
    var hhName = p.household_display_name || p.household_name || 'Household';
    return '<a href="#" class="pv2-hh-name" onclick="event.preventDefault();openHouseholdDetail(' + p.household_id + ')">' + esc(hhName) + '</a>'
      + '<div id="pv-family-members" class="pv2-muted" role="status">Loading…</div>';
  }
  if (_userRole === 'member') return '<p class="pv2-muted">No household linked.</p>';
  if (!permEdit('directory')) return '<p class="pv2-muted">No household linked.</p>';
  return '<p class="pv2-muted">No household linked.</p>'
    + '<button class="btn-secondary" onclick="createHouseholdForPerson(' + p.id + ',\'' + esc(p.last_name||'') + '\')">Create household</button>';
}
var _pvfTagAddOpen = false;
function pvfTagsBody(p) {
  // Show only the tags actually applied to this person (the "active" tags). The full list of
  // available tags stays hidden behind a click-to-open "＋ Add tag" box, rather than always
  // listing every unapplied tag inline.
  var chips = (p.tags||[]).map(function(t){
    return '<span class="pv2-chip">' + esc(t.name)
      + (permEdit('directory') ? '<button type="button" class="pv2-chip-x" onclick="pvfRemoveTag(' + t.id + ')" aria-label="Remove tag ' + esc(t.name) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>' : '')
      + '</span>';
  }).join('');
  var out = '<div style="display:flex;flex-wrap:wrap;gap:8px;' + (chips ? 'margin-bottom:12px;' : '') + '">'
    + (chips || '<span class="pv2-muted">No tags yet.</span>') + '</div>';
  // Tag add/remove PATCHes people/{id} (see pvfAddTag/pvfRemoveTag), the same segment the
  // 'directory' item gates -- so this affordance follows it, not the coarser member/non-member
  // split (member is separately excluded since its directory level is forced 'none').
  if (permEdit('directory')) {
    var curIds = (p.tags||[]).map(function(t){ return t.id; });
    var avail = (typeof allTags !== 'undefined' ? allTags : []).filter(function(t){ return curIds.indexOf(t.id) < 0; });
    if (!avail.length) {
      out += '<span class="pv2-muted">Every tag is applied.</span>';
    } else {
      out += '<button type="button" class="btn-secondary" aria-expanded="' + (_pvfTagAddOpen ? 'true' : 'false') + '" onclick="pvfToggleAddTags()">' + (_pvfTagAddOpen ? 'Done adding tags' : 'Add tag') + '</button>';
      if (_pvfTagAddOpen) {
        out += '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;">'
          + avail.map(function(t){
              return '<button type="button" class="pv2-chip-add" onclick="pvfAddTag(' + t.id + ')">' + esc(t.name) + '</button>';
            }).join('')
          + '</div>';
      }
    }
    // Newsletter (Brevo) status/toggle lives here in Tags & Groups. The wrap is
    // populated asynchronously by pvfNewsletterInit (called after render); it's
    // shown only when the person has an email.
    if (p.email) {
      out += '<div class="pv2-extra-row" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border);"><span class="pv2-flabel">Newsletter</span>'
        + '<span id="pv-newsletter-wrap" class="require-edit"></span>'
        + '<span id="pv-newsletter-status" role="status" class="pv2-edit-note"></span>'
        + '</div>';
    }
  }
  return out;
}
function pvfToggleAddTags() {
  _pvfTagAddOpen = !_pvfTagAddOpen;
  var body = document.getElementById('pvf-body-tags');
  if (body) body.innerHTML = pvfTagsBody(_currentPvPerson);
  var p = _currentPvPerson;
  if (p && p.email && _userRole !== 'member') pvfNewsletterInit(p.id);
}
function pvfSetTags(tagIds) {
  var p = _currentPvPerson;
  api('/admin/api/people/' + p.id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ tag_ids: tagIds }) })
    .then(function(r){
      if (r && r.error) { alert('Save failed: ' + r.error); return; }
      _currentPvPerson.tags = (typeof allTags !== 'undefined' ? allTags : []).filter(function(t){ return tagIds.indexOf(t.id) >= 0; });
      var body = document.getElementById('pvf-body-tags'); if (body) body.innerHTML = pvfTagsBody(_currentPvPerson);
      if (p && p.email && _userRole !== 'member') pvfNewsletterInit(p.id);
      pvfToast();
    }).catch(function(){ alert('Save failed. Please try again.'); });
}
function pvfAddTag(tagId) {
  var cur = (_currentPvPerson.tags||[]).map(function(t){ return t.id; });
  if (cur.indexOf(tagId) < 0) cur.push(tagId);
  pvfSetTags(cur);
}
function pvfRemoveTag(tagId) {
  var cur = (_currentPvPerson.tags||[]).map(function(t){ return t.id; }).filter(function(id){ return id !== tagId; });
  pvfSetTags(cur);
}
function pvfLocationBody(p) {
  var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
  if (!addrParts.length) return '<p class="pv2-muted">No address on file.</p>';
  var addrStr = addrParts.map(esc).join(', ');
  var out = '<div style="font-size:15px;color:var(--text);line-height:1.5;">' + addrStr + '</div>';
  if (addrParts.length >= 2) {
    // Map is embedded on load (auto-opened by pvfRenderInfo); the button just toggles it.
    out += '<div style="margin-top:12px;"><div id="pv-map-' + p.id + '" data-addr="' + encodeURIComponent(addrParts.join(', ')) + '" style="display:none;margin-top:2px;border-radius:8px;overflow:hidden;line-height:0;border:1px solid var(--border);"></div>'
      + '<button id="pv-map-btn-' + p.id + '" class="btn-secondary" style="margin-top:8px;" onclick="togglePersonMap(' + p.id + ')">Show map</button></div>';
  }
  return out;
}
function pvfGivingBody() {
  return '<div id="pvf-giving-inner" class="pv2-muted" role="status">Loading…</div>';
}
function pvfRenderGivingCard(personId) {
  var el = document.getElementById('pvf-giving-inner');
  if (!el) return;
  api('/admin/api/giving?person_id=' + personId + '&limit=500').then(function(d){
    var entries = (d && d.entries) ? d.entries : (Array.isArray(d) ? d : []);
    var curYear = new Date().getFullYear().toString();
    var ytd = entries.filter(function(e){ return (e.contribution_date||'').slice(0,4) === curYear; });
    var ytdTotal = ytd.reduce(function(s,e){ return s+(e.amount||0); }, 0);
    var grandTotal = entries.reduce(function(s,e){ return s+(e.amount||0); }, 0);
    var recent = entries.slice().sort(function(a,b){ return (b.contribution_date||'').localeCompare(a.contribution_date||''); }).slice(0,3);
    var html = '<div style="display:flex;gap:12px;margin-bottom:16px;">'
      + '<div class="pv2-tile"><div class="pv2-tile-lbl">' + curYear + '</div><div class="pv2-tile-val" style="color:var(--color-teal);">$' + (ytdTotal/100).toFixed(2) + '</div></div>'
      + '<div class="pv2-tile"><div class="pv2-tile-lbl">All time</div><div class="pv2-tile-val" style="color:var(--color-navy);">$' + (grandTotal/100).toFixed(2) + '</div></div>'
      + '</div>';
    if (recent.length) {
      html += '<h3 class="ppl-qv-section-lbl">Recent gifts</h3>';
      html += recent.map(function(g){
        return '<div class="pv2-gift"><div style="flex:1;min-width:0;">'
          + '<div style="font-weight:700;font-size:14px;color:var(--color-navy);">' + esc(g.fund_name || g.fund || 'Gift') + '</div>'
          + '<div style="font-size:12.5px;color:var(--warm-meta);">' + esc(fmtDate(g.contribution_date||'')) + ' · ' + esc(g.method||'') + '</div></div>'
          + '<div style="font-weight:700;font-size:15px;color:var(--color-navy);">$' + ((g.amount||0)/100).toFixed(2) + '</div></div>';
      }).join('');
    } else {
      html += '<p class="pv2-muted">No gifts recorded.</p>';
    }
    html += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;">'
      + '<a href="#" onclick="showPvTab(\'giving\');return false;" style="font-weight:600;">Full giving history</a>'
      + (entries.length ? '<a href="#" onclick="sendGivingStatement(' + personId + ',\'' + curYear + '\');return false;" style="font-weight:600;">Send statement</a>' : '')
      + '</div>';
    el.innerHTML = html;
  }).catch(function(){ el.innerHTML = '<p class="pv2-muted" role="alert">Giving could not be loaded. Try again in a moment.</p>'; });
}
function pvfFollowupsBody(p) {
  var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
  return '<div id="pvf-followup-list" class="pv2-muted" style="margin-bottom:12px;">Loading…</div>'
    + (_userRole !== 'member'
        ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn-secondary" onclick="openAddFollowUp(' + p.id + ',\'' + esc(name) + '\',\'pastoral_call\')">Add follow-up</button>'
          + '<button class="btn-secondary" onclick="markSeenToday(' + p.id + ')">Mark seen today</button>'
          + '</div>'
        : '');
}
function pvfRenderFollowups(personId) {
  var el = document.getElementById('pvf-followup-list');
  if (!el) return;
  // The follow-up list endpoint is staff+ only; other roles just see the action buttons.
  if (_userRole !== 'admin' && _userRole !== 'staff') { el.innerHTML = ''; return; }
  api('/admin/api/followup?person_id=' + personId).then(function(d){
    var items = (d && d.items) ? d.items : (Array.isArray(d) ? d : []);
    var open = items.filter(function(i){ return !i.done && !i.completed_at && i.status !== 'done'; });
    if (!open.length) { el.innerHTML = 'No open follow-ups.'; return; }
    el.innerHTML = open.map(function(i){
      var due = i.due_date ? 'Due ' + esc(fmtDate(i.due_date)) : '';
      return '<div class="pv2-fu-item"><span class="os-badge os-badge-warning">Needs follow-up</span>'
        + '<div style="flex:1;min-width:0;"><div style="font-weight:600;color:var(--text);">' + esc(i.notes || i.type || 'Follow-up') + '</div>'
        + (due ? '<div style="font-size:14px;color:var(--muted);">' + due + '</div>' : '') + '</div></div>';
    }).join('');
  }).catch(function(){ el.innerHTML = 'Follow-ups could not be loaded.'; });
}
function pvfNotesBody(p) {
  var has = (p.notes||'').trim();
  // PATCHes people/{id} on save (pvfSaveNotesInline) -- gated on 'directory' like the rest of
  // the inline profile editor, not just membership.
  if (!permEdit('directory')) {
    return '<div style="white-space:pre-wrap;">'
      + (has ? esc(p.notes) : '<span class="pv2-muted">No notes.</span>') + '</div>';
  }
  return '<div style="white-space:pre-wrap;margin-bottom:12px;">'
    + (has ? esc(p.notes) : '<span class="pv2-muted">No notes.</span>') + '</div>'
    + '<button type="button" class="btn-secondary" onclick="pvfEditNotesInline()">' + (has ? 'Edit note' : 'Add a note') + '</button>';
}
function pvfEditNotesInline() {
  if (!permEdit('directory')) return;
  var body = document.getElementById('pvf-body-notes'); if (!body) return;
  var p = _currentPvPerson;
  body.innerHTML = '<label for="pvf-notes-ta" class="sr-only">Notes</label><textarea id="pvf-notes-ta" rows="5" class="pv2-inp" style="max-width:100%;resize:vertical;">' + esc(p.notes||'') + '</textarea>'
    + '<div class="pv2-edit-actions">'
    + '<button class="btn-secondary" onclick="pvfCancelNotesInline()">Cancel</button>'
    + '<button class="btn-primary" onclick="pvfSaveNotesInline()">Save note</button></div>';
  var ta = document.getElementById('pvf-notes-ta'); if (ta) ta.focus();
}
function pvfCancelNotesInline() {
  var body = document.getElementById('pvf-body-notes'); if (body) body.innerHTML = pvfNotesBody(_currentPvPerson);
}
function pvfSaveNotesInline() {
  var ta = document.getElementById('pvf-notes-ta'); if (!ta) return;
  var val = ta.value;
  var p = _currentPvPerson;
  api('/admin/api/people/' + p.id, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ notes: val }) })
    .then(function(r){
      if (r && r.error) { alert('Save failed: ' + r.error); return; }
      _currentPvPerson.notes = val;
      pvfCancelNotesInline();
      pvfToast();
    }).catch(function(){ alert('Save failed. Please try again.'); });
}
// Directory visibility, read-only summary (the flags themselves are edited as a section).
function pvfDirectoryBody(p) {
  if (String(p.public_directory) === '0') {
    return '<p class="pv2-dir-line"><span class="os-badge os-badge-neutral">Not in the directory</span></p>'
      + '<p class="pv2-dir-note">Hidden from the member directory and the printed directory.</p>';
  }
  var hidden = [['dir_hide_address','address'],['dir_hide_phone','phone'],['dir_hide_email','email'],['dir_hide_dob','birthday'],['dir_hide_anniversary','anniversary']]
    .filter(function(f){ return String(p[f[0]]) === '1'; }).map(function(f){ return f[1]; });
  return '<p class="pv2-dir-line"><span class="os-badge os-badge-success">In the directory</span></p>'
    + '<p class="pv2-dir-note">' + (hidden.length ? 'Hidden from members: ' + esc(hidden.join(', ')) + '.' : 'Everything on file is shown to members.') + '</p>';
}
// Build + inject the Open Sky person page (OS3): a main column of sections, each editable as a
// whole, and an aside with household, giving and location.
function pvfRenderInfo(p) {
  var infoEl = document.getElementById('ptab-info');
  if (!infoEl) return;
  _pvfTagAddOpen = false; // start collapsed on each profile render
  pvfBuildRegistry(p);
  var isFinance = (_userRole === 'admin' || _userRole === 'finance');
  var isMemberView = _userRole === 'member';
  // Hide the preferred-name row when it just repeats the first name (redundant).
  var _prefRedundant = (p.preferred_name||'').trim()
    && (p.preferred_name||'').trim().toLowerCase() === (p.first_name||'').trim().toLowerCase();
  function rows(ids) { return function() { return ids.map(pvfRowHtml).join(''); }; }
  _pvSections = {}; _pvSectionBodies = {}; _pvSectionOpen = {};
  function section(id, title, ids, bodyFn, opts) {
    opts = opts || {};
    _pvSections[id] = ids;
    _pvSectionBodies[id] = bodyFn;
    opts.edit = ids.length > 0;
    opts.body = bodyFn(p);
    return pvfCard(id, title, opts);
  }

  var contactIds = ['phone','email','address1','address2','city','state','zip'];
  var contactCard = section('contact', 'Contact', contactIds, function(pp){ return rows(contactIds)() + pvfContactExtras(pp); });
  // gender, marital_status and dob are all absent from memberSafeView, so a member sees just
  // the member type here — the one Personal field that belongs in a directory.
  var personalIds = isMemberView ? ['member_type']
    : ['first_name','last_name'].concat(_prefRedundant ? [] : ['preferred_name']).concat(['middle_name','member_type','family_role','gender','marital_status','dob']);
  var personalEditIds = ['first_name','last_name','preferred_name','middle_name','member_type','family_role','gender','marital_status','dob'];
  var personalCard = section('personal', 'Personal', isMemberView ? [] : personalEditIds, rows(personalIds));
  // Members get contact / personal (member type) / household / location and nothing else. The
  // server already strips the underlying data (memberSafeView); these cards would otherwise
  // render as empty shells with real headings.
  var churchIds = ['baptized','baptism_date','confirmed','confirmation_date','anniversary_date','envelope_number'];
  var demoCard = isMemberView ? '' : section('church', 'Church life', churchIds, rows(churchIds));
  var tagsCard = isMemberView ? '' : pvfCard('tags', 'Tags', { pad:true, body: pvfTagsBody(p) });
  var dirIds = ['public_directory','dir_hide_address','dir_hide_phone','dir_hide_email','dir_hide_dob','dir_hide_anniversary'];
  var dirCard = isMemberView ? '' : section('directory', 'Directory visibility', dirIds, pvfDirectoryBody, { pad:true });
  var followCard = isMemberView ? '' : pvfCard('followups', 'Follow-ups', { pad:true, body: pvfFollowupsBody(p) });
  var notesCard = isMemberView ? '' : pvfCard('notes', 'Notes', { pad:true, body: pvfNotesBody(p) });

  var addBtn = (p.household_id && permEdit('directory'))
    ? '<button class="btn-secondary pv2-card-btn" onclick="openAddToHouseholdModal(' + p.household_id + ')">Add member</button>'
    : '';
  var familyCard = pvfCard('family', 'Household', { headerBtns: addBtn, pad:true, body: pvfFamilyBody(p) });
  var locationCard = pvfCard('location', 'Location', { pad:true, body: pvfLocationBody(p) });
  var givingCard = isFinance ? pvfCard('giving', 'Giving', { tag: String(new Date().getFullYear()), pad:true, body: pvfGivingBody() }) : '';

  infoEl.innerHTML = '<div class="pv2-layout">'
    + '<div class="pv2-main">' + contactCard + personalCard + demoCard + tagsCard + dirCard + followCard + notesCard + '</div>'
    + '<aside class="pv2-aside" aria-label="Household, giving and location">' + familyCard + givingCard + locationCard + '</aside>'
    + '</div>';

  if (p.household_id) loadPvFamily(p.household_id, p.id);
  if (isFinance) pvfRenderGivingCard(p.id);
  // /admin/api/followup is outside the member allowlist, so for a member this was a guaranteed
  // 403 on every profile open — and there is no Follow-ups card to fill any more either way.
  if (!isMemberView) pvfRenderFollowups(p.id);
  // Newsletter control lives in the Tags card — populate it after render.
  if (p.email && _userRole !== 'member') pvfNewsletterInit(p.id);
  // Auto-embed the map (togglePersonMap opens the hidden container + loads the static map).
  if (document.getElementById('pv-map-' + p.id)) togglePersonMap(p.id);
}
// ── PERSON PROFILE SECTION EDITING ─────────────────────
// The old per-section editors (Contact / Demographics / Notes / Tags, each a whole-card
// Edit-then-Save panel writing a full-row PUT) lived here. The profile is now the pvf*
// field registry above — click one value, PATCH just that field — and the #pv-*-section
// containers those editors wrote into no longer exist in the markup, so every one of them
// was unreachable. They were deleted rather than left in place because their presence is
// actively misleading: they look like the live profile editor and are the obvious thing to
// change when the profile needs a new field.
function syncPersonAddrToHousehold(hhId) {
  var p = _currentPvPerson;
  if (!p || !p.address1) return;
  if (!confirm('Update the household address to match this person\'s address?\n\n' + [p.address1, p.address2, p.city, ((p.state||'') + ' ' + (p.zip||'')).trim()].filter(Boolean).join(', '))) return;
  api('/admin/api/households/' + hhId).then(function(hh) {
    if (!hh || !hh.id) { alert('Could not load household.'); return; }
    var updated = Object.assign({}, hh, { address1: p.address1||'', address2: p.address2||'', city: p.city||'', state: p.state||'', zip: p.zip||'' });
    api('/admin/api/households/' + hhId, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(updated) })
      .then(function(r) {
        // Only the household record changed — this person's own address is already what
        // was just copied from — so the saved-toast is the right feedback here. (This
        // called the removed pvRenderContact(), which would have thrown.)
        if (r && r.ok) { pvfToast(); }
        else alert('Failed to update household address: ' + ((r && r.error) || 'unknown error'));
      }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
  });
}

function loadPvFamily(hhId, selfId) {
  var el = document.getElementById('pv-family-members');
  if (!el) return;
  api('/admin/api/households/'+hhId).then(function(d) {
    var members = (d && d.members) ? d.members : [];
    if (!members.length) { el.innerHTML = 'No members found.'; return; }
    el.classList.remove('pv2-muted');
    el.innerHTML = members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'').charAt(0)+(m.last_name||'').charAt(0)).toUpperCase();
      var meta = m.family_role ? m.family_role.charAt(0).toUpperCase()+m.family_role.slice(1) : '';
      var isSelf = m.id === selfId;
      return '<div class="pv-family-member">'
        + '<div class="pv-family-avatar">'+ini+'</div>'
        + '<div style="flex:1;min-width:0;">'
        + (isSelf
            ? '<div class="pv-family-name" aria-current="true">'+esc(mName)+'</div>'
            : '<button type="button" class="pv-family-name pv-family-link" onclick="openPersonDetail('+m.id+')">'+esc(mName)+'</button>')
        + '</div>'
        + (meta ? '<div class="pv-family-meta">'+esc(meta)+'</div>' : '')
        + '</div>';
    }).join('')
    + (permEdit('directory') ? '<div style="margin-top:12px;"><button class="btn-secondary" onclick="editHouseholdById('+hhId+')">Edit household</button></div>' : '');
  }).catch(function(){
    el.innerHTML = 'Household members could not be loaded.';
  });
}
function closeProfile() {
  _currentPvPerson = null;
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.remove('pv-mode');
}
function togglePvTagEditor() {
  var editor = document.getElementById('pv-tags-editor');
  if (!editor) return;
  var open = editor.style.display !== 'none';
  if (open) { editor.style.display = 'none'; return; }
  // Populate chip picker with current person's tags pre-selected
  var sel = (_currentPvPerson && _currentPvPerson.tags) ? _currentPvPerson.tags.map(function(t){return t.id;}) : [];
  var chips = document.getElementById('pv-tag-chips');
  if (chips) {
    chips.innerHTML = allTags.map(function(t) {
      var on = sel.indexOf(t.id) >= 0;
      return '<span class="tag-chip" data-tid="'+t.id+'"'+(on?' data-picked="1"':'')+' onclick="togglePvTagChip(this)"'
        +' style="cursor:pointer;padding:4px 10px;'
        +(on?'background:'+t.color+'30;border-color:'+t.color+';color:'+t.color+';':'background:var(--linen);border-color:var(--border);color:var(--warm-gray);')
        +'">'+esc(t.name)+'</span>';
    }).join('');
  }
  editor.style.display = '';
}
function togglePvTagChip(el) {
  var t = allTags.find(function(x){return x.id == el.dataset.tid;});
  if (!t) return;
  if (el.dataset.picked === '1') {
    el.dataset.picked = '';
    el.style.background = 'var(--linen)'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--warm-gray)';
  } else {
    el.dataset.picked = '1';
    el.style.background = t.color+'30'; el.style.borderColor = t.color; el.style.color = t.color;
  }
}
function savePvTags() {
  if (!_currentPvPerson) return;
  var ids = [];
  document.querySelectorAll('#pv-tag-chips .tag-chip').forEach(function(el) {
    if (el.dataset.picked === '1') ids.push(parseInt(el.dataset.tid));
  });
  api('/admin/api/people/'+_currentPvPerson.id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ tag_ids: ids })
  }).then(function(r) {
    if (r.error) { alert('Error: '+r.error); return; }
    // Update local tags and re-render display
    _currentPvPerson.tags = allTags.filter(function(t){ return ids.indexOf(t.id) >= 0; });
    var display = document.getElementById('pv-tags-display');
    if (display) {
      var tagHtml = _currentPvPerson.tags.map(function(t){
        return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;background:'+esc(t.color)+';color:white;font-size:11px;font-weight:600;margin:2px;">'+esc(t.name)+'</span>';
      }).join('');
      display.innerHTML = tagHtml || '<span style="color:var(--warm-gray);font-size:.82rem;font-style:italic;">No tags</span>';
    }
    document.getElementById('pv-tags-editor').style.display = 'none';
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function triggerPhotoUpload() {
  var inp = document.getElementById('pv-photo-input');
  if (inp) inp.click();
}
// Photo edit menu: a single edit button opens this on-demand menu instead of
// four always-visible corner buttons cluttering the profile photo.
var _pvPhotoState = { hasPhoto: false, hasHousehold: false };
function togglePvPhotoMenu(e) {
  if (e) { e.stopPropagation(); if (e.preventDefault) e.preventDefault(); }
  if (!permEdit('directory')) return;
  var menu = document.getElementById('pv-photo-menu');
  if (!menu) return;
  if (menu.style.display !== 'none') { closePvPhotoMenu(); return; }
  var items = [];
  items.push('<button onclick="closePvPhotoMenu();triggerPhotoUpload()">' + (_pvPhotoState.hasPhoto ? 'Replace photo' : 'Upload photo') + '</button>');
  if (_pvPhotoState.hasHousehold) items.push('<button onclick="closePvPhotoMenu();openPVPhotoPicker()">Use a family photo</button>');
  if (_pvPhotoState.hasPhoto) items.push('<button onclick="closePvPhotoMenu();recropPersonPhoto()">Re-crop photo</button>');
  if (_pvPhotoState.hasPhoto) items.push('<button class="danger" onclick="closePvPhotoMenu();removePersonPhoto()">Remove photo</button>');
  menu.innerHTML = items.join('');
  menu.style.display = 'block';
  setTimeout(function() { document.addEventListener('click', _pvPhotoMenuOutside); }, 0);
}
function _pvPhotoMenuOutside(ev) {
  var menu = document.getElementById('pv-photo-menu');
  if (menu && !menu.contains(ev.target)) closePvPhotoMenu();
}
function closePvPhotoMenu() {
  var menu = document.getElementById('pv-photo-menu');
  if (menu) menu.style.display = 'none';
  document.removeEventListener('click', _pvPhotoMenuOutside);
}
function triggerHHPhotoUpload() {
  var inp = document.getElementById('hm-photo-input');
  if (inp) inp.click();
}
function handleHHPhotoSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  input.value = '';
  if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
  if (!_editingHouseholdId) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() { showCropModal(img, uploadHouseholdPhoto); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function uploadHouseholdPhoto(blob) {
  var hid = _editingHouseholdId;
  if (!hid) return;
  var btn = document.getElementById('hm-photo-upload-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading…'; }
  var fd = new FormData();
  fd.append('photo', blob, 'photo.jpg');
  api('/admin/api/households/' + hid + '/photo', { method: 'POST', body: fd, credentials: 'same-origin' })
    .then(function(d) {
      if (btn) { btn.disabled = false; btn.innerHTML = '&#128247; Upload Photo'; }
      if (d && d.ok && d.photo_url) {
        document.getElementById('hm-photo').value = d.photo_url;
        var prevEl = document.getElementById('hm-photo-preview');
        if (prevEl) { prevEl.src = photoSrc(d.photo_url) + '?t=' + Date.now(); prevEl.style.display = 'block'; }
        var rcBtn = document.getElementById('hm-photo-recrop-btn');
        if (rcBtn) rcBtn.style.display = 'inline-flex';
        var rmBtn = document.getElementById('hm-photo-remove-btn');
        if (rmBtn) rmBtn.style.display = 'inline-flex';
      } else {
        alert('Upload failed: ' + ((d && d.error) || 'unknown error'));
      }
    }).catch(function() {
      if (btn) { btn.disabled = false; btn.innerHTML = '&#128247; Upload Photo'; }
      alert('Upload failed. Please try again.');
    });
}
function recropHHPhoto() {
  var url = document.getElementById('hm-photo').value;
  if (!url) return;
  var img = new Image();
  img.onload = function() { showCropModal(img, uploadHouseholdPhoto); };
  img.onerror = function() { alert('Could not load the current household photo for re-cropping.'); };
  img.src = photoSrc(url);
}
function removeHHPhoto() {
  var hid = _editingHouseholdId;
  if (!hid) return;
  if (!confirm('Remove this household photo?')) return;
  api('/admin/api/households/' + hid + '/photo', { method: 'DELETE', credentials: 'same-origin' })
    .then(function(d) {
      if (!d || !d.ok) { alert('Remove failed: ' + ((d && d.error) || 'unknown error')); return; }
      document.getElementById('hm-photo').value = '';
      var prevEl = document.getElementById('hm-photo-preview');
      if (prevEl) { prevEl.src = ''; prevEl.style.display = 'none'; }
      var rcBtn = document.getElementById('hm-photo-recrop-btn');
      if (rcBtn) rcBtn.style.display = 'none';
      var rmBtn = document.getElementById('hm-photo-remove-btn');
      if (rmBtn) rmBtn.style.display = 'none';
    })
    .catch(function() { alert('Remove failed. Please try again.'); });
}

function handlePhotoFileSelected(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  input.value = '';
  if (!file.type.startsWith('image/')) { alert('Please select an image file.'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() { showCropModal(img, uploadPersonPhoto); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function togglePVSms() {
  var p = _currentPvPerson;
  if (!p) return;
  var nextOptIn = p.sms_opt_in ? 0 : 1;
  api('/admin/api/people/bulk-comm-opt', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ ids: [p.id], sms: nextOptIn ? 'in' : 'out' })
  }).then(function(r) {
    if (!r.ok) { alert('Error: ' + (r.error || 'unknown')); return; }
    p.sms_opt_in = nextOptIn;
    var badge = document.getElementById('pv-sms-badge');
    if (badge) {
      badge.setAttribute('aria-pressed', nextOptIn ? 'true' : 'false');
      badge.textContent = nextOptIn ? 'Birthday and anniversary texts on' : 'Birthday and anniversary texts off';
    }
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function openPVPhotoPicker() {
  var p = _currentPvPerson;
  if (!p || !p.household_id) {
    alert('This person has no household, so there are no family photos to pick from.');
    return;
  }
  api('/admin/api/households/' + p.household_id).then(function(h) {
    var tiles = [];
    if (h && h.photo_url) {
      tiles.push({ url: h.photo_url, name: h.name || 'Household photo', sub: 'Household photo' });
    }
    (h && h.members ? h.members : []).forEach(function(m) {
      if (!m.photo_url) return;
      if (m.id === p.id) return; // skip self
      tiles.push({
        url: m.photo_url,
        name: ((m.first_name||'') + ' ' + (m.last_name||'')).trim() || 'Member',
        sub: m.family_role || ''
      });
    });
    if (!tiles.length) {
      alert('No household members have a photo on their profile yet, and the household has no photo set.');
      return;
    }
    var list = document.getElementById('pv-photo-pick-list');
    list.innerHTML = tiles.map(function(t, i) {
      return '<div data-pvpidx="' + i + '" onclick="usePVPhotoFrom(' + i + ')" style="cursor:pointer;width:120px;text-align:center;border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--white);">'
        + '<img src="' + esc(photoSrc(t.url)) + '" alt="" style="width:80px;height:80px;object-fit:cover;border-radius:50%;display:block;margin:0 auto 6px;">'
        + '<div style="font-size:.85rem;font-weight:600;color:var(--charcoal);">' + esc(t.name) + '</div>'
        + '<div style="font-size:.72rem;color:var(--warm-gray);text-transform:capitalize;">' + esc(t.sub) + '</div>'
        + '</div>';
    }).join('');
    _pvPickerTiles = tiles;
    openModal('pv-photo-pick-modal');
  });
}
var _pvPickerTiles = [];
function usePVPhotoFrom(idx) {
  var p = _currentPvPerson;
  var t = _pvPickerTiles[idx];
  if (!p || !t) return;
  api('/admin/api/people/' + p.id + '/photo', {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    credentials: 'same-origin',
    body: JSON.stringify({ photo_url: t.url })
  }).then(function(d) {
      if (!d || !d.ok) { alert('Could not apply photo: ' + ((d && d.error) || 'unknown')); return; }
      closeModal('pv-photo-pick-modal');
      _currentPvPerson.photo_url = d.photo_url;
      var photoEl = document.getElementById('pv-photo');
      if (photoEl) {
        var imgEl = document.createElement('img');
        imgEl.src = photoSrc(d.photo_url) + '?t=' + Date.now();
        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
        photoEl.innerHTML = '';
        photoEl.appendChild(imgEl);
      }
      _pvPhotoState.hasPhoto = true;
    }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function recropPersonPhoto() {
  var p = _currentPvPerson;
  if (!p || !p.photo_url) return;
  var img = new Image();
  // Same-origin: photoSrc returns either /admin/r2photo/... or
  // /admin/photo-proxy?url=... — both come from this worker, so the
  // canvas won't be tainted by drawImage.
  img.onload = function() { showCropModal(img, uploadPersonPhoto); };
  img.onerror = function() { alert('Could not load the current photo for re-cropping.'); };
  img.src = photoSrc(p.photo_url);
}
function removePersonPhoto() {
  var pid = _currentPvPerson && _currentPvPerson.id;
  if (!pid) return;
  if (!confirm('Remove this person’s photo? Initials will show until you upload a new one.')) return;
  api('/admin/api/people/' + pid + '/photo', { method: 'DELETE', credentials: 'same-origin' })
    .then(function(d) {
      if (!d || !d.ok) { alert('Remove failed: ' + ((d && d.error) || 'unknown error')); return; }
      _currentPvPerson.photo_url = '';
      var photoEl = document.getElementById('pv-photo');
      if (photoEl) {
        var initialsTxt = ((_currentPvPerson.first_name||'').charAt(0) + (_currentPvPerson.last_name||'').charAt(0)).toUpperCase();
        photoEl.innerHTML = '<span style="color:white;font-size:24px;font-weight:600;line-height:1;">' + initialsTxt + '</span>';
      }
      _pvPhotoState.hasPhoto = false;
    })
    .catch(function() { alert('Remove failed. Please try again.'); });
}
function uploadPersonPhoto(blob) {
  var pid = _currentPvPerson && _currentPvPerson.id;
  if (!pid) return;
  var overlay = document.getElementById('pv-photo-overlay');
  if (overlay) { overlay.style.opacity = '1'; overlay.innerHTML = '<span style="color:white;font-size:12px;">Uploading\u2026</span>'; }
  var fd = new FormData();
  fd.append('photo', blob, 'photo.jpg');
  api('/admin/api/people/' + pid + '/photo', { method: 'POST', body: fd, credentials: 'same-origin' })
    .then(function(d) {
      if (overlay) { overlay.style.opacity = ''; overlay.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="white" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'; }
      if (d && d.ok && d.photo_url) {
        _currentPvPerson.photo_url = d.photo_url;
        _pvPhotoState.hasPhoto = true;
        var photoEl = document.getElementById('pv-photo');
        if (photoEl) {
          var imgEl = document.createElement('img');
          imgEl.src = photoSrc(d.photo_url) + '?t=' + Date.now();
          imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
          photoEl.innerHTML = '';
          photoEl.appendChild(imgEl);
        }
      } else {
        alert('Upload failed: ' + ((d && d.error) || 'unknown error'));
      }
    }).catch(function() {
      if (overlay) overlay.style.opacity = '';
      alert('Upload failed. Please try again.');
    });
}

// ── CROP MODAL ────────────────────────────────────────────────────────
var _cropFitScale = 1, _cropZoom = 1;
function showCropModal(img, callback) {
  _cropImg = img;
  _cropCallback = callback;
  var MAX_W = 600, MAX_H = 440;
  _cropFitScale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
  _cropZoom = 1;
  _cropScale = _cropFitScale * _cropZoom;
  var canvas = document.getElementById('crop-canvas');
  canvas.width = Math.round(img.width * _cropScale);
  canvas.height = Math.round(img.height * _cropScale);
  var dim = Math.min(img.width, img.height);
  _cropRect = { x: Math.round((img.width - dim) / 2), y: Math.round((img.height - dim) / 2), w: dim, h: dim };
  var slider = document.getElementById('crop-zoom');
  if (slider) slider.value = 100;
  var lbl = document.getElementById('crop-zoom-label');
  if (lbl) lbl.textContent = '100%';
  _cropDraw();
  openModal('crop-modal');
}
function cropZoomSlider(val) {
  _cropZoom = Math.max(1, parseInt(val) / 100);
  _cropScale = _cropFitScale * _cropZoom;
  var canvas = document.getElementById('crop-canvas');
  canvas.width = Math.round(_cropImg.width * _cropScale);
  canvas.height = Math.round(_cropImg.height * _cropScale);
  var lbl = document.getElementById('crop-zoom-label');
  if (lbl) lbl.textContent = Math.round(_cropZoom * 100) + '%';
  _cropDraw();
}
function cropZoom(dir) {
  var slider = document.getElementById('crop-zoom');
  if (!slider) return;
  var step = 25;
  var v = Math.max(100, Math.min(500, parseInt(slider.value) + dir * step));
  slider.value = v;
  cropZoomSlider(v);
}
function _cropDraw() {
  var canvas = document.getElementById('crop-canvas');
  if (!canvas || !_cropImg) return;
  var ctx = canvas.getContext('2d');
  var s = _cropScale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(_cropImg, 0, 0, canvas.width, canvas.height);
  var cx = _cropRect.x * s, cy = _cropRect.y * s, cw = _cropRect.w * s, ch = _cropRect.h * s;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, canvas.width, cy);
  ctx.fillRect(0, cy + ch, canvas.width, canvas.height - cy - ch);
  ctx.fillRect(0, cy, cx, ch);
  ctx.fillRect(cx + cw, cy, canvas.width - cx - cw, ch);
  ctx.strokeStyle = 'white'; ctx.lineWidth = 1.5;
  ctx.strokeRect(cx, cy, cw, ch);
  var hs = 8;
  ctx.fillStyle = 'white';
  [[cx, cy],[cx+cw, cy],[cx, cy+ch],[cx+cw, cy+ch]].forEach(function(pt) {
    ctx.fillRect(pt[0]-hs/2, pt[1]-hs/2, hs, hs);
  });
}
function _cropHitCorner(mx, my) {
  var s = _cropScale, hs = 10;
  var cx = _cropRect.x*s, cy = _cropRect.y*s, cw = _cropRect.w*s, ch = _cropRect.h*s;
  var corners = [{k:'tl',x:cx,y:cy},{k:'tr',x:cx+cw,y:cy},{k:'bl',x:cx,y:cy+ch},{k:'br',x:cx+cw,y:cy+ch}];
  for (var i=0; i<corners.length; i++) {
    if (Math.abs(mx-corners[i].x)<hs && Math.abs(my-corners[i].y)<hs) return corners[i].k;
  }
  return null;
}
function _cropCanvasXY(e) {
  var r = document.getElementById('crop-canvas').getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
function cropMouseDown(e) {
  var xy = _cropCanvasXY(e), mx = xy[0], my = xy[1];
  var corner = _cropHitCorner(mx, my);
  var s = _cropScale;
  var cx = _cropRect.x*s, cy = _cropRect.y*s, cw = _cropRect.w*s, ch = _cropRect.h*s;
  var inside = mx>=cx && mx<=cx+cw && my>=cy && my<=cy+ch;
  _cropDrag = { type: corner || (inside ? 'move' : null), sx: mx, sy: my, rx: _cropRect.x, ry: _cropRect.y, rw: _cropRect.w, rh: _cropRect.h };
  e.preventDefault();
}
function cropMouseMove(e) {
  if (!_cropDrag || !_cropDrag.type) return;
  var xy = _cropCanvasXY(e), mx = xy[0], my = xy[1];
  var s = _cropScale;
  var dx = (mx - _cropDrag.sx) / s, dy = (my - _cropDrag.sy) / s;
  var iw = _cropImg.width, ih = _cropImg.height;
  var r = {x: _cropDrag.rx, y: _cropDrag.ry, w: _cropDrag.rw, h: _cropDrag.rh};
  // Keep handles grabbable at every zoom: minimum is whichever is larger of
  // 20 source-image pixels or 30 displayed canvas pixels back-projected.
  var MIN = Math.max(20, 30 / _cropScale);
  if (_cropDrag.type === 'move') {
    r.x = Math.max(0, Math.min(iw - r.w, r.x + dx));
    r.y = Math.max(0, Math.min(ih - r.h, r.y + dy));
  } else {
    // Free aspect ratio: each corner moves x/y independently.
    if (_cropDrag.type === 'tl') {
      var nw = Math.max(MIN, r.w - dx), nh = Math.max(MIN, r.h - dy);
      r.x = r.x + (r.w - nw); r.y = r.y + (r.h - nh); r.w = nw; r.h = nh;
    } else if (_cropDrag.type === 'tr') {
      var nw = Math.max(MIN, r.w + dx), nh = Math.max(MIN, r.h - dy);
      r.y = r.y + (r.h - nh); r.w = nw; r.h = nh;
    } else if (_cropDrag.type === 'bl') {
      var nw = Math.max(MIN, r.w - dx), nh = Math.max(MIN, r.h + dy);
      r.x = r.x + (r.w - nw); r.w = nw; r.h = nh;
    } else if (_cropDrag.type === 'br') {
      var nw = Math.max(MIN, r.w + dx), nh = Math.max(MIN, r.h + dy);
      r.w = nw; r.h = nh;
    }
    r.x = Math.max(0, Math.min(iw - r.w, r.x));
    r.y = Math.max(0, Math.min(ih - r.h, r.y));
    r.w = Math.min(r.w, iw - r.x);
    r.h = Math.min(r.h, ih - r.y);
  }
  _cropDrag.sx = mx; _cropDrag.sy = my;
  _cropDrag.rx = r.x; _cropDrag.ry = r.y; _cropDrag.rw = r.w; _cropDrag.rh = r.h;
  _cropRect = r;
  _cropDraw();
}
function cropMouseUp() { _cropDrag = null; }
function cropApply() {
  if (!_cropImg || !_cropCallback) return;
  var MAX = 400;
  var sw = _cropRect.w, sh = _cropRect.h;
  var scale = Math.min(1, MAX / sw, MAX / sh);
  var ow = Math.round(sw * scale), oh = Math.round(sh * scale);
  var canvas = document.createElement('canvas');
  canvas.width = ow; canvas.height = oh;
  canvas.getContext('2d').drawImage(_cropImg, _cropRect.x, _cropRect.y, sw, sh, 0, 0, ow, oh);
  closeModal('crop-modal');
  canvas.toBlob(function(blob) { _cropCallback(blob); _cropCallback = null; }, 'image/jpeg', 0.85);
}
function cropSkip() {
  if (!_cropImg || !_cropCallback) return;
  var MAX = 400, img = _cropImg;
  var w = img.width, h = img.height;
  if (w > MAX || h > MAX) {
    if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
    else { w = Math.round(w * MAX / h); h = MAX; }
  }
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  closeModal('crop-modal');
  canvas.toBlob(function(blob) { _cropCallback(blob); _cropCallback = null; }, 'image/jpeg', 0.85);
}

// syncPersonFromBreeze() removed 2026-07-27 \u2014 no path pulls a person's data from
// Breeze anymore (Connect is the source of truth for all people data; only giving
// syncs from Breeze). Reverse sync (pushPersonToBreeze, below) is unaffected.
function pushPersonToBreeze(personId) {
  if (!confirm('Create this person in Breeze? Their name and contact info will be pushed. This cannot be undone automatically.')) return;
  var btn = event && event.currentTarget;
  var origLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Pushing…'; }
  api('/admin/api/people/' + personId + '/push-to-breeze', {
    method: 'POST',
    headers: {'Content-Type':'application/json'}
  }).then(function(r) {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
    if (r && r.ok) {
      alert('Created in Breeze (ID: ' + r.breeze_id + ').' + (r.fields_sent ? ' ' + r.fields_sent + ' contact field(s) sent.' : ''));
      api('/admin/api/people/' + personId).then(function(p) { if (p && p.id) showProfile(p); });
    } else {
      alert('Push to Breeze failed: ' + ((r && r.error) || 'Unknown error'));
    }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
    alert('Push to Breeze error: ' + (e.message || e));
  });
}
function applyAddressToHousehold(personId, householdId) {
  var p = _currentPvPerson;
  if (!p || !p.address1) { alert('This person has no address to push.'); return; }
  if (!confirm('Push this address to household members who have no address on file? (Existing addresses will not be changed.)')) return;
  api('/admin/api/households/'+householdId+'/sync-address', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ address1: p.address1||'', city: p.city||'', state: p.state||'MO', zip: p.zip||'' })
  }).then(function(r) {
    if (!r.ok) { alert('Error: '+(r.error||'unknown')); return; }
    var n = r.updated || 0;
    if (n > 0) alert('Address pushed to ' + n + ' member' + (n !== 1 ? 's' : '') + ' who had no address on file.');
    else alert('All household members already have an address — nothing was changed.');
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
// Add-to-household: search for existing person and link them
var _addToHhId = null, _addToHhPeople = {}, _addToHhTimer = null, _addToHhHousehold = null;
function openAddToHouseholdModal(householdId) {
  _addToHhId = householdId;
  _addToHhPeople = {};
  // Fetched up front so creating a new member can inherit the household address, and so
  // the panel can show which address they'll get rather than applying it invisibly.
  _addToHhHousehold = null;
  api('/admin/api/households/' + householdId).then(function(h) {
    if (h && !h.error) { _addToHhHousehold = h; renderAddHhAddressNote(); }
  }).catch(function() { /* prefill is a convenience — never block adding someone */ });
  var s = document.getElementById('add-hh-search');
  if (s) s.value = '';
  var r = document.getElementById('add-hh-results');
  if (r) r.innerHTML = '<p style="color:var(--warm-gray);text-align:center;padding:16px;font-size:.88rem;">Type a name to search…</p>';
  // Reset "create new person" panel
  var np = document.getElementById('add-hh-new'); if (np) np.style.display = 'none';
  var nt = document.getElementById('add-hh-new-toggle'); if (nt) nt.textContent = '+ Create new person instead';
  var nf = document.getElementById('anh-first'); if (nf) nf.value = '';
  var nl = document.getElementById('anh-last');  if (nl) nl.value = '';
  openModal('add-to-hh-modal');
  setTimeout(function(){ if (s) s.focus(); }, 100);
}
// States the address a newly-created member will inherit, so the prefill is visible
// rather than silent — and says plainly when there is nothing to inherit.
function renderAddHhAddressNote() {
  var el = document.getElementById('anh-address-note');
  if (!el) return;
  var h = _addToHhHousehold;
  if (!h) { el.textContent = ''; return; }
  var line = [h.address1, h.address2].filter(Boolean).join(' ');
  var cityLine = [h.city, [h.state, h.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  var full = [line, cityLine].filter(Boolean).join(', ');
  el.innerHTML = full
    ? 'Address will be prefilled from the household: <strong>' + esc(full) + '</strong>'
    : 'This household has no address on file, so none will be prefilled.';
}
function searchAddToHh(q) {
  if (_addToHhTimer) clearTimeout(_addToHhTimer);
  var el = document.getElementById('add-hh-results');
  if (!q || q.length < 2) {
    el.innerHTML = '<p style="color:var(--warm-gray);text-align:center;padding:16px;font-size:.88rem;">Type a name to search…</p>';
    return;
  }
  _addToHhTimer = setTimeout(function() {
    el.innerHTML = '<p style="color:var(--warm-gray);text-align:center;padding:16px;font-size:.88rem;">Searching…</p>';
    api('/admin/api/people?q='+encodeURIComponent(q)+'&limit=10').then(function(d) {
      var people = d.people || [];
      _addToHhPeople = {};
      people.forEach(function(p){ _addToHhPeople[p.id] = p; });
      if (!people.length) { el.innerHTML = '<p style="color:var(--warm-gray);text-align:center;padding:16px;font-size:.88rem;">No people found</p>'; return; }
      el.innerHTML = people.map(function(p) {
        var hhTag = (p.household_display_name || p.household_name) ? ' <span style="font-size:.75rem;color:var(--warm-gray);background:var(--bg-alt);border-radius:4px;padding:1px 6px;margin-left:4px;">'+esc(p.household_display_name || p.household_name)+'</span>' : '';
        return '<div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;">'
          +'<span style="font-size:.92rem;">'+esc(p.first_name)+' '+esc(p.last_name)+hhTag+'</span>'
          +'<button class="btn-primary" style="font-size:.78rem;padding:4px 10px;white-space:nowrap;" onclick="confirmAddToHh('+p.id+')">Add</button>'
          +'</div>';
      }).join('');
    });
  }, 300);
}
function confirmAddToHh(personId) {
  var p = _addToHhPeople[personId];
  if (!p) return;
  api('/admin/api/people/'+personId, {
    method: 'PATCH', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ household_id: _addToHhId })
  }).then(function(r) {
    if (r.ok) {
      closeModal('add-to-hh-modal');
      if (_currentPvPerson && _currentPvPerson.household_id === _addToHhId) loadPvFamily(_addToHhId, _currentPvPerson.id);
    } else alert('Error: '+(r.error||'unknown'));
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function toggleAddHhNew(btn) {
  var panel = document.getElementById('add-hh-new');
  if (!panel) return;
  var show = panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  btn.textContent = show ? '— Cancel new person' : '+ Create new person instead';
  if (show) {
    var sel = document.getElementById('anh-type');
    if (sel) sel.innerHTML = (_memberTypes || []).map(function(t){ return '<option value="'+esc(t)+'">'+esc(t)+'</option>'; }).join('');
    renderAddHhAddressNote();
    var f = document.getElementById('anh-first'); if (f) f.focus();
  }
}
function createAndAddToHh() {
  var first = (document.getElementById('anh-first').value || '').trim();
  var last  = (document.getElementById('anh-last').value  || '').trim();
  var type  = document.getElementById('anh-type').value;
  if (!first || !last) { alert('First and last name are required.'); return; }
  var btn = document.querySelector('#add-hh-new .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }
  // Someone added to a household almost always lives at that household's address, and
  // re-typing it is both tedious and a source of near-miss duplicates. The household row
  // is the source: it carries its own address, so this doesn't depend on which member
  // happens to be complete. A blank field on the household simply prefills nothing.
  var body = { first_name: first, last_name: last, member_type: type || 'Visitor', household_id: _addToHhId, tag_ids: [] };
  var hh = _addToHhHousehold;
  if (hh && String(hh.id) === String(_addToHhId)) {
    ['address1','address2','city','zip'].forEach(function(k){ if (hh[k]) body[k] = hh[k]; });
    if (hh.state) body.state = hh.state;
  }
  api('/admin/api/people', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(body)
  }).then(function(r) {
    if (btn) { btn.disabled = false; btn.textContent = 'Create & Add to Household'; }
    if (r && r.ok) {
      closeModal('add-to-hh-modal');
      if (_currentPvPerson && _currentPvPerson.household_id === _addToHhId) loadPvFamily(_addToHhId, _currentPvPerson.id);
      loadPeople();
    } else { alert('Error: '+(r && r.error ? r.error : 'Could not create person')); }
  }).catch(function() { if (btn) { btn.disabled = false; btn.textContent = 'Create & Add to Household'; } alert('Network error.'); });
}
function showPvTab(name) {
  if (name === 'giving' && _userRole !== 'admin' && _userRole !== 'finance') return; // giving is finance+ only
  document.querySelectorAll('.pv-tab').forEach(function(b){
    b.classList.toggle('active', b.dataset.ptab === name);
  });
  document.querySelectorAll('.ptab-panel').forEach(function(p){
    p.classList.toggle('active', p.id === 'ptab-'+name);
  });
  if (name === 'giving' && _currentPvPerson) loadPvGiving(_currentPvPerson.id);
}
function loadPvGiving(personId) {
  var el = document.getElementById('ptab-giving');
  if (!el) return;
  _pvGivingPersonId = personId;
  _pvGivingEntries = [];
  _pvPledges = [];
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Loading...</div>';
  Promise.all([
    api('/admin/api/giving?person_id='+personId+'&limit=2000'),
    api('/admin/api/people/'+personId+'/pledges').catch(function(){ return { pledges: [] }; }),
  ]).then(function(results) {
    var d = results[0], pd = results[1];
    _pvGivingEntries = (d && d.entries) ? d.entries : [];
    _pvPledges = (pd && pd.pledges) ? pd.pledges : [];
    renderPvGiving('');
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load giving.</div>';
  });
}
// P28-C / PL1b: pledge card — a small year/pledged/given table plus an inline add-or-update
// form. Pulled from the profile's own Giving tab data (_pvPledges, loaded alongside the gift
// entries) so no separate load state is needed.
function renderPvPledgesCard(personId) {
  var rows = _pvPledges.slice().sort(function(a,b){ return b.fiscal_year - a.fiscal_year; }).map(function(p) {
    var pct = p.amount_cents > 0 ? Math.round((p.actual_cents / p.amount_cents) * 100) : 0;
    return '<tr>'
      + '<td style="padding:6px 8px;font-size:12px;">'+p.fiscal_year+'</td>'
      + '<td style="padding:6px 8px;text-align:right;font-size:12px;">$'+(p.amount_cents/100).toFixed(2)+'</td>'
      + '<td style="padding:6px 8px;text-align:right;font-size:12px;">$'+(p.actual_cents/100).toFixed(2)+'</td>'
      + '<td style="padding:6px 8px;text-align:right;font-size:12px;font-weight:600;">'+pct+'%</td>'
      + '<td style="padding:6px 8px;text-align:center;">'
      + '<button onclick="deletePvPledge('+personId+','+p.fiscal_year+')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;" title="Delete">&times;</button>'
      + '</td></tr>';
  }).join('');
  var thisYear = new Date().getFullYear();
  return '<div style="background:var(--linen);border-radius:8px;padding:14px;margin-bottom:16px;">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--slate-blue);margin-bottom:10px;">Pledges</div>'
    + (rows
      ? '<table style="width:100%;border-collapse:collapse;margin-bottom:10px;">'
        + '<thead><tr><th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Year</th>'
        + '<th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:600;">Pledged</th>'
        + '<th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:600;">Given</th>'
        + '<th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:600;">%</th>'
        + '<th style="padding:6px 8px;"></th></tr></thead><tbody>'+rows+'</tbody></table>'
      : '<div style="font-size:12px;color:var(--warm-gray);margin-bottom:10px;">No pledges recorded.</div>')
    + '<div style="display:grid;grid-template-columns:100px 140px auto;gap:8px;align-items:end;">'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Year</label><input type="number" id="pledge-year" value="'+thisYear+'" style="width:100%;box-sizing:border-box;"></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Pledge ($)</label><input type="number" id="pledge-amount" step="0.01" min="0" placeholder="0.00" style="width:100%;box-sizing:border-box;"></div>'
    + '<button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;height:fit-content;" onclick="submitPvPledge('+personId+')">Save Pledge</button>'
    + '</div>'
    + '</div>';
}
function submitPvPledge(personId) {
  var yearEl = document.getElementById('pledge-year');
  var amtEl = document.getElementById('pledge-amount');
  if (!yearEl || !amtEl) return;
  var year = parseInt(yearEl.value);
  var amount = parseFloat(amtEl.value);
  if (!year || !isFinite(amount) || amount < 0) { alert('Enter a year and a non-negative pledge amount.'); return; }
  api('/admin/api/people/'+personId+'/pledges', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ fiscal_year: year, amount_cents: Math.round(amount * 100) }),
  }).then(function(d) {
    if (d && d.error) { alert(d.error); return; }
    loadPvGiving(personId);
  }).catch(function() { alert('Could not save the pledge.'); });
}
function deletePvPledge(personId, year) {
  if (!confirm('Remove the '+year+' pledge?')) return;
  api('/admin/api/people/'+personId+'/pledges/'+year, { method: 'DELETE' }).then(function() {
    loadPvGiving(personId);
  }).catch(function() { alert('Could not remove the pledge.'); });
}
function renderPvGiving(filterYear) {
  var el = document.getElementById('ptab-giving');
  if (!el) return;
  var personId = _pvGivingPersonId;
  var allE = _pvGivingEntries;
  var entries = filterYear ? allE.filter(function(e){ return (e.contribution_date||'').startsWith(filterYear); }) : allE;
  var grandTotal = allE.reduce(function(s,e){return s+(e.amount||0);},0);
  var yearTotal  = entries.reduce(function(s,e){return s+(e.amount||0);},0);
  // Year list
  var years = {};
  allE.forEach(function(e){ var yr=(e.contribution_date||'').slice(0,4); if (yr) years[yr]=1; });
  var yearList = Object.keys(years).sort().reverse();
  var yearOpts = '<option value=""'+(filterYear===''?' selected':'')+'>All Years ($'+(grandTotal/100).toFixed(2)+')</option>'
    + yearList.map(function(y){
      var yt = allE.filter(function(e){return (e.contribution_date||'').startsWith(y);}).reduce(function(s,e){return s+(e.amount||0);},0);
      return '<option value="'+y+'"'+(y===filterYear?' selected':'')+'>'+y+' ($'+(yt/100).toFixed(2)+')</option>';
    }).join('');
  // Fund options for Add Gift form
  var activeFunds = allFunds.filter(function(f){return f.active;});
  if (!activeFunds.length) activeFunds = allFunds;
  var fundOpts = activeFunds.map(function(f){
    return '<option value="'+f.id+'">'+esc(f.name)+'</option>';
  }).join('');
  // Add Gift form
  var today = new Date().toISOString().slice(0,10);
  var addForm = '<div style="background:var(--linen);border-radius:8px;padding:14px;margin-bottom:16px;">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--slate-blue);margin-bottom:10px;">Add Gift</div>'
    + '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Date</label><input type="date" id="qg-date" value="'+today+'" style="width:100%;box-sizing:border-box;"></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Fund</label><select id="qg-fund" style="width:100%;box-sizing:border-box;">'+(fundOpts||'<option value="">No funds</option>')+'</select></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Amount ($)</label><input type="number" id="qg-amount" step="0.01" min="0.01" placeholder="0.00" style="width:100%;box-sizing:border-box;"></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Method</label><select id="qg-method" style="width:100%;box-sizing:border-box;"><option value="cash">Cash</option><option value="check" selected>Check</option><option value="card">Card</option><option value="ach">ACH</option><option value="other">Other</option></select></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Check #</label><input type="text" id="qg-check" placeholder="optional" style="width:100%;box-sizing:border-box;"></div>'
    + '<div class="field" style="margin:0;"><label style="font-size:11px;">Notes</label><input type="text" id="qg-notes" placeholder="optional" style="width:100%;box-sizing:border-box;"></div>'
    + '</div>'
    + '<button class="btn-primary" style="margin-top:10px;font-size:.8rem;padding:5px 16px;" onclick="submitQuickGift('+personId+')">Add Gift</button>'
    + '</div>';
  // Table rows
  var isFinUser = (_userRole === 'admin' || _userRole === 'finance');
  var rows = entries.length ? entries.map(function(e){
    var canDel = !e.batch_closed;
    var batchCell = isFinUser
      ? '<button onclick="event.stopPropagation();goToBatch('+e.batch_id+')" style="background:none;border:none;color:var(--sky-steel);cursor:pointer;font-size:12px;padding:0;font-weight:600;" title="'+esc(e.batch_description||'')+'">Batch '+e.batch_id+'</button>'
      : '<span style="font-size:12px;color:var(--warm-gray);">Batch '+e.batch_id+'</span>';
    return '<tr style="cursor:pointer;" onclick="openEditGiftModal('+e.id+',\''+filterYear+'\')">'
      + '<td style="padding:6px 8px;white-space:nowrap;font-size:12px;">'+(e.contribution_date||'—')+'</td>'
      + '<td style="padding:6px 8px;font-size:12px;">'+batchCell+'</td>'
      + '<td style="padding:6px 8px;font-size:12px;">'+esc(e.fund_name||'General')+'</td>'
      + '<td style="padding:6px 8px;text-align:right;white-space:nowrap;font-size:12px;font-weight:600;">$'+((e.amount||0)/100).toFixed(2)+'</td>'
      + '<td style="padding:6px 8px;font-size:12px;color:var(--warm-gray);">'+esc(e.method||'')+'</td>'
      + '<td style="padding:6px 8px;font-size:12px;color:var(--warm-gray);">'+esc((e.check_number||e.notes||''))+'</td>'
      + '<td style="padding:6px 8px;text-align:center;white-space:nowrap;">'
      + (canDel
          ? '<button onclick="event.stopPropagation();deleteGivingEntry('+e.id+',\''+filterYear+'\')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px;line-height:1;" title="Delete">&times;</button>'
          : '<span style="font-size:10px;color:var(--warm-gray);">closed</span>')
      + '</td>'
      + '</tr>';
  }).join('') : '<tr><td colspan="7" style="padding:16px;text-align:center;color:var(--warm-gray);font-size:13px;">No gifts'+(filterYear?' in '+filterYear:'')+'.</td></tr>';
  // Statement year for links
  var statYear = filterYear || new Date().getFullYear().toString();
  var toolbar = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">'
    + '<select style="font-size:.85rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border);" onchange="renderPvGiving(this.value)">'+yearOpts+'</select>'
    + '<a href="/admin/api/reports/giving-statement?person_id='+personId+'&year='+statYear+'&format=csv" target="_blank" class="btn-secondary" style="font-size:.8rem;padding:5px 12px;text-decoration:none;">&#8595; CSV</a>'
    + '<button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="sendGivingStatement('+personId+',\''+statYear+'\')">Email statement</button>'
    + '</div>';
  el.innerHTML = '<div style="padding:16px;">'
    + toolbar
    + renderPvPledgesCard(personId)
    + addForm
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--slate-blue);">Gifts'+(filterYear?' ('+filterYear+')':'')+'</div>'
    + '<div style="font-size:13px;font-weight:600;">$'+(yearTotal/100).toFixed(2)+'</div>'
    + '</div>'
    + '<div style="overflow-x:auto;">'
    + '<table style="width:100%;border-collapse:collapse;min-width:480px;">'
    + '<thead><tr style="background:var(--linen);">'
    + '<th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Date</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Batch</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Fund</th>'
    + '<th style="padding:6px 8px;text-align:right;font-size:11px;font-weight:600;">Amount</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Method</th>'
    + '<th style="padding:6px 8px;text-align:left;font-size:11px;font-weight:600;">Note / Check #</th>'
    + '<th style="padding:6px 8px;"></th>'
    + '</tr></thead>'
    + '<tbody>'+rows+'</tbody>'
    + '</table>'
    + '</div>'
    + '</div>';
}
function submitQuickGift(personId) {
  var dateEl   = document.getElementById('qg-date');
  var fundEl   = document.getElementById('qg-fund');
  var amtEl    = document.getElementById('qg-amount');
  var methodEl = document.getElementById('qg-method');
  var checkEl  = document.getElementById('qg-check');
  var notesEl  = document.getElementById('qg-notes');
  if (!dateEl || !fundEl || !amtEl) return;
  var date   = dateEl.value;
  var fundId = fundEl.value;
  var amount = parseFloat(amtEl.value);
  if (!date || !fundId || !amount || amount <= 0) { alert('Date, fund, and a positive amount are required.'); return; }
  api('/admin/api/giving/quick-entry', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      person_id:    personId,
      fund_id:      parseInt(fundId),
      amount:       amount,
      method:       methodEl ? methodEl.value : 'cash',
      date:         date,
      check_number: checkEl  ? checkEl.value.trim()  : '',
      notes:        notesEl  ? notesEl.value.trim()  : ''
    })
  }).then(function(r) {
    if (r && r.ok) {
      loadPvGiving(personId);
    } else {
      alert('Error: '+(r && r.error ? r.error : 'Could not save gift'));
    }
  }).catch(function(){ alert('Network error saving gift. Please try again.'); });
}
function deleteGivingEntry(entryId, filterYear) {
  if (!confirm('Delete this gift entry? This cannot be undone.')) return;
  api('/admin/api/giving/entries/'+entryId, {method:'DELETE'}).then(function(r) {
    if (r && r.ok) {
      _pvGivingEntries = _pvGivingEntries.filter(function(e){return e.id !== entryId;});
      renderPvGiving(filterYear);
      // Refresh aside total
      var ag = document.getElementById('pv-aside-giving');
      var curYear = new Date().getFullYear().toString();
      var ytdEntries = _pvGivingEntries.filter(function(e){ return (e.contribution_date||'').slice(0,4)===curYear; });
      var ytdTotal = ytdEntries.reduce(function(s,e){return s+(e.amount||0);},0);
      if (ag) ag.innerHTML = '<div class="pv-aside-lbl">'+curYear+' Giving</div>'
        + '<div class="pv-aside-big">$'+(ytdTotal/100).toFixed(2)+'</div>'
        + '<div class="pv-aside-sub">'+ytdEntries.length+' gift'+(ytdEntries.length!==1?'s':'')+'</div>';
    } else {
      alert('Error: '+(r && r.error ? r.error : 'Could not delete entry'));
    }
  }).catch(function(){ alert('Could not delete gift. Please try again.'); });
}
function sendGivingStatement(personId, year) {
  var p = _currentPvPerson;
  if (!p || !p.email) { alert('This person does not have an email address on file.'); return; }
  if (!confirm('Send '+year+' giving statement to '+p.email+'?')) return;
  api('/admin/api/reports/giving-statement?person_id='+personId+'&year='+year).then(function(d) {
    if (!d || !d.entries || !d.entries.length) { alert('No giving data found for '+year+'.'); return; }
    var name = ((p.first_name||'')+' '+(p.last_name||'')).trim() || 'Friend';
    var total = d.entries.reduce(function(s,e){return s+(e.amount||0);},0);
    var tRows = d.entries.map(function(e){
      return '<tr><td style="padding:5px 10px;border-bottom:1px solid var(--border);">'+(e.gift_date||'')+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid var(--border);">'+esc(e.fund_name||'')+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid var(--border);text-align:right;">$'+((e.amount||0)/100).toFixed(2)+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid var(--border);color:var(--muted);">'+esc(e.method||'')+'</td></tr>';
    }).join('');
    var htmlBody = '<html><body style="font-family:Georgia,serif;max-width:620px;margin:0 auto;padding:24px;color:#222;">'
      +'<h2 style="color:#0A3C5C;margin-bottom:4px;">'+esc(year)+' Giving Statement</h2>'
      +'<p style="color:var(--muted);font-size:13px;">Timothy Lutheran Church &bull; St. Louis, MO</p>'
      +'<p>Dear '+esc(name)+',</p>'
      +'<p>Thank you for your generous giving to Timothy Lutheran Church. Below is a summary of your contributions for '+esc(year)+':</p>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">'
      +'<thead><tr style="background:var(--info-bg);">'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th>'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Fund</th>'
      +'<th style="padding:8px 10px;text-align:right;font-weight:600;">Amount</th>'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Method</th>'
      +'</tr></thead>'
      +'<tbody>'+tRows+'</tbody>'
      +'<tfoot><tr style="font-weight:700;"><td colspan="2" style="padding:8px 10px;border-top:2px solid var(--border);">Total Contributions</td>'
      +'<td style="padding:8px 10px;border-top:2px solid var(--border);text-align:right;">$'+(total/100).toFixed(2)+'</td><td></td></tr></tfoot>'
      +'</table>'
      +'<p style="font-size:12px;color:var(--muted);">No goods or services were provided in exchange for these contributions. Please retain this statement for your tax records.</p>'
      +'</body></html>';
    api('/admin/api/giving/send-statement', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ to_email: p.email, to_name: name, subject: year+' Giving Statement \u2014 Timothy Lutheran Church', html_body: htmlBody })
    }).then(function(r){
      if (r && r.ok) alert('Statement sent to '+p.email+'.');
      else alert('Error sending statement: '+(r && r.error ? r.error : 'unknown error'));
    }).catch(function(){ alert('Network error. Please try again.'); });
  }).catch(function(){ alert('Could not load giving data. Please try again.'); });
}
function openEditGiftModal(entryId, filterYear) {
  var e = _pvGivingEntries.find(function(x){ return x.id === entryId; });
  if (!e) return;
  _editGiftId = entryId;
  _editGiftFilterYear = filterYear;
  var activeFunds = allFunds.filter(function(f){return f.active;});
  if (!activeFunds.length) activeFunds = allFunds;
  var fundOpts = activeFunds.map(function(f){
    return '<option value="'+f.id+'"'+(f.id===e.fund_id?' selected':'')+'>'+esc(f.name)+'</option>';
  }).join('');
  document.getElementById('egm-fund').innerHTML = fundOpts;
  document.getElementById('egm-date').value = e.contribution_date || '';
  document.getElementById('egm-amount').value = ((e.amount||0)/100).toFixed(2);
  document.getElementById('egm-method').value = e.method || 'check';
  document.getElementById('egm-check').value = e.check_number || '';
  document.getElementById('egm-notes').value = e.notes || '';
  var mTitle = document.querySelector('#edit-gift-modal h2');
  if (mTitle) mTitle.textContent = 'Edit Gift — Batch #' + e.batch_id + (e.batch_closed ? ' (closed)' : '');
  var saveBtn = document.querySelector('#edit-gift-modal .btn-primary');
  if (saveBtn) saveBtn.style.display = e.batch_closed ? 'none' : '';
  openModal('edit-gift-modal');
}
function saveEditGift() {
  if (!_editGiftId) return;
  var date   = document.getElementById('egm-date').value;
  var fundId = document.getElementById('egm-fund').value;
  var amount = parseFloat(document.getElementById('egm-amount').value);
  var method = document.getElementById('egm-method').value;
  var check  = document.getElementById('egm-check').value.trim();
  var notes  = document.getElementById('egm-notes').value.trim();
  if (!date || !fundId || !amount || amount <= 0) { alert('Date, fund, and a positive amount are required.'); return; }
  var saveBtn = document.querySelector('#edit-gift-modal .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  api('/admin/api/giving/entries/'+_editGiftId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ fund_id: parseInt(fundId), amount: amount, method: method, check_number: check, notes: notes, date: date })
  }).then(function(r) {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    if (r && r.ok) {
      closeModal('edit-gift-modal');
      loadPvGiving(_pvGivingPersonId);
    } else {
      alert('Error: '+(r && r.error ? r.error : 'Could not save gift'));
    }
  }).catch(function(){ if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; } alert('Network error. Please try again.'); });
}
function startInlineGiftEdit(id, filterYear) {
  _editGiftId = id;
  _editGiftFilterYear = filterYear;
  renderPvGiving(filterYear);
}
function cancelInlineGift(filterYear) {
  _editGiftId = null;
  renderPvGiving(filterYear);
}
function saveInlineGift(filterYear) {
  if (!_editGiftId) return;
  var dateEl = document.getElementById('ieg-date');
  var fundEl = document.getElementById('ieg-fund');
  var amtEl  = document.getElementById('ieg-amount');
  var mthEl  = document.getElementById('ieg-method');
  var chkEl  = document.getElementById('ieg-check');
  var ntEl   = document.getElementById('ieg-notes');
  if (!dateEl || !fundEl || !amtEl) return;
  var date   = dateEl.value;
  var fundId = fundEl.value;
  var amount = parseFloat(amtEl.value);
  var method = mthEl ? mthEl.value : 'other';
  var check  = chkEl ? chkEl.value.trim() : '';
  var notes  = ntEl  ? ntEl.value.trim()  : '';
  if (!date || !fundId || !amount || amount <= 0) { alert('Date, fund, and a positive amount are required.'); return; }
  var saveBtn = document.querySelector('button[onclick^="saveInlineGift"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving\u2026'; }
  api('/admin/api/giving/entries/'+_editGiftId, {
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ fund_id: parseInt(fundId), amount: amount, method: method, check_number: check, notes: notes, date: date })
  }).then(function(r) {
    if (r && r.ok) {
      _editGiftId = null;
      loadPvGiving(_pvGivingPersonId);
    } else {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      alert('Error: '+(r && r.error ? r.error : 'Could not save gift'));
    }
  }).catch(function() {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    alert('Network error. Please try again.');
  });
}
function togglePvQuickGift() {
  var box = document.getElementById('pv-quick-gift');
  var btn = document.getElementById('pv-gift-btn');
  if (!box) return;
  var open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  if (btn) btn.textContent = open ? '+ Add Gift' : '— Cancel';
  if (!open) {
    // Pre-fill today's date and populate funds
    var di = document.getElementById('pv-gift-date');
    if (di && !di.value) di.value = new Date().toISOString().slice(0,10);
    var fs = document.getElementById('pv-gift-fund');
    if (fs && !fs.options.length) {
      allFunds.forEach(function(f){ fs.appendChild(new Option(f.name, f.id)); });
    }
    document.getElementById('pv-gift-err').style.display = 'none';
  }
}
function togglePvCheckNum() {
  var m = document.getElementById('pv-gift-method');
  var r = document.getElementById('pv-gift-check-row');
  if (r) r.style.display = (m && m.value === 'check') ? '' : 'none';
}
function submitPvQuickGift() {
  if (!_currentPvPerson) return;
  var fund_id = document.getElementById('pv-gift-fund').value;
  var amount  = document.getElementById('pv-gift-amount').value;
  var date    = document.getElementById('pv-gift-date').value;
  var method  = document.getElementById('pv-gift-method').value;
  var check   = document.getElementById('pv-gift-check').value;
  var notes   = document.getElementById('pv-gift-notes').value;
  var errEl   = document.getElementById('pv-gift-err');
  if (!fund_id || !amount || !date) { errEl.textContent = 'Fund, amount, and date are required.'; errEl.style.display='block'; return; }
  api('/admin/api/giving/quick-entry', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ person_id: _currentPvPerson.id, fund_id, amount, date, method, check_number: check, notes })
  }).then(function(r) {
    if (r.error) { errEl.textContent = r.error; errEl.style.display='block'; return; }
    // Reset form
    document.getElementById('pv-gift-amount').value = '';
    document.getElementById('pv-gift-notes').value = '';
    document.getElementById('pv-gift-check').value = '';
    errEl.style.display='none';
    togglePvQuickGift();
    loadPvGiving(_currentPvPerson.id);
  }).catch(function(){ errEl.textContent = 'Error saving gift.'; errEl.style.display='block'; });
}
function openPersonEdit(p) {
  var isNew = !p || !p.id;
  document.getElementById('person-modal-title').textContent = isNew ? 'Add person' : p.first_name + ' ' + p.last_name;
  // New people get the short form (name, contact, member type, household); the rest is edited
  // section by section on the profile. An existing record still gets every field.
  var pmEl = document.getElementById('person-modal'); if (pmEl) pmEl.classList.toggle('pm-full', !isNew);
  var pmSave = document.getElementById('pm-save-btn'); if (pmSave) pmSave.textContent = isNew ? 'Add person' : 'Save';
  document.getElementById('pm-id').value = isNew ? '' : p.id;
  // Prefill from a partial object even when adding new (p.id absent) — e.g. converting a
  // website contact-form follow-up item into a real person. isNew still governs every OTHER
  // field below (address/dates/etc.), which no caller has ever passed in for a new person.
  document.getElementById('pm-first').value = (p && p.first_name) || '';
  document.getElementById('pm-last').value = (p && p.last_name) || '';
  document.getElementById('pm-middle').value = isNew ? '' : (p.middle_name||'');
  document.getElementById('pm-preferred').value = isNew ? '' : (p.preferred_name||'');
  document.getElementById('pm-email').value = (p && p.email) || '';
  document.getElementById('pm-phone').value = (p && p.phone) || '';
  document.getElementById('pm-sms-opt-in').checked = !isNew && !!p.sms_opt_in;
  document.getElementById('pm-addr1').value = isNew ? '' : (p.address1||'');
  var a2El = document.getElementById('pm-addr2'); if (a2El) a2El.value = isNew ? '' : (p.address2||'');
  document.getElementById('pm-city').value = isNew ? '' : (p.city||'');
  document.getElementById('pm-state').value = isNew ? 'MO' : (p.state||'MO');
  document.getElementById('pm-zip').value = isNew ? '' : (p.zip||'');
  // Populate member type select from current _memberTypes list (includes custom types)
  // Always include 'Organization' as the last option for org records.
  var pmType = document.getElementById('pm-type');
  var mtOptions = (_memberTypes || []).filter(function(t){ return t.toLowerCase() !== 'organization'; });
  pmType.innerHTML = mtOptions.map(function(t) {
    return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
  }).join('') + '<option value="Organization">Organization</option>';
  pmType.value = isNew ? 'Visitor' : (p.member_type || 'Visitor');
  // Fallback: if DB value isn't in the list (e.g. old lowercase), try case-insensitive match
  if (!pmType.value || pmType.value !== (isNew ? 'Visitor' : (p.member_type || 'Visitor'))) {
    var mt = isNew ? 'Visitor' : (p.member_type || '');
    var match = Array.from(pmType.options).find(function(o){ return o.value.toLowerCase() === mt.toLowerCase(); });
    if (match) pmType.value = match.value;
  }
  updatePersonNameMode();
  if (!isNew && (p.member_type||'').toLowerCase() === 'organization') document.getElementById('pm-org-name').value = p.first_name||'';
  document.getElementById('pm-role').value = isNew ? '' : (p.family_role||'');
  document.getElementById('pm-gender').value = isNew ? '' : (p.gender||'');
  document.getElementById('pm-marital').value = isNew ? '' : (p.marital_status||'');
  // A date picker can't render either partial-date sentinel, so a placeholder stands in
  // for the unknown part and the precision select records which part that is. pmReadDate
  // rebuilds the sentinel on save, so the placeholder is never stored.
  function loadPmDate(inputId, cbId, val) {
    document.getElementById(inputId).value = pmDateInputValue(val);
    var prec = document.getElementById(inputId + '-prec');
    if (prec) { prec.value = pmDatePrecision(val); pmDatePrecChanged(inputId); }
    var cb = document.getElementById(cbId);
    if (cb) cb.checked = pmDatePrecision(val) === 'monthday';
  }
  loadPmDate('pm-dob',     'pm-dob-noyear',     isNew ? '' : (p.dob||''));
  loadPmDate('pm-baptism', 'pm-baptism-noyear', isNew ? '' : (p.baptism_date||''));
  loadPmDate('pm-confirm', 'pm-confirm-noyear', isNew ? '' : (p.confirmation_date||''));
  loadPmDate('pm-anniv',   'pm-anniv-noyear',   isNew ? '' : (p.anniversary_date||''));
  // Sacramental yes/no lives beside the dates: a person can be baptized with no date on
  // file, and before this the modal had no way to say so at all.
  var bapSel = document.getElementById('pm-baptized');
  if (bapSel) bapSel.value = String(isNew ? 0 : (Number(p.baptized) === 1 ? 1 : Number(p.baptized) === 2 ? 2 : 0));
  var confSel = document.getElementById('pm-confirmed');
  if (confSel) confSel.value = String(isNew ? 0 : (Number(p.confirmed) === 1 ? 1 : Number(p.confirmed) === 2 ? 2 : 0));
  document.getElementById('pm-death').value = isNew ? '' : (p.death_date||'');
  document.getElementById('pm-deceased').checked = !isNew && !!p.deceased;
  var pubEl = document.getElementById('pm-public');
  if (pubEl) pubEl.checked = isNew ? true : (p.public_directory !== 0);
  var dirFieldsEl = document.getElementById('pm-dir-fields');
  if (dirFieldsEl) dirFieldsEl.style.opacity = (!isNew && p.public_directory === 0) ? '.4' : '1';
  var haEl = document.getElementById('pm-hide-addr');        if (haEl) haEl.checked = !isNew && !!p.dir_hide_address;
  var hpEl = document.getElementById('pm-hide-phone');       if (hpEl) hpEl.checked = !isNew && !!p.dir_hide_phone;
  var heEl = document.getElementById('pm-hide-email');       if (heEl) heEl.checked = !isNew && !!p.dir_hide_email;
  var hdEl = document.getElementById('pm-hide-dob');         if (hdEl) hdEl.checked = !isNew && !!p.dir_hide_dob;
  var hanEl = document.getElementById('pm-hide-anniversary'); if (hanEl) hanEl.checked = !isNew && !!p.dir_hide_anniversary;
  document.getElementById('pm-envelope').value = isNew ? '' : (p.envelope_number||'');
  var pmEnvHist = document.getElementById('pm-envelope-history');
  if (pmEnvHist) {
    var hist = [];
    if (!isNew && p.envelope_history) { try { var parsed = JSON.parse(p.envelope_history); if (Array.isArray(parsed)) hist = parsed; } catch (e) {} }
    pmEnvHist.innerHTML = hist.length ? 'Prior: ' + esc(hist.join(', ')) + ' <span style="color:var(--warm-meta);">(old envelopes still valid)</span>' : '';
  }
  document.getElementById('pm-last-seen').value = isNew ? '' : (p.last_seen_date||'');
  document.getElementById('pm-notes').value = isNew ? '' : (p.notes||'');
  var genderEl = document.getElementById('pm-gender'); if (genderEl) genderEl.value = isNew ? '' : (p.gender||'');
  var maritalEl = document.getElementById('pm-marital'); if (maritalEl) maritalEl.value = isNew ? '' : (p.marital_status||'');
  document.getElementById('pm-hh-search').value = isNew ? '' : (p.household_name||'');
  document.getElementById('pm-hh-id').value = isNew ? '' : (p.household_id||'');
  // Tag picker
  var sel = (p && p.tags) ? p.tags.map(function(t){return t.id;}) : [];
  document.getElementById('pm-tag-picker').innerHTML = allTags.map(function(t) {
    var on = sel.indexOf(t.id) >= 0;
    return '<span class="tag-chip" data-tid="' + t.id + '" onclick="toggleTagPick(this)" style="cursor:pointer;padding:4px 10px;'
      + (on ? 'background:' + t.color + '30;border-color:' + t.color + ';color:' + t.color + ';' : 'background:var(--linen);border-color:var(--border);color:var(--warm-gray);') + '">'
      + '<span class="tag-dot" style="background:' + esc(t.color) + '"></span>' + esc(t.name) + '</span>';
  }).join('');
  document.getElementById('pm-del-btn').style.display = isNew ? 'none' : 'inline-flex';
  openModal('person-modal');
}
function toggleTagPick(el) {
  var t = allTags.find(function(x){return x.id == el.dataset.tid;});
  if (!t) return;
  var on = el.style.background.indexOf('#') !== -1 || el.style.background.indexOf('rgb') !== -1;
  // Check by data attribute
  if (el.dataset.picked === '1') {
    el.dataset.picked = '';
    el.style.background = 'var(--linen)'; el.style.borderColor = 'var(--border)'; el.style.color = 'var(--warm-gray)';
  } else {
    el.dataset.picked = '1';
    el.style.background = t.color + '30'; el.style.borderColor = t.color; el.style.color = t.color;
  }
}
function getSelectedTagIds() {
  var ids = [];
  document.querySelectorAll('#pm-tag-picker .tag-chip').forEach(function(el) {
    if (el.dataset.picked === '1') ids.push(parseInt(el.dataset.tid));
  });
  return ids;
}
function updatePersonNameMode() {
  var isOrg = (document.getElementById('pm-type').value||'').toLowerCase() === 'organization';
  document.getElementById('pm-name-2col').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-name-1col').style.display = isOrg ? '' : 'none';
  document.getElementById('pm-name-2col-b').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-role-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-hh-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-dates-section').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-addr-hint').style.display = isOrg ? 'none' : '';
}
function savePerson() {
  var id = document.getElementById('pm-id').value;
  var isOrg = (document.getElementById('pm-type').value||'').toLowerCase() === 'organization';
  var first_name = isOrg ? document.getElementById('pm-org-name').value.trim()
                         : document.getElementById('pm-first').value.trim();
  var last_name  = isOrg ? '' : document.getElementById('pm-last').value.trim();
  var data = {
    first_name: first_name,
    last_name: last_name,
    middle_name: isOrg ? '' : document.getElementById('pm-middle').value.trim(),
    // Don't store a preferred name that just repeats the first name.
    preferred_name: (function(){
      if (isOrg) return '';
      var pref = document.getElementById('pm-preferred').value.trim();
      return pref.toLowerCase() === first_name.toLowerCase() ? '' : pref;
    })(),
    email: document.getElementById('pm-email').value.trim(),
    phone: document.getElementById('pm-phone').value.trim(),
    address1: document.getElementById('pm-addr1').value.trim(),
    address2: (document.getElementById('pm-addr2') || {value:''}).value.trim(),
    city: document.getElementById('pm-city').value.trim(),
    state: document.getElementById('pm-state').value.trim(),
    zip: document.getElementById('pm-zip').value.trim(),
    member_type: document.getElementById('pm-type').value,
    family_role: document.getElementById('pm-role').value,
    gender: document.getElementById('pm-gender').value,
    marital_status: document.getElementById('pm-marital').value,
    household_id: document.getElementById('pm-hh-id').value || null,
    dob:               pmReadDate('pm-dob',     'pm-dob-noyear'),
    baptism_date:      pmReadDate('pm-baptism', 'pm-baptism-noyear'),
    confirmation_date: pmReadDate('pm-confirm', 'pm-confirm-noyear'),
    anniversary_date:  pmReadDate('pm-anniv',   'pm-anniv-noyear'),
    // A date on file already asserts the sacrament happened, so entering one and leaving
    // the answer on "Not recorded" resolves to Yes. An explicit No is never overridden —
    // that combination is contradictory and the human's answer wins.
    baptized:  (pmReadSacrament('pm-baptized')  === 0 && pmReadDate('pm-baptism', 'pm-baptism-noyear')) ? 1 : pmReadSacrament('pm-baptized'),
    confirmed: (pmReadSacrament('pm-confirmed') === 0 && pmReadDate('pm-confirm', 'pm-confirm-noyear')) ? 1 : pmReadSacrament('pm-confirmed'),
    death_date: document.getElementById('pm-death').value,
    deceased: document.getElementById('pm-deceased').checked ? 1 : 0,
    public_directory: (document.getElementById('pm-public') || {checked:true}).checked ? 1 : 0,
    dir_hide_address:     document.getElementById('pm-hide-addr')        ? (document.getElementById('pm-hide-addr').checked        ? 1 : 0) : 0,
    dir_hide_phone:       document.getElementById('pm-hide-phone')       ? (document.getElementById('pm-hide-phone').checked       ? 1 : 0) : 0,
    dir_hide_email:       document.getElementById('pm-hide-email')       ? (document.getElementById('pm-hide-email').checked       ? 1 : 0) : 0,
    dir_hide_dob:         document.getElementById('pm-hide-dob')         ? (document.getElementById('pm-hide-dob').checked         ? 1 : 0) : 0,
    dir_hide_anniversary: document.getElementById('pm-hide-anniversary') ? (document.getElementById('pm-hide-anniversary').checked ? 1 : 0) : 0,
    envelope_number: document.getElementById('pm-envelope').value.trim(),
    last_seen_date: document.getElementById('pm-last-seen').value,
    notes: document.getElementById('pm-notes').value,
    sms_opt_in: document.getElementById('pm-sms-opt-in').checked ? 1 : 0,
    tag_ids: getSelectedTagIds()
  };
  if (!data.first_name || (!isOrg && !data.last_name)) { alert(isOrg ? 'Name is required.' : 'First and last name are required.'); return; }
  var saveBtn = document.getElementById('pm-save-btn');
  var saveLabel = saveBtn ? saveBtn.textContent : 'Save';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.setAttribute('aria-busy', 'true'); saveBtn.textContent = 'Saving…'; }
  function reEnablePersonSave() { if (saveBtn) { saveBtn.disabled = false; saveBtn.removeAttribute('aria-busy'); saveBtn.textContent = saveLabel; } }
  var url = id ? '/admin/api/people/' + id : '/admin/api/people';
  var meth = id ? 'PUT' : 'POST';
  api(url, {method:meth, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(r) {
    if (r.ok) {
      reEnablePersonSave();
      closeModal('person-modal');
      // A new person lands on their profile, where every other section is filled in (OS3).
      var pvId = !id ? r.id : (_currentPvPerson ? (_currentPvPerson.id || r.id) : null);
      if (pvId) openPersonDetail(pvId);
      loadPeople();
    } else { reEnablePersonSave(); alert('Error saving: ' + (r.error||'unknown')); }
  }).catch(function() { reEnablePersonSave(); alert('Error saving. Please try again.'); });
}
function deletePerson() {
  var id = document.getElementById('pm-id').value;
  if (!id) return;
  if (!confirm('Mark this person as inactive? They will be hidden from the people list.')) return;
  api('/admin/api/people/' + id, {method:'DELETE'})
    .then(function() { closeModal('person-modal'); loadPeople(); })
    .catch(function(e) { alert('Delete failed: ' + (e && e.message ? e.message : 'Server error. Please try again.')); });
}
function sendConnectInvite(id) {
  api('/admin/api/people/' + id + '/invite', {method:'POST'}).then(function(r) {
    if (r && r.ok) alert('Invite sent to ' + (r.email || 'their email address') + '. The link expires in 7 days.');
    else alert('Error: ' + ((r && r.error) || 'Could not send invite. Check that this person has an email address.'));
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function archivePerson(id) {
  if (!confirm('Archive this person? They will be hidden from the active list but their records and giving history are preserved.')) return;
  api('/admin/api/people/' + id + '/archive', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function unarchivePerson(id) {
  if (!confirm('Reactivate this person and return them to the active people list?')) return;
  api('/admin/api/people/' + id + '/unarchive', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}
function markPersonDeceased(id) {
  if (!confirm('Mark this person as deceased? Today will be set as their death date. They will be archived, removed from anniversary cards, and their giving history is preserved.')) return;
  api('/admin/api/people/' + id + '/deceased', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}

// ── PHONE FORMATTING ──────────────────────────────────────────────────────
function formatPhoneOnBlur(el) {
  var digits = (el.value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') {
    el.value = '(' + digits.slice(1,4) + ') ' + digits.slice(4,7) + '-' + digits.slice(7);
  } else if (digits.length === 10) {
    el.value = '(' + digits.slice(0,3) + ') ' + digits.slice(3,6) + '-' + digits.slice(6);
  }
}

// ── USPS ADDRESS VALIDATION ───────────────────────────────────────────────
// r.source is 'census' when no USPS/Lob key is configured and the server fell back to the
// free Census geocoder (BUG2) — label results accordingly so a Census-sourced non-match
// doesn't misleadingly read as "not found by USPS" when USPS was never actually queried.
function validateAddrResultMsg(r) {
  var dpv = r.dpvConfirmation;
  var isCensus = r.source === 'census';
  var note = isCensus ? ' (via Census geocoder — no USPS/Lob key configured; ask an admin to add one for confirmed deliverability)' : '';
  if (dpv === 'Y') return '<span class="os-badge os-badge-success">Deliverable</span> <span>Confirmed deliverable' + note + '</span>';
  if (dpv === 'S') return '<span class="os-badge os-badge-warning">Needs review</span> <span>Street confirmed; add the apartment or suite' + note + '</span>';
  if (dpv === 'D') return '<span class="os-badge os-badge-warning">Needs review</span> <span>Street confirmed; the apartment or suite did not match' + note + '</span>';
  return isCensus
    ? '<span class="os-badge os-badge-neutral">Not matched</span> <span>The Census geocoder did not match this address' + note + '</span>'
    : '<span class="os-badge os-badge-neutral">Not found</span> <span>USPS did not find this address</span>';
}
function validatePersonAddress() {
  var btn = document.getElementById('pm-addr-validate-btn');
  var status = document.getElementById('pm-addr-validate-status');
  var street = (document.getElementById('pm-addr1').value || '').trim();
  if (!street) { if (status) status.innerHTML = '<span style="color:var(--danger);">Enter a street address first.</span>'; return; }
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Validating…';
  api('/admin/api/utils/validate-address', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      address1: street,
      address2: (document.getElementById('pm-addr2') || {value:''}).value.trim(),
      city: (document.getElementById('pm-city').value || '').trim(),
      state: (document.getElementById('pm-state').value || '').trim(),
      zip: (document.getElementById('pm-zip').value || '').trim()
    })
  }).then(function(r) {
    if (btn) btn.disabled = false;
    if (!r.ok) {
      if (status) status.innerHTML = '<span style="color:var(--danger);">' + esc(r.error || 'Validation failed') + '</span>';
      return;
    }
    document.getElementById('pm-addr1').value = r.address1;
    var a2v = document.getElementById('pm-addr2'); if (a2v) a2v.value = r.address2 || '';
    document.getElementById('pm-city').value  = r.city;
    document.getElementById('pm-state').value = r.state;
    document.getElementById('pm-zip').value   = r.zip + (r.zip4 ? '-' + r.zip4 : '');
    if (status) status.innerHTML = validateAddrResultMsg(r);
  }).catch(function(err) {
    if (btn) btn.disabled = false;
    var msg = err && err.message ? err.message : 'Request failed';
    if (status) status.innerHTML = '<span style="color:var(--danger);">' + esc(msg) + ' — try again, or ask the admin to configure USPS API keys.</span>';
  });
}

// Validate address in the inline profile contact editor (pec-* fields)
function validateContactAddress() {
  var btn = document.querySelector('#pv-contact-section button[onclick="validateContactAddress()"]');
  var status = document.getElementById('pec-addr-validate-status');
  var street = (document.getElementById('pec-addr1').value || '').trim();
  if (!street) { if (status) status.innerHTML = '<span style="color:var(--danger);">Enter a street address first.</span>'; return; }
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Validating…';
  api('/admin/api/utils/validate-address', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      address1: street,
      address2: (document.getElementById('pec-addr2') || {value:''}).value.trim(),
      city:  (document.getElementById('pec-city').value  || '').trim(),
      state: (document.getElementById('pec-state').value || '').trim(),
      zip:   (document.getElementById('pec-zip').value   || '').trim()
    })
  }).then(function(r) {
    if (btn) btn.disabled = false;
    if (!r.ok) {
      if (status) status.innerHTML = '<span style="color:var(--danger);">' + esc(r.error || 'Validation failed') + '</span>';
      return;
    }
    document.getElementById('pec-addr1').value = r.address1;
    var pec2 = document.getElementById('pec-addr2'); if (pec2) pec2.value = r.address2 || '';
    document.getElementById('pec-city').value  = r.city;
    document.getElementById('pec-state').value = r.state;
    document.getElementById('pec-zip').value   = r.zip + (r.zip4 ? '-' + r.zip4 : '');
    if (status) status.innerHTML = validateAddrResultMsg(r);
  }).catch(function(err) {
    if (btn) btn.disabled = false;
    var msg = err && err.message ? err.message : 'Request failed';
    if (status) status.innerHTML = '<span style="color:var(--danger);">' + esc(msg) + ' — try again, or ask the admin to configure USPS API keys.</span>';
  });
}

// ── CREATE HOUSEHOLD FROM PROFILE ─────────────────────────────────────────
function createHouseholdForPerson(personId, lastName) {
  var hhName = (lastName || '').trim();
  hhName = hhName ? hhName + ' Family' : 'New Household';
  api('/admin/api/households', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name: hhName, state: 'MO' })
  }).then(function(r) {
    if (!r.ok || !r.id) { alert('Error creating household: ' + (r.error || 'unknown')); return; }
    var hhId = r.id;
    api('/admin/api/people/' + personId).then(function(p) {
      if (!p || !p.id) return;
      var tagIds = (p.tags || []).map(function(t){ return t.id; });
      api('/admin/api/people/' + personId, {
        method: 'PUT',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(Object.assign({}, p, { household_id: hhId, family_role: p.family_role || 'head', tag_ids: tagIds }))
      }).then(function(r2) {
        if (r2.ok) {
          api('/admin/api/people/' + personId).then(function(p2) { if (p2 && p2.id) showProfile(p2); });
        } else alert('Error linking to household: ' + (r2.error || 'unknown'));
      }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
    });
  }).catch(function(err) { if (err.message !== 'Unauthorized') alert('Error: ' + err.message); });
}

// ── MAP EMBED (Google Static Maps, proxied server-side so GOOGLE_ADDRESS_API_KEY never reaches the browser) ──
function togglePersonMap(personId) {
  var el  = document.getElementById('pv-map-' + personId);
  var btn = document.getElementById('pv-map-btn-' + personId);
  if (!el) return;
  if (el.style.display === 'none') {
    el.style.display = '';
    if (btn) btn.textContent = 'Hide map';
    if (el.dataset.loaded) return;
    // Members get the maps link rather than the paid embedded map — see loadQuickViewMap.
    if (_userRole === 'member') {
      el.innerHTML = '<div style="padding:8px;">' + openInMapsHtml(el.dataset.addr) + '</div>';
      el.dataset.loaded = '1';
      return;
    }
    var addr = decodeURIComponent(el.dataset.addr);
    var img = new Image();
    img.onload = function() {
      el.innerHTML = '';
      img.style.cssText = 'width:100%;height:auto;display:block;';
      el.appendChild(img);
      el.dataset.loaded = '1';
    };
    img.onerror = function() {
      showMapError(el, el.dataset.addr);
    };
    el.innerHTML = '<div style="padding:8px;font-size:14px;color:var(--muted);">Loading map…</div>';
    img.src = '/admin/api/utils/static-map?address=' + encodeURIComponent(addr);
  } else {
    el.style.display = 'none';
    if (btn) btn.textContent = 'Show map';
  }
}

`;
