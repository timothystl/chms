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
    renderPeopleCards(people);
    renderPeopleMobile(people);
    renderPeoplePager();
    updateFdCount();
    renderActiveFilterChips();
    updateFilterBadge();
    if (_peopleViewMode === 'household') loadPeopleHouseholdView(resetPage);
  }).catch(function() {
    if (mySeq !== _pLoadSeq) return;
    _peopleTotal = 0;
    renderPeopleDesktop([]);
    renderPeopleCards([]);
    renderPeopleMobile([]);
    renderPeoplePager();
    setStatus('p-status','Error loading people.','err');
  });
}
function renderPeoplePager() {
  var el = document.getElementById('p-pager');
  if (!el) return;
  var total = _peopleTotal, limit = peopleFilter.limit, offset = peopleFilter.offset;
  var from = offset + 1, to = Math.min(offset + limit, total);
  var countHtml = '<span style="font-size:12px;color:var(--warm-gray);">Showing ' + from + '–' + to + ' of ' + total + ' people</span>';
  var prevDisabled = offset === 0 ? ' disabled' : '';
  var nextDisabled = to >= total ? ' disabled' : '';
  var navHtml = total <= limit ? '' :
    '<div style="display:flex;gap:6px;">'
    + '<button class="btn-secondary" style="padding:5px 12px;font-size:12px;"' + prevDisabled + ' onclick="peoplePage(-1)">&#8592; Prev</button>'
    + '<button class="btn-secondary" style="padding:5px 12px;font-size:12px;"' + nextDisabled + ' onclick="peoplePage(1)">Next &#8594;</button>'
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
  if (btn) { btn.style.background = _archiveView ? 'var(--teal)' : ''; btn.style.color = _archiveView ? '#fff' : ''; }
  loadPeople(true);
}
function renderPeopleDesktop(people) {
  _loadedPeople = people;
  var c = document.getElementById('p-grid');
  if (!people.length) { c.innerHTML = '<div class="empty" style="padding:40px 24px;"><div class="empty-icon">&#128100;</div>' + (_archiveView ? 'No archived people found' : 'No people found') + '</div>'; return; }
  var isOrg, isSelected, displayName, avInner, avClass, clickHandler, trCls;
  var rows = people.map(function(p) {
    isOrg = (p.member_type||'').toLowerCase() === 'organization';
    isSelected = _selectedPeople.has(p.id);
    displayName = isOrg
      ? esc(p.first_name || p.last_name)
      : esc(p.last_name) + (p.last_name && p.first_name ? ', ' : '') + esc(p.first_name);
    avInner = isOrg
      ? '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:var(--warm-gray);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>'
      : (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" style="width:38px;height:38px;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name));
    avClass = 'dir-avatar ' + (isOrg ? 'dir-avatar-org' : 'dir-avatar-' + (p.id % 5));
    clickHandler = _selectMode
      ? 'onclick="togglePersonSelect(' + p.id + ', this)"'
      : 'onclick="openPersonQuickView(' + p.id + ')"';
    var rowClsList = [];
    if (isSelected) rowClsList.push('dir-row-selected');
    if (p.id === _qvPersonId) rowClsList.push('dir-row-qv');
    trCls = rowClsList.length ? ' class="' + rowClsList.join(' ') + '"' : '';
    var statusPill = '';
    if (p.status === 'archived') statusPill = ' <span style="font-size:.68rem;padding:1px 6px;border-radius:99px;background:#8b735522;color:#8b7355;border:1px solid #8b735544;vertical-align:middle;">archived</span>';
    else if (p.status === 'deceased') statusPill = ' <span style="font-size:.68rem;padding:1px 6px;border-radius:99px;background:#6c757d22;color:#6c757d;border:1px solid #6c757d44;vertical-align:middle;">&#x271D; deceased</span>';
    var contactHtml = (p.phone ? '<div class="dir-phone-main"><a href="tel:' + esc(p.phone.replace(/\D/g,'')) + '" onclick="event.stopPropagation()">' + esc(p.phone) + '</a></div>' : '')
      + (p.email ? '<div class="dir-email-sub"><a href="mailto:' + esc(p.email) + '" onclick="event.stopPropagation()">' + esc(p.email) + '</a></div>' : '');
    if (!contactHtml) contactHtml = '<span style="color:var(--faint);">—</span>';
    return '<tr' + trCls + ' style="cursor:pointer;" ' + clickHandler + ' ondblclick="openPersonDetail(' + p.id + ')">'
      + '<td style="width:36px;text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" name="person-select"' + (isSelected ? ' checked' : '') + ' style="' + (_selectMode ? '' : 'display:none;') + '" onchange="togglePersonSelect(' + p.id + ',this.closest(&#39;tr&#39;))" onclick="event.stopPropagation()"></td>'
      + '<td><div class="dir-name-cell"><div class="' + avClass + '">' + avInner + '</div><span class="dir-name-link">' + displayName + '</span>' + statusPill + '</div></td>'
      + '<td>' + typeDotHtml(p.member_type) + '</td>'
      + '<td class="dir-contact">' + contactHtml + '</td>'
      + '</tr>';
  }).join('');
  var cbAll = '<input type="checkbox" id="p-check-all" style="' + (_selectMode ? '' : 'display:none;') + '" onchange="selectAllVisible(this.checked)">';
  function sortTh(label, col) {
    var active = peopleFilter.sort === col;
    var arrow = active ? (peopleFilter.dir === 'asc' ? ' &#9650;' : ' &#9660;') : ' <span style="opacity:.3;">&#9650;</span>';
    return '<th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="sortPeople(\'' + col + '\')">' + label + arrow + '</th>';
  }
  c.innerHTML = '<table class="dir-table"><thead><tr>'
    + '<th>' + cbAll + '</th>'
    + sortTh('Name','last_name') + sortTh('Type','member_type') + '<th>Contact</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
}
// Card view (2b) — same data/interactions as the table, denser visual scan.
function renderPeopleCards(people) {
  var c = document.getElementById('p-card-grid');
  if (!c) return;
  if (!people.length) { c.innerHTML = '<div class="empty" style="padding:40px 24px;"><div class="empty-icon">&#128100;</div>' + (_archiveView ? 'No archived people found' : 'No people found') + '</div>'; return; }
  c.innerHTML = '<div class="ppl-card-grid">' + people.map(function(p) {
    var isOrg = (p.member_type||'').toLowerCase() === 'organization';
    var isSelected = _selectedPeople.has(p.id);
    var displayName = isOrg
      ? esc(p.first_name || p.last_name)
      : esc(p.first_name) + (p.first_name && p.last_name ? ' ' : '') + esc(p.last_name);
    var avClass = 'dir-avatar ' + (isOrg ? 'dir-avatar-org' : 'dir-avatar-' + (p.id % 5));
    var avInner = isOrg
      ? '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:var(--warm-gray);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>'
      : (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" style="width:42px;height:42px;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name));
    var clickHandler = _selectMode ? 'togglePersonSelect(' + p.id + ', this)' : 'openPersonQuickView(' + p.id + ')';
    var cb = _selectMode ? '<div class="ppl-card-cb">' + (isSelected ? '&#10003;' : '') + '</div>' : '';
    var cardCls = 'ppl-card' + (isSelected ? ' selected' : '') + (p.id === _qvPersonId ? ' qv-active' : '');
    return '<div class="' + cardCls + '" style="border-left-color:' + typeColor(p.member_type) + ';" onclick="' + clickHandler + '" ondblclick="openPersonDetail(' + p.id + ')">'
      + cb
      + '<div class="ppl-card-top"><div class="' + avClass + '" style="width:42px;height:42px;">' + avInner + '</div>'
      + '<div style="min-width:0;"><div class="ppl-card-name">' + displayName + '</div><div>' + typeDotHtml(p.member_type, 7) + '</div></div></div>'
      + (p.phone ? '<div class="ppl-card-phone">' + esc(p.phone) + '</div>' : '')
      + (p.email ? '<div class="ppl-card-email">' + esc(p.email) + '</div>' : '')
      + '</div>';
  }).join('') + '</div>';
}
// ── Household view (RDS2b) — reuses the Households tab's card rendering
// (renderHouseholds) and API, filtered by the People tab's own search box
// and Members/All toggle. Paginated separately from List/Card since it's a
// different dataset (households, not people).
var _pHhOffset = 0, _pHhTotal = 0;
function loadPeopleHouseholdView(resetPage) {
  if (resetPage) _pHhOffset = 0;
  var q = peopleFilter.q || '';
  var mtParam = peopleFilter.mt === 'member' ? '&member_type=member' : '';
  api('/admin/api/households?q=' + encodeURIComponent(q) + '&sort=name&limit=24&offset=' + _pHhOffset + mtParam).then(function(d) {
    _pHhTotal = d.total || 0;
    renderHouseholds(d.households || [], 'p-hh-grid');
    renderPeopleHouseholdPager();
  }).catch(function() {
    var c = document.getElementById('p-hh-grid');
    if (c) c.innerHTML = '<div class="empty"><div class="empty-icon">&#127968;</div>Error loading households.</div>';
  });
}
function renderPeopleHouseholdPager() {
  var el = document.getElementById('p-hh-pager');
  if (!el) return;
  var limit = 24, offset = _pHhOffset, total = _pHhTotal;
  if (total <= limit) { el.innerHTML = '<span style="color:var(--warm-gray);font-size:.82rem;">' + total + ' household' + (total !== 1 ? 's' : '') + '</span>'; return; }
  var from = offset + 1, to = Math.min(offset + limit, total);
  el.innerHTML = '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="peopleHhPage(-1)" ' + (offset===0?'disabled':'') + '>&#8592; Prev</button>'
    + '<span style="font-size:.82rem;color:var(--warm-gray);margin:0 10px;">' + from + '–' + to + ' of ' + total + '</span>'
    + '<button class="btn-secondary" style="padding:4px 10px;font-size:.8rem;" onclick="peopleHhPage(1)" ' + (to>=total?'disabled':'') + '>Next &#8594;</button>';
}
function peopleHhPage(dir) {
  _pHhOffset = Math.max(0, _pHhOffset + dir * 24);
  loadPeopleHouseholdView();
}
// List/Card/Household toggle — persists the user's choice. List/Card re-render the
// already-loaded person dataset (no refetch); Household fetches its own dataset.
var _peopleViewMode = 'list';
function initPeopleViewMode() {
  try { _peopleViewMode = localStorage.getItem('peopleViewMode') || 'list'; } catch (e) {}
  applyPeopleViewMode();
}
function setPeopleViewMode(mode) {
  _peopleViewMode = mode;
  try { localStorage.setItem('peopleViewMode', mode); } catch (e) {}
  applyPeopleViewMode();
}
function applyPeopleViewMode() {
  var listBtn = document.getElementById('p-view-list-btn');
  var cardBtn = document.getElementById('p-view-card-btn');
  var hhBtn = document.getElementById('p-view-household-btn');
  var grid = document.getElementById('p-grid');
  var cardGrid = document.getElementById('p-card-grid');
  var hhView = document.getElementById('p-hh-view');
  var pager = document.getElementById('p-pager');
  var quickview = document.getElementById('ppl-quickview');
  var isCard = _peopleViewMode === 'card';
  var isHousehold = _peopleViewMode === 'household';
  if (listBtn) listBtn.classList.toggle('active', !isCard && !isHousehold);
  if (cardBtn) cardBtn.classList.toggle('active', isCard);
  if (hhBtn) hhBtn.classList.toggle('active', isHousehold);
  if (grid) grid.style.display = (isCard || isHousehold) ? 'none' : 'block';
  if (cardGrid) cardGrid.style.display = isCard ? 'block' : 'none';
  if (hhView) hhView.style.display = isHousehold ? 'flex' : 'none';
  if (pager) pager.style.display = isHousehold ? 'none' : 'flex';
  if (quickview) quickview.style.display = isHousehold ? 'none' : 'flex';
  if (isHousehold) loadPeopleHouseholdView(true);
}
// ── Quick-view panel (RDS2 master-detail) — right-side preview shown on
// row/card click instead of navigating straight to the full Person Profile.
// "Full Profile" inside the panel still calls the existing openPersonDetail().
var _qvPersonId = null;
var _QV_EMPTY_HTML = '<div class="ppl-qv-empty">'
  + '<svg viewBox="0 0 24 24" style="width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35;"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>'
  + '<div>Select a person to view details</div></div>';
