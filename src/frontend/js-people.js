export const JS_PEOPLE = String.raw`// ── FUNDS ──────────────────────────────────────────────────────────────
function loadFunds() {
  api('/admin/api/funds').then(function(d) { allFunds = d.funds || []; });
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
    peopleFilter.q = document.getElementById('p-search').value;
    loadPeople(true);
  }, 300);
}
function loadPeople(resetPage) {
  if (resetPage) peopleFilter.offset = 0;
  var params = new URLSearchParams();
  if (peopleFilter.q) params.set('q', peopleFilter.q);
  if (peopleFilter.mt) params.set('member_type', peopleFilter.mt);
  if (peopleFilter.tagIds && peopleFilter.tagIds.length) params.set('tag_ids', peopleFilter.tagIds.join(','));
  if (peopleFilter.missingFields && peopleFilter.missingFields.length) params.set('missing_fields', peopleFilter.missingFields.join(','));
  params.set('limit', peopleFilter.limit);
  params.set('offset', peopleFilter.offset);
  params.set('sort', peopleFilter.sort || 'last_name');
  params.set('dir', peopleFilter.dir || 'asc');
  if (_archiveView) params.set('archived', '1');
  setStatus('p-status', 'Loading…');
  api('/admin/api/people?' + params).then(function(d) {
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
    _peopleTotal = 0;
    renderPeopleDesktop([]);
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
  var isOrg, isSelected, displayName, avInner, avClass, clickHandler, tags, tagHtml, trCls;
  var rows = people.map(function(p) {
    isOrg = p.member_type === 'organization';
    isSelected = _selectedPeople.has(p.id);
    displayName = isOrg
      ? esc(p.first_name || p.last_name)
      : esc(p.last_name) + (p.last_name && p.first_name ? ', ' : '') + esc(p.first_name);
    avInner = isOrg
      ? '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:#888;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>'
      : (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name));
    avClass = 'dir-avatar ' + (isOrg ? 'dir-avatar-org' : 'dir-avatar-' + (p.id % 5));
    clickHandler = _selectMode
      ? 'onclick="togglePersonSelect(' + p.id + ', this)"'
      : 'onclick="openPersonDetail(' + p.id + ')"';
    tags = p.tags || [];
    tagHtml = tags.slice(0,3).map(function(t) {
      return '<span class="dir-tag" style="background:' + esc(t.color) + '22;color:' + esc(t.color) + ';border-color:' + esc(t.color) + '44;">' + esc(t.name) + '</span>';
    }).join('');
    if (tags.length > 3) tagHtml += '<span class="dir-tag-more">+' + (tags.length - 3) + '</span>';
    trCls = isSelected ? ' class="dir-row-selected"' : '';
    var badge = (p.member_type||'visitor').replace(/\s+/g,'-');
    var statusPill = '';
    if (p.status === 'archived') statusPill = ' <span style="font-size:.68rem;padding:1px 6px;border-radius:99px;background:#8b735522;color:#8b7355;border:1px solid #8b735544;vertical-align:middle;">archived</span>';
    else if (p.status === 'deceased') statusPill = ' <span style="font-size:.68rem;padding:1px 6px;border-radius:99px;background:#6c757d22;color:#6c757d;border:1px solid #6c757d44;vertical-align:middle;">&#x271D; deceased</span>';
    return '<tr' + trCls + ' style="cursor:pointer;" ' + clickHandler + '>'
      + '<td style="width:36px;text-align:center;" onclick="event.stopPropagation()"><input type="checkbox" name="person-select"' + (isSelected ? ' checked' : '') + ' style="' + (_selectMode ? '' : 'display:none;') + '" onchange="togglePersonSelect(' + p.id + ',this.closest(&#39;tr&#39;))" onclick="event.stopPropagation()"></td>'
      + '<td><div class="dir-name-cell"><div class="' + avClass + '">' + avInner + '</div><span class="dir-name-link">' + displayName + '</span>' + statusPill + '</div></td>'
      + '<td><span class="dir-badge dir-badge-' + badge + '">' + esc(p.member_type||'visitor') + '</span></td>'
      + '<td class="dir-contact">' + (p.email ? '<a href="mailto:' + esc(p.email) + '" onclick="event.stopPropagation()">' + esc(p.email) + '</a>' : '') + (p.phone ? '<div class="dir-phone">' + esc(p.phone) + '</div>' : '') + '</td>'
      + '<td>' + (p.household_display_name || p.household_name ? '<span class="dir-hh-link">' + esc(p.household_display_name || p.household_name) + '</span>' : '<span style="color:var(--faint);">—</span>') + '</td>'
      + '<td><div class="dir-tags">' + tagHtml + '</div></td>'
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
    + sortTh('Name','last_name') + sortTh('Status','member_type') + '<th>Contact</th>' + sortTh('Household','household') + '<th>Tags</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
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
}
function togglePersonSelect(id, el) {
  if (_selectedPeople.has(id)) {
    _selectedPeople.delete(id);
    el.classList.remove('selected', 'dir-row-selected');
  } else {
    _selectedPeople.add(id);
    el.classList.add('selected', 'dir-row-selected');
  }
  var cb = el.querySelector('input[type=checkbox]');
  if (cb) cb.checked = _selectedPeople.has(id);
  var countEl = document.getElementById('p-bulk-count');
  if (countEl) countEl.textContent = _selectedPeople.size + ' selected';
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
  });
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
  var done = 0;
  ids.forEach(function(personId) {
    // Fetch current tags, then add/remove
    api('/admin/api/people/' + personId).then(function(p) {
      var curTagIds = (p.tags || []).map(function(t){return t.id;});
      var newTagIds = curTagIds.filter(function(id){return removes.indexOf(id)<0;});
      adds.forEach(function(id){ if (newTagIds.indexOf(id)<0) newTagIds.push(id); });
      return api('/admin/api/people/' + personId, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tag_ids:newTagIds})});
    }).then(function() {
      done++;
      if (done === ids.length) {
        document.getElementById('p-bulk-tags-panel').style.display = 'none';
        clearSelection(); loadPeople();
      }
    });
  });
}
function renderPeopleMobile(people) {
  var c = document.getElementById('p-contact-list');
  if (!people.length) { c.innerHTML = '<div class="empty"><div class="empty-icon">&#128100;</div>' + (_archiveView ? 'No archived people found' : 'No people found') + '</div>'; return; }
  c.innerHTML = people.map(function(p) {
    var addr = [p.address1, p.city, p.state].filter(Boolean).join(', ');
    if (!addr && p.household_address) addr = p.household_address;
    var mapUrl = addr ? 'https://maps.apple.com/?q=' + encodeURIComponent(addr) : '';
    return '<div class="c-card">'
      + '<div class="c-avatar">' + (p.photo_url ? '<img src="' + esc(photoSrc(p.photo_url)) + '" alt="" onerror="this.style.display=\'none\';this.parentNode.textContent=\'' + initials(p.first_name, p.last_name) + '\'">' : initials(p.first_name, p.last_name)) + '</div>'
      + '<div class="c-info"><div class="c-name">' + esc(p.first_name) + (p.last_name ? ' ' + esc(p.last_name) : '') + (p.deceased ? ' <span style="font-size:.72rem;color:#888;font-weight:400;">&#x271D; d. ' + (p.death_date||'') + '</span>' : '') + '</div>'
      + '<div class="c-type">' + esc(p.member_type||'visitor') + '</div>'
      + (p.phone ? '<a href="tel:' + esc(p.phone.replace(/\\D/g,'')) + '" class="c-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.37 1.18 2 2 0 012.34 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.28-.78a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>' + esc(p.phone) + '</a>' : '')
      + (addr && mapUrl ? '<a href="' + esc(mapUrl) + '" class="c-link" target="_blank"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>' + esc(addr) + '</a>' : '')
      + '</div></div>';
  }).join('');
}

// ── PERSON DETAIL ─────────────────────────────────────────────────────
function calcAge(ds) {
  if (!ds) return '';
  var d = new Date(ds), now = new Date();
  var age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age >= 0 ? ' (age '+age+')' : '';
}
function showProfile(p) {
  _currentPvPerson = p;
  var isOrg = p.member_type === 'organization';
  var displayName = isOrg ? (p.first_name||p.last_name||'Unnamed') : ((p.first_name||'')+' '+(p.last_name||'')).trim();
  var tn = document.getElementById('pv-topbar-name');
  if (tn) tn.textContent = displayName;
  var photoEl = document.getElementById('pv-photo');
  if (photoEl) {
    var pvColors = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
    if (p.photo_url) {
      var pvi = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      var pvbg = pvColors[p.id % pvColors.length];
      photoEl.style.background = pvbg;
      var img = document.createElement('img');
      img.src = photoSrc(p.photo_url);
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
      img.onerror = function() {
        photoEl.innerHTML = '<span style="color:white;font-size:24px;font-weight:600;line-height:1;">'+pvi+'</span>';
      };
      photoEl.innerHTML = '';
      photoEl.appendChild(img);
    } else if (isOrg) {
      photoEl.innerHTML = '<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:none;stroke:var(--warm-gray);stroke-width:1.5"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>';
      photoEl.style.background = 'var(--linen)';
    } else {
      var initials = ((p.first_name||'').charAt(0)+(p.last_name||'').charAt(0)).toUpperCase();
      var bg = pvColors[p.id % pvColors.length];
      photoEl.innerHTML = '<span style="color:white;font-size:24px;font-weight:600;line-height:1;">'+initials+'</span>';
      photoEl.style.background = bg;
    }
    var overlayEl = document.getElementById('pv-photo-overlay');
    if (overlayEl) overlayEl.style.display = (_userRole !== 'member') ? 'flex' : 'none';
  }
  var fnEl = document.getElementById('pv-fullname');
  if (fnEl) fnEl.textContent = displayName;
  var bdEl = document.getElementById('pv-badge');
  if (bdEl) {
    var mt = p.member_type||'visitor';
    var badgeClass = mt === 'member' ? 'dir-badge-member' : mt === 'organization' ? 'dir-badge-organization' : 'dir-badge-visitor';
    var statusHtml = '';
    if (p.status === 'archived') statusHtml = ' <span style="font-size:.7rem;padding:2px 8px;border-radius:99px;background:#8b735522;color:#8b7355;border:1px solid #8b735544;">Archived</span>';
    else if (p.status === 'deceased') statusHtml = ' <span style="font-size:.7rem;padding:2px 8px;border-radius:99px;background:#6c757d22;color:#6c757d;border:1px solid #6c757d44;">&#x271D; Deceased' + (p.death_date ? ' '+esc(p.death_date) : '') + '</span>';
    bdEl.innerHTML = '<span class="dir-badge '+badgeClass+'">'+mt.charAt(0).toUpperCase()+mt.slice(1)+'</span>'+statusHtml;
  }
  var saEl = document.getElementById('pv-status-actions');
  if (saEl && _userRole !== 'member') {
    var pStatus = p.status || 'active';
    if (pStatus === 'active') {
      saEl.innerHTML = '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="archivePerson('+p.id+')">Archive</button>'
        + '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="markPersonDeceased('+p.id+')">Deceased</button>';
    } else if (pStatus === 'archived') {
      saEl.innerHTML = '<button class="btn-primary" style="font-size:.76rem;padding:3px 9px;background:var(--teal);" onclick="unarchivePerson('+p.id+')">Reactivate</button>';
    } else if (pStatus === 'deceased') {
      saEl.innerHTML = '<button class="btn-secondary" style="font-size:.76rem;padding:3px 9px;color:var(--warm-gray);" onclick="unarchivePerson('+p.id+')">Reactivate</button>';
    }
  }
  var hhEl = document.getElementById('pv-hh');
  if (hhEl) hhEl.textContent = (p.household_display_name || p.household_name) ? ' \u00b7 '+(p.household_display_name || p.household_name) : '';
  var roleEl = document.getElementById('pv-role');
  if (roleEl) roleEl.textContent = p.family_role ? ' \u00b7 '+p.family_role : '';
  // Info tab — two-column layout
  var infoEl = document.getElementById('ptab-info');
  if (infoEl) {
    var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
    var addrStr = addrParts.map(esc).join(', ');
    var addrVal = addrStr ? '<a href="https://maps.google.com/?q='+encodeURIComponent(addrParts.join(', '))+'" target="_blank" rel="noopener">'+addrStr+'</a>' : '';
    var emailVal = p.email ? '<a href="mailto:'+esc(p.email)+'">'+esc(p.email)+'</a>' : '';
    var phoneVal = p.phone ? '<a href="tel:'+esc(p.phone)+'">'+esc(p.phone)+'</a>' : '';
    var tagHtml = (p.tags||[]).map(function(t){
      return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;background:'+esc(t.color)+';color:white;font-size:11px;font-weight:600;margin:2px;">'+esc(t.name)+'</span>';
    }).join('');
    var dirBadge = p.public_directory === 0 ? '<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:99px;background:#f4e8c1;color:#9a7a2b;font-weight:600;margin-left:8px;">Private</span>' : '';
    var leftCol = '<div>'
      + '<div class="pv-section" id="pv-contact-section">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Contact'+dirBadge+'</div>'
      + '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditContact()">Edit</button></div>'
      + pvRow('Address', addrVal)
      + pvRow('Phone', phoneVal)
      + pvRow('Email', emailVal)
      + (p.email && _userRole !== 'member' ? '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;" onclick="addToNewsletter('+p.id+',\''+esc(p.email)+'\',\''+esc(p.first_name||'')+'\',\''+esc(p.last_name||'')+'\')">&#9993; Add to Newsletter</button>'
          + '<span id="pv-newsletter-status" style="font-size:.75rem;line-height:2;color:var(--teal);"></span>'
          + '</div>' : '')
      + (p.household_id ? '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="applyAddressToHousehold('+p.id+','+p.household_id+')">Push address to household members without one</button></div>' : '')
      + '</div>'
      + '<div class="pv-section">'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Family</div>'
      + (p.household_id ? '<button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;margin-left:auto;" onclick="openAddToHouseholdModal('+p.household_id+')">+ Add Person</button>' : '')
      + '</div>'
      + (p.household_id
          ? '<div id="pv-family-members" style="color:var(--warm-gray);font-size:12px;">Loading\u2026</div>'
          : '<div style="color:var(--faint);font-size:12px;font-style:italic;">No household linked</div>')
      + '</div>'
      + '</div>';
    var rightCol = '<div>'
      + '<div class="pv-section" id="pv-demo-section">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Demographics / Dates</div><div style="display:flex;gap:5px;">'
      + (p.breeze_id ? '<button class="btn-secondary role-admin" style="font-size:.7rem;padding:2px 8px;" onclick="syncPersonFromBreeze(\''+esc(p.breeze_id)+'\','+p.id+')">&#8635; Sync Breeze</button>' : '<button class="btn-secondary role-admin role-staff" style="font-size:.7rem;padding:2px 8px;" onclick="pushPersonToBreeze('+p.id+')">&#8679; Push to Breeze</button>')
      + '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditDemo()">Edit</button></div></div>'
      + '<div class="pv-field-grid">'
      + pvField('gender', p.gender)
      + pvField('marital status', p.marital_status)
      + pvField('birthday', p.dob ? fmtDate(p.dob)+calcAge(p.dob) : '')
      + pvField('baptized', p.baptism_date ? fmtDate(p.baptism_date) : (p.baptized ? 'Yes (date unknown)' : ''))
      + pvField('confirmed', p.confirmation_date ? fmtDate(p.confirmation_date) : (p.confirmed ? 'Yes (date unknown)' : ''))
      + pvField('anniversary', p.anniversary_date ? fmtDate(p.anniversary_date) : '')
      + pvField('deceased', p.deceased ? (p.death_date ? fmtDate(p.death_date) : 'Yes') : 'No')
      + '</div>'
      + '</div>'
      + '<div class="pv-section" id="pv-tags-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Tags</div><button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditTags()">Edit</button></div><div style="display:flex;flex-wrap:wrap;gap:6px;">'+(tagHtml||'<span style="color:var(--warm-gray);font-size:12px;font-style:italic;">No tags</span>')+'</div></div>'
      + (p.notes || _userRole !== 'member'
          ? '<div class="pv-section" id="pv-notes-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Notes</div>'
            + (_userRole !== 'member' ? '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditNotes()">Edit</button>' : '')
            + '</div><div style="font-size:13px;color:var(--charcoal);white-space:pre-wrap;line-height:1.5;">'+(p.notes ? esc(p.notes) : '<span style="color:var(--warm-gray);font-style:italic;">No notes</span>')+'</div></div>'
          : '')
      + '</div>';
    infoEl.innerHTML = '<div class="pv-info-cols">'+leftCol+rightCol+'</div>';
    if (p.household_id) loadPvFamily(p.household_id, p.id);
  }
  // Aside
  var asideEl = document.getElementById('pv-aside');
  if (asideEl) {
    asideEl.innerHTML = '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Member ID</div>'
      + '<div style="font-size:13px;color:var(--charcoal);">#'+p.id+'</div>'
      + '</div>'
      + (p.envelope_number ? '<div class="pv-aside-block"><div class="pv-aside-lbl">Envelope #</div><div style="font-size:13px;color:var(--charcoal);">'+esc(p.envelope_number)+'</div></div>' : '')
      + (p.deceased ? '<div class="pv-aside-block" style="color:var(--danger);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">Deceased</div>' : '')
      + '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Added</div>'
      + '<div style="font-size:13px;color:var(--charcoal);">'+(p.created_at ? p.created_at.slice(0,10) : '—')+'</div>'
      + '</div>'
      + '<div class="pv-aside-block">'
      + '<div class="pv-aside-lbl">Last Seen</div>'
      + '<div style="font-size:13px;color:var(--charcoal);" id="pv-last-seen">'+(p.last_seen_date || '—')+'</div>'
      + '</div>'
      + '<div class="pv-aside-block" style="display:flex;flex-direction:column;gap:6px;">'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;width:100%;" onclick="markSeenToday('+p.id+')">&#10003; Mark Seen Today</button>'
      + '<button class="btn-secondary" style="font-size:.75rem;padding:4px 10px;width:100%;" onclick="openAddFollowUp('+p.id+',\''+esc((p.first_name||'')+' '+(p.last_name||''))+'\',\'pastoral_call\')">+ Follow Up</button>'
      + '</div>'
      + '<div class="pv-aside-block" id="pv-aside-giving">'
      + '<div class="pv-aside-lbl">Total Giving</div>'
      + '<div style="font-size:12px;color:var(--warm-gray);">—</div>'
      + '</div>';
    api('/admin/api/giving?person_id='+p.id+'&limit=500').then(function(d) {
      var entries = (d && d.entries) ? d.entries : (Array.isArray(d) ? d : []);
      var total = entries.reduce(function(s,e){return s+(e.amount||0);},0);
      var ag = document.getElementById('pv-aside-giving');
      var curYear = new Date().getFullYear().toString();
      var pid = p.id;
      if (ag) ag.innerHTML = '<div class="pv-aside-lbl">Total Giving</div>'
        + '<div class="pv-aside-big">$'+(total/100).toFixed(2)+'</div>'
        + '<div class="pv-aside-sub">'+entries.length+' gift'+(entries.length!==1?'s':'')+'</div>'
        + (entries.length ? '<div style="display:flex;flex-direction:column;gap:4px;margin-top:8px;">'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;width:100%;" onclick="showPvTab(\'giving\')">View All Gifts</button>'
          + '<button class="btn-secondary" style="font-size:.75rem;padding:3px 9px;width:100%;" onclick="sendGivingStatement('+pid+',\''+curYear+'\')">&#9993; Send Statement</button>'
          + '</div>' : '');
    });
  }
  var ca = document.querySelector('.content-area');
  if (ca) ca.classList.add('pv-mode');
  showPvTab('info');
}
function pvRow(key, val) {
  return '<div class="pv-row"><div class="pv-row-key">'+key+'</div>'
    + '<div class="pv-row-val'+(val?'':' empty')+'">'+(val||'—')+'</div></div>';
}
function pvField(label, val) {
  return '<div class="pv-field-card"><div class="pv-field-card-lbl">'+label+'</div>'
    + '<div class="pv-field-card-val'+(val?'':' empty')+'">'+(val||'—')+'</div></div>';
}
// ── PERSON PROFILE SECTION EDITING ─────────────────────────────────────
function pvBuildPersonPatch(p, overrides) {
  var full = {};
  ['first_name','last_name','email','phone','address1','city','state','zip',
   'member_type','family_role','gender','marital_status','household_id',
   'dob','baptism_date','confirmation_date','anniversary_date','death_date',
   'deceased','public_directory','envelope_number','last_seen_date','notes','breeze_id',
   'dir_hide_address','dir_hide_phone','dir_hide_email'
  ].forEach(function(k){ full[k] = (p[k] !== undefined) ? p[k] : null; });
  Object.assign(full, overrides);
  full.tag_ids = (p.tags || []).map(function(t){ return t.id; });
  return full;
}
// ── Contact section ──────────────────────────────────────────────────
function pvEditContact() {
  var sec = document.getElementById('pv-contact-section');
  if (!sec || sec.dataset.editing === '1') return;
  sec.dataset.editing = '1';
  var p = _currentPvPerson;
  var inp = 'width:100%;box-sizing:border-box;font-size:13px;padding:5px 8px;border:1px solid var(--sky-steel);border-radius:4px;';
  var dirBadge = p.public_directory === 0 ? '<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:99px;background:#f4e8c1;color:#9a7a2b;font-weight:600;margin-left:8px;">Private</span>' : '';
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
    + '<div class="pv-section-title" style="margin:0;">Contact'+dirBadge+'</div>'
    + '<div style="display:flex;gap:6px;">'
    + '<button class="btn-primary" style="font-size:.7rem;padding:3px 10px;" onclick="pvSaveContact()">Save</button>'
    + '<button class="btn-secondary" style="font-size:.7rem;padding:3px 10px;" onclick="pvCancelContact()">Cancel</button>'
    + '</div></div>'
    + '<div style="display:grid;gap:8px;">'
    + '<div><label for="pec-addr1" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">Street Address</label><input type="text" id="pec-addr1" value="'+esc(p.address1||'')+'" style="'+inp+'"></div>'
    + '<div style="display:grid;grid-template-columns:1fr 60px 90px;gap:6px;">'
    + '<div><label for="pec-city" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">City</label><input type="text" id="pec-city" value="'+esc(p.city||'')+'" style="'+inp+'"></div>'
    + '<div><label for="pec-state" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">State</label><input type="text" id="pec-state" value="'+esc(p.state||'')+'" style="'+inp+'" maxlength="2"></div>'
    + '<div><label for="pec-zip" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">ZIP</label><input type="text" id="pec-zip" value="'+esc(p.zip||'')+'" style="'+inp+'"></div>'
    + '</div>'
    + '<div><label for="pec-phone" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">Phone</label><input type="tel" id="pec-phone" value="'+esc(p.phone||'')+'" style="'+inp+'"></div>'
    + '<div><label for="pec-email" style="font-size:11px;color:var(--warm-gray);display:block;margin-bottom:2px;">Email</label><input type="email" id="pec-email" value="'+esc(p.email||'')+'" style="'+inp+'"></div>'
    + '</div>';
  var f = sec.querySelector('#pec-addr1'); if (f) f.focus();
}
function pvCancelContact() { pvRenderContact(); }
function pvSaveContact() {
  var p = _currentPvPerson;
  var btn = document.querySelector('#pv-contact-section .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  var patch = pvBuildPersonPatch(p, {
    address1: (document.getElementById('pec-addr1')||{}).value || '',
    city:     (document.getElementById('pec-city')||{}).value || '',
    state:    (document.getElementById('pec-state')||{}).value || '',
    zip:      (document.getElementById('pec-zip')||{}).value || '',
    phone:    (document.getElementById('pec-phone')||{}).value || '',
    email:    (document.getElementById('pec-email')||{}).value || ''
  });
  api('/admin/api/people/'+p.id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)})
    .then(function() {
      ['address1','city','state','zip','phone','email'].forEach(function(k){ _currentPvPerson[k] = patch[k]; });
      pvRenderContact();
    }).catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      alert('Save failed. Please try again.');
    });
}
function pvRenderContact() {
  var sec = document.getElementById('pv-contact-section');
  if (!sec) return;
  var p = _currentPvPerson;
  var addrParts = [p.address1, p.city, ((p.state||'')+(p.zip ? ' '+p.zip : '')).trim()].filter(Boolean);
  var addrStr = addrParts.map(esc).join(', ');
  var addrVal = addrStr ? '<a href="https://maps.google.com/?q='+encodeURIComponent(addrParts.join(', '))+'" target="_blank" rel="noopener">'+addrStr+'</a>' : '';
  var emailVal = p.email ? '<a href="mailto:'+esc(p.email)+'">'+esc(p.email)+'</a>' : '';
  var phoneVal = p.phone ? '<a href="tel:'+esc(p.phone)+'">'+esc(p.phone)+'</a>' : '';
  var dirBadge = p.public_directory === 0 ? '<span style="display:inline-block;font-size:10px;padding:2px 7px;border-radius:99px;background:#f4e8c1;color:#9a7a2b;font-weight:600;margin-left:8px;">Private</span>' : '';
  delete sec.dataset.editing;
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Contact'+dirBadge+'</div>'
    + '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditContact()">Edit</button></div>'
    + pvRow('Address', addrVal)
    + pvRow('Phone', phoneVal)
    + pvRow('Email', emailVal)
    + (p.household_id ? '<div style="margin-top:8px;"><button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="applyAddressToHousehold('+p.id+','+p.household_id+')">Push address to household members without one</button></div>' : '');
}
// ── Demographics section ──────────────────────────────────────────────
function pvEditDemo() {
  var sec = document.getElementById('pv-demo-section');
  if (!sec || sec.dataset.editing === '1') return;
  sec.dataset.editing = '1';
  var p = _currentPvPerson;
  var inp = 'width:100%;box-sizing:border-box;font-size:13px;padding:5px 8px;border:1px solid var(--sky-steel);border-radius:4px;';
  var gOpts = ['','Male','Female','Other'].map(function(v){
    return '<option value="'+v+'"'+((p.gender||'')===v&&v?' selected':(!v&&!p.gender?' selected':''))+'>'+(v||'—')+'</option>';
  }).join('');
  var msOpts = ['','Single','Married','Divorced','Widowed'].map(function(v){
    return '<option value="'+v+'"'+((p.marital_status||'')===v&&v?' selected':(!v&&!p.marital_status?' selected':''))+'>'+(v||'—')+'</option>';
  }).join('');
  var breezeBtn = p.breeze_id
    ? '<button class="btn-secondary role-admin" style="font-size:.7rem;padding:3px 10px;" onclick="syncPersonFromBreeze(\''+esc(p.breeze_id)+'\','+p.id+')">&#8635; Sync Breeze</button>'
    : '<button class="btn-secondary role-admin role-staff" style="font-size:.7rem;padding:3px 10px;" onclick="pushPersonToBreeze('+p.id+')">&#8679; Push to Breeze</button>';
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
    + '<div class="pv-section-title" style="margin:0;">Demographics / Dates</div>'
    + '<div style="display:flex;gap:6px;">'+breezeBtn
    + '<button class="btn-primary" style="font-size:.7rem;padding:3px 10px;" onclick="pvSaveDemo()">Save</button>'
    + '<button class="btn-secondary" style="font-size:.7rem;padding:3px 10px;" onclick="pvCancelDemo()">Cancel</button>'
    + '</div></div>'
    + '<div class="pv-field-grid">'
    + '<div class="pv-field-card"><label for="ped-gender" class="pv-field-card-lbl">gender</label><select id="ped-gender" style="'+inp+'">'+gOpts+'</select></div>'
    + '<div class="pv-field-card"><label for="ped-ms" class="pv-field-card-lbl">marital status</label><select id="ped-ms" style="'+inp+'">'+msOpts+'</select></div>'
    + '<div class="pv-field-card"><label for="ped-dob" class="pv-field-card-lbl">birthday</label><input type="date" id="ped-dob" value="'+esc(p.dob ? p.dob.slice(0,10) : '')+'" style="'+inp+'"></div>'
    + '<div class="pv-field-card"><label for="ped-bap" class="pv-field-card-lbl">baptized (date)</label><input type="date" id="ped-bap" name="ped-bap" value="'+esc(p.baptism_date ? p.baptism_date.slice(0,10) : '')+'" style="'+inp+'"></div>'
    + '<div class="pv-field-card" style="display:flex;flex-direction:column;gap:4px;"><label class="pv-field-card-lbl">baptized (no date)</label><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ped-baptized" name="ped-baptized"'+(p.baptized?' checked':'')+' style="width:16px;height:16px;cursor:pointer;"> Yes, date unknown</label></div>'
    + '<div class="pv-field-card"><label for="ped-conf" class="pv-field-card-lbl">confirmed (date)</label><input type="date" id="ped-conf" name="ped-conf" value="'+esc(p.confirmation_date ? p.confirmation_date.slice(0,10) : '')+'" style="'+inp+'"></div>'
    + '<div class="pv-field-card" style="display:flex;flex-direction:column;gap:4px;"><label class="pv-field-card-lbl">confirmed (no date)</label><label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" id="ped-confirmed" name="ped-confirmed"'+(p.confirmed?' checked':'')+' style="width:16px;height:16px;cursor:pointer;"> Yes, date unknown</label></div>'
    + '<div class="pv-field-card"><label for="ped-ann" class="pv-field-card-lbl">anniversary</label><input type="date" id="ped-ann" value="'+esc(p.anniversary_date ? p.anniversary_date.slice(0,10) : '')+'" style="'+inp+'"></div>'
    + '</div>';
  var f = sec.querySelector('select'); if (f) f.focus();
}
function pvCancelDemo() { pvRenderDemo(); }
function pvSaveDemo() {
  var p = _currentPvPerson;
  var btn = document.querySelector('#pv-demo-section .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  var patch = pvBuildPersonPatch(p, {
    gender:            (document.getElementById('ped-gender')||{}).value || '',
    marital_status:    (document.getElementById('ped-ms')||{}).value || '',
    dob:               (document.getElementById('ped-dob')||{}).value || null,
    baptism_date:      (document.getElementById('ped-bap')||{}).value || null,
    baptized:          (document.getElementById('ped-baptized')||{}).checked ? 1 : 0,
    confirmation_date: (document.getElementById('ped-conf')||{}).value || null,
    confirmed:         (document.getElementById('ped-confirmed')||{}).checked ? 1 : 0,
    anniversary_date:  (document.getElementById('ped-ann')||{}).value || null
  });
  api('/admin/api/people/'+p.id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)})
    .then(function() {
      ['gender','marital_status','dob','baptism_date','baptized','confirmation_date','confirmed','anniversary_date'].forEach(function(k){ _currentPvPerson[k] = patch[k]; });
      pvRenderDemo();
    }).catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      alert('Save failed. Please try again.');
    });
}
function pvRenderDemo() {
  var sec = document.getElementById('pv-demo-section');
  if (!sec) return;
  var p = _currentPvPerson;
  delete sec.dataset.editing;
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Demographics / Dates</div><div style="display:flex;gap:5px;">'
    + (p.breeze_id ? '<button class="btn-secondary role-admin" style="font-size:.7rem;padding:2px 8px;" onclick="syncPersonFromBreeze(\''+esc(p.breeze_id)+'\','+p.id+')">&#8635; Sync Breeze</button>' : '')
    + '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditDemo()">Edit</button></div></div>'
    + '<div class="pv-field-grid">'
    + pvField('gender', p.gender)
    + pvField('marital status', p.marital_status)
    + pvField('birthday', p.dob ? fmtDate(p.dob)+calcAge(p.dob) : '')
    + pvField('baptized', p.baptism_date ? fmtDate(p.baptism_date) : (p.baptized ? 'Yes (date unknown)' : ''))
    + pvField('confirmed', p.confirmation_date ? fmtDate(p.confirmation_date) : (p.confirmed ? 'Yes (date unknown)' : ''))
    + pvField('anniversary', p.anniversary_date ? fmtDate(p.anniversary_date) : '')
    + pvField('deceased', p.deceased ? (p.death_date ? fmtDate(p.death_date) : 'Yes') : 'No')
    + '</div>';
}
// ── Notes section ────────────────────────────────────────────────────
function pvEditNotes() {
  var sec = document.getElementById('pv-notes-section');
  if (!sec || sec.dataset.editing === '1') return;
  sec.dataset.editing = '1';
  var p = _currentPvPerson;
  var inp = 'width:100%;box-sizing:border-box;font-size:13px;padding:5px 8px;border:1px solid var(--sky-steel);border-radius:4px;';
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
    + '<div class="pv-section-title" style="margin:0;">Notes</div>'
    + '<div style="display:flex;gap:6px;">'
    + '<button class="btn-primary" style="font-size:.7rem;padding:3px 10px;" onclick="pvSaveNotes()">Save</button>'
    + '<button class="btn-secondary" style="font-size:.7rem;padding:3px 10px;" onclick="pvCancelNotes()">Cancel</button>'
    + '</div></div>'
    + '<label for="ped-notes" style="display:none;">Notes</label>'
    + '<textarea id="ped-notes" style="'+inp+';min-height:100px;resize:vertical;display:block;">'+esc(p.notes||'')+'</textarea>';
  var f = sec.querySelector('textarea'); if (f) f.focus();
}
function pvCancelNotes() { pvRenderNotes(); }
function pvSaveNotes() {
  var p = _currentPvPerson;
  var btn = document.querySelector('#pv-notes-section .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  var notes = (document.getElementById('ped-notes')||{}).value || '';
  var patch = pvBuildPersonPatch(p, {notes: notes});
  api('/admin/api/people/'+p.id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)})
    .then(function() {
      _currentPvPerson.notes = notes;
      pvRenderNotes();
    }).catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      alert('Save failed. Please try again.');
    });
}
function pvRenderNotes() {
  var sec = document.getElementById('pv-notes-section');
  if (!sec) return;
  var p = _currentPvPerson;
  delete sec.dataset.editing;
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Notes</div>'
    + (_userRole !== 'member' ? '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditNotes()">Edit</button>' : '')
    + '</div>'
    + '<div style="font-size:13px;color:var(--charcoal);white-space:pre-wrap;line-height:1.5;">'
    + (p.notes ? esc(p.notes) : '<span style="color:var(--warm-gray);font-style:italic;">No notes</span>')
    + '</div>';
}
// ── Tags section ─────────────────────────────────────────────────────
function pvEditTags() {
  var sec = document.getElementById('pv-tags-section');
  if (!sec || sec.dataset.editing === '1') return;
  sec.dataset.editing = '1';
  var p = _currentPvPerson;
  var currentTagIds = (p.tags||[]).map(function(t){ return t.id; });
  var checkboxes = allTags.map(function(t){
    var checked = currentTagIds.indexOf(t.id) >= 0 ? ' checked' : '';
    return '<label style="display:flex;align-items:center;gap:8px;padding:5px 2px;cursor:pointer;font-size:13px;">'
      + '<input type="checkbox" name="person-tag" value="'+t.id+'"'+checked+' style="cursor:pointer;">'
      + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:'+esc(t.color||'#ccc')+';flex-shrink:0;"></span>'
      + esc(t.name)
      + '</label>';
  }).join('');
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
    + '<div class="pv-section-title" style="margin:0;">Tags</div>'
    + '<div style="display:flex;gap:6px;">'
    + '<button class="btn-primary" style="font-size:.7rem;padding:3px 10px;" onclick="pvSaveTags()">Save</button>'
    + '<button class="btn-secondary" style="font-size:.7rem;padding:3px 10px;" onclick="pvCancelTags()">Cancel</button>'
    + '</div></div>'
    + '<div style="max-height:220px;overflow-y:auto;">'
    + (checkboxes || '<span style="color:var(--warm-gray);font-size:12px;font-style:italic;">No tags defined</span>')
    + '</div>';
}
function pvCancelTags() { pvRenderTags(); }
function pvSaveTags() {
  var p = _currentPvPerson;
  var btn = document.querySelector('#pv-tags-section .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  var cbs = document.querySelectorAll('#pv-tags-section input[type="checkbox"]');
  var tagIds = [];
  cbs.forEach(function(cb){ if (cb.checked) tagIds.push(parseInt(cb.value, 10)); });
  var patch = pvBuildPersonPatch(p, {});
  patch.tag_ids = tagIds;
  api('/admin/api/people/'+p.id, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)})
    .then(function() {
      _currentPvPerson.tags = allTags.filter(function(t){ return tagIds.indexOf(t.id) >= 0; });
      pvRenderTags();
    }).catch(function() {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      alert('Save failed. Please try again.');
    });
}
function pvRenderTags() {
  var sec = document.getElementById('pv-tags-section');
  if (!sec) return;
  var p = _currentPvPerson;
  delete sec.dataset.editing;
  var tagHtml = (p.tags||[]).map(function(t){
    return '<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:99px;background:'+esc(t.color)+';color:white;font-size:11px;font-weight:600;margin:2px;">'+esc(t.name)+'</span>';
  }).join('');
  sec.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><div class="pv-section-title" style="margin:0;">Tags</div>'
    + '<button class="btn-secondary require-edit" style="font-size:.7rem;padding:2px 8px;" onclick="pvEditTags()">Edit</button></div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;">'+(tagHtml||'<span style="color:var(--warm-gray);font-size:12px;font-style:italic;">No tags</span>')+'</div>';
}
function loadPvFamily(hhId, selfId) {
  var el = document.getElementById('pv-family-members');
  if (!el) return;
  api('/admin/api/households/'+hhId).then(function(d) {
    var members = (d && d.members) ? d.members : [];
    if (!members.length) { el.innerHTML = '<div style="color:var(--faint);font-size:12px;font-style:italic;">No members found</div>'; return; }
    var clrs = ['#2E7EA6','#C9973A','#5A9E6F','#9B59B6','#E87040'];
    el.innerHTML = members.map(function(m) {
      var mName = ((m.first_name||'')+' '+(m.last_name||'')).trim();
      var ini = ((m.first_name||'').charAt(0)+(m.last_name||'').charAt(0)).toUpperCase();
      var mbg = clrs[m.id % clrs.length];
      var meta = m.family_role ? m.family_role.charAt(0).toUpperCase()+m.family_role.slice(1) : '';
      var isSelf = m.id === selfId;
      return '<div class="pv-family-member">'
        + '<div class="pv-family-avatar" style="background:'+mbg+';">'+ini+'</div>'
        + '<div style="flex:1;">'
        + (isSelf
            ? '<div class="pv-family-name" style="opacity:.6;">'+esc(mName)+'</div>'
            : '<div class="pv-family-name" onclick="openPersonDetail('+m.id+')" style="cursor:pointer;color:var(--sky-steel);">'+esc(mName)+'</div>')
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
    method: 'PUT',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(Object.assign({}, _currentPvPerson, {
      tag_ids: ids,
      household_id: _currentPvPerson.household_id || null
    }))
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
  });
}
function triggerPhotoUpload() {
  var inp = document.getElementById('pv-photo-input');
  if (inp) inp.click();
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
  var hid = _editingHouseholdId;
  if (!hid) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var MAX = 600;
      var w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(function(blob) {
        var btn = document.getElementById('hm-photo-upload-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Uploading\u2026'; }
        var fd = new FormData();
        fd.append('photo', blob, 'photo.jpg');
        fetch('/admin/api/households/' + hid + '/photo', { method: 'POST', body: fd, credentials: 'same-origin' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (btn) { btn.disabled = false; btn.innerHTML = '&#128247; Upload Photo'; }
            if (d && d.ok && d.photo_url) {
              document.getElementById('hm-photo').value = d.photo_url;
              var prevEl = document.getElementById('hm-photo-preview');
              if (prevEl) { prevEl.src = photoSrc(d.photo_url) + '?t=' + Date.now(); prevEl.style.display = 'block'; }
            } else {
              alert('Upload failed: ' + ((d && d.error) || 'unknown error'));
            }
          }).catch(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '&#128247; Upload Photo'; }
            alert('Upload failed. Please try again.');
          });
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
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
function uploadPersonPhoto(blob) {
  var pid = _currentPvPerson && _currentPvPerson.id;
  if (!pid) return;
  var overlay = document.getElementById('pv-photo-overlay');
  if (overlay) { overlay.style.opacity = '1'; overlay.innerHTML = '<span style="color:white;font-size:12px;">Uploading\u2026</span>'; }
  var fd = new FormData();
  fd.append('photo', blob, 'photo.jpg');
  fetch('/admin/api/people/' + pid + '/photo', { method: 'POST', body: fd, credentials: 'same-origin' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (overlay) { overlay.style.opacity = ''; overlay.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="white" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>'; }
      if (d && d.ok && d.photo_url) {
        _currentPvPerson.photo_url = d.photo_url;
        var photoEl = document.getElementById('pv-photo');
        if (photoEl) {
          var imgEl = document.createElement('img');
          imgEl.src = d.photo_url + '?t=' + Date.now();
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
function showCropModal(img, callback) {
  _cropImg = img;
  _cropCallback = callback;
  var MAX_W = 540, MAX_H = 380;
  _cropScale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
  var canvas = document.getElementById('crop-canvas');
  canvas.width = Math.round(img.width * _cropScale);
  canvas.height = Math.round(img.height * _cropScale);
  var dim = Math.min(img.width, img.height);
  _cropRect = { x: Math.round((img.width - dim) / 2), y: Math.round((img.height - dim) / 2), w: dim, h: dim };
  _cropDraw();
  openModal('crop-modal');
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
  var MIN = 40;
  if (_cropDrag.type === 'move') {
    r.x = Math.max(0, Math.min(iw - r.w, r.x + dx));
    r.y = Math.max(0, Math.min(ih - r.h, r.y + dy));
  } else {
    var d = (Math.abs(dx) > Math.abs(dy)) ? dx : dy;
    if (_cropDrag.type === 'tl') { var nw=Math.max(MIN,r.w-d),nh=Math.max(MIN,r.h-d); r.x=r.x+(r.w-nw); r.y=r.y+(r.h-nh); r.w=nw; r.h=nh; }
    else if (_cropDrag.type === 'tr') { var nw=Math.max(MIN,r.w+d),nh=Math.max(MIN,r.h+d); r.w=nw; r.y=r.y+(r.h-nh); r.h=nh; }
    else if (_cropDrag.type === 'bl') { var nw=Math.max(MIN,r.w-d),nh=Math.max(MIN,r.h+d); r.x=r.x+(r.w-nw); r.w=nw; r.h=nh; }
    else if (_cropDrag.type === 'br') { var nw=Math.max(MIN,r.w+d),nh=Math.max(MIN,r.h+d); r.w=nw; r.h=nh; }
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

function syncPersonFromBreeze(breezeId, personId) {
  var btn = event && event.currentTarget;
  var origLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing\u2026'; }
  api('/admin/api/import/breeze-sync-person', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ breeze_id: breezeId })
  }).then(function(r) {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
    if (r && r.ok) {
      alert(r.summary || 'Synced from Breeze.');
      // Reload the profile to show updated values
      api('/admin/api/people/' + personId).then(function(p) { if (p && p.id) showProfile(p); });
    } else {
      alert('Breeze sync failed: ' + ((r && r.error) || 'Unknown error'));
    }
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
    alert('Breeze sync error: ' + (e.message || e));
  });
}
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
  });
}
// Add-to-household: search for existing person and link them
var _addToHhId = null, _addToHhPeople = {}, _addToHhTimer = null;
function openAddToHouseholdModal(householdId) {
  _addToHhId = householdId;
  _addToHhPeople = {};
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
  var tagIds = (p.tags||[]).map(function(t){ return t.id; });
  api('/admin/api/people/'+personId, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify(Object.assign({}, p, { household_id: _addToHhId, tag_ids: tagIds }))
  }).then(function(r) {
    if (r.ok) {
      closeModal('add-to-hh-modal');
      if (_currentPvPerson && _currentPvPerson.household_id === _addToHhId) loadPvFamily(_addToHhId, _currentPvPerson.id);
    } else alert('Error: '+(r.error||'unknown'));
  });
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
  api('/admin/api/people', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ first_name: first, last_name: last, member_type: type || 'Visitor', household_id: _addToHhId, tag_ids: [] })
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
  if (name === 'timeline' && _currentPvPerson) loadPvTimeline(_currentPvPerson.id);
}
function loadPvGiving(personId) {
  var el = document.getElementById('ptab-giving');
  if (!el) return;
  _pvGivingPersonId = personId;
  _pvGivingEntries = [];
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Loading...</div>';
  api('/admin/api/giving?person_id='+personId+'&limit=2000').then(function(d) {
    _pvGivingEntries = (d && d.entries) ? d.entries : [];
    renderPvGiving('');
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load giving.</div>';
  });
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
      var total = _pvGivingEntries.reduce(function(s,e){return s+(e.amount||0);},0);
      var ag = document.getElementById('pv-aside-giving');
      if (ag) ag.innerHTML = '<div class="pv-aside-lbl">Total Giving</div>'
        + '<div class="pv-aside-big">$'+(total/100).toFixed(2)+'</div>'
        + '<div class="pv-aside-sub">'+_pvGivingEntries.length+' gift'+(_pvGivingEntries.length!==1?'s':'')+'</div>';
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
function loadPvTimeline(personId) {
  var el = document.getElementById('ptab-timeline');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);">Loading…</div>';
  Promise.all([
    api('/admin/api/audit?entity_type=person&entity_id='+personId+'&limit=60'),
    api('/admin/api/followup?person_id='+personId)
  ]).then(function(results) {
    var auditEntries = (results[0] && results[0].entries) ? results[0].entries : [];
    var fuItems = (results[1] && results[1].items) ? results[1].items : [];
    // Merge and sort by date descending
    var events = [];
    auditEntries.forEach(function(a) {
      events.push({ ts: a.ts, type: 'audit', data: a });
    });
    fuItems.forEach(function(f) {
      events.push({ ts: f.completed_at || f.created_at, type: 'followup', data: f });
    });
    events.sort(function(a,b){ return (b.ts||'').localeCompare(a.ts||''); });
    if (!events.length) {
      el.innerHTML = '<div style="padding:20px;color:var(--warm-gray);font-style:italic;">No timeline entries yet.</div>';
      return;
    }
    var typeLabels = {pastoral_call:'Pastoral Call',prayer:'Prayer Follow-up',first_gift:'First Gift',not_seen:'Not Seen',newsletter:'Newsletter',general:'Follow-up'};
    var rows = events.map(function(ev) {
      var d = ev.data;
      var ts = (ev.ts||'').slice(0,16).replace('T',' ');
      if (ev.type === 'audit') {
        var old = d.old_value ? esc(d.old_value) : '<em style="color:var(--warm-gray)">—</em>';
        var nw  = d.new_value ? esc(d.new_value) : '<em style="color:var(--warm-gray)">—</em>';
        return '<div class="tl-row">'
          + '<div class="tl-dot tl-dot-edit"></div>'
          + '<div class="tl-body">'
          + '<div class="tl-meta"><span class="tl-action">Edited</span> <span class="tl-field">'+esc(d.field||'')+'</span></div>'
          + '<div class="tl-change">'+old+' &rarr; '+nw+'</div>'
          + '<div class="tl-ts">'+ts+'</div>'
          + '</div></div>';
      } else {
        var fLabel = typeLabels[d.type] || 'Follow-up';
        var status = d.completed ? '<span style="color:var(--teal);font-size:.78rem;">&#10003; done '+(d.completed_at||'').slice(0,10)+'</span>' : '<span style="color:var(--sand-tan);font-size:.78rem;">open</span>';
        return '<div class="tl-row">'
          + '<div class="tl-dot tl-dot-fu"></div>'
          + '<div class="tl-body">'
          + '<div class="tl-meta"><span class="tl-action">'+esc(fLabel)+'</span> '+status+'</div>'
          + (d.notes ? '<div class="tl-change">'+esc(d.notes)+'</div>' : '')
          + '<div class="tl-ts">'+ts+'</div>'
          + '</div></div>';
      }
    }).join('');
    el.innerHTML = '<div style="padding:20px 16px;">'+rows+'</div>';
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load timeline.</div>';
  });
}
function openPersonEdit(p) {
  var isNew = !p || !p.id;
  document.getElementById('person-modal-title').textContent = isNew ? 'Add Person' : p.first_name + ' ' + p.last_name;
  document.getElementById('pm-id').value = isNew ? '' : p.id;
  document.getElementById('pm-first').value = isNew ? '' : (p.first_name||'');
  document.getElementById('pm-last').value = isNew ? '' : (p.last_name||'');
  document.getElementById('pm-email').value = isNew ? '' : (p.email||'');
  document.getElementById('pm-phone').value = isNew ? '' : (p.phone||'');
  document.getElementById('pm-sms-opt-in').checked = !isNew && !!p.sms_opt_in;
  document.getElementById('pm-addr1').value = isNew ? '' : (p.address1||'');
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
  if (!isNew && p.member_type === 'organization') document.getElementById('pm-org-name').value = p.first_name||'';
  document.getElementById('pm-role').value = isNew ? '' : (p.family_role||'');
  document.getElementById('pm-gender').value = isNew ? '' : (p.gender||'');
  document.getElementById('pm-marital').value = isNew ? '' : (p.marital_status||'');
  document.getElementById('pm-dob').value = isNew ? '' : (p.dob||'');
  document.getElementById('pm-baptism').value = isNew ? '' : (p.baptism_date||'');
  document.getElementById('pm-confirm').value = isNew ? '' : (p.confirmation_date||'');
  document.getElementById('pm-anniv').value = isNew ? '' : (p.anniversary_date||'');
  document.getElementById('pm-death').value = isNew ? '' : (p.death_date||'');
  document.getElementById('pm-deceased').checked = !isNew && !!p.deceased;
  var pubEl = document.getElementById('pm-public');
  if (pubEl) pubEl.checked = isNew ? true : (p.public_directory !== 0);
  var dirFieldsEl = document.getElementById('pm-dir-fields');
  if (dirFieldsEl) dirFieldsEl.style.opacity = (!isNew && p.public_directory === 0) ? '.4' : '1';
  var haEl = document.getElementById('pm-hide-addr');  if (haEl) haEl.checked = !isNew && !!p.dir_hide_address;
  var hpEl = document.getElementById('pm-hide-phone'); if (hpEl) hpEl.checked = !isNew && !!p.dir_hide_phone;
  var heEl = document.getElementById('pm-hide-email'); if (heEl) heEl.checked = !isNew && !!p.dir_hide_email;
  document.getElementById('pm-envelope').value = isNew ? '' : (p.envelope_number||'');
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
    // A chip is "selected" if it has a color border (not the default warm-gray)
    if (el.style.borderColor !== 'var(--border)' && el.style.borderColor !== 'rgb(232, 224, 208)' && el.style.borderColor) {
      ids.push(parseInt(el.dataset.tid));
    }
  });
  return ids;
}
function updatePersonNameMode() {
  var isOrg = document.getElementById('pm-type').value === 'organization';
  document.getElementById('pm-name-2col').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-name-1col').style.display = isOrg ? '' : 'none';
  document.getElementById('pm-role-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-hh-field').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-dates-section').style.display = isOrg ? 'none' : '';
  document.getElementById('pm-addr-hint').style.display = isOrg ? 'none' : '';
}
function savePerson() {
  var id = document.getElementById('pm-id').value;
  var isOrg = document.getElementById('pm-type').value === 'organization';
  var first_name = isOrg ? document.getElementById('pm-org-name').value.trim()
                         : document.getElementById('pm-first').value.trim();
  var last_name  = isOrg ? '' : document.getElementById('pm-last').value.trim();
  var data = {
    first_name: first_name,
    last_name: last_name,
    email: document.getElementById('pm-email').value.trim(),
    phone: document.getElementById('pm-phone').value.trim(),
    address1: document.getElementById('pm-addr1').value.trim(),
    city: document.getElementById('pm-city').value.trim(),
    state: document.getElementById('pm-state').value.trim(),
    zip: document.getElementById('pm-zip').value.trim(),
    member_type: document.getElementById('pm-type').value,
    family_role: document.getElementById('pm-role').value,
    gender: document.getElementById('pm-gender').value,
    marital_status: document.getElementById('pm-marital').value,
    household_id: document.getElementById('pm-hh-id').value || null,
    dob: document.getElementById('pm-dob').value,
    baptism_date: document.getElementById('pm-baptism').value,
    confirmation_date: document.getElementById('pm-confirm').value,
    anniversary_date: document.getElementById('pm-anniv').value,
    death_date: document.getElementById('pm-death').value,
    deceased: document.getElementById('pm-deceased').checked ? 1 : 0,
    public_directory: (document.getElementById('pm-public') || {checked:true}).checked ? 1 : 0,
    dir_hide_address: document.getElementById('pm-hide-addr') && document.getElementById('pm-hide-addr').checked ? 1 : 0,
    dir_hide_phone:   document.getElementById('pm-hide-phone') && document.getElementById('pm-hide-phone').checked ? 1 : 0,
    dir_hide_email:   document.getElementById('pm-hide-email') && document.getElementById('pm-hide-email').checked ? 1 : 0,
    envelope_number: document.getElementById('pm-envelope').value.trim(),
    last_seen_date: document.getElementById('pm-last-seen').value,
    notes: document.getElementById('pm-notes').value,
    gender: (document.getElementById('pm-gender') || {value:''}).value,
    marital_status: (document.getElementById('pm-marital') || {value:''}).value,
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
function archivePerson(id) {
  if (!confirm('Archive this person? They will be hidden from the active list but their records and giving history are preserved.')) return;
  api('/admin/api/people/' + id + '/archive', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  });
}
function unarchivePerson(id) {
  if (!confirm('Reactivate this person and return them to the active people list?')) return;
  api('/admin/api/people/' + id + '/unarchive', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  });
}
function markPersonDeceased(id) {
  if (!confirm('Mark this person as deceased? Today will be set as their death date. They will be archived, removed from anniversary cards, and their giving history is preserved.')) return;
  api('/admin/api/people/' + id + '/deceased', {method:'POST'}).then(function(r) {
    if (r.ok) { openPersonDetail(id); loadPeople(); }
    else alert('Error: ' + (r.error || 'unknown'));
  });
}

`;
