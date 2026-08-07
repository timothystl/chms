export const JS_REGISTER = String.raw`// ── CHURCH REGISTER ───────────────────────────────────────────────────
var _regType = 'baptism';
var _regEntries = [];   // cached full list for current type
var _regEditId = null;  // null = add mode, number = edit mode
var _regLabels = {
  baptism:      { title: 'Baptisms',      nameLbl: 'Name Baptized',  name2Lbl: 'Parent / Sponsor', col2: 'Parent/Sponsor' },
  confirmation: { title: 'Confirmations', nameLbl: 'Name Confirmed', name2Lbl: 'Sponsors / Witnesses', col2: 'Sponsors/Witnesses' }
};
function showRegisterTab(type) {
  _regType = type;
  _regEditId = null;
  document.querySelectorAll('[data-rtab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.rtab === type);
  });
  var lbl = _regLabels[type];
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + lbl.title.slice(0,-1);
  var nl = document.getElementById('reg-name-lbl');   if (nl) nl.textContent = lbl.nameLbl;
  var n2 = document.getElementById('reg-name2-lbl');  if (n2) n2.textContent = lbl.name2Lbl;
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
  clearRegForm();
  loadRegister();
}
function clearRegForm() {
  ['reg-date','reg-name','reg-dob','reg-place-of-birth','reg-baptism-place','reg-father','reg-mother','reg-sponsors','reg-officiant','reg-notes','reg-record-type'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.value = '';
  });
}
function toggleRegForm() {
  var p = document.getElementById('reg-form-panel');
  if (!p) return;
  // Toggle a class, not an inline style. On a phone the panel's own rule is display:none, so
  // clearing an inline style (the old p.style.display='') gives that rule the decision again and
  // the form never appears — which is why the register was read-only on a phone.
  var opening = !p.classList.contains('reg-form-open');
  p.classList.toggle('reg-form-open', opening);
  if (opening && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
}
// Collapse the phone form again. No-op on desktop, where the panel is always visible.
function closeRegFormMobile() {
  var p = document.getElementById('reg-form-panel');
  if (p) p.classList.remove('reg-form-open');
}
function loadRegister() {
  var el = document.getElementById('reg-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--warm-gray);font-size:.85rem;">Loading\u2026</div>';
  api('/admin/api/register?type=' + _regType).then(function(d) {
    _regEntries = d.entries || [];
    populateRegYearFilter(_regEntries);
    regFilterChanged();
  }).catch(function() {
    el.innerHTML = '<div style="padding:20px;color:var(--danger);">Could not load register.</div>';
  });
}
function populateRegYearFilter(entries) {
  var sel = document.getElementById('reg-year-filter');
  if (!sel) return;
  var years = {};
  entries.forEach(function(e) { var y = (e.event_date||'').slice(0,4); if (y) years[y] = 1; });
  var ys = Object.keys(years).sort().reverse();
  var cur = sel.value;
  sel.innerHTML = '<option value="">All Years</option>'
    + ys.map(function(y){ return '<option value="'+y+'"'+(y===cur?' selected':'')+'>'+y+'</option>'; }).join('');
}
// The scanned historical register runs to thousands of entries, and every one of them used to be
// rendered at once: ~1.5KB of HTML and ~25 elements per row, so a few thousand entries is several
// MB of markup and tens of thousands of DOM nodes. Worse, the search box rebuilt all of it on
// every keystroke with no debounce. On iOS that exhausts the web content process's memory and the
// renderer is killed — the "A problem repeatedly occurred" page, not a JS error, which is why
// nothing showed up in the error banner. Both halves are fixed: render a bounded window, and wait
// for typing to settle first.
var REG_PAGE_SIZE = 250;
var REG_SHOW_ALL_MAX = 1000;     // above this, "Show all" is not offered — see renderRegisterList
var _regShown = REG_PAGE_SIZE;   // how many matching rows are currently rendered
var _regDebounce = null;

/** Rows matching the current search + year filter. Shared with printRegister so the printed
 *  register can never disagree with the one on screen. */
function regFilteredEntries() {
  var search = (document.getElementById('reg-search') ? document.getElementById('reg-search').value : '').toLowerCase().trim();
  var year   = document.getElementById('reg-year-filter') ? document.getElementById('reg-year-filter').value : '';
  var tokens = search ? search.split(/\s+/).filter(Boolean) : [];
  return _regEntries.filter(function(e) {
    if (year && (e.event_date||'').slice(0,4) !== year) return false;
    if (tokens.length) {
      var hay = ((e.name||'')+' '+(e.name2||'')+' '+(e.officiant||'')).toLowerCase();
      if (!tokens.every(function(t){ return hay.indexOf(t) >= 0; })) return false;
    }
    return true;
  });
}
// Search input. Debounced, and resets the window so a new query starts from the first page.
function debounceRegister() {
  clearTimeout(_regDebounce);
  _regDebounce = setTimeout(regFilterChanged, 250);
}
// Anything that changes WHICH rows match starts the window over.
function regFilterChanged() {
  _regShown = REG_PAGE_SIZE;
  filterRegister();
}
function regShowMore() {
  _regShown += REG_PAGE_SIZE;
  filterRegister();
}
function regShowAll() {
  _regShown = Infinity;
  filterRegister();
}
function filterRegister() {
  var filtered = regFilteredEntries();
  var stat = document.getElementById('reg-stat-txt');
  if (stat) {
    var total = _regEntries.length;
    stat.textContent = filtered.length === total
      ? total + ' ' + _regLabels[_regType].title.toLowerCase()
      : filtered.length + ' of ' + total + ' shown';
  }
  renderRegisterList(filtered.slice(0, _regShown), filtered.length);
}
function renderRegisterList(entries, matchCount) {
  var el = document.getElementById('reg-list');
  if (!el) return;
  var lbl = _regLabels[_regType];
  if (matchCount === undefined) matchCount = entries.length;
  if (!entries.length) {
    el.innerHTML = '<div class="reg-empty">'
      + '<div class="reg-empty-icon">\uD83D\uDCDA</div>'
      + '<div class="reg-empty-ttl">No ' + lbl.title.toLowerCase() + ' found</div>'
      + '<div class="reg-empty-sub">' + (_regEntries.length ? 'Try adjusting the search or year filter.' : 'Use the form to record the first entry.') + '</div></div>';
    return;
  }
  var byYear = {}; var yearOrder = [];
  entries.forEach(function(e) {
    var yr = (e.event_date||'').slice(0,4) || '\u2014';
    if (!byYear[yr]) { byYear[yr] = []; yearOrder.push(yr); }
    byYear[yr].push(e);
  });
  // Detect if this batch has extended fields (historical import)
  var hasExtended = entries.some(function(e){ return e.father||e.mother||e.sponsors||e.dob||e.baptism_place; });
  var DASH = '<span class="reg-dash">\u2014</span>';
  var html = '';
  yearOrder.forEach(function(yr) {
    var grp = byYear[yr];
    var rows = grp.map(function(e) {
      // Date cell
      var dateDisp = e.event_date ? e.event_date : '\u2014';
      var placeDisp = (e.baptism_place && hasExtended) ? '<br><span class="reg-sub">'+esc(e.baptism_place)+'</span>' : '';
      // Name cell
      var namePart = '<strong>'+esc(e.name||'\u2014')+'</strong>';
      if (e.dob) namePart += '<br><span class="reg-sub">b. '+esc(e.dob)+'</span>';
      if (e.notes) namePart += '<br><span class="reg-sub reg-sub-note">'+esc(e.notes)+'</span>';
      // Family cell (extended or simple)
      var familyPart;
      if (hasExtended) {
        var parts = [];
        if (e.father) parts.push('<span class="reg-flabel">Father</span> '+esc(e.father));
        if (e.mother) parts.push('<span class="reg-flabel">Mother</span> '+esc(e.mother));
        if (e.sponsors) parts.push('<span class="reg-flabel">Sponsors</span> '+esc(e.sponsors));
        if (!parts.length && e.name2) parts.push(esc(e.name2));
        familyPart = parts.length ? parts.join('<br>') : DASH;
      } else {
        familyPart = e.name2 ? esc(e.name2) : DASH;
      }
      // Officiant + record_type badge
      var rtBadge = (e.record_type && hasExtended) ? '<span class="reg-rt-badge">'+esc(e.record_type)+'</span><br>' : '';
      var officPart = e.officiant ? esc(e.officiant) : DASH;
      var pdfPart = e.pdf_page ? '<br><span class="reg-page">p.'+esc(e.pdf_page)+'</span>' : '';
      return '<tr>'
        + '<td class="reg-c-date">'+dateDisp+placeDisp+'</td>'
        + '<td>'+namePart+'</td>'
        + '<td class="reg-c-sm">'+familyPart+'</td>'
        + '<td class="reg-c-sm">'+rtBadge+officPart+pdfPart+'</td>'
        + '<td class="reg-c-act">'
        + '<button class="reg-edit-btn require-edit-register" onclick="openRegisterEdit('+e.id+')" title="Edit">Edit</button>'
        + '<button class="reg-del-btn require-edit-register" onclick="deleteRegisterEntry('+e.id+')" title="Delete">Delete</button>'
        + '</td>'
        + '</tr>';
    }).join('');
    var famHeader = hasExtended ? 'Family' : esc(lbl.col2);
    html += '<div class="reg-year-hdr">'+yr+' <span class="reg-yr-count">('+grp.length+')</span></div>'
      + '<div class="reg-scroll">'
      + '<table class="reg-table">'
      + '<thead><tr><th>Date</th><th>'+esc(lbl.nameLbl)+'</th><th>'+famHeader+'</th><th>Officiant</th><th></th></tr></thead>'
      + '<tbody>'+rows+'</tbody></table>'
      + '</div>';
  });
  // Say plainly how many of the matches are on screen, and offer the rest. Silently truncating
  // a register would read as missing records.
  if (matchCount > entries.length) {
    var remaining = matchCount - entries.length;
    html += '<div class="reg-more">'
      + '<div class="reg-more-txt">Showing the first ' + entries.length + ' of ' + matchCount
      + ' matching entries. Keep typing in the search box to narrow them down.</div>'
      + '<button class="btn-secondary" onclick="regShowMore()">Show ' + Math.min(REG_PAGE_SIZE, remaining) + ' more</button>'
      // "Show all" is only offered below a ceiling. Rendering thousands of rows at once is the
      // very thing that killed the renderer, so a button promising to do it on a phone would just
      // hand the crash back — one tap away. Show more still reaches everything, a page at a time.
      + (matchCount <= REG_SHOW_ALL_MAX
        ? '<button class="btn-secondary" onclick="regShowAll()">Show all ' + matchCount + '</button>'
        : '')
      + '</div>';
  }
  el.innerHTML = html;
}
function saveRegisterEntry() {
  var date          = document.getElementById('reg-date').value;
  var name          = document.getElementById('reg-name').value.trim();
  var dob           = document.getElementById('reg-dob').value;
  var placeOfBirth  = document.getElementById('reg-place-of-birth').value.trim();
  var baptismPlace  = document.getElementById('reg-baptism-place').value.trim();
  var father        = document.getElementById('reg-father').value.trim();
  var mother        = document.getElementById('reg-mother').value.trim();
  var sponsors      = document.getElementById('reg-sponsors').value.trim();
  var officiant     = document.getElementById('reg-officiant').value.trim();
  var notes         = document.getElementById('reg-notes').value.trim();
  var recordType    = document.getElementById('reg-record-type').value.trim();
  if (!name) { alert('Name is required.'); return; }
  var isEdit = !!_regEditId;
  var url    = isEdit ? '/admin/api/register/' + _regEditId : '/admin/api/register';
  var method = isEdit ? 'PUT' : 'POST';
  var body   = {event_date: date, name: name, dob: dob, place_of_birth: placeOfBirth, baptism_place: baptismPlace, father: father, mother: mother, sponsors: sponsors, officiant: officiant, notes: notes, record_type: recordType};
  if (!isEdit) body.type = _regType;
  api(url, {method: method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(function(r) {
    if (r.ok) {
      _regEditId = null;
      clearRegForm();
      var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + _regLabels[_regType].title.slice(0,-1);
      var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
      var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
      closeRegFormMobile();
      loadRegister();
    } else alert('Error: ' + (r.error||'unknown'));
  });
}
function openRegisterEdit(id) {
  var entry = _regEntries.find(function(e){ return e.id === id; });
  if (!entry) return;
  _regEditId = id;
  document.getElementById('reg-date').value           = entry.event_date || '';
  document.getElementById('reg-name').value           = entry.name || '';
  document.getElementById('reg-dob').value            = entry.dob || '';
  document.getElementById('reg-place-of-birth').value = entry.place_of_birth || '';
  document.getElementById('reg-baptism-place').value  = entry.baptism_place || '';
  document.getElementById('reg-father').value         = entry.father || '';
  document.getElementById('reg-mother').value         = entry.mother || '';
  document.getElementById('reg-sponsors').value       = entry.sponsors || entry.name2 || '';
  document.getElementById('reg-officiant').value      = entry.officiant || '';
  document.getElementById('reg-notes').value          = entry.notes || '';
  document.getElementById('reg-record-type').value    = entry.record_type || '';
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Edit Entry';
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Save Changes';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = '';
  // Reveal the form on a phone, where it is collapsed by default. Has to be the class — see
  // toggleRegForm; the inline style this replaced could not beat the panel's own display:none,
  // so tapping Edit on a phone silently did nothing.
  var fp = document.getElementById('reg-form-panel');
  if (fp) {
    fp.classList.add('reg-form-open');
    // On a phone the form stacks ABOVE the list, so an Edit tapped from far down a long list
    // would otherwise open a form the user never scrolls back up to see.
    if (fp.scrollIntoView) fp.scrollIntoView({ block: 'nearest' });
  }
  var nameEl = document.getElementById('reg-name'); if (nameEl) nameEl.focus();
}
function cancelRegisterEdit() {
  _regEditId = null;
  clearRegForm();
  var ft = document.getElementById('reg-form-title'); if (ft) ft.textContent = 'Add ' + _regLabels[_regType].title.slice(0,-1);
  var sb = document.getElementById('reg-save-btn');   if (sb) sb.textContent = 'Add Entry';
  var cb = document.getElementById('reg-cancel-btn'); if (cb) cb.style.display = 'none';
  closeRegFormMobile();
}
function deleteRegisterEntry(id) {
  if (!confirm('Delete this register entry? This cannot be undone.')) return;
  api('/admin/api/register/' + id, {method:'DELETE'}).then(function(r) {
    if (r.ok) loadRegister();
    else alert(r.error || 'Cannot delete.');
  });
}
function printRegister() {
  var lbl = _regLabels[_regType];
  var year = document.getElementById('reg-year-filter') ? document.getElementById('reg-year-filter').value : '';
  // Deliberately the FULL match set, not the capped on-screen window — a printed register that
  // silently stopped at 250 rows would be worse than useless.
  var entries = regFilteredEntries();
  var hasExtended = entries.some(function(e){ return e.father||e.mother||e.sponsors||e.dob||e.baptism_place; });
  var byYear = {}; var yearOrder = [];
  entries.forEach(function(e) {
    var yr = (e.event_date||'').slice(0,4)||'\u2014';
    if (!byYear[yr]) { byYear[yr] = []; yearOrder.push(yr); }
    byYear[yr].push(e);
  });
  var colSpan = hasExtended ? '9' : '5';
  var thead = hasExtended
    ? '<tr><th>#</th><th>Baptism Date</th><th>Name</th><th>DOB</th><th>Father</th><th>Mother</th><th>Sponsors / Remarks</th><th>Officiant</th><th>Place</th></tr>'
    : '<tr><th>#</th><th>Date</th><th>'+lbl.nameLbl+'</th><th>'+lbl.col2+'</th><th>Officiant</th></tr>';
  var tableRows = '';
  yearOrder.forEach(function(yr) {
    tableRows += '<tr class="yr-hdr"><td colspan="'+colSpan+'">'+yr+'</td></tr>';
    byYear[yr].forEach(function(e, i) {
      if (hasExtended) {
        tableRows += '<tr>'
          +'<td style="color:#999;">'+(i+1)+'</td>'
          +'<td>'+(e.event_date ? esc(e.event_date) : '\u2014')+'</td>'
          +'<td><strong>'+(e.name ? esc(e.name) : '\u2014')+'</strong>'+(e.record_type?'<br><small>'+esc(e.record_type)+'</small>':'')+'</td>'
          +'<td>'+(e.dob ? esc(e.dob) : '\u2014')+(e.place_of_birth?'<br><small>'+esc(e.place_of_birth)+'</small>':'')+'</td>'
          +'<td>'+(e.father ? esc(e.father) : '\u2014')+'</td>'
          +'<td>'+(e.mother ? esc(e.mother) : '\u2014')+'</td>'
          +'<td>'+(e.sponsors||e.name2 ? esc(e.sponsors||e.name2) : '\u2014')+(e.notes?'<br><em>'+esc(e.notes)+'</em>':'')+'</td>'
          +'<td>'+(e.officiant ? esc(e.officiant) : '\u2014')+'</td>'
          +'<td>'+(e.baptism_place ? esc(e.baptism_place) : '\u2014')+(e.pdf_page?'<br><small>p.'+esc(String(e.pdf_page))+'</small>':'')+'</td>'
          +'</tr>';
      } else {
        tableRows += '<tr>'
          +'<td style="color:#999;">'+(i+1)+'</td>'
          +'<td>'+(e.event_date ? esc(e.event_date) : '\u2014')+'</td>'
          +'<td><strong>'+(e.name ? esc(e.name) : '\u2014')+'</strong></td>'
          +'<td>'+(e.name2 ? esc(e.name2) : '\u2014')+'</td>'
          +'<td>'+(e.officiant ? esc(e.officiant) : '\u2014')+(e.notes?'<br><em style="font-size:.8em;color:#666">'+esc(e.notes)+'</em>':'')+'</td>'
          +'</tr>';
      }
    });
  });
  var churchName = '';
  var cn = document.getElementById('settings-church-name'); if (cn) churchName = cn.value||'';
  var printWin = window.open('', '_blank', 'width=1100,height=900');
  printWin.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+lbl.title+' Register</title>'
    +'<style>body{font-family:Georgia,serif;font-size:10pt;margin:0;padding:24px 32px;}h1{font-size:16pt;margin:0 0 2px;}h2{font-size:10pt;font-weight:normal;color:#666;margin:0 0 20px;}'
    +'table{width:100%;border-collapse:collapse;font-size:8.5pt;}th{border-bottom:2px solid #222;padding:5px 6px;text-align:left;background:#f9f9f9;}td{padding:5px 6px;border-bottom:1px solid #e0e0e0;vertical-align:top;}'
    +'.yr-hdr td{background:#eeeeee;font-weight:bold;font-size:9pt;letter-spacing:.05em;padding:7px 6px 4px;border-bottom:1px solid #bbb;}'
    +'small{font-size:7.5pt;color:#777;}em{color:#555;}'
    +'@media print{body{padding:0;}.no-print{display:none;}@page{size:landscape;}}</style></head><body>'
    +'<div class="no-print" style="margin-bottom:16px;"><button onclick="window.print()">&#128424; Print</button></div>'
    +'<h1>'+(churchName ? esc(churchName)+' \u2014 ' : '')+lbl.title+' Register</h1>'
    +'<h2>'+(year||'All Years')+' \u00b7 '+entries.length+' '+(entries.length===1?'entry':'entries')+'</h2>'
    +'<table><thead>'+thead+'</thead><tbody>'+tableRows+'</tbody></table>'
    +'</body></html>');
  printWin.document.close();
}

// ── REGISTER IMPORT ──────────────────────────────────────────────────
var _regImportRows = [];   // parsed rows ready to import
var _regImportHeaders = {
  baptism: [
    'Entry No.', 'Record Type', 'First Names', 'Surname',
    'Date of Birth', 'Place of Birth', 'Baptism Date', 'Baptism Place',
    'Father', 'Mother', 'Sponsors / Remarks', 'Officiant', 'Notes', 'PDF Page'
  ],
  confirmation: [
    'Entry No.', 'Full Name', 'Confirmation Date', 'Type', 'Remarks / Notes'
  ]
};
function updateRegImportHeaders() {
  var sel = document.getElementById('reg-import-type');
  var box = document.getElementById('reg-import-headers');
  if (!sel || !box) return;
  var cols = _regImportHeaders[sel.value] || _regImportHeaders.baptism;
  box.innerHTML = cols.map(function(c) { return '<strong>'+esc(c)+'</strong>'; }).join(' &nbsp;&#183;&nbsp; ');
}
function openRegImport() {
  var sel = document.getElementById('reg-import-type');
  if (sel) sel.value = _regType;
  updateRegImportHeaders();
  showRegImportStep(1);
  document.getElementById('reg-import-modal').style.display = 'flex';
}
function closeRegImport() {
  document.getElementById('reg-import-modal').style.display = 'none';
  resetRegImport();
}
function resetRegImport() {
  _regImportRows = [];
  var fi = document.getElementById('reg-import-file'); if (fi) fi.value = '';
  var fn = document.getElementById('reg-import-filename'); if (fn) fn.textContent = '';
  showRegImportStep(1);
}
function showRegImportStep(n) {
  [1,2,3].forEach(function(i){
    var el = document.getElementById('reg-import-step'+i);
    if (el) el.style.display = (i===n) ? '' : 'none';
  });
}
function regImportFileChosen(input) {
  var file = input.files[0];
  if (!file) return;
  var fn = document.getElementById('reg-import-filename');
  if (fn) fn.textContent = file.name;
  var reader = new FileReader();
  reader.onload = function(ev) {
    try {
      var parsed = parseRegImportFile(ev.target.result, file.name);
      if (parsed.error) { alert(parsed.error); return; }
      _regImportRows = parsed.rows;
      showRegImportPreview(parsed);
    } catch(err) { alert('Parse error: ' + err.message); }
  };
  reader.readAsText(file, 'UTF-8');
}
function parseRegImportFile(text, filename) {
  // Detect delimiter: if splitting first line by tab gives 5+ fields, use tab
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(function(l){ return l.trim(); });
  if (lines.length < 2) return { error: 'File has fewer than 2 lines — need a header row and at least one data row.' };
  var delim = lines[0].split('\t').length >= 5 ? '\t' : ',';
  function parseLine(line) {
    if (delim === '\t') return line.split('\t').map(function(c){ return c.trim(); });
    // CSV: handle quoted fields
    var cols = [], cur = '', inQ = false;
    for (var ci = 0; ci < line.length; ci++) {
      var ch = line[ci];
      if (ch === '"' && !inQ) { inQ = true; }
      else if (ch === '"' && inQ && line[ci+1] === '"') { cur += '"'; ci++; }
      else if (ch === '"' && inQ) { inQ = false; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    return cols;
  }
  var headers = parseLine(lines[0]).map(function(h){ return h.toLowerCase().replace(/[^a-z0-9]/g,' ').trim().replace(/\s+/g,' '); });
  function col(names) {
    var norm = function(s) { return s.toLowerCase().replace(/[^a-z0-9]/g,' ').trim().replace(/\s+/g,' '); };
    for (var ni = 0; ni < names.length; ni++) {
      var idx = headers.indexOf(norm(names[ni]));
      if (idx >= 0) return idx;
    }
    return -1;
  }
  var colMap = {
    entry_no:       col(['entry no', 'entry no.', '#', 'no', 'no.']),
    record_type:    col(['record type','type']),
    first_names:    col(['first names','first name','firstname','given names','given name','first name s','christian name','christian names','forename','forenames','baptismal name','baptized name','name of child','child']),
    surname:        col(['surname','last name','lastname','family name']),
    dob:            col(['date of birth','dob','birth date','birthdate']),
    place_of_birth: col(['place of birth','birthplace','birth place']),
    event_date:     col(['baptism date','confirmation date','wedding date','event date','date']),
    baptism_place:  col(['baptism place','place','location','church','baptism location']),
    father:         col(['father']),
    mother:         col(['mother']),
    sponsors:       col(['sponsors   remarks','sponsors / remarks','sponsors/remarks','sponsors remarks','sponsors witnesses','sponsors / witnesses','sponsors','godparents','witnesses','remarks']),
    officiant:      col(['officiant','pastor','minister','priest','celebrant']),
    notes:          col(['notes','note','comments','remarks notes','remarks / notes','remarks/notes','remarks']),
    pdf_page:       col(['pdf page','page','pdf'])
  };
  var missing = [];
  if (colMap.first_names < 0 && colMap.surname < 0 && headers.indexOf('name') < 0 && headers.indexOf('full name') < 0) missing.push('Name column (First Names + Surname, or Name)');
  if (colMap.first_names < 0 && colMap.surname >= 0) missing.push('First Names column (found Surname but no First Names/Given Name — names will be surnames only)');
  if (colMap.event_date < 0) missing.push('Date column (Baptism Date or Date)');
  var regType = document.getElementById('reg-import-type') ? document.getElementById('reg-import-type').value : 'baptism';
  var rows = [];
  var skipped = 0;
  for (var li = 1; li < lines.length; li++) {
    var cols = parseLine(lines[li]);
    if (cols.every(function(c){ return !c; })) { skipped++; continue; }
    var g = function(idx) { return (idx >= 0 && idx < cols.length) ? cols[idx] : ''; };
    var firstName = g(colMap.first_names), surname = g(colMap.surname);
    var nameCol = headers.indexOf('name');
    if (nameCol < 0) nameCol = headers.indexOf('full name');
    var fullName = (firstName || surname)
      ? (firstName + (firstName && surname ? ' ' : '') + surname).trim()
      : g(nameCol);
    var rawDate = g(colMap.event_date);
    rows.push({
      type:           regType,
      name:           fullName,
      name2:          g(colMap.sponsors),
      officiant:      g(colMap.officiant),
      notes:          g(colMap.notes),
      record_type:    g(colMap.record_type),
      dob:            normalizeRegDate(g(colMap.dob)),
      place_of_birth: g(colMap.place_of_birth),
      event_date:     normalizeRegDate(rawDate),
      baptism_place:  g(colMap.baptism_place),
      father:         g(colMap.father),
      mother:         g(colMap.mother),
      sponsors:       g(colMap.sponsors),
      pdf_page:       g(colMap.pdf_page)
    });
  }
  return { rows: rows, headers: headers, colMap: colMap, skipped: skipped, missing: missing, delim: delim };
}
function normalizeRegDate(s) {
  if (!s) return '';
  s = s.trim();
  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Already ISO YYYY-MM → use 01 as day
  if (/^\d{4}-\d{2}$/.test(s)) return s+'-01';
  var MONTHS = {
    january:'01',jan:'01',february:'02',feb:'02',march:'03',mar:'03',
    april:'04',apr:'04',may:'05',june:'06',jun:'06',july:'07',jul:'07',
    august:'08',aug:'08',september:'09',sept:'09',sep:'09',
    october:'10',oct:'10',november:'11',nov:'11',december:'12',dec:'12'
  };
  var m;
  // MM/DD/YYYY or M-D-YYYY (slash or dash separator, year last)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);
  // MM/DD/YY or M-D-YY (2-digit year → 19xx for historical records)
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/);
  if (m) return '19'+m[3]+'-'+pad2(m[1])+'-'+pad2(m[2]);
  // Month D(st/nd/rd/th)?, YYYY  e.g. "July 1, 1928" or "July 1st, 1928"
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return m[3]+'-'+MONTHS[m[1].toLowerCase()]+'-'+pad2(m[2]);
  // D(st/nd/rd/th)? Month YYYY  e.g. "1 July 1928" or "1st July 1928"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return m[3]+'-'+MONTHS[m[2].toLowerCase()]+'-'+pad2(m[1]);
  // Month YYYY  e.g. "July 1928" (no day — store as 1st of month)
  m = s.match(/^([A-Za-z]+)\.?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) return m[2]+'-'+MONTHS[m[1].toLowerCase()]+'-01';
  // YYYY only — store as Jan 1 of that year
  m = s.match(/^(\d{4})$/);
  if (m) return m[1]+'-01-01';
  return s;
}
function pad2(n) { return String(n).padStart(2,'0'); }
function showRegImportPreview(parsed) {
  var rows = parsed.rows;
  var cnt = document.getElementById('reg-import-count'); if (cnt) cnt.textContent = rows.length;
  var sum = document.getElementById('reg-import-summary');
  if (sum) sum.innerHTML = (rows.length === 0
    ? '<span style="color:var(--danger);font-weight:600;">No data rows detected. Check that the file has a header row and data rows, and that the delimiter is tab or comma.</span>'
    : '<strong>'+rows.length+'</strong> rows detected'
      + (parsed.skipped ? ' (<em>'+parsed.skipped+' blank rows skipped</em>)' : '')
      + ' — showing first 5 as preview. '
      + (parsed.missing.length ? '<span style="color:var(--danger);">Warning: could not find columns: <strong>'+parsed.missing.join(', ')+'</strong></span>' : ''));
  // Build preview table
  var previewCols = ['name','event_date','dob','father','mother','sponsors','officiant','baptism_place'];
  var thead = document.getElementById('reg-import-preview-head');
  var tbody = document.getElementById('reg-import-preview-body');
  if (thead) thead.innerHTML = '<tr>'+previewCols.map(function(c){ return '<th style="padding:5px 8px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;">'+c.replace(/_/g,' ')+'</th>'; }).join('')+'</tr>';
  if (tbody) tbody.innerHTML = rows.slice(0,5).map(function(r) {
    return '<tr>'+previewCols.map(function(c){
      return '<td style="padding:5px 8px;border-bottom:1px solid var(--border);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+(r[c]?esc(r[c]):'<span style="color:var(--faint);">\u2014</span>')+'</td>';
    }).join('')+'</tr>';
  }).join('');
  var warn = document.getElementById('reg-import-warn');
  if (warn) { warn.style.display = parsed.missing.length ? '' : 'none'; warn.textContent = parsed.missing.length ? 'Some columns were not found — those fields will be left blank.' : ''; }
  showRegImportStep(2);
}
function runRegImport() {
  if (!_regImportRows.length) {
    var sum = document.getElementById('reg-import-summary');
    if (sum) sum.innerHTML = '<span style="color:var(--danger);font-weight:600;">No rows to import — please select a file with data rows first.</span>';
    return;
  }
  var prog = document.getElementById('reg-import-progress');
  var btn  = document.querySelector('#reg-import-step2 .btn-primary');
  if (prog) { prog.style.display = ''; prog.textContent = 'Importing\u2026'; }
  if (btn) btn.disabled = true;
  var regType = document.getElementById('reg-import-type') ? document.getElementById('reg-import-type').value : 'baptism';
  var clearFirst = document.getElementById('reg-import-clear') && document.getElementById('reg-import-clear').checked;
  function doImport() {
  // Send in chunks of 50
  var allRows = _regImportRows.slice();
  var CHUNK = 50;
  var chunks = [];
  for (var i = 0; i < allRows.length; i += CHUNK) chunks.push(allRows.slice(i, i+CHUNK));
  var totalImported = 0, totalErrors = 0, lastApiErr = '';
  function sendChunk(idx) {
    if (idx >= chunks.length) {
      if (prog) prog.style.display = 'none';
      if (btn) btn.disabled = false;
      var doneMsg = document.getElementById('reg-import-done-msg');
      var doneSub = document.getElementById('reg-import-done-sub');
      if (doneMsg) doneMsg.textContent = totalImported + ' records imported successfully';
      if (doneSub) {
        var sub = totalErrors ? totalErrors+' rows had errors and were skipped.' : 'All records were saved to the register.';
        if (lastApiErr) sub += ' Last API error: ' + lastApiErr;
        doneSub.textContent = sub;
      }
      showRegImportStep(3);
      if (totalImported > 0) loadRegister();
      return;
    }
    if (prog) prog.textContent = 'Importing '+Math.min((idx+1)*CHUNK, allRows.length)+' of '+allRows.length+'\u2026';
    api('/admin/api/register/batch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(chunks[idx])
    }).then(function(r) {
      if (r.error) { lastApiErr = r.error; totalErrors += chunks[idx].length; }
      else { totalImported += (r.imported||0); totalErrors += (r.errors||0); }
      sendChunk(idx+1);
    }).catch(function(err) {
      lastApiErr = err ? (err.message||String(err)) : 'network error';
      totalErrors += chunks[idx].length;
      sendChunk(idx+1);
    });
  }
  sendChunk(0);
  } // end doImport
  if (clearFirst) {
    if (prog) prog.textContent = 'Clearing existing records\u2026';
    api('/admin/api/register/clear', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({type: regType})
    }).then(function() { doImport(); }).catch(function() { doImport(); });
  } else {
    doImport();
  }
}

`;