function openPersonQuickView(id) {
  _qvPersonId = id;
  renderPeopleDesktop(_loadedPeople || []);
  renderPeopleCards(_loadedPeople || []);
  var el = document.getElementById('ppl-quickview');
  if (!el) return;
  el.innerHTML = '<div class="ppl-qv-empty">Loading&#8230;</div>';
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
  var tint = avatarTint(p.id);
  var avInner = p.photo_url
    ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">'
    : initials(p.first_name, p.last_name);
  var hhLabel = p.household_display_name || p.household_name || 'Household';
  var hhLink = p.household_id ? ' &middot; <a onclick="openHouseholdDetail(' + p.household_id + ')">' + esc(hhLabel) + '</a>' : '';
  var contactRows = '';
  if (p.phone) contactRows += '<div class="ppl-qv-row"><a href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '">' + esc(p.phone) + '</a></div>';
  if (p.email) contactRows += '<div class="ppl-qv-row"><a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a></div>';
  if (!contactRows) contactRows = '<div class="ppl-qv-row" style="color:var(--faint);">No contact info on file</div>';
  // Location: same address parts + static-map proxy as the full profile. Only rendered when
  // there's a usable address and the viewer can load the map (member role can't hit the proxy).
  var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
  var mapEnc = (addrParts.length >= 2 && _userRole !== 'member') ? encodeURIComponent(addrParts.join(', ')) : '';
  var locSection = '';
  if (mapEnc) {
    locSection = '<div class="ppl-qv-section"><div class="ppl-qv-section-lbl">Location</div>'
      + '<div class="ppl-qv-row" style="margin-bottom:8px;"><a href="https://maps.google.com/?q=' + mapEnc + '" target="_blank" rel="noopener">' + esc(addrParts.join(', ')) + '</a></div>'
      + '<div id="ppl-qv-map" class="ppl-qv-map"><div style="padding:8px;font-size:12px;color:var(--warm-gray);">Loading map&#8230;</div></div></div>';
  }
  el.innerHTML = '<div class="ppl-qv-avatar" style="background:' + tint.bg + ';color:' + tint.fg + ';">' + avInner + '</div>'
    + '<div class="ppl-qv-name">' + name + '</div>'
    + '<div class="ppl-qv-meta">' + typeDotHtml(p.member_type) + hhLink + '</div>'
    + '<div class="ppl-qv-actions">'
    + (p.phone ? '<a href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '" style="background:var(--color-teal);color:var(--white);">Call</a>' : '<span style="background:var(--linen);color:var(--faint);cursor:default;">Call</span>')
    + '<div onclick="openPersonDetail(' + p.id + ')" style="background:var(--linen);color:var(--color-navy);">Full Profile</div>'
    + '</div>'
    + '<div class="ppl-qv-section"><div class="ppl-qv-section-lbl">Contact</div>' + contactRows + '</div>'
    + locSection
    + (p.household_id ? '<div class="ppl-qv-section"><div class="ppl-qv-section-lbl">Household</div><div class="ppl-qv-hh-names" id="ppl-qv-hh-chips">Loading&#8230;</div></div>' : '');
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
      return '<div class="ppl-qv-hh-name' + (isSelf ? ' is-self' : '') + '" onclick="openPersonQuickView(' + m.id + ')">' + esc(mName || 'Unnamed') + '</div>';
    }).join('') || '<span style="color:var(--faint);font-size:12px;">No other members</span>';
  }).catch(function() {});
}
// ── MULTI-SELECT ──────────────────────────────────────────────────────
function toggleSelectMode() {
  _selectMode = !_selectMode;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.innerHTML = _selectMode ? '&#10005; Cancel Select' : '&#9745; Select';
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = _selectMode ? 'flex' : 'none';
  if (_selectMode) {
    _qvPersonId = null;
    var qvEl = document.getElementById('ppl-quickview');
    if (qvEl) qvEl.innerHTML = _QV_EMPTY_HTML;
    // Populate member type dropdown
    var sel = document.getElementById('p-bulk-mt');
    if (sel) {
      sel.innerHTML = '<option value="">Change Member Type…</option>'
        + _memberTypes.map(function(t) {
          var v = t.toLowerCase().replace(/\s+/g,'-');
          return '<option value="' + v + '">' + esc(t) + '</option>';
        }).join('');
    }
    // Populate tags
    renderBulkTagsPanel();
  }
  renderPeopleDesktop(_loadedPeople || []);
  renderPeopleCards(_loadedPeople || []);
}
var _loadedPeople = [];
function clearSelection() {
  _selectMode = false;
  _selectedPeople.clear();
  var btn = document.getElementById('p-select-btn');
  if (btn) btn.innerHTML = '&#9745; Select';
  var bar = document.getElementById('p-bulk-bar');
  if (bar) bar.style.display = 'none';
  var panel = document.getElementById('p-bulk-tags-panel');
  if (panel) panel.style.display = 'none';
  renderPeopleDesktop(_loadedPeople || []);
  renderPeopleCards(_loadedPeople || []);
}
function togglePersonSelect(id, el) {
  if (_selectedPeople.has(id)) _selectedPeople.delete(id); else _selectedPeople.add(id);
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
  // Full re-render keeps table row + card checkmark state in sync (lists are page-sized, cheap to redraw).
  renderPeopleDesktop(_loadedPeople || []);
  renderPeopleCards(_loadedPeople || []);
}
function selectAllVisible(checked) {
  (_loadedPeople || []).forEach(function(p) {
    if (checked) _selectedPeople.add(p.id); else _selectedPeople.delete(p.id);
  });
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
  renderPeopleDesktop(_loadedPeople || []);
  renderPeopleCards(_loadedPeople || []);
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
  if (!people.length) { c.innerHTML = '<div class="empty"><div class="empty-icon">&#128100;</div>' + (_archiveView ? 'No archived people found' : 'No people found') + '</div>'; return; }
  c.innerHTML = people.map(function(p) {
    var isOrg = (p.member_type||'').toLowerCase() === 'organization';
    var addr = [p.address1, p.city, p.state].filter(Boolean).join(', ');
    if (!addr && p.household_address) addr = p.household_address;
    var url = mapUrl(addr);
    var tint = avatarTint(p.id);
    var avInner = p.photo_url
      ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">'
      : initials(p.first_name, p.last_name);
    var actions = '<div class="c-actions">'
      + (p.phone ? '<a href="tel:' + esc(p.phone.replace(/\D/g,'')) + '" class="c-btn c-btn-call" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.37 1.18 2 2 0 012.34 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.28-.78a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>Call</a>' : '')
      + (p.email ? '<a href="mailto:' + esc(p.email) + '" class="c-btn c-btn-outline" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>Email</a>' : '')
      + (addr && url ? '<a href="' + esc(url) + '" class="c-btn c-btn-outline" target="_blank" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Map</a>' : '')
      + '</div>';
    return '<div class="c-card" onclick="openPersonDetail(' + p.id + ')">'
      + '<div class="c-avatar"' + (isOrg ? '' : ' style="background:' + tint.bg + ';color:' + tint.fg + ';"') + '>' + avInner + '</div>'
      + '<div class="c-info"><div class="c-name">' + esc(p.first_name) + (p.last_name ? ' ' + esc(p.last_name) : '') + (p.deceased ? ' <span style="font-size:.72rem;color:var(--warm-gray);font-weight:400;">&#x271D; d. ' + (p.death_date||'') + '</span>' : '') + '</div>'
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
      photoEl.innerHTML = '<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:none;stroke:var(--warm-gray);stroke-width:1.5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>';
      photoEl.style.background = 'var(--linen)';
    } else {
      var initials = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      photoEl.innerHTML = '<span style="color:'+pvTint.fg+';font-size:28px;font-weight:700;line-height:1;">'+initials+'</span>';
      photoEl.style.background = pvTint.bg;
    }
    // Photo editing is now a single discreet edit button + on-click menu
    // (was four always-on corner buttons). Members never see it.
    var canEditPhoto = (_userRole !== 'member');
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
    if (p.status === 'archived') statusHtml = ' <span style="font-size:.7rem;padding:2px 8px;border-radius:99px;background:#8b735522;color:#8b7355;border:1px solid #8b735544;">Archived</span>';
    else if (p.status === 'deceased') statusHtml = ' <span style="font-size:.7rem;padding:2px 8px;border-radius:99px;background:#6c757d22;color:#6c757d;border:1px solid #6c757d44;">&#x271D; Deceased' + (p.death_date ? ' '+esc(p.death_date) : '') + '</span>';
    bdEl.innerHTML = typeDotHtml(mt) + statusHtml;
  }
  var haEl = document.getElementById('pv-hdr-actions');
  if (haEl) {
    var telDigits = (p.phone||'').replace(/[^0-9]/g,'');
    // Newsletter status/toggle moved to the Tags & Groups card (see pvfTagsBody).
    haEl.innerHTML = (p.phone ? '<a class="pv2-hdr-btn" href="tel:'+telDigits+'">&#128222; Call</a>' : '')
      + (p.phone ? '<a class="pv2-hdr-btn" href="sms:'+telDigits+'">&#128172; Text</a>' : '')
      + (p.email ? '<a class="pv2-hdr-btn solid" href="mailto:'+esc(p.email)+'">&#9993; Email</a>' : '');
  }
  var saEl = document.getElementById('pv-status-actions');
  if (saEl && _userRole !== 'member') {
    var pStatus = p.status || 'active';
    var inviteBtn = (mt.toLowerCase() === 'member' && pStatus === 'active' && p.email)
      ? '<button class="btn-secondary role-admin role-staff" style="font-size:.76rem;padding:3px 9px;color:var(--sky-steel);" onclick="sendConnectInvite('+p.id+')">&#128231; Invite to Connect</button>'
      : '';
    if (pStatus === 'active') {
      saEl.innerHTML = inviteBtn
        + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="archivePerson('+p.id+')">Archive</button>'
        + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="markPersonDeceased('+p.id+')">Deceased</button>';
    } else if (pStatus === 'archived') {
      saEl.innerHTML = '<button class="btn-primary" style="font-size:.76rem;padding:3px 9px;background:var(--teal);" onclick="unarchivePerson('+p.id+')">Reactivate</button>';
    } else if (pStatus === 'deceased') {
      saEl.innerHTML = '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="unarchivePerson('+p.id+')">Reactivate</button>';
    }
  }
  var hhEl = document.getElementById('pv-hh');
  if (hhEl) {
    var hhName = p.household_display_name || p.household_name;
    hhEl.innerHTML = hhName
      ? '<span class="pv-meta-sep">&middot;</span> <span onclick="openHouseholdDetail('+p.household_id+')">'+esc(hhName)+'</span>'
      : '';
  }
  var roleEl = document.getElementById('pv-role');
  if (roleEl) roleEl.textContent = p.family_role ? ' \u00b7 '+p.family_role : '';
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
// single-field PATCH save. members never see editors (canEdit gate below).
var _pvFields = {};
function pvfCanEdit() { return _userRole !== 'member'; }
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
    {id:'member_type', label:'Status', type:'select', options:mtOpts},
    {id:'dob', label:'Birthdate', type:'date', sub:function(v){ return v ? (pvfYearsAgo(v).replace(' ago',' old')) : ''; }},
    {id:'phone', label:'Phone', type:'tel'},
    {id:'email', label:'Email', type:'email'},
    {id:'address1', label:'Street', type:'text'},
    {id:'city', label:'City', type:'text'},
    {id:'state', label:'State', type:'text'},
    {id:'zip', label:'ZIP', type:'text'},
    {id:'baptized', label:'Baptized', type:'select', options:sacramentOpts, blankVals:['0','']},
    {id:'baptism_date', label:'Baptism date', type:'date', sub:dateSub},
    {id:'confirmed', label:'Confirmed', type:'select', options:sacramentOpts, blankVals:['0','']},
    {id:'confirmation_date', label:'Confirmation date', type:'date', sub:dateSub},
    {id:'anniversary_date', label:'Anniversary', type:'date', sub:dateSub},
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
  return String(val);
}
// Read-only cell HTML for one field (with hover pencil when editable).
function pvfRowHtml(id) {
  var cfg = _pvFields[id]; if (!cfg) return '';
  var val = pvfRawVal(id);
  var disp = pvfDisplay(cfg, val);
  var empty = !disp;
  var editable = pvfCanEdit();
  var sub = (cfg.sub && val) ? cfg.sub(val) : '';
  var inner = '<div class="pv2-ro' + (editable ? ' editable' : '') + (empty ? ' empty' : '') + '"'
    + (editable ? ' onclick="pvfStart(\'' + id + '\')"' : '') + '>'
    + '<span>' + (empty ? 'Not set' : esc(disp)) + '</span>'
    + (editable ? '<span class="pv2-pencil">✎ Edit</span>' : '')
    + '</div>'
    + (sub ? '<div class="pv2-sub">' + esc(sub) + '</div>' : '');
  return '<div class="pv2-frow"><div class="pv2-flabel">' + esc(cfg.label) + '</div>'
    + '<div class="pv2-fval" id="pvf-' + id + '">' + inner + '</div></div>';
}
// Swap a field cell into its inline editor.
function pvfStart(id) {
  if (!pvfCanEdit()) return;
  var cfg = _pvFields[id]; if (!cfg) return;
  var cell = document.getElementById('pvf-' + id); if (!cell) return;
  var val = pvfRawVal(id);
  var html;
  if (cfg.type === 'select') {
    html = '<select class="pv2-inp sel" id="pvfi-' + id + '" onchange="pvfCommit(\'' + id + '\')" onblur="pvfCommit(\'' + id + '\')">'
      + (cfg.options || []).map(function(o){
          return '<option value="' + esc(String(o.value)) + '"' + (String(o.value) === String(val) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
        }).join('')
      + '</select>';
  } else if (cfg.type === 'date') {
    // A date picker can only hold a complete calendar date, so the precision select beside
    // it is what lets a record say "1994, month unknown" without inventing a January 1st.
    var prec = pmDatePrecision(val);
    html = '<input class="pv2-inp" id="pvfi-' + id + '" type="date" value="' + esc(pmDateInputValue(val)) + '"'
      + ' onblur="pvfDateBlur(\'' + id + '\')"'
      + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}else if(event.key===\'Escape\'){pvfCancel(\'' + id + '\');}">'
      + '<select class="pv2-inp sel pv2-prec" id="pvfi-' + id + '-prec" onchange="pmDatePrecChanged(\'pvfi-' + id + '\')" onblur="pvfDateBlur(\'' + id + '\')">'
      + [['exact','Exact date'],['monthday','Month &amp; day only'],['year','Year only']].map(function(o){
          return '<option value="' + o[0] + '"' + (prec === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('')
      + '</select>';
  } else {
    html = '<input class="pv2-inp" id="pvfi-' + id + '" type="' + esc(cfg.type || 'text') + '" value="' + esc(String(val)) + '"'
      + ' placeholder="' + esc(cfg.ph || cfg.label) + '" onblur="pvfCommit(\'' + id + '\')"'
      + ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();this.blur();}else if(event.key===\'Escape\'){pvfCancel(\'' + id + '\');}">';
  }
  cell.innerHTML = html;
  var el = document.getElementById('pvfi-' + id);
  if (el) { el.focus(); if (el.select && cfg.type !== 'date') el.select(); }
}
// A date cell holds two controls, so tabbing from the picker to the precision select fires
// blur — and committing there would tear the select out from under the click. Defer one
// tick and only commit once focus has actually left the cell.
function pvfDateBlur(id) {
  setTimeout(function() {
    var cell = document.getElementById('pvf-' + id);
    var active = document.activeElement;
    if (cell && active && cell.contains && cell.contains(active)) return;
    if (document.getElementById('pvfi-' + id)) pvfCommit(id);
  }, 0);
}
// Swap the cell back to its read-only form.
//
// ⚠ Replacing the cell's contents removes whatever control is inside it, and if that
// control still has focus the browser fires blur SYNCHRONOUSLY, part-way through the
// assignment. That blur handler calls back into pvfCommit -> pvfCancel, which would set
// innerHTML again while this assignment is still running — and Chrome throws
// "The node to be removed is no longer a child of this node" out of the outer set.
//
// That exception is what surfaced as "Save failed. Please try again." on gender and
// marital status, AFTER the PATCH had already succeeded: a <select> commits from its
// onchange and so is still focused here, where a text input commits from onblur and is
// not. Hence a re-entrancy guard rather than anything to do with the request.
var _pvfRendering = {};
function pvfCancel(id) {
  if (_pvfRendering[id]) return;
  var cell = document.getElementById('pvf-' + id);
  if (!cell) return;
  _pvfRendering[id] = true;
  try {
    cell.innerHTML = pvfRowHtml(id).replace(/^[\s\S]*?<div class="pv2-fval"[^>]*>/, '').replace(/<\/div>$/, '');
  } finally {
    _pvfRendering[id] = false;
  }
}
// Commit a single field: PATCH just that field, update local record, re-render cell + toast.
var _pvfCommitting = {};
function pvfCommit(id) {
  var cfg = _pvFields[id]; if (!cfg) return;
  if (_pvfCommitting[id]) return; // guard against onchange+onblur double-fire on selects
  var inp = document.getElementById('pvfi-' + id);
  if (!inp) return;
  // pmReadDate turns the picker's placeholder date back into the stored sentinel, so a
  // "year only" edit saves as 1994-00-00 rather than as 1 January 1994.
  var newVal = cfg.type === 'date' ? pmReadDate('pvfi-' + id, null) : inp.value;
  var oldVal = String(pvfRawVal(id));
  if (String(newVal) === oldVal) { pvfCancel(id); return; }
  _pvfCommitting[id] = true;
  var body = {}; body[id] = newVal;
  var p = _currentPvPerson;
  api('/admin/api/people/' + p.id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
    .then(function(r) {
      // Cleared only AFTER pvfCancel: the re-render synchronously blurs the control it is
      // replacing, and that blur re-enters pvfCommit. Clearing first let it through.
      if (r && r.error) { alert('Save failed: ' + r.error); pvfCancel(id); _pvfCommitting[id] = false; return; }
      _currentPvPerson[id] = newVal;
      pvfCancel(id);
      _pvfCommitting[id] = false;
      pvfToast();
      // Header-affecting fields: re-render the whole profile header/badges.
      if (['first_name','last_name','preferred_name','member_type','marital_status','family_role'].indexOf(id) >= 0) {
        pvfRefreshHeader();
      }
    }).catch(function(err) {
      // Carry whatever reason there is. Reported as a bare "Save failed. Please try again."
      // this was undiagnosable — and it also fires when the save SUCCEEDED but a later step
      // in the .then threw, which reads to the user as data loss that didn't happen.
      var why = err && err.message && err.message !== 'Unauthorized' ? '\n\n' + err.message : '';
      alert('Save failed. Please try again.' + why);
      pvfCancel(id);
      _pvfCommitting[id] = false;
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
      wrap.innerHTML = '<button class="pv2-hdr-btn dashed" disabled>&#128240; Checking newsletter…</button>';
    } else if (state === 'on') {
      wrap.innerHTML = '<button class="pv2-hdr-btn on" title="On the newsletter — click to remove" onclick="pvfNewsletterToggle(' + id + ',true)">&#9993; Newsletter &#10003;</button>';
    } else {
      wrap.innerHTML = '<button class="pv2-hdr-btn dashed" onclick="pvfNewsletterToggle(' + id + ',false)">&#128240; Add to newsletter</button>';
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
  var roleEl = document.getElementById('pv-role'); if (roleEl) roleEl.textContent = p.family_role ? ' · ' + p.family_role : '';
}
// Generic section card wrapper.
function pvfCard(id, title, opts) {
  opts = opts || {};
  return '<div class="pv2-card" id="pvf-sec-' + id + '"' + (opts.cls ? ' data-cls="' + opts.cls + '"' : '') + '>'
    + '<div class="pv2-card-hd"><h3>' + esc(title) + '</h3><div class="sp"></div>'
    + (opts.tag ? '<span class="pv2-card-hd-tag">' + esc(opts.tag) + '</span>' : '')
    + (opts.headerBtns || '')
    + '</div>'
    + '<div class="pv2-card-bd' + (opts.pad ? ' pad' : '') + '" id="pvf-body-' + id + '">' + (opts.body || '') + '</div>'
    + '</div>';
}
// ── Custom card bodies ─────────────────────────────────────────────────
function pvfContactExtras(p) {
  var out = '';
  if (p.phone && _userRole !== 'member') {
    out += '<div style="margin-top:6px;">' + (p.sms_opt_in
      ? '<span id="pv-sms-badge" onclick="togglePVSms()" title="Click to opt out of SMS" style="cursor:pointer;font-size:11px;padding:2px 9px;border-radius:99px;background:var(--pale-sage);color:var(--sage);font-weight:600;">SMS ✓</span>'
      : '<span id="pv-sms-badge" onclick="togglePVSms()" title="Click to opt in to SMS" style="cursor:pointer;font-size:11px;padding:2px 9px;border-radius:99px;background:var(--linen);color:var(--warm-gray);font-weight:600;">SMS off</span>') + '</div>';
  }
  if (p.household_id && (p.address1||'').trim() && _userRole !== 'member') {
    out += '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;" onclick="applyAddressToHousehold(' + p.id + ',' + p.household_id + ')">Push address to household</button>'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;" onclick="syncPersonAddrToHousehold(' + p.household_id + ')">&#8593; Sync to household</button></div>';
  }
  return out;
}
function pvfFamilyBody(p) {
  if (p.household_id) {
    // "Role in household" (head/spouse/child/other) is inline-editable here;
    // the member list loads async into #pv-family-members below it.
    return pvfRowHtml('family_role')
      + '<div id="pv-family-members" style="color:var(--warm-gray);font-size:12px;margin-top:6px;">Loading…</div>';
  }
  if (_userRole === 'member') return '<div style="color:var(--faint);font-size:13px;font-style:italic;padding:6px 0;">No household linked</div>';
  return '<div style="color:var(--faint);font-size:13px;font-style:italic;padding:6px 0;">No household linked</div>'
    + '<button class="pv2-adddash" onclick="createHouseholdForPerson(' + p.id + ',\'' + esc(p.last_name||'') + '\')">＋ Create household</button>';
}
var _pvfTagAddOpen = false;
function pvfTagsBody(p) {
  // Show only the tags actually applied to this person (the "active" tags). The full list of
  // available tags stays hidden behind a click-to-open "＋ Add tag" box, rather than always
  // listing every unapplied tag inline.
  var chips = (p.tags||[]).map(function(t){
    return '<span class="pv2-chip">' + esc(t.name)
      + (_userRole !== 'member' ? '<button class="pv2-chip-x" onclick="pvfRemoveTag(' + t.id + ')">✕</button>' : '')
      + '</span>';
  }).join('');
  var out = '<div style="display:flex;flex-wrap:wrap;gap:8px;' + (chips ? 'margin-bottom:12px;' : '') + '">'
    + (chips || '<span style="color:var(--faint);font-size:13px;font-style:italic;">No tags</span>') + '</div>';
  if (_userRole !== 'member') {
    var curIds = (p.tags||[]).map(function(t){ return t.id; });
    var avail = (typeof allTags !== 'undefined' ? allTags : []).filter(function(t){ return curIds.indexOf(t.id) < 0; });
    if (!avail.length) {
      out += '<span style="color:var(--faint);font-size:12.5px;">All tags applied</span>';
    } else {
      out += '<button class="pv2-chip-add" onclick="pvfToggleAddTags()">' + (_pvfTagAddOpen ? '✕ Done' : '＋ Add tag') + '</button>';
      if (_pvfTagAddOpen) {
        out += '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;">'
          + avail.map(function(t){
              return '<button class="pv2-chip-add" onclick="pvfAddTag(' + t.id + ')">＋ ' + esc(t.name) + '</button>';
            }).join('')
          + '</div>';
      }
    }
    // Newsletter (Brevo) status/toggle lives here in Tags & Groups. The wrap is
    // populated asynchronously by pvfNewsletterInit (called after render); it's
    // shown only when the person has an email.
    if (p.email) {
      out += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--warm-gray-light,#e8e2d8);display:flex;flex-wrap:wrap;gap:8px;align-items:center;">'
        + '<span id="pv-newsletter-wrap" class="require-edit"></span>'
        + '<span id="pv-newsletter-status" style="font-size:.75rem;color:var(--color-teal);"></span>'
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
  if (!addrParts.length) return '<div style="color:var(--faint);font-size:13px;font-style:italic;padding:4px 0;">No address on file</div>';
  var addrStr = addrParts.map(esc).join(', ');
  var out = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--warm-meta);margin-bottom:5px;">Home address</div>'
    + '<div style="font-size:14.5px;color:var(--color-navy);line-height:1.45;">' + addrStr + '</div>';
  if (addrParts.length >= 2) {
    // Map is embedded on load (auto-opened by pvfRenderInfo); the button just toggles it.
    out += '<div style="margin-top:10px;"><div id="pv-map-' + p.id + '" data-addr="' + encodeURIComponent(addrParts.join(', ')) + '" style="display:none;margin-top:2px;border-radius:10px;overflow:hidden;line-height:0;border:1px solid var(--warm-divider);"></div>'
      + '<button id="pv-map-btn-' + p.id + '" class="btn-secondary" style="font-size:.72rem;padding:3px 9px;margin-top:8px;" onclick="togglePersonMap(' + p.id + ')">&#9654; Show Map</button></div>';
  }
  return out;
}
function pvfGivingBody() {
  return '<div id="pvf-giving-inner" style="color:var(--warm-gray);font-size:13px;">Loading…</div>';
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
      html += '<div style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:var(--warm-meta);margin-bottom:6px;">Recent gifts</div>';
      html += recent.map(function(g){
        return '<div class="pv2-gift"><div style="flex:1;min-width:0;">'
          + '<div style="font-weight:700;font-size:14px;color:var(--color-navy);">' + esc(g.fund_name || g.fund || 'Gift') + '</div>'
          + '<div style="font-size:12.5px;color:var(--warm-meta);">' + esc(fmtDate(g.contribution_date||'')) + ' · ' + esc(g.method||'') + '</div></div>'
          + '<div style="font-weight:700;font-size:15px;color:var(--color-navy);">$' + ((g.amount||0)/100).toFixed(2) + '</div></div>';
      }).join('');
    } else {
      html += '<div style="color:var(--faint);font-size:13px;font-style:italic;padding:4px 0;">No gifts recorded</div>';
    }
    html += '<div style="display:flex;gap:12px;justify-content:center;margin-top:12px;">'
      + '<a href="#" onclick="showPvTab(\'giving\');return false;" style="font-size:13.5px;font-weight:700;">View full giving history →</a>'
      + (entries.length ? '<a href="#" onclick="sendGivingStatement(' + personId + ',\'' + curYear + '\');return false;" style="font-size:13.5px;font-weight:700;">&#9993; Send statement</a>' : '')
      + '</div>';
    el.innerHTML = html;
  }).catch(function(){ el.innerHTML = '<div style="color:var(--danger);font-size:13px;">Could not load giving.</div>'; });
}
function pvfFollowupsBody(p) {
  var name = ((p.first_name||'')+' '+(p.last_name||'')).trim();
  return '<div id="pvf-followup-list" style="color:var(--warm-gray);font-size:13px;margin-bottom:10px;">Loading…</div>'
    + (_userRole !== 'member'
        ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
          + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 11px;" onclick="markSeenToday(' + p.id + ')">&#10003; Mark Seen Today</button>'
          + '<button class="btn-secondary" style="font-size:.78rem;padding:5px 11px;" onclick="openAddFollowUp(' + p.id + ',\'' + esc(name) + '\',\'pastoral_call\')">＋ Add follow-up</button>'
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
    if (!open.length) { el.innerHTML = '<div style="color:var(--faint);font-size:13px;font-style:italic;">No open follow-ups</div>'; return; }
    el.innerHTML = open.map(function(i){
      var due = i.due_date ? 'Due ' + esc(fmtDate(i.due_date)) : '';
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid var(--warm-row-divider);">'
        + '<div style="flex:1;min-width:0;"><div style="font-size:13.5px;color:var(--color-navy);">' + esc(i.notes || i.type || 'Follow-up') + '</div>'
        + (due ? '<div style="font-size:12px;color:var(--faint);margin-top:2px;">' + due + '</div>' : '') + '</div></div>';
    }).join('');
  }).catch(function(){ el.innerHTML = '<div style="color:var(--faint);font-size:12.5px;">Could not load follow-ups</div>'; });
}
function pvfNotesBody(p) {
  var has = (p.notes||'').trim();
  if (_userRole === 'member') {
    return '<div style="font-size:14px;color:var(--charcoal);white-space:pre-wrap;line-height:1.5;">'
      + (has ? esc(p.notes) : '<span style="color:var(--faint);font-style:italic;">No notes</span>') + '</div>';
  }
  return '<div class="pv2-note" onclick="pvfEditNotesInline()" style="cursor:text;">'
    + '<div style="font-size:14px;color:var(--charcoal);white-space:pre-wrap;line-height:1.5;">'
    + (has ? esc(p.notes) : '<span style="color:var(--faint);font-style:italic;">Click to add a note…</span>') + '</div></div>';
}
function pvfEditNotesInline() {
  if (_userRole === 'member') return;
  var body = document.getElementById('pvf-body-notes'); if (!body) return;
  var p = _currentPvPerson;
  body.innerHTML = '<textarea id="pvf-notes-ta" rows="4" class="pv2-inp" style="max-width:100%;resize:vertical;line-height:1.5;">' + esc(p.notes||'') + '</textarea>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">'
    + '<button class="btn-secondary" style="font-size:.78rem;" onclick="pvfCancelNotesInline()">Cancel</button>'
    + '<button class="btn-primary" style="font-size:.78rem;" onclick="pvfSaveNotesInline()">Save note</button></div>';
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
// Build + inject the whole redesigned Information panel, then load async card content.
function pvfRenderInfo(p) {
  var infoEl = document.getElementById('ptab-info');
  if (!infoEl) return;
  _pvfTagAddOpen = false; // start collapsed on each profile render
  pvfBuildRegistry(p);
  var isFinance = (_userRole === 'admin' || _userRole === 'finance');
  var displayName = ((p.first_name||'')+' '+(p.last_name||'')).trim() || 'Unnamed';

  // Hide the preferred-name row when it just repeats the first name (redundant).
  var _prefRedundant = (p.preferred_name||'').trim()
    && (p.preferred_name||'').trim().toLowerCase() === (p.first_name||'').trim().toLowerCase();
  var nameCard = pvfCard('name', 'Name', { body:
    pvfRowHtml('first_name') + pvfRowHtml('last_name')
    + (_prefRedundant ? '' : pvfRowHtml('preferred_name')) + pvfRowHtml('middle_name') });
  // gender, marital_status and dob are all absent from memberSafeView, so for a member this
  // card was three empty rows under a "Personal" heading. Member type is the one field here a
  // member does get, and it belongs in a directory.
  var personalCard = _userRole === 'member'
    ? pvfCard('personal', 'Personal', { body: pvfRowHtml('member_type') })
    : pvfCard('personal', 'Personal', { body:
        pvfRowHtml('gender') + pvfRowHtml('marital_status') + pvfRowHtml('member_type') + pvfRowHtml('dob') });
  var contactCard = pvfCard('contact', 'Contact', { body:
    pvfRowHtml('phone') + pvfRowHtml('email') + pvfRowHtml('address1') + pvfRowHtml('city') + pvfRowHtml('state') + pvfRowHtml('zip')
    + pvfContactExtras(p) });
  var addBtn = p.household_id
    ? '<button class="btn-secondary require-edit" style="font-size:.72rem;padding:3px 9px;" onclick="openAddToHouseholdModal(' + p.household_id + ')">+ Add</button>'
    : '';
  var familyCard = pvfCard('family', 'Family & Household', { headerBtns: addBtn, body: pvfFamilyBody(p) });

  var breezeBtn = _userRole === 'member' ? ''
    : '<button class="btn-secondary role-admin role-staff" style="font-size:.72rem;padding:3px 9px;" onclick="pushPersonToBreeze(' + p.id + ')">&#8679; Breeze</button>';
  // Members get name / contact / family / location and nothing else. The server already strips
  // the underlying data (memberSafeView), so these cards rendered as empty shells with real
  // headings — which reads to a member as "the app is showing me Demographics, Tags,
  // Follow-ups and Notes" whether or not any values appear. Giving was already gated this way
  // on isFinance; these four simply never got the same treatment.
  var isMemberView = _userRole === 'member';
  var demoCard = isMemberView ? '' : pvfCard('church', 'Demographics', { headerBtns: breezeBtn, body:
    pvfRowHtml('baptized') + pvfRowHtml('baptism_date')
    + pvfRowHtml('confirmed') + pvfRowHtml('confirmation_date')
    + pvfRowHtml('anniversary_date') });
  var tagsCard = isMemberView ? '' : pvfCard('tags', 'Tags & Groups', { pad:true, body: pvfTagsBody(p) });
  var locationCard = pvfCard('location', 'Location', { pad:true, body: pvfLocationBody(p) });
  var givingCard = isFinance ? pvfCard('giving', 'Giving', { tag:'This year', pad:true, body: pvfGivingBody() }) : '';
  var followCard = isMemberView ? '' : pvfCard('followups', 'Follow-ups', { pad:true, body: pvfFollowupsBody(p) });
  var notesCard = isMemberView ? '' : pvfCard('notes', 'Notes', { body: pvfNotesBody(p) });

  var navDefs = [['name','Name'],['personal','Personal'],['contact','Contact'],['family','Family']];
  if (!isMemberView) navDefs.push(['church','Demographics'],['tags','Tags & Groups']);
  navDefs.push(['location','Location']);
  if (isFinance) navDefs.push(['giving','Giving']);
  if (!isMemberView) navDefs.push(['followups','Follow-ups'],['notes','Notes']);
  var navHtml = '<div class="pv2-nav-lbl">Jump to</div>'
    + navDefs.map(function(n){ return '<button class="pv2-nav-btn" data-sec="' + n[0] + '" onclick="pvfGo(\'' + n[0] + '\')">' + esc(n[1]) + '</button>'; }).join('');

  infoEl.innerHTML = '<div style="max-width:1120px;margin:0 auto;">'
    + '<div class="pv2-crumb">People <span style="opacity:.5">/</span> <b id="pvf-crumb">' + esc(displayName) + '</b></div>'
    + '<div class="pv2-body">'
    + pvfNavSelectHtml(navDefs, 'pvf-sec-')
    + '<nav class="pv2-nav">' + navHtml + '</nav>'
    + '<div class="pv2-grid">'
    + '<div class="pv2-col">' + nameCard + personalCard + contactCard + familyCard + '</div>'
    + '<div class="pv2-col">' + demoCard + tagsCard + locationCard + givingCard + followCard + notesCard + '</div>'
    + '</div></div></div>';

  if (p.household_id) loadPvFamily(p.household_id, p.id);
  if (isFinance) pvfRenderGivingCard(p.id);
  // /admin/api/followup is outside the member allowlist, so for a member this was a guaranteed
  // 403 on every profile open — and there is no Follow-ups card to fill any more either way.
  if (!isMemberView) pvfRenderFollowups(p.id);
  // Newsletter control now lives in the Tags & Groups card — populate it after render.
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
    if (!members.length) { el.innerHTML = '<div style="color:var(--faint);font-size:12px;font-style:italic;">No members found</div>'; return; }
    el.innerHTML = members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'').charAt(0)+(m.last_name||'').charAt(0)).toUpperCase();
      var mTint = avatarTint(m.id);
      var meta = m.family_role ? m.family_role.charAt(0).toUpperCase()+m.family_role.slice(1) : '';
      var isSelf = m.id === selfId;
      return '<div class="pv-family-member">'
        + '<div class="pv-family-avatar" style="background:'+mTint.bg+';color:'+mTint.fg+';">'+ini+'</div>'
        + '<div style="flex:1;">'
        + (isSelf
            ? '<div class="pv-family-name" style="opacity:.6;">'+esc(mName)+'</div>'
            : '<div class="pv-family-name" onclick="openPersonDetail('+m.id+')" style="cursor:pointer;color:var(--color-teal);">'+esc(mName)+'</div>')
        + (meta ? '<div class="pv-family-meta">'+esc(meta)+'</div>' : '')
        + '</div>'
        + '</div>';
    }).join('')
    + '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;" onclick="editHouseholdById('+hhId+')">&#9998; Edit Household Details</button></div>';
  }).catch(function(){
    el.innerHTML = '<div style="color:var(--faint);font-size:12px;">Could not load family</div>';
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
  if (_userRole === 'member') return;
  var menu = document.getElementById('pv-photo-menu');
  if (!menu) return;
  if (menu.style.display !== 'none') { closePvPhotoMenu(); return; }
  var items = [];
  items.push('<button onclick="closePvPhotoMenu();triggerPhotoUpload()">&#128247; ' + (_pvPhotoState.hasPhoto ? 'Replace photo' : 'Upload photo') + '</button>');
  if (_pvPhotoState.hasHousehold) items.push('<button onclick="closePvPhotoMenu();openPVPhotoPicker()">&#128100; Use a family photo</button>');
  if (_pvPhotoState.hasPhoto) items.push('<button onclick="closePvPhotoMenu();recropPersonPhoto()">&#9986; Re-crop</button>');
  if (_pvPhotoState.hasPhoto) items.push('<button class="danger" onclick="closePvPhotoMenu();removePersonPhoto()">&times; Remove photo</button>');
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
      if (nextOptIn) {
        badge.style.background = '#e8f3ec';
        badge.style.color = '#3a7a55';
        badge.textContent = 'SMS ✓';
        badge.title = 'Click to opt out of SMS';
      } else {
        badge.style.background = '#f0eee8';
        badge.style.color = '#998877';
        badge.textContent = 'SMS off';
        badge.title = 'Click to opt in to SMS';
      }
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
  if (name === 'attendance' && _currentPvPerson) loadPvAttendance(_currentPvPerson.id);
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
    + '<button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="sendGivingStatement('+personId+',\''+statYear+'\')">&#9993; Email Statement</button>'
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
      return '<tr><td style="padding:5px 10px;border-bottom:1px solid #eee;">'+(e.gift_date||'')+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid #eee;">'+esc(e.fund_name||'')+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid #eee;text-align:right;">$'+((e.amount||0)/100).toFixed(2)+'</td>'
        +'<td style="padding:5px 10px;border-bottom:1px solid #eee;color:#777;">'+esc(e.method||'')+'</td></tr>';
    }).join('');
    var htmlBody = '<html><body style="font-family:Georgia,serif;max-width:620px;margin:0 auto;padding:24px;color:#222;">'
      +'<h2 style="color:#0A3C5C;margin-bottom:4px;">'+esc(year)+' Giving Statement</h2>'
      +'<p style="color:#555;font-size:13px;">Timothy Lutheran Church &bull; St. Louis, MO</p>'
      +'<p>Dear '+esc(name)+',</p>'
      +'<p>Thank you for your generous giving to Timothy Lutheran Church. Below is a summary of your contributions for '+esc(year)+':</p>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">'
      +'<thead><tr style="background:#EDF5F8;">'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th>'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Fund</th>'
      +'<th style="padding:8px 10px;text-align:right;font-weight:600;">Amount</th>'
      +'<th style="padding:8px 10px;text-align:left;font-weight:600;">Method</th>'
      +'</tr></thead>'
      +'<tbody>'+tRows+'</tbody>'
      +'<tfoot><tr style="font-weight:700;"><td colspan="2" style="padding:8px 10px;border-top:2px solid #ccc;">Total Contributions</td>'
      +'<td style="padding:8px 10px;border-top:2px solid #ccc;text-align:right;">$'+(total/100).toFixed(2)+'</td><td></td></tr></tfoot>'
      +'</table>'
      +'<p style="font-size:12px;color:#666;">No goods or services were provided in exchange for these contributions. Please retain this statement for your tax records.</p>'
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
function loadPvAttendance(personId) {
  var el = document.getElementById('ptab-attendance');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Attendance data coming soon.</div>';
}
function openPersonEdit(p) {
  var isNew = !p || !p.id;
  document.getElementById('person-modal-title').textContent = isNew ? 'Add Person' : p.first_name + ' ' + p.last_name;
  document.getElementById('pm-id').value = isNew ? '' : p.id;
  document.getElementById('pm-first').value = isNew ? '' : (p.first_name||'');
  document.getElementById('pm-last').value = isNew ? '' : (p.last_name||'');
  document.getElementById('pm-middle').value = isNew ? '' : (p.middle_name||'');
  document.getElementById('pm-preferred').value = isNew ? '' : (p.preferred_name||'');
  document.getElementById('pm-email').value = isNew ? '' : (p.email||'');
  document.getElementById('pm-phone').value = isNew ? '' : (p.phone||'');
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
  var saveBtn = document.querySelector('#person-modal .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  function reEnablePersonSave() { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; } }
  var url = id ? '/admin/api/people/' + id : '/admin/api/people';
  var meth = id ? 'PUT' : 'POST';
  api(url, {method:meth, headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)}).then(function(r) {
    if (r.ok) {
      reEnablePersonSave();
      closeModal('person-modal');
      var pvId = _currentPvPerson ? (_currentPvPerson.id || r.id) : null;
      if (pvId) {
        api('/admin/api/people/' + pvId).then(function(p) { showProfile(p); });
      }
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
  if (dpv === 'Y') return '<span style="color:var(--sage);">&#10003; Confirmed deliverable' + note + '</span>';
  if (dpv === 'S') return '<span style="color:var(--color-gold);">&#9888; Primary confirmed — apt/suite info needed' + note + '</span>';
  if (dpv === 'D') return '<span style="color:var(--color-gold);">&#9888; Primary confirmed — secondary not matched' + note + '</span>';
  return isCensus
    ? '<span style="color:var(--danger);">&#10005; Address not matched by the Census geocoder' + note + '</span>'
    : '<span style="color:var(--danger);">&#10005; Address not found by USPS</span>';
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
    if (btn) btn.textContent = '▼ Hide Map';
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
    el.innerHTML = '<div style="padding:8px;font-size:12px;color:var(--warm-gray);">Loading map…</div>';
    img.src = '/admin/api/utils/static-map?address=' + encodeURIComponent(addr);
  } else {
    el.style.display = 'none';
    if (btn) btn.textContent = '&#9654; Show Map';
  }
}

`;
