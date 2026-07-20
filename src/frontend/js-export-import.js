export const JS_EXPORT_IMPORT = String.raw`// ── BATCH SEND ─────────────────────────────────────────────────────────
function loadBatchStatementGivers() {
  var yr = document.getElementById('batch-stmt-year').value;
  var status = document.getElementById('batch-stmt-status');
  var listEl = document.getElementById('batch-stmt-list');
  if (!yr) { status.textContent = 'Enter a year.'; status.className = 'import-status err'; return; }
  status.textContent = 'Loading givers for ' + yr + '…'; status.className = 'import-status';
  listEl.innerHTML = '';
  // Fetch people who gave in this year (via giving summary approach - get all people with giving)
  api('/admin/api/reports/giving-statement?year=' + yr + '&list_givers=1').then(function(d) {
    var givers = d.givers || [];
    if (!givers.length) {
      status.textContent = 'No givers with email found for ' + yr + '.';
      status.className = 'import-status err';
      return;
    }
    status.textContent = givers.length + ' givers found with email. Check who to include, then Send.';
    status.className = 'import-status ok';
    listEl.innerHTML = '<div style="margin-bottom:8px;display:flex;gap:8px;">'
      + '<button class="btn-sm" onclick="selectAllBatchGivers(true)">Select All</button>'
      + '<button class="btn-sm" onclick="selectAllBatchGivers(false)">Deselect All</button>'
      + '<button class="btn-primary" style="font-size:.8rem;padding:4px 12px;" onclick="sendBatchStatements(' + yr + ')">Send Selected</button>'
      + '</div>'
      + '<div id="batch-givers-list">'
      + givers.map(function(g) {
        return '<label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.85rem;cursor:pointer;">'
          + '<input type="checkbox" data-pid="' + g.id + '" checked>'
          + '<span>' + esc(g.first_name + ' ' + g.last_name) + '</span>'
          + '<span style="color:var(--warm-gray);font-size:.78rem;">' + esc(g.email) + '</span>'
          + '<span style="margin-left:auto;font-size:.78rem;">' + fmtMoney(g.total_cents) + '</span>'
          + '</label>';
      }).join('')
      + '</div>';
  }).catch(function(e) {
    status.textContent = 'Error: ' + e.message; status.className = 'import-status err';
  });
}
function selectAllBatchGivers(checked) {
  document.querySelectorAll('#batch-givers-list input[type=checkbox]').forEach(function(cb) { cb.checked = checked; });
}
function sendBatchStatements(yr) {
  var status = document.getElementById('batch-stmt-status');
  var checks = document.querySelectorAll('#batch-givers-list input[type=checkbox]:checked');
  if (!checks.length) { status.textContent = 'No givers selected.'; status.className = 'import-status err'; return; }
  // Ensure church config is loaded
  if (!_churchConfig.church_name) {
    api('/admin/api/config/church').then(function(cfg) {
      _churchConfig = cfg || {};
      doSendBatch(yr, checks, status);
    });
  } else {
    doSendBatch(yr, checks, status);
  }
}
function doSendBatch(yr, checks, status) {
  var ids = Array.from(checks).map(function(cb){return cb.dataset.pid;});
  var total = ids.length, done = 0, failed = 0, skipped = 0;
  status.textContent = 'Sending 0/' + total + '…'; status.className = 'import-status';
  function sendNext() {
    if (!ids.length) {
      var msg = 'Done. ' + done + ' sent';
      if (skipped) msg += ', ' + skipped + ' skipped (no email)';
      if (failed) msg += ', ' + failed + ' failed';
      msg += '.';
      status.textContent = msg;
      status.className = failed ? 'import-status' : 'import-status ok';
      return;
    }
    var pid = ids.shift();
    api('/admin/api/reports/giving-statement?person_id=' + pid + '&year=' + yr).then(function(d) {
      if (d.error || !d.person) { failed++; sendNext(); return; }
      d._mode = 'person';
      var p = d.person || {};
      if (!p.email) { skipped++; sendNext(); return; }
      var churchName = _churchConfig.church_name || 'Timothy Lutheran Church';
      var letterHtml = renderLetterHTML(d);
      var fullHtml = '<div style="font-family:Georgia,serif;font-size:14px;line-height:1.65;max-width:560px;">'
        + '<div style="font-size:16px;font-weight:bold;margin-bottom:6px;">' + esc(churchName) + '</div><hr style="margin:10px 0;">'
        + letterHtml + '</div>';
      return api('/admin/api/giving/send-statement', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          to_email: p.email,
          to_name: (p.first_name + ' ' + p.last_name).trim(),
          subject: yr + ' Charitable Contribution Statement — ' + churchName,
          html_body: fullHtml
        })
      });
    }).then(function(r) {
      if (r && r.ok) done++; else failed++;
      status.textContent = 'Sending ' + (done+failed+skipped) + '/' + total + '…';
      sendNext();
    }).catch(function() { failed++; sendNext(); });
  }
  sendNext();
}
// ── GENERATE REGISTER FROM PEOPLE ─────────────────────────────────────
// Called from the Register tab toolbar — uses the current register type
function openRegFromPeoplePrompt() {
  var type  = _regType;
  var label = type === 'baptism' ? 'Baptisms' : 'Confirmations';
  var btn   = document.querySelector('[onclick="openRegFromPeoplePrompt()"]');
  var stat  = document.getElementById('reg-stat-txt');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating\u2026'; }
  if (stat) stat.textContent = 'Generating\u2026';
  api('/admin/api/import/register-from-people', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ cutoff: '1900-01-01', types: [type] })
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128100; From People'; }
    if (d.error) {
      if (stat) stat.textContent = 'Error: ' + d.error;
      return;
    }
    var msg = d.imported + ' ' + label.toLowerCase() + ' added';
    if (d.skipped) msg += ', ' + d.skipped + ' already existed';
    if (stat) stat.textContent = msg;
    if (d.imported > 0) loadRegister();
  }).catch(function(e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#128100; From People'; }
    if (stat) stat.textContent = 'Error: ' + e.message;
  });
}
// ── CLEAR GIVING ──────────────────────────────────────────────────────
function pruneEmptyBatches() {
  var status = document.getElementById('prune-batches-status');
  status.textContent = 'Pruning…'; status.className = 'import-status';
  api('/admin/api/giving/prune-empty-batches', {method:'POST'}).then(function(d) {
    if (d.ok) {
      status.textContent = 'Done — ' + d.deleted + ' empty batch(es) deleted.';
      status.className = 'import-status ok';
      loadBatches();
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
// ── EXPORT ──────────────────────────────────────────────────────────────
function exportPeople() {
  var status = document.getElementById('export-status');
  status.textContent = 'Preparing people export…'; status.className = 'import-status';
  var a = document.createElement('a');
  a.href = '/admin/api/export/people';
  a.download = 'people-export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { status.textContent = 'Download started.'; status.className = 'import-status ok'; }, 500);
}
function exportGiving() {
  var status = document.getElementById('export-status');
  var year = document.getElementById('export-giving-year').value;
  status.textContent = 'Preparing giving export…'; status.className = 'import-status';
  var a = document.createElement('a');
  a.href = '/admin/api/export/giving' + (year ? '?year=' + year : '');
  a.download = year ? ('giving-' + year + '.csv') : 'giving-all.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { status.textContent = 'Download started.'; status.className = 'import-status ok'; }, 500);
}
function exportRegister() {
  var status = document.getElementById('export-status');
  status.textContent = 'Preparing register export…'; status.className = 'import-status';
  var a = document.createElement('a');
  a.href = '/admin/api/export/register';
  a.download = 'register-export.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { status.textContent = 'Download started.'; status.className = 'import-status ok'; }, 500);
}
function clearGivingByYear() {
  var year = (document.getElementById('clear-year-input').value || '').trim();
  if (!/^\d{4}$/.test(year)) { alert('Enter a valid 4-digit year.'); return; }
  var status = document.getElementById('clear-year-status');
  if (!confirm('This will PERMANENTLY DELETE all giving entries for ' + year + '. 2021\u20132025 data will not be affected.\n\nAre you sure?')) return;
  status.textContent = 'Deleting\u2026'; status.className = 'import-status';
  api('/admin/api/giving/by-year?year=' + year, {method:'DELETE'}).then(function(d) {
    if (d.ok) {
      status.textContent = 'Deleted ' + (d.deleted||0) + ' entries for ' + year + '. Safe to re-import.';
      status.className = 'import-status ok';
      loadBatches();
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  });
}
function clearAllGiving() {
  if (!confirm('This will PERMANENTLY DELETE all giving entries and batches. This cannot be undone.\\n\\nAre you absolutely sure?')) return;
  if (!confirm('Last chance — click OK to permanently delete ALL giving data.')) return;
  var status = document.getElementById('clear-giving-status');
  status.textContent = 'Deleting…'; status.className = 'import-status';
  api('/admin/api/giving/all', {method:'DELETE'}).then(function(d) {
    if (d.ok) {
      status.textContent = 'All giving data cleared. You can now re-import.';
      status.className = 'import-status ok';
      loadBatches();
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function addToNewsletter(id, email, firstName, lastName) {
  var st = document.getElementById('pv-newsletter-status');
  if (st) st.textContent = 'Adding\u2026';
  api('/admin/api/brevo/sync-contact', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({email: email, first_name: firstName, last_name: lastName})
  }).then(function(r) {
    if (st) { st.textContent = r.ok ? 'Added to newsletter \u2713' : 'Error: '+(r.error||'unknown'); }
  }).catch(function() { if (st) st.textContent = 'Request failed.'; });
}
function brevoCheckSync() {
  var status = document.getElementById('brevo-reconcile-status');
  var results = document.getElementById('brevo-reconcile-results');
  status.textContent = 'Checking\u2026'; status.className = 'import-status';
  results.innerHTML = '';
  api('/admin/api/brevo/reconcile').then(function(d) {
    if (d.error) { status.textContent = 'Error: '+d.error; status.className = 'import-status err'; return; }
    status.textContent = d.chms_member_count+' members in ChMS with email \u00b7 '+d.brevo_list_count+' contacts in Brevo list';
    status.className = 'import-status ok';
    var html = '';
    if (d.missing_from_brevo && d.missing_from_brevo.length) {
      html += '<div style="margin-top:10px;"><strong style="color:var(--charcoal);">'+d.missing_from_brevo.length+' members missing from Brevo:</strong>'
        + ' <button class="btn-secondary" style="font-size:.78rem;padding:2px 8px;margin-left:8px;" onclick="brevoBulkSyncAll()">Add All Missing</button>'
        + '<div style="margin-top:6px;font-size:.82rem;color:var(--warm-gray);max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:6px 10px;">'
        + d.missing_from_brevo.map(function(p){ return esc(p.first_name+' '+p.last_name)+' &lt;'+esc(p.email)+'&gt;'; }).join('<br>')
        + '</div></div>';
    } else {
      html += '<div style="margin-top:8px;color:var(--teal);font-size:.88rem;">&#10003; All members are in Brevo.</div>';
    }
    if (d.in_brevo_not_chms && d.in_brevo_not_chms.length) {
      html += '<div style="margin-top:10px;"><strong style="color:var(--warm-gray);">'+d.in_brevo_not_chms.length+' in Brevo not found as active members</strong>'
        + ' <span style="font-size:.78rem;color:var(--warm-gray);">(website sign-ups or past members — no action needed)</span>'
        + '<div style="margin-top:4px;font-size:.78rem;color:var(--warm-gray);max-height:100px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:4px 8px;">'
        + d.in_brevo_not_chms.map(esc).join('<br>')
        + '</div></div>';
    }
    results.innerHTML = html;
  }).catch(function() { status.textContent = 'Request failed.'; status.className = 'import-status err'; });
}
function brevoBulkSyncAll() {
  var status = document.getElementById('brevo-reconcile-status');
  status.textContent = 'Syncing all members to Brevo\u2026'; status.className = 'import-status';
  document.getElementById('brevo-reconcile-results').innerHTML = '';
  api('/admin/api/brevo/bulk-sync', {method:'POST'}).then(function(d) {
    if (d.error) { status.textContent = 'Error: '+d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Bulk sync queued: '+d.count+' members sent to Brevo (import is async \u2014 allow a minute to complete).';
    status.className = 'import-status ok';
  }).catch(function() { status.textContent = 'Request failed.'; status.className = 'import-status err'; });
}
function runEmailTest(type) {
  var status = document.getElementById('email-test-status');
  status.textContent = 'Sending\u2026'; status.className = 'import-status';
  var endpoint = type === 'birthday' ? 'email/run-birthday' : 'email/run-anniversary';
  api('/admin/api/' + endpoint, {method:'POST'}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var label = type === 'birthday' ? 'Birthday' : 'Anniversary';
    var msg = label + ' emails: ' + d.sent + ' sent';
    if (d.skipped) msg += ', ' + d.skipped + ' already sent today';
    if (d.errors && d.errors.length) msg += '. Errors: ' + d.errors.join('; ');
    else msg += '.';
    status.textContent = msg; status.className = 'import-status ok';
  }).catch(function() { status.textContent = 'Request failed.'; status.className = 'import-status err'; });
}
function runSmsTest(type) {
  var status = document.getElementById('sms-test-status');
  status.textContent = 'Sending…'; status.className = 'import-status';
  var endpoint = type === 'birthday' ? 'sms/run-birthday' : 'sms/run-anniversary';
  api('/admin/api/' + endpoint, {method:'POST'}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var label = type === 'birthday' ? 'Birthday' : 'Anniversary';
    var msg = label + ' texts: ' + d.sent + ' sent';
    if (d.skipped) msg += ', ' + d.skipped + ' already sent today';
    if (d.errors && d.errors.length) msg += '. Errors: ' + d.errors.join('; ');
    else msg += '.';
    status.textContent = msg; status.className = 'import-status ok';
  }).catch(function() { status.textContent = 'Request failed.'; status.className = 'import-status err'; });
}
function fixHouseholdHeads() {
  var status = document.getElementById('hq4-status');
  status.textContent = 'Working\u2026'; status.className = 'import-status';
  api('/admin/api/households/fix-heads', {method:'POST'}).then(function(d) {
    if (d.ok) {
      var msg = 'Fixed ' + d.fixed + ' household' + (d.fixed === 1 ? '' : 's') + '.';
      if (d.fixed === 0) msg = 'All households already have a head assigned.';
      status.textContent = msg;
      status.className = 'import-status ok';
      var el = document.getElementById('hq4-status-text');
      if (el) el.textContent = '0 households have no Head of Household assigned.';
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
function applyAllHouseholdPhotos() {
  var status = document.getElementById('cascade-photos-status');
  status.textContent = 'Working…'; status.className = 'import-status';
  api('/admin/api/households/apply-photo-to-members-all', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: '{}'
  }).then(function(d) {
    if (d.ok) {
      var n = d.updated || 0;
      status.textContent = 'Updated ' + n + ' member' + (n === 1 ? '' : 's') + '.';
      status.className = 'import-status ok';
    } else {
      status.textContent = 'Error: ' + (d.error||'unknown');
      status.className = 'import-status err';
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
function bulkValidateAddresses() {
  var btn = document.getElementById('bulk-validate-addr-btn');
  var status = document.getElementById('bulk-validate-addr-status');
  if (btn) btn.disabled = true;
  var totals = { validated: 0, updated: 0, failed: 0, total: 0 };
  var allFailures = [];
  function runPage(offset) {
    if (status) { status.textContent = 'Validating… ' + (totals.total ? offset + ' of ' + totals.total : ''); status.className = 'import-status'; }
    api('/admin/api/utils/bulk-validate-addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset: offset })
    }).then(function(d) {
      if (!d.ok) {
        if (btn) btn.disabled = false;
        if (status) { status.textContent = 'Error: ' + (d.error || 'unknown'); status.className = 'import-status err'; }
        return;
      }
      totals.total = d.total;
      totals.validated += d.validated;
      totals.updated += d.updated;
      totals.failed += d.failed;
      if (d.failures && d.failures.length) allFailures = allFailures.concat(d.failures);
      if (d.hasMore) {
        runPage(d.nextOffset);
      } else {
        if (btn) btn.disabled = false;
        var msg = 'Done. Validated ' + totals.validated + ' of ' + totals.total + ' addresses. '
                + totals.updated + ' standardized';
        if (totals.failed) msg += ', ' + totals.failed + ' could not be validated';
        msg += '.';
        if (status) {
          status.className = 'import-status ok';
          var html = '<div>' + esc(msg) + '</div>';
          if (allFailures.length) {
            html += '<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:.82rem;color:var(--warm-gray);">'
              + 'Show ' + allFailures.length + ' unvalidated address' + (allFailures.length === 1 ? '' : 'es')
              + '</summary><div style="margin-top:6px;font-size:.8rem;">'
              + allFailures.map(function(f) {
                  return '<div style="padding:4px 0;border-bottom:1px solid var(--border);">'
                    + '<a href="#" onclick="goToProfile(' + f.id + ');return false;" style="font-weight:600;color:var(--teal);">' + esc(f.name || 'Person #' + f.id) + '</a>'
                    + ' <span style="color:var(--warm-gray);">' + esc(f.address || '') + '</span>'
                    + (f.error ? ' <span style="color:#c0392b;font-size:.75rem;">— ' + esc(f.error) + '</span>' : '')
                    + '</div>';
                }).join('')
              + '</div></details>';
          }
          status.innerHTML = html;
        }
      }
    }).catch(function(e) {
      if (btn) btn.disabled = false;
      if (status) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; }
    });
  }
  runPage(0);
}
function normalizeAllPhones() {
  var status = document.getElementById('normalize-phones-status');
  if (status) { status.textContent = 'Working…'; status.className = 'import-status'; }
  api('/admin/api/utils/normalize-phones', {method:'POST'}).then(function(d) {
    if (d.ok) {
      var msg = d.updated + ' phone number' + (d.updated === 1 ? '' : 's') + ' reformatted'
              + ' (' + d.total_with_phone + ' total with a phone number).';
      if (d.updated === 0) msg = 'All phone numbers are already in the correct format.';
      if (status) { status.textContent = msg; status.className = 'import-status ok'; }
    } else {
      if (status) { status.textContent = 'Error: ' + (d.error||'unknown'); status.className = 'import-status err'; }
    }
  }).catch(function(e) {
    if (status) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; }
  });
}

// ── IMPORT ──────────────────────────────────────────────────────────────
function loadFundMapping() {
  var status = document.getElementById('fund-map-status');
  status.textContent = 'Loading…'; status.className = 'import-status';
  api('/admin/api/import/breeze-fund-list').then(function(d) {
    var breezeFunds = d.breeze_funds || [];
    var realFunds   = d.real_funds   || [];
    var breezeSubdomain = d.breeze_subdomain || '';
    if (!breezeFunds.length) {
      status.textContent = 'No unmapped Breeze funds found — all done!';
      status.className = 'import-status ok';
      return;
    }
    // Options for merge-into-existing
    var mergeOpts = realFunds.map(function(f) {
      return '<option value="merge:' + f.id + '">Merge into: ' + esc(f.name) + '</option>';
    }).join('');
    var rows = breezeFunds.map(function(f) {
      var amt = '$' + (f.total_cents / 100).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
      var breezeLink = (breezeSubdomain && f.breeze_id)
        ? ' <a href="https://' + esc(breezeSubdomain) + '.breezechms.com/payments/reports#/&funds=' + esc(f.breeze_id) + '" target="_blank" style="font-size:.78rem;color:var(--link);">View in Breeze &#8599;</a>'
        : '';
      return '<tr style="border-bottom:1px solid #eee;">'
        + '<td style="padding:6px 8px;font-size:.82rem;">' + esc(f.name) + breezeLink + '<br><span style="color:#888;">' + f.gifts + ' gifts &bull; ' + amt + '</span></td>'
        + '<td style="padding:6px 8px;">'
        +   '<select data-from="' + f.id + '" style="font-size:.82rem;padding:2px 4px;width:100%;margin-bottom:4px;">'
        +     '<option value="">— skip —</option>'
        +     '<option value="rename">Rename to real name below</option>'
        +     mergeOpts
        +   '</select>'
        +   '<input type="text" data-rename="' + f.id + '" placeholder="New fund name (if renaming)" style="font-size:.82rem;padding:2px 6px;width:100%;display:none;">'
        + '</td></tr>';
    }).join('');
    document.getElementById('fund-map-rows').innerHTML = rows;
    // Show/hide rename input when "Rename" selected
    document.querySelectorAll('#fund-map-rows select').forEach(function(sel) {
      sel.addEventListener('change', function() {
        var inp = document.querySelector('input[data-rename="' + sel.dataset.from + '"]');
        if (inp) inp.style.display = sel.value === 'rename' ? 'block' : 'none';
      });
    });
    document.getElementById('fund-map-area').style.display = 'block';
    status.textContent = breezeFunds.length + ' Breeze fund(s) need mapping. For each: rename it OR merge into an existing fund.';
    status.className = 'import-status';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function applyFundMapping() {
  var status = document.getElementById('fund-map-status');
  var selects = document.querySelectorAll('#fund-map-rows select');
  var mappings = [];
  selects.forEach(function(sel) {
    var fromId = parseInt(sel.dataset.from);
    var val = sel.value;
    if (!val || val === '') return;
    if (val === 'rename') {
      var inp = document.querySelector('input[data-rename="' + sel.dataset.from + '"]');
      var newName = inp ? inp.value.trim() : '';
      if (newName) mappings.push({ from_id: fromId, rename: newName });
    } else if (val.startsWith('merge:')) {
      mappings.push({ from_id: fromId, to_id: parseInt(val.slice(6)) });
    }
  });
  if (!mappings.length) { status.textContent = 'No mappings selected.'; status.className = 'import-status err'; return; }
  status.textContent = 'Applying…'; status.className = 'import-status';
  api('/admin/api/import/map-funds', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mappings:mappings})}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Done! ' + (d.entries_moved||0) + ' contributions re-linked, ' + (d.renamed||0) + ' funds renamed. Reload to continue.';
    status.className = 'import-status ok';
    document.getElementById('fund-map-area').style.display = 'none';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function loadDuplicateFunds() {
  var status = document.getElementById('dup-funds-status');
  var area = document.getElementById('dup-funds-area');
  status.textContent = 'Loading…'; status.className = 'import-status';
  area.innerHTML = '';
  api('/admin/api/funds/duplicates').then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var groups = d.duplicates || [];
    if (!groups.length) {
      status.textContent = 'No duplicate fund names found.';
      status.className = 'import-status ok';
      return;
    }
    area.innerHTML = groups.map(function(g, gi) {
      var rows = g.funds.map(function(f, fi) {
        var amt = '$' + (f.total_cents / 100).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
        return '<tr style="border-bottom:1px solid #eee;">'
          + '<td style="padding:6px 8px;"><label style="font-size:.82rem;"><input type="radio" name="dup-keep-' + gi + '" value="' + f.id + '"' + (fi === 0 ? ' checked' : '') + '> Keep this one</label></td>'
          + '<td style="padding:6px 8px;font-size:.82rem;">#' + f.id + (f.breeze_id ? ' &bull; breeze_id ' + esc(f.breeze_id) : ' &bull; no breeze_id') + (f.active ? '' : ' &bull; <span style="color:#999;">inactive</span>') + '</td>'
          + '<td style="padding:6px 8px;font-size:.82rem;">' + f.entry_count + ' gifts &bull; ' + amt + '</td></tr>';
      }).join('');
      return '<div style="margin:10px 0;padding:8px;border:1px solid var(--border);border-radius:8px;">'
        + '<div style="font-weight:600;font-size:.9rem;margin-bottom:6px;">' + esc(g.name) + ' <span style="font-weight:400;color:var(--warm-gray);font-size:.8rem;">(' + g.funds.length + ' duplicate rows)</span></div>'
        + '<table style="width:100%;border-collapse:collapse;" data-dup-group="' + gi + '">' + rows + '</table>'
        + '<button class="btn-secondary" style="margin-top:6px;font-size:.82rem;" onclick="mergeDuplicateFundGroup(' + gi + ')">Merge into selected</button>'
        + '</div>';
    }).join('');
    status.textContent = groups.length + ' duplicate fund name group(s) found. Pick which row to keep in each, then merge.';
    status.className = 'import-status';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function mergeDuplicateFundGroup(gi) {
  var status = document.getElementById('dup-funds-status');
  var table = document.querySelector('table[data-dup-group="' + gi + '"]');
  if (!table) return;
  var radios = table.querySelectorAll('input[type=radio]');
  var keepId = null, allIds = [];
  radios.forEach(function(r) {
    allIds.push(parseInt(r.value));
    if (r.checked) keepId = parseInt(r.value);
  });
  if (!keepId) { status.textContent = 'Pick which fund to keep first.'; status.className = 'import-status err'; return; }
  var removeIds = allIds.filter(function(id) { return id !== keepId; });
  if (!removeIds.length) return;
  if (!confirm('Merge ' + removeIds.length + ' duplicate fund(s) into fund #' + keepId + '? Their gifts will be reassigned and the duplicate rows deleted. This cannot be undone.')) return;
  status.textContent = 'Merging…'; status.className = 'import-status';
  api('/admin/api/funds/merge', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({keep_id:keepId, remove_ids:removeIds})}).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Merged. ' + (d.moved_entries||0) + ' gift(s) reassigned to fund #' + keepId + '.';
    status.className = 'import-status ok';
    loadDuplicateFunds();
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

// ── SCHEDULER VOLUNTEER MIGRATION (SC6 Phase 2) ───────────────────────
// Matches the old Scheduler's client-side "ws_people" list to real ChMS People records
// and lets an admin/staff review and commit the link — no auto-guessing, always a human
// picks before anything is written.
var _svMigPending = [];
function svMigConfidenceLabel(c) {
  var labels = {
    breeze_id: 'Matched by Breeze ID', exact_name: 'Exact name match',
    fuzzy: 'Possible match', ambiguous_name: 'Multiple people share this name',
    none: 'No match found'
  };
  return labels[c] || c;
}
function svMigConfidenceColor(c) {
  var colors = { breeze_id: '#2e7d32', exact_name: '#2e7d32', fuzzy: '#c9973a', ambiguous_name: '#c0392b', none: '#999' };
  return colors[c] || '#999';
}
function svMigRowHtml(p, i) {
  var rowName = 'sv-mig-row-' + i;
  var m = p.match || { confidence: 'none', suggested: null, candidates: [] };
  var options = '';
  var pickedSomething = false;
  if (m.suggested) {
    options += '<label style="display:block;font-size:.85rem;margin:2px 0;"><input type="radio" name="' + rowName + '" value="link:' + m.suggested.id + '" checked> Link to ' + esc(m.suggested.first_name + ' ' + m.suggested.last_name) + ' (' + esc(m.suggested.email || 'no email') + ')</label>';
    pickedSomething = true;
  }
  (m.candidates || []).forEach(function(c) {
    if (m.suggested && c.id === m.suggested.id) return;
    options += '<label style="display:block;font-size:.85rem;margin:2px 0;"><input type="radio" name="' + rowName + '" value="link:' + c.id + '"> Link to ' + esc(c.first_name + ' ' + c.last_name) + ' (' + esc(c.email || 'no email') + ')</label>';
  });
  options += '<label style="display:block;font-size:.85rem;margin:2px 0;"><input type="radio" name="' + rowName + '" value="create"' + (!pickedSomething ? ' checked' : '') + '> Create a new person named ' + esc(p.name || '(no name)') + '</label>';
  options += '<label style="display:block;font-size:.85rem;margin:2px 0;"><input type="radio" name="' + rowName + '" value="skip"> Skip for now</label>';
  options += '<div style="margin:4px 0;position:relative;">'
    + '<input type="text" placeholder="Search a different person..." id="sv-mig-search-' + i + '" oninput="svMigSearch(' + i + ')" style="font-size:.8rem;padding:4px 6px;border:1px solid var(--border);border-radius:6px;width:240px;">'
    + '<div id="sv-mig-search-results-' + i + '" style="position:absolute;background:var(--white);border:1px solid var(--border);border-radius:6px;z-index:20;max-width:280px;"></div>'
    + '</div>';

  return '<div class="sv-mig-row" data-legacy-id="' + esc(p.legacy_id) + '" style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;">'
    + '<div style="font-weight:600;font-size:.9rem;">' + esc(p.name || '(no name)')
    + '<span style="font-weight:400;color:var(--warm-gray);font-size:.78rem;"> — ' + esc((p.roles || []).join(', ') || 'no roles') + '</span></div>'
    + '<div style="font-size:.75rem;color:' + svMigConfidenceColor(m.confidence) + ';font-weight:600;margin-bottom:4px;">' + svMigConfidenceLabel(m.confidence) + '</div>'
    + options
    + '</div>';
}
function loadSchedulerVolunteerMigration() {
  var status = document.getElementById('sv-mig-status');
  var area = document.getElementById('sv-mig-area');
  status.textContent = 'Loading…'; status.className = 'import-status';
  area.innerHTML = '';
  api('/admin/api/scheduler/volunteers/migration-preview').then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    _svMigPending = d.pending || [];
    if (!_svMigPending.length) {
      status.textContent = 'Nothing to migrate. ' + (d.already_migrated_count || 0) + ' already migrated, ' + (d.total_legacy || 0) + ' total legacy volunteer(s).';
      status.className = 'import-status ok';
      return;
    }
    area.innerHTML = _svMigPending.map(function(p, i) { return svMigRowHtml(p, i); }).join('')
      + '<button class="btn-primary" onclick="svMigCommitAll()">Commit Selected</button>';
    status.textContent = _svMigPending.length + ' legacy volunteer(s) to review. ' + (d.already_migrated_count || 0) + ' already migrated.';
    status.className = 'import-status';
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}
function svMigSearch(i) {
  var inp = document.getElementById('sv-mig-search-' + i);
  var resultsEl = document.getElementById('sv-mig-search-results-' + i);
  var q = inp.value;
  if (q.length < 2) { resultsEl.innerHTML = ''; return; }
  api('/admin/api/people?q=' + encodeURIComponent(q)).then(function(d) {
    var rows = (d.people || []).slice(0, 8);
    resultsEl.innerHTML = rows.map(function(p) {
      var name = esc(p.first_name + ' ' + p.last_name);
      return '<div style="cursor:pointer;padding:3px 6px;font-size:.8rem;" onclick="svMigPickSearchResult(' + i + ',' + p.id + ',&#39;' + name.replace(/'/g, '&#39;') + '&#39;)">'
        + esc(p.last_name) + ', ' + esc(p.first_name) + (p.email ? ' — ' + esc(p.email) : '') + '</div>';
    }).join('');
  });
}
function svMigPickSearchResult(i, personId, name) {
  var rows = document.querySelectorAll('.sv-mig-row');
  var row = rows[i];
  if (!row) return;
  var rowName = 'sv-mig-row-' + i;
  var existing = row.querySelector('input[value="link:' + personId + '"]');
  if (existing) {
    existing.checked = true;
  } else {
    var label = document.createElement('label');
    label.style.display = 'block'; label.style.fontSize = '.85rem'; label.style.margin = '2px 0';
    label.innerHTML = '<input type="radio" name="' + rowName + '" value="link:' + personId + '" checked> Link to ' + esc(name);
    var searchWrap = row.querySelector('input[type=text]').parentNode;
    row.insertBefore(label, searchWrap);
    label.querySelector('input').checked = true;
  }
  document.getElementById('sv-mig-search-results-' + i).innerHTML = '';
  document.getElementById('sv-mig-search-' + i).value = '';
}
function svMigCommitAll() {
  var status = document.getElementById('sv-mig-status');
  var mappings = _svMigPending.map(function(p, i) {
    var checked = document.querySelector('input[name="sv-mig-row-' + i + '"]:checked');
    var val = checked ? checked.value : 'skip';
    if (val === 'create') return { legacy_id: p.legacy_id, action: 'create' };
    if (val.indexOf('link:') === 0) return { legacy_id: p.legacy_id, action: 'link', person_id: parseInt(val.slice(5), 10) };
    return { legacy_id: p.legacy_id, action: 'skip' };
  });
  status.textContent = 'Committing…'; status.className = 'import-status';
  api('/admin/api/scheduler/volunteers/migration-commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mappings: mappings }) }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var msg = d.linked + ' linked, ' + d.created + ' created, ' + d.skipped + ' skipped.';
    if (d.errors && d.errors.length) msg += ' ' + d.errors.length + ' error(s): ' + d.errors.map(function(e) { return e.error; }).join('; ');
    status.textContent = msg;
    status.className = (d.errors && d.errors.length) ? 'import-status err' : 'import-status ok';
    loadSchedulerVolunteerMigration();
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function downloadBreezeAuditLog() {
  var from = document.getElementById('giving-sync-from').value;
  var to = document.getElementById('giving-sync-to').value;
  if (!from || !to) { alert('Please select a date range (From / To) above first.'); return; }
  window.location.href = '/admin/api/giving/breeze-audit-export?start=' + encodeURIComponent(from) + '&end=' + encodeURIComponent(to);
}

function runBreezeGivingSync() {
  var from = document.getElementById('giving-sync-from').value;
  var to = document.getElementById('giving-sync-to').value;
  var status = document.getElementById('giving-sync-status');
  if (!from || !to) { status.textContent = 'Please select a date range.'; status.className = 'import-status err'; return; }
  status.textContent = 'Syncing ' + from + ' to ' + to + '…'; status.className = 'import-status';
  api('/admin/api/import/breeze-giving', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({start: from, end: to})
  }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var msg = 'Done. ' + (d.imported||0) + ' imported';
    if (d.lateImported) msg += ', ' + d.lateImported + ' cross-year late entries imported';
    if (d.corrected) msg += ', ' + d.corrected + ' in-place corrections';
    if (d.orphansRemoved) msg += ', ' + d.orphansRemoved + ' stale entries removed (deleted/edited in Breeze)';
    if (d.diagnostics && d.diagnostics.orphanSafetyAbort) msg += ', ' + (d.diagnostics.orphanCandidates || 0) + ' orphan candidates SKIPPED (safety: ' + (d.diagnostics.orphanSafetyReason || 'unknown') + ')';
    if (d.diagnostics && d.diagnostics.warnings && d.diagnostics.warnings.length) msg += ', ' + d.diagnostics.warnings.length + ' warning(s) (see diagnostics)';
    if (d.skipped) msg += ', ' + d.skipped + ' already existed';
    if (d.skippedDateFilter) msg += ', ' + d.skippedDateFilter + ' outside date range (see diagnostics)';
    if (d.dupesRemoved) msg += ', ' + d.dupesRemoved + ' dupes removed';
    if (d.fundsRenamed) msg += ', ' + d.fundsRenamed + ' funds renamed';
    if (d.fundsMade) msg += ', ' + d.fundsMade + ' funds created';
    if (d.errors && d.errors.length) msg += ', ' + d.errors.length + ' error(s)';
    msg += '.';
    status.textContent = msg; status.className = 'import-status ok';
    var diagEl = document.getElementById('giving-sync-diagnostics');
    if (diagEl) {
      diagEl.style.display = 'block';
      var out = {};
      if (d.lateEntries && d.lateEntries.length) out.lateEntries = d.lateEntries;
      if (d.ghostFundContribs && d.ghostFundContribs.length) out.ghostFundContribs = d.ghostFundContribs;
      if (d.diagnostics) out.diagnostics = d.diagnostics;
      diagEl.textContent = JSON.stringify(Object.keys(out).length ? out : d, null, 2);
    }
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function runBreezeGivingAll() {
  var startYear = parseInt(document.getElementById('giving-sync-start-year').value) || 2020;
  var currentYear = new Date().getFullYear();
  var status = document.getElementById('giving-all-status');
  var btn = document.getElementById('giving-all-btn');
  btn.disabled = true;
  var totalImported = 0, totalSkipped = 0;
  var years = [];
  for (var y = startYear; y <= currentYear; y++) years.push(y);
  var idx = 0;
  function doYear() {
    if (idx >= years.length) {
      btn.disabled = false;
      status.textContent = 'All done! ' + totalImported + ' contributions imported, ' + totalSkipped + ' already existed.';
      status.className = 'import-status ok';
      return;
    }
    var yr = years[idx++];
    status.textContent = 'Syncing ' + yr + '… (' + idx + '/' + years.length + ' years)';
    status.className = 'import-status';
    api('/admin/api/import/breeze-giving', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({start: yr + '-01-01', end: yr + '-12-31'})
    }).then(function(d) {
      if (d.error) {
        btn.disabled = false;
        status.textContent = 'Error on ' + yr + ': ' + d.error;
        status.className = 'import-status err';
        return;
      }
      totalImported += (d.imported || 0) + (d.lateImported || 0);
      totalSkipped  += d.skipped  || 0;
      status.textContent = yr + ': ' + (d.imported||0) + ' imported' + (d.lateImported ? ', ' + d.lateImported + ' late' : '') + ' — running total: ' + totalImported + ' imported, ' + totalSkipped + ' skipped';
      doYear();
    }).catch(function(e) {
      btn.disabled = false;
      status.textContent = 'Error on ' + yr + ': ' + e.message;
      status.className = 'import-status err';
    });
  }
  doYear();
}

function applyManualFundRenames() {
  var rows = document.querySelectorAll('#manual-fund-rename-table tr[data-fund-id]');
  var updates = [];
  rows.forEach(function(row) {
    var newName = row.querySelector('input').value.trim();
    var fundId = row.getAttribute('data-fund-id');
    if (newName) updates.push({ id: parseInt(fundId), name: newName });
  });
  if (!updates.length) { alert('Enter at least one fund name.'); return; }
  var status = document.getElementById('fix-fund-names-status');
  status.textContent = 'Saving ' + updates.length + ' fund name(s)…'; status.className = 'import-status';
  api('/admin/api/import/manual-fund-renames', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: updates }) })
    .then(function(d) {
      if (d.ok) {
        status.textContent = 'Renamed ' + d.renamed + ' fund(s).'; status.className = 'import-status ok';
        document.getElementById('manual-fund-rename-area').style.display = 'none';
        loadFunds && loadFunds();
      } else {
        status.textContent = 'Error: ' + (d.error || 'unknown'); status.className = 'import-status err';
      }
    }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function fixFundNames() {
  var status = document.getElementById('fix-fund-names-status');
  status.textContent = 'Looking up fund names from Breeze…'; status.className = 'import-status';
  api('/admin/api/import/fix-fund-names', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})
    .then(function(d) {
      if (!d.ok && d.needsManual) {
        status.textContent = 'Breeze API did not return fund names. Enter the real names below:';
        status.className = 'import-status';
        var area = document.getElementById('manual-fund-rename-area');
        var tbody = document.getElementById('manual-fund-rename-table');
        tbody.innerHTML = '';
        (d.placeholderFunds || []).forEach(function(f) {
          var tr = document.createElement('tr');
          tr.setAttribute('data-fund-id', f.id);
          tr.innerHTML = '<td style="padding:4px 8px;font-size:.82rem;color:var(--warm-gray);">ID: ' + esc(f.breeze_id||'?') + '</td>'
            + '<td style="padding:4px 8px;font-size:.82rem;">' + esc(f.name) + '</td>'
            + '<td style="padding:4px;"><input type="text" placeholder="Real fund name" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:.85rem;"></td>';
          tbody.appendChild(tr);
        });
        area.style.display = '';
        return;
      }
      if (!d.ok) {
        var msg = 'Error: ' + (d.error || JSON.stringify(d));
        if (d.httpStatus !== undefined) msg += ' (HTTP ' + d.httpStatus + ')';
        if (d.rawBodyPreview) msg += '\nBreeze response preview: ' + d.rawBodyPreview;
        status.textContent = msg; status.className = 'import-status err';
        return;
      }
      var msg = 'Breeze funds found: ' + d.breezeFundsFound + '. Renamed: ' + d.renamed + '.';
      if (d.renamed > 0) loadFunds && loadFunds();
      var noMatch = d.noMatchFunds || [];
      if (noMatch.length > 0) {
        msg += ' ' + noMatch.length + ' fund(s) not found in Breeze — enter names below:';
        var area = document.getElementById('manual-fund-rename-area');
        var tbody = document.getElementById('manual-fund-rename-table');
        tbody.innerHTML = '';
        noMatch.forEach(function(f) {
          var tr = document.createElement('tr');
          tr.setAttribute('data-fund-id', f.id);
          tr.innerHTML = '<td style="padding:4px 8px;font-size:.82rem;color:var(--warm-gray);white-space:nowrap;">Breeze ID: ' + esc(f.breeze_id||'?') + '</td>'
            + '<td style="padding:4px 8px;font-size:.82rem;">' + esc(f.old_name) + '</td>'
            + '<td style="padding:4px;"><input type="text" name="fund-rename" placeholder="Real fund name" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:5px;font-size:.85rem;"></td>';
          tbody.appendChild(tr);
        });
        area.style.display = '';
      }
      status.textContent = msg; status.className = 'import-status ' + (d.renamed > 0 || noMatch.length === 0 ? 'ok' : '');
    })
    .catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

function runBreezeImport() {
  var bar = document.getElementById('breeze-bar');
  var fill = document.getElementById('breeze-fill');
  var status = document.getElementById('breeze-status');
  bar.style.display = 'block'; fill.style.width = '0%';
  status.textContent = 'Starting import…'; status.className = 'import-status';
  var totalImported = 0, totalUpdated = 0, totalDeactivated = 0;
  var lastStatusField = null, allStatusesSeen = new Set();
  function doPage(offset) {
    api('/admin/api/import/breeze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({offset:offset, limit:100})}).then(function(d) {
      if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; bar.style.display = 'none'; return; }
      totalImported += d.imported || 0;
      totalUpdated += d.updated || 0;
      totalDeactivated += d.deactivated || 0;
      if (d.status_field) lastStatusField = d.status_field;
      if (d.statuses_seen) d.statuses_seen.forEach(function(s) { allStatusesSeen.add(s); });
      if (d._diag && !window._breezeImportDiag) {
        window._breezeImportDiag = d._diag;
        // Show diagnostic inline so no DevTools needed
        var diagEl = document.getElementById('breeze-diag');
        if (diagEl && d._diag) {
          var diag = d._diag;
          var lines = [
            'Date fields detected:',
            '  DOB: '          + (diag.dob_field          ? '"' + diag.dob_field.name          + '" (id ' + diag.dob_field.id          + ')' : '(not found)'),
            '  Baptism: '      + (diag.baptism_field      ? '"' + diag.baptism_field.name      + '" (id ' + diag.baptism_field.id      + ')' : '(not found — dates will be empty)'),
            '  Confirmation: ' + (diag.confirmation_field ? '"' + diag.confirmation_field.name + '" (id ' + diag.confirmation_field.id + ')' : '(not found — dates will be empty)'),
            '  Deceased: '     + (diag.deceased_field     ? '"' + diag.deceased_field.name     + '" (id ' + diag.deceased_field.id     + ')' : '(not found)'),
            '  Death date: '   + (diag.death_date_field   ? '"' + diag.death_date_field.name   + '" (id ' + diag.death_date_field.id   + ')' : '(not found)'),
            '  Envelope #: '   + (diag.envelope_field     ? '"' + diag.envelope_field.name     + '" (id ' + diag.envelope_field.id     + ')' : '(not found)'),
            'Status field ID: ' + (diag.status_field_id || '(none)'),
          ];
          if (diag.sample_top_level_keys && diag.sample_top_level_keys.length) {
            lines.push('Top-level person properties (not details/family):');
            diag.sample_top_level_keys.forEach(function(e) { lines.push('  ' + e.key + ' → ' + e.val); });
          }
          if (diag.sample_detail_entries) {
            lines.push('details entries:');
            diag.sample_detail_entries.forEach(function(e) { lines.push('  ' + e.key + ' → ' + e.val); });
          }
          diagEl.innerHTML = lines.map(function(l) { return esc(l); }).join('<br>');
          diagEl.style.display = 'block';
        }
      }
      fill.style.width = d.done ? '100%' : Math.min(95, (d.next_offset / Math.max(d.next_offset + 100, 200)) * 100) + '%';
      status.textContent = 'Imported ' + totalImported + ', updated ' + totalUpdated + '…';
      if (d.done) {
        var msg = 'People sync done. ' + totalImported + ' new, ' + totalUpdated + ' updated' + (totalDeactivated ? ', ' + totalDeactivated + ' deactivated' : '') + '.';
        if (!lastStatusField) {
          msg += ' ⚠ No Breeze status field detected — check Settings › Breeze Status Mapping.';
        } else if (allStatusesSeen.size === 0) {
          msg += ' ⚠ Status field "' + lastStatusField.name + '" found but no values seen.';
        } else {
          msg += ' Status field: "' + lastStatusField.name + '". Statuses: ' + [...allStatusesSeen].join(', ') + '.';
        }
        status.textContent = msg;
        status.className = (lastStatusField && allStatusesSeen.size > 0) ? 'import-status ok' : 'import-status warn';
        fill.style.width = '100%';
        loadPeople();
        // Auto-trigger tag sync after people import completes
        runBreezeTagSync();
        return;
      }
      doPage(d.next_offset);
    }).catch(function(e) { status.textContent = 'Network error: ' + e.message; status.className = 'import-status err'; });
  }
  doPage(0);
}
function runBreezeTagSync(btnEl) {
  var btn = btnEl || null;
  var origLabel = btn ? btn.innerHTML : '';
  var status = document.getElementById('breeze-tag-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing tags\u2026'; }
  if (status) { status.textContent = 'Fetching tag list\u2026'; status.className = 'import-status'; }
  // Phase 1: fetch + upsert tag list (one Breeze API call)
  api('/admin/api/import/breeze-sync-tags', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({phase:'list'}) })
    .then(function(r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'Unknown error');
      var tags = r.tags || [];
      var total = tags.length;
      var done = 0, totalAssignments = 0;
      // Phase 2: sync each tag's members one-at-a-time (one Breeze API call per tag)
      function syncNext() {
        if (done >= total) {
          if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
          var msg = 'Tags synced: ' + total + ' tags, ' + totalAssignments + ' assignments.';
          if (status) { status.textContent = msg; status.className = 'import-status ok'; }
          loadTags();
          return;
        }
        var tag = tags[done];
        if (status) status.textContent = 'Syncing tag ' + (done+1) + '/' + total + ': ' + tag.name + '\u2026';
        api('/admin/api/import/breeze-sync-tags', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({phase:'sync', tag_id: tag.breeze_id, local_tag_id: tag.local_id})
        }).then(function(sr) {
          totalAssignments += (sr && sr.assignments) || 0;
          done++;
          syncNext();
        }).catch(function() { done++; syncNext(); }); // skip failed tags and continue
      }
      syncNext();
    }).catch(function(e) {
      if (btn) { btn.disabled = false; btn.innerHTML = origLabel; }
      if (status) { status.textContent = 'Tag sync error: ' + (e.message || e); status.className = 'import-status err'; }
    });
}
function importGivingCSV(file) {
  if (!file) file = document.getElementById('giving-csv-file').files[0];
  var status = document.getElementById('giving-csv-status');
  var label  = document.getElementById('giving-csv-name');
  if (!file) { status.textContent = 'Please select a file.'; status.className = 'import-status err'; return; }
  if (label) label.textContent = file.name;
  status.textContent = 'Reading\u2026'; status.className = 'import-status';
  var reader = new FileReader();
  reader.onload = function(e) {
    var lines = e.target.result.split(/\r?\n/);
    var header = lines[0];
    var dataLines = lines.slice(1).filter(function(l) { return l.trim(); });
    var total = dataLines.length;
    var chunkSize = 5000;
    var chunks = [];
    for (var i = 0; i < dataLines.length; i += chunkSize)
      chunks.push(dataLines.slice(i, i + chunkSize));
    var totImported = 0, totSkipped = 0, totBatches = 0, totFunds = 0, totBlank = 0, totDup = 0, totZero = 0, allDupIds = [];
    function sendChunk(idx) {
      if (idx >= chunks.length) {
        var msg = 'Done \u2014 ' + totImported + ' imported, ' + totSkipped + ' skipped (of ' + total + ' rows).';
        if (totBatches) msg += ' ' + totBatches + ' new batches.';
        if (totFunds)   msg += ' ' + totFunds + ' new funds.';
        if (totSkipped) {
          var why = [];
          if (totDup)   why.push(totDup   + ' already imported');
          if (totZero)  why.push(totZero  + ' zero-amount');
          if (totBlank) why.push(totBlank + ' blank ID');
          if (why.length) msg += ' Skipped: ' + why.join(', ') + '.';
        }
        status.textContent = msg; status.className = 'import-status ok';
        if (allDupIds.length) {
          var details = document.createElement('details');
          details.style.cssText = 'margin-top:6px;font-size:.8rem;color:var(--warm-gray);';
          var summary = document.createElement('summary');
          summary.style.cssText = 'cursor:pointer;';
          summary.textContent = 'Show ' + allDupIds.length + ' skipped payment ID(s)';
          details.appendChild(summary);
          var pre = document.createElement('pre');
          pre.style.cssText = 'margin:4px 0 0;white-space:pre-wrap;font-size:.75rem;max-height:200px;overflow-y:auto;';
          pre.textContent = allDupIds.join('\n');
          details.appendChild(pre);
          status.after(details);
        }
        return;
      }
      var pct = Math.round(idx / chunks.length * 100);
      status.textContent = 'Uploading\u2026 ' + pct + '% (' + (idx * chunkSize) + ' of ' + total + ' rows)';
      api('/admin/api/import/giving-csv', {
        method: 'POST',
        headers: {'Content-Type': 'text/csv'},
        body: header + '\n' + chunks[idx].join('\n')
      }).then(function(d) {
        if (d.error) { status.textContent = 'Error on chunk ' + (idx+1) + ' of ' + chunks.length + ' (after ' + (idx * chunkSize) + ' rows): ' + d.error; status.className = 'import-status err'; return; }
        totImported += d.imported   || 0;
        totSkipped  += d.skipped    || 0;
        totBatches  += d.batchesMade|| 0;
        totFunds    += d.fundsMade  || 0;
        totBlank    += d.skipBlank  || 0;
        totDup      += d.skipDup    || 0;
        totZero     += d.skipZero   || 0;
        if (d.dupIds && d.dupIds.length) allDupIds = allDupIds.concat(d.dupIds);
        sendChunk(idx + 1);
      }).catch(function(err) { status.textContent = 'Error: ' + err.message; status.className = 'import-status err'; });
    }
    sendChunk(0);
  };
  reader.readAsText(file);
}


function importAttendanceSimple() {
  var text = document.getElementById('att-simple-text').value.trim();
  var status = document.getElementById('att-simple-status');
  if (!text) { status.textContent = 'Paste attendance data first.'; status.className = 'import-status err'; return; }
  status.textContent = 'Importing…'; status.className = 'import-status';
  api('/admin/api/import/attendance-simple', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text
  }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    var msg = 'Done — ' + d.imported + ' inserted, ' + d.updated + ' updated, ' + d.skipped + ' skipped.';
    if (d.combinedUsed) msg += ' (' + d.combinedUsed + ' combined-only Sundays stored as combined total)';
    status.textContent = msg;
    status.className = 'import-status ok';
  }).catch(function(e) { status.textContent = 'Error: ' + e; status.className = 'import-status err'; });
}

// ── Old System Comparison ────────────────────────────────────────────────
var _oldSysRows = null; // raw parsed rows from spreadsheet
var _oldSysHeaders = [];
var OLD_SYS_FIELDS = [
  { key: 'first_name',       label: 'First Name',        required: true  },
  { key: 'last_name',        label: 'Last Name',         required: true  },
  { key: 'dob',              label: 'Birthday / DOB',    required: false },
  { key: 'baptism_date',     label: 'Baptism Date',      required: false },
  { key: 'confirmation_date',label: 'Confirmation Date', required: false },
  { key: 'anniversary_date', label: 'Anniversary Date',  required: false },
  { key: 'email',            label: 'Email',             required: false },
  { key: 'phone',            label: 'Phone',             required: false },
  { key: 'address',          label: 'Street Address',    required: false },
  { key: 'city',             label: 'City',              required: false },
  { key: 'state',            label: 'State',             required: false },
  { key: 'zip',              label: 'ZIP Code',          required: false },
];
var OLD_SYS_AUTO_MATCH = {
  first_name:        /^first.?name$|^fname$|^first$/i,
  last_name:         /^last.?name$|^lname$|^last$|^surname$/i,
  dob:               /^d\.?o\.?b\.?$|^birth.?date$|^date.?of.?birth$|^birthday$/i,
  baptism_date:      /^baptism.?date$|^date.?baptized$|^baptized$|^baptism$/i,
  confirmation_date: /^confirm(ation)?.?date$|^date.?confirm(ed)?$|^confirmed$/i,
  anniversary_date:  /^anniversary.?date$|^wedding.?date$|^marriage.?date$|^anniversary$/i,
  email:             /^e.?mail$|^email.?address$/i,
  phone:             /^phone.?(number)?$|^cell$|^mobile$|^home.?phone$|^tel(ephone)?$/i,
  address:           /^address$|^street$|^home.?address$|^street.?address$|^mailing.?address$|^address1$/i,
  city:              /^city$|^town$|^municipality$/i,
  state:             /^state$|^province$|^st$|^state.?code$/i,
  zip:               /^zip$|^zip.?code$|^postal.?code$|^postal$/i,
};

function _oldSysLoadSheetJS(cb) {
  if (window.XLSX) { cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  s.onload = cb;
  s.onerror = function() { alert('Could not load Excel parser. Check your internet connection.'); };
  document.head.appendChild(s);
}

function _oldSysParseCsv(text) {
  var lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (!lines.length) return [];
  function parseLine(line) {
    var fields = [], cur = '', inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (inQ) {
        if (c === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQ = false; }
        else { cur += c; }
      } else {
        if (c === '"') { inQ = true; }
        else if (c === ',') { fields.push(cur); cur = ''; }
        else { cur += c; }
      }
    }
    fields.push(cur);
    return fields;
  }
  var headers = parseLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    var vals = parseLine(lines[i]);
    var obj = {};
    headers.forEach(function(h, j) { obj[h] = vals[j] !== undefined ? vals[j] : ''; });
    rows.push(obj);
  }
  return rows;
}

function oldSysFileSelected(input) {
  var file = input.files[0];
  if (!file) return;
  document.getElementById('old-sys-filename').textContent = file.name;
  document.getElementById('old-sys-col-map').style.display = 'none';
  document.getElementById('old-sys-results').innerHTML = '';
  var isCsv = /\.(csv|tsv|txt)$/i.test(file.name);
  if (isCsv) {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var data = _oldSysParseCsv(e.target.result);
        if (!data.length) { alert('File appears empty.'); return; }
        _oldSysRows = data;
        _oldSysHeaders = Object.keys(data[0]);
        _oldSysRenderColumnMap();
      } catch(err) { alert('Could not parse file: ' + err.message); }
    };
    reader.readAsText(file);
    return;
  }
  _oldSysLoadSheetJS(function() {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var data = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
        if (!data.length) { alert('Spreadsheet appears empty.'); return; }
        _oldSysRows = data;
        _oldSysHeaders = Object.keys(data[0]);
        _oldSysRenderColumnMap();
      } catch(err) {
        alert('Could not parse spreadsheet: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function _oldSysRenderColumnMap() {
  var grid = document.getElementById('old-sys-col-map-grid');
  var opts = ['(skip)'].concat(_oldSysHeaders).map(function(h) {
    return '<option value="'+esc(h)+'">'+esc(h)+'</option>';
  }).join('');
  grid.innerHTML = OLD_SYS_FIELDS.map(function(f) {
    // auto-detect best match
    var autoCol = '';
    for (var i = 0; i < _oldSysHeaders.length; i++) {
      var re = OLD_SYS_AUTO_MATCH[f.key];
      if (re && re.test(_oldSysHeaders[i])) { autoCol = _oldSysHeaders[i]; break; }
    }
    var selOpts = ['(skip)'].concat(_oldSysHeaders).map(function(h) {
      return '<option value="'+esc(h)+'"'+(h===autoCol?' selected':'')+'>'+esc(h)+'</option>';
    }).join('');
    return '<div style="display:flex;align-items:center;gap:6px;">'
      + '<label style="min-width:140px;color:var(--charcoal);">'+(f.required?'<strong>':'')+'&#8203;'+esc(f.label)+(f.required?'</strong>':'')+'</label>'
      + '<select id="old-sys-col-'+f.key+'" style="flex:1;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:.82rem;">'+selOpts+'</select>'
      + '</div>';
  }).join('');
  document.getElementById('old-sys-col-map').style.display = '';
}

function runOldSysCompare() {
  var status = document.getElementById('old-sys-status');
  var resultsEl = document.getElementById('old-sys-results');
  if (!_oldSysRows || !_oldSysRows.length) { status.textContent = 'No spreadsheet loaded.'; status.className = 'import-status err'; return; }
  // Build column map
  var colMap = {};
  OLD_SYS_FIELDS.forEach(function(f) {
    var sel = document.getElementById('old-sys-col-'+f.key);
    if (sel && sel.value && sel.value !== '(skip)') colMap[f.key] = sel.value;
  });
  if (!colMap.first_name || !colMap.last_name) {
    status.textContent = 'First Name and Last Name columns are required.';
    status.className = 'import-status err';
    return;
  }
  // Extract mapped rows
  var people = _oldSysRows.map(function(row) {
    var p = {};
    OLD_SYS_FIELDS.forEach(function(f) {
      p[f.key] = colMap[f.key] ? String(row[colMap[f.key]]||'').trim() : '';
    });
    return p;
  }).filter(function(p) { return p.first_name || p.last_name; });
  if (!people.length) { status.textContent = 'No valid rows found.'; status.className = 'import-status err'; return; }
  status.textContent = 'Comparing ' + people.length + ' rows…';
  status.className = 'import-status';
  resultsEl.innerHTML = '';
  api('/admin/api/import/old-system-compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ people: people })
  }).then(function(d) {
    if (d.error) { status.textContent = 'Error: ' + d.error; status.className = 'import-status err'; return; }
    status.textContent = 'Done. ' + d.summary.diff + ' with differences, ' + d.summary.not_found + ' not found, ' + d.summary.matched + ' identical.';
    status.className = 'import-status ok';
    _oldSysRenderResults(d.results, d.summary);
  }).catch(function(e) { status.textContent = 'Error: ' + e.message; status.className = 'import-status err'; });
}

var _oldSysFilter = 'diff';
var _oldSysResultData = null;
var _oldSysSummary = null;
var _OLD_SYS_FIELD_LABELS = {
  dob:'Birthday', baptism_date:'Baptism Date', confirmation_date:'Confirmation Date',
  anniversary_date:'Anniversary Date', email:'Email', phone:'Phone',
  address:'Street Address', city:'City', state:'State', zip:'ZIP Code'
};
var _OLD_SYS_PATCHABLE = { dob:1, baptism_date:1, confirmation_date:1, anniversary_date:1, email:1, phone:1, address:1, city:1, state:1, zip:1 };

function _oldSysRenderResults(results, summary) {
  _oldSysResultData = results;
  _oldSysSummary = summary;
  _oldSysReRender(_oldSysFilter);
}
function _oldSysReRender(filter) {
  _oldSysFilter = filter;
  var results = _oldSysResultData;
  var summary = _oldSysSummary;
  if (!results) return;
  var el = document.getElementById('old-sys-results');
  if (!el) return;

  var show = results.filter(function(r) {
    if (filter === 'diff')      return r.status === 'diff';
    if (filter === 'not_found') return r.status === 'not_found';
    if (filter === 'multiple')  return r.status === 'multiple';
    if (filter === 'match')     return r.status === 'match';
    return true;
  });

  var tabBtns = ['diff','not_found','multiple','match','all'].map(function(f) {
    var counts = {diff:summary.diff, not_found:summary.not_found, multiple:summary.multiple, match:summary.matched, all:summary.total};
    var lbls = {diff:'Differences', not_found:'Not Found', multiple:'Multiple Matches', match:'Identical', all:'All'};
    var active = f===filter ? 'background:var(--navy);color:#fff;' : 'background:var(--linen);';
    return '<button onclick="_oldSysReRender(\''+f+'\')" style="'+active+'border:1px solid var(--border);border-radius:6px;padding:4px 12px;font-size:.8rem;cursor:pointer;white-space:nowrap;">'+lbls[f]+' ('+counts[f]+')</button>';
  }).join('');

  var rows = show.map(function(r) {
    var name = esc((r.old.first_name||'')+' '+(r.old.last_name||''));
    var matchLink = r.match
      ? '<span style="color:var(--sky-steel);cursor:pointer;font-size:.8rem;" onclick="openPersonDetail('+r.match.id+')">'+esc((r.match.first_name||'')+' '+(r.match.last_name||''))+' &#8594;</span>'
          + (r.fuzzy_match ? '<span style="font-size:.72rem;color:var(--warm-gray);margin-left:4px;">(nickname match)</span>' : '')
      : (r.status==='not_found'
          ? '<span style="color:var(--danger);font-size:.8rem;">Not found in database</span>'
          : '<span style="color:var(--gold);font-size:.8rem;">'+(r.multiple_count||'?')+' name matches — open profile to disambiguate</span>');
    var diffRows = '';
    if (r.diffs && Object.keys(r.diffs).length) {
      diffRows = Object.keys(r.diffs).map(function(field) {
        var diff = r.diffs[field];
        var lbl = _OLD_SYS_FIELD_LABELS[field] || field;
        var oldVal = diff.old || '(blank)';
        var dbVal  = diff.db  || '(blank)';
        var addrField = field === 'address' || field === 'city' || field === 'state' || field === 'zip';
        var canApply = r.match && _OLD_SYS_PATCHABLE[field] && (!addrField || diff.db_blank);
        var applyBtn = canApply
          ? '<button class="btn-sm" style="font-size:.72rem;padding:2px 8px;background:var(--pale-sage);border:1px solid var(--soft-sage);border-radius:5px;cursor:pointer;white-space:nowrap;" onclick="oldSysApplyField('+r.match.id+',\''+field+'\')" title="Set '+esc(lbl)+' to old-system value">Apply Old</button>'
          : '';
        var extraBtn = '';
        if (field === 'phone' && diff.old) {
          var d10 = diff.old.replace(/\D/g,'').slice(-10);
          var fmtPhone = d10.length === 10 ? '('+d10.slice(0,3)+') '+d10.slice(3,6)+'-'+d10.slice(6) : diff.old;
          extraBtn = '<button class="btn-sm" style="font-size:.72rem;padding:2px 7px;margin-left:3px;background:var(--linen);border:1px solid var(--border);border-radius:5px;cursor:pointer;" onclick="this.textContent=\''+esc(fmtPhone)+'\';this.onclick=null;" title="Show formatted phone">Format</button>';
        }
        return '<tr>'
          + '<td style="padding:4px 8px;font-size:.78rem;color:var(--warm-gray);white-space:nowrap;">'+esc(lbl)+'</td>'
          + '<td style="padding:4px 8px;font-size:.78rem;font-weight:600;color:var(--navy);">'+esc(oldVal)+'</td>'
          + '<td style="padding:4px 8px;font-size:.78rem;color:var(--charcoal);">'+esc(dbVal)+'</td>'
          + '<td style="padding:4px 2px;white-space:nowrap;">'+applyBtn+extraBtn+'</td>'
          + '</tr>';
      }).join('');
      diffRows = '<table style="width:100%;border-collapse:collapse;margin-top:6px;">'
        + '<thead><tr><th style="padding:2px 8px;font-size:.75rem;text-align:left;color:var(--warm-gray);font-weight:400;">Field</th><th style="padding:2px 8px;font-size:.75rem;text-align:left;color:var(--warm-gray);font-weight:400;">Old System</th><th style="padding:2px 8px;font-size:.75rem;text-align:left;color:var(--warm-gray);font-weight:400;">Timothy ChMS</th><th></th></tr></thead>'
        + '<tbody>'+diffRows+'</tbody></table>';
    }
    var borderColor = r.status==='diff' ? 'var(--gold)' : r.status==='not_found' ? '#e74c3c' : r.status==='multiple' ? 'var(--teal)' : 'var(--soft-sage)';
    return '<div style="border-left:3px solid '+borderColor+';padding:8px 12px 8px 14px;margin-bottom:8px;background:var(--linen);border-radius:0 8px 8px 0;">'
      + '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
      +   '<span style="font-weight:600;font-size:.88rem;">'+name+'</span>'
      +   matchLink
      + '</div>'
      + diffRows
      + '</div>';
  }).join('');

  el.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">'+tabBtns+'</div>'
    + (show.length ? rows : '<div style="color:var(--warm-gray);font-size:.85rem;padding:8px 0;">No records in this category.</div>');
}
function oldSysApplyField(personId, field) {
  var record = null;
  if (_oldSysResultData) {
    for (var i = 0; i < _oldSysResultData.length; i++) {
      var r = _oldSysResultData[i];
      if (r.match && r.match.id === personId) { record = r; break; }
    }
  }
  if (!record || !record.diffs || !record.diffs[field]) { alert('Data not found — please re-run comparison.'); return; }
  var value = record.diffs[field].old;
  var body = {};
  body[field === 'address' ? 'address1' : field] = value;
  api('/admin/api/people/' + personId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function(d) {
    if (d.error) { alert('Error applying field: ' + d.error); return; }
    runOldSysCompare();
  }).catch(function(e) { alert('Error: ' + e.message); });
}

`;
