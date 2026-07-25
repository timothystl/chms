export const HTML_TABS_1 = String.raw`<!-- ═══ HOME / DASHBOARD TAB ═══ -->
<div id="tab-home" class="tab-panel active">
  <div id="dash-body" style="padding:24px;max-width:1100px;"></div>
</div>

<!-- ═══ PEOPLE TAB ═══ -->
<div id="tab-people" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="p-search" placeholder="Search name, email, phone…" oninput="debouncePeople()"></div>
    <div class="view-toggle" title="Switch between list, card, and household view">
      <button id="p-view-list-btn" class="active" onclick="setPeopleViewMode('list')">&#9776; List</button>
      <button id="p-view-card-btn" onclick="setPeopleViewMode('card')">&#9638; Card</button>
      <button id="p-view-household-btn" onclick="setPeopleViewMode('household')">&#8962; Household</button>
    </div>
    <button class="btn-secondary" id="p-filter-btn" onclick="toggleFilterDrawer()" style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
      <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      Filters
      <span id="p-filter-count" style="display:none;background:var(--teal);color:var(--white);border-radius:99px;padding:1px 7px;font-size:.72rem;font-weight:700;"></span>
    </button>
    <button class="btn-secondary" id="p-members-btn" onclick="toggleMemberFilter()" title="Toggle between Members only and all types" style="margin-left:auto;">Members</button>
    <button class="btn-secondary" id="p-select-btn" onclick="toggleSelectMode()">&#9745; Select</button>
    <button class="btn-secondary" id="p-archive-btn" onclick="toggleArchiveView()" title="View archived &amp; deceased people">Archived</button>
    <button class="btn-secondary" onclick="printDirectory()" title="Print directory">&#128438; Directory</button>
    <button class="btn-primary require-edit" onclick="openPersonEdit(null)">+ Add Person</button>
  </div>
  <!-- Active filter chips -->
  <div id="p-active-filters" style="display:none;padding:0 16px 10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;"></div>
  <!-- Bulk action bar (visible when Select mode is active) -->
  <div id="p-bulk-bar" style="display:none;position:sticky;bottom:0;z-index:500;background:var(--steel-anchor);color:var(--white);padding:10px 16px;display:none;align-items:center;gap:10px;flex-wrap:wrap;">
    <span id="p-bulk-count" style="font-size:.9rem;font-weight:700;">0 selected</span>
    <div style="flex:1;"></div>
    <select id="p-bulk-mt" style="padding:5px 8px;border-radius:6px;border:none;font-size:.85rem;background:var(--white);color:var(--charcoal);">
      <option value="">Change Member Type…</option>
    </select>
    <button class="btn-sm" onclick="applyBulkMemberType()" style="background:var(--white);color:var(--steel-anchor);">Apply</button>
    <button class="btn-sm" onclick="openBulkTagsPanel()" style="background:var(--white);color:var(--steel-anchor);">&#9881; Tags</button>
    <button class="btn-sm" onclick="openBulkCommPanel()" style="background:var(--white);color:var(--steel-anchor);">&#9993; Comms</button>
    <button class="btn-sm" onclick="openBulkSacramentPanel()" style="background:var(--white);color:var(--steel-anchor);">&#10010; Sacraments</button>
    <button class="btn-sm" onclick="clearSelection()" style="background:rgba(255,255,255,.2);color:var(--white);">Cancel</button>
  </div>
  <!-- Bulk sacrament-flag mini-panel -->
  <div id="p-bulk-sacrament-panel" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:4px 0 8px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;margin-bottom:8px;">Bulk Sacramental Status</div>
    <div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:10px;">For all selected people, mark them as baptized and/or confirmed (date unknown). Use after filtering by missing baptism/confirmation date.</div>
    <div style="display:flex;flex-wrap:wrap;gap:24px;margin-bottom:12px;">
      <div style="display:flex;flex-direction:column;gap:6px;font-size:.88rem;">
        <div style="font-weight:700;color:var(--charcoal);">Baptized</div>
        <label><input type="radio" name="bulk-bap"  value=""      checked> No change</label>
        <label><input type="radio" name="bulk-bap"  value="set">   Mark Yes</label>
        <label><input type="radio" name="bulk-bap"  value="unset"> Mark No</label>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:.88rem;">
        <div style="font-weight:700;color:var(--charcoal);">Confirmed</div>
        <label><input type="radio" name="bulk-con"  value=""      checked> No change</label>
        <label><input type="radio" name="bulk-con"  value="set">   Mark Yes</label>
        <label><input type="radio" name="bulk-con"  value="unset"> Mark No</label>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" style="font-size:.82rem;padding:5px 12px;" onclick="applyBulkSacrament()">Apply</button>
      <button class="btn-secondary" style="font-size:.82rem;padding:5px 12px;" onclick="document.getElementById(&#39;p-bulk-sacrament-panel&#39;).style.display=&#39;none&#39;">Cancel</button>
    </div>
  </div>
  <!-- Bulk communications opt-in/out mini-panel -->
  <div id="p-bulk-comm-panel" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:4px 0 8px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;margin-bottom:8px;">Bulk Communications Opt-In</div>
    <div style="display:flex;flex-wrap:wrap;gap:24px;margin-bottom:12px;">
      <div style="display:flex;flex-direction:column;gap:6px;font-size:.88rem;">
        <div style="font-weight:700;color:var(--charcoal);">SMS (text messages)</div>
        <label><input type="radio" name="bulk-sms" value=""    checked> No change</label>
        <label><input type="radio" name="bulk-sms" value="in">  Opt-in</label>
        <label><input type="radio" name="bulk-sms" value="out"> Opt-out</label>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:.88rem;">
        <div style="font-weight:700;color:var(--charcoal);">Newsletter (Brevo)</div>
        <label><input type="radio" name="bulk-news" value=""    checked> No change</label>
        <label><input type="radio" name="bulk-news" value="add"> Add to list (requires email)</label>
      </div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" style="font-size:.82rem;padding:5px 12px;" onclick="applyBulkComm()">Apply</button>
      <button class="btn-secondary" style="font-size:.82rem;padding:5px 12px;" onclick="document.getElementById(&#39;p-bulk-comm-panel&#39;).style.display=&#39;none&#39;">Cancel</button>
    </div>
  </div>
  <!-- Bulk tags mini-panel -->
  <div id="p-bulk-tags-panel" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin:4px 0 8px;">
    <div style="font-size:.78rem;font-weight:700;color:var(--warm-gray);text-transform:uppercase;margin-bottom:8px;">Bulk Tag Management</div>
    <div id="p-bulk-tags-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
    <div style="font-size:.75rem;color:var(--warm-gray);margin-bottom:6px;">&#9679; = add to all &nbsp; &#9675; = remove from all &nbsp; (empty = no change)</div>
    <div style="display:flex;gap:8px;">
      <button class="btn-primary" style="font-size:.82rem;padding:5px 12px;" onclick="applyBulkTags()">Apply Tags</button>
      <button class="btn-secondary" style="font-size:.82rem;padding:5px 12px;" onclick="document.getElementById(&#39;p-bulk-tags-panel&#39;).style.display=&#39;none&#39;">Cancel</button>
    </div>
  </div>
  <div id="p-status" class="status-msg"></div>
  <!-- Master-detail: list (List/Card view) on the left, quick-view panel on the right (RDS2) -->
  <div class="ppl-master-detail">
    <div class="ppl-list-col">
      <!-- Desktop list (table) view -->
      <div id="p-grid"></div>
      <!-- Desktop card view -->
      <div id="p-card-grid"></div>
      <!-- Household view (RDS2b) — reuses the Households tab's card grid -->
      <div id="p-hh-view" style="display:none;flex-direction:column;flex:1;min-height:0;">
        <div id="p-hh-grid" class="card-grid" style="flex:1;min-height:0;overflow-y:auto;padding:2px 2px 0;"></div>
        <div id="p-hh-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;flex-shrink:0;"></div>
      </div>
      <!-- Pagination -->
      <div id="p-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
    </div>
    <div class="ppl-quickview" id="ppl-quickview">
      <div class="ppl-qv-empty">
        <svg viewBox="0 0 24 24" style="width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35;"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
        <div>Select a person to view details</div>
      </div>
    </div>
  </div>
  <!-- Mobile contact list -->
  <div class="contact-list" id="p-contact-list"></div>
</div>

<!-- ═══ HOUSEHOLDS TAB ═══ -->
<div id="tab-households" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="h-search" placeholder="Search households…" oninput="debounceHouseholds()"></div>
    <div style="display:flex;gap:5px;flex-shrink:0;">
      <button class="pill active" id="hh-filter-all" onclick="setHHFilter('all')">All</button>
      <button class="pill" id="hh-filter-member" onclick="setHHFilter('member')">Members</button>
    </div>
    <button class="btn-primary require-edit" onclick="openHouseholdEdit(null)" style="margin-left:auto;">+ New Household</button>
  </div>
  <div id="h-status" class="status-msg"></div>
  <div class="card-grid" id="h-grid"></div>
  <div id="h-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
</div>

<!-- ═══ ORGANIZATIONS TAB ═══ -->
<div id="tab-organizations" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="org-search" placeholder="Search organizations…" oninput="debounceOrgs()"></div>
    <button class="btn-primary require-edit" onclick="openOrgEdit(null)" style="margin-left:auto;">+ New Organization</button>
  </div>
  <div id="org-status" class="status-msg"></div>
  <div class="card-grid" id="org-grid"></div>
  <div id="org-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
</div>

<!-- ═══ GIVING TAB ═══ -->
<div id="tab-giving" class="tab-panel">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;flex-shrink:0;">
    <span style="font-size:22px;font-weight:800;color:var(--color-navy);">Giving</span>
    <div class="view-toggle" style="margin-left:auto;">
      <button class="active" id="giv-view-batches-btn" onclick="givSetView('batches')">Batches</button>
      <button id="giv-view-txns-btn" onclick="givSetView('transactions')">Transactions</button>
      <button id="giv-view-reports-btn" onclick="givSetView('reports')">Reports</button>
      <button id="giv-view-settings-btn" onclick="givSetView('settings')">Settings</button>
    </div>
  </div>
  <div class="giving-layout" id="giv-view-batches">
    <!-- Batch list -->
    <div class="batch-list-panel">
      <div class="batch-list-hdr">
        <h3>Batches</h3>
        <button class="btn-primary" style="padding:5px 12px;font-size:.8rem;" onclick="openNewBatch()">+ New</button>
      </div>
      <div class="batch-search-wrap">
        <input type="search" id="batch-search-input" placeholder="Search batches&#8230;" oninput="filterBatchSearch(this.value)">
      </div>
      <div class="batch-filter-pills">
        <button class="pill active" data-bs="all" onclick="setBatchFilter(this,'all')">All</button>
        <button class="pill" data-bs="open" onclick="setBatchFilter(this,'open')">Open</button>
        <button class="pill" data-bs="closed" onclick="setBatchFilter(this,'closed')">Closed</button>
      </div>
      <div id="batch-list"></div>
    </div>
    <!-- Batch detail -->
    <div class="batch-detail-panel" id="batch-detail">
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--warm-gray);gap:10px;padding:40px;">
        <svg viewBox="0 0 24 24" style="width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:1.5;opacity:.35;"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/></svg>
        <div style="font-size:.9rem;">Select a batch to view entries</div>
      </div>
    </div>
  </div>

  <div class="giv-txn-view" id="giv-view-transactions" style="display:none;">
    <div class="giv-txn-filters">
      <div class="field"><label>Fund</label><select id="giv-txn-fund" onchange="loadGivingTransactions()"><option value="">All Funds</option></select></div>
      <div class="field"><label>From</label><input type="date" id="giv-txn-from" onchange="loadGivingTransactions()"></div>
      <div class="field"><label>To</label><input type="date" id="giv-txn-to" onchange="loadGivingTransactions()"></div>
      <button class="btn-secondary" onclick="givTxnClearFilters()">Clear Filters</button>
    </div>
    <div class="giv-txn-table-wrap">
      <table class="entries-table">
        <thead><tr><th>Donor</th><th>Fund</th><th>Method</th><th>Date</th><th class="amt-col">Amount</th></tr></thead>
        <tbody id="giv-txn-tbody"></tbody>
      </table>
    </div>
  </div>

  <div id="giv-view-reports" style="display:none;">
    <div class="report-tiles" id="giv-rpt-tiles-grid">
      <div class="report-tile require-finance" data-tile-id="giving-by-fund">
        <div class="tile-icon">&#128200;</div>
        <div class="tile-title">Giving by Fund</div>
        <div class="tile-desc">
          <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-from" name="rpt-from" style="font-size:.82rem;padding:4px 8px;"></div>
          <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-to" name="rpt-to" style="font-size:.82rem;padding:4px 8px;"></div>
          <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingSummary()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-by-method">
        <div class="tile-icon">&#128179;</div>
        <div class="tile-title">Giving by Method</div>
        <div class="tile-desc">
          <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-method-from" name="rpt-method-from" style="font-size:.82rem;padding:4px 8px;"></div>
          <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-method-to" name="rpt-method-to" style="font-size:.82rem;padding:4px 8px;"></div>
          <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingByMethod()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-statement">
        <div class="tile-icon">&#128196;</div>
        <div class="tile-title">Giving Statement</div>
        <div class="tile-desc">
          <div style="display:flex;gap:6px;margin-bottom:6px;">
            <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;"><input type="radio" name="rpt-stmt-mode" value="person" checked onchange="toggleStmtMode()"> Person</label>
            <label style="display:flex;align-items:center;gap:4px;font-size:.82rem;cursor:pointer;"><input type="radio" name="rpt-stmt-mode" value="household" onchange="toggleStmtMode()"> Household</label>
          </div>
          <div id="rpt-stmt-person-row" class="field" style="margin:4px 0;">
            <div class="ac-wrap"><input type="text" id="rpt-person-search" name="rpt-person-search" placeholder="Search person…" style="font-size:.82rem;padding:4px 8px;" oninput="acSearch(this,&#39;rpt-person-ac&#39;,&#39;rpt-person-id&#39;)"><div class="ac-dropdown" id="rpt-person-ac"></div></div>
            <input type="hidden" id="rpt-person-id" name="rpt-person-id">
          </div>
          <div id="rpt-stmt-hh-row" class="field" style="margin:4px 0;display:none;">
            <div class="ac-wrap"><input type="text" id="rpt-hh-search" name="rpt-hh-search" placeholder="Search household…" style="font-size:.82rem;padding:4px 8px;" oninput="acSearchHH(this)"><div class="ac-dropdown" id="rpt-hh-ac"></div></div>
            <input type="hidden" id="rpt-hh-id" name="rpt-hh-id">
          </div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="rpt-year" name="rpt-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatement()">View Statement</button>
            <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatementLetter(&#39;year_end&#39;)">View Letter</button>
            <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatementLetter(&#39;midyear&#39;)">Mid-Year Update</button>
            <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="downloadStatement()">CSV</button>
          </div>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-trend">
        <div class="tile-icon">&#128200;</div>
        <div class="tile-title">Giving Trend</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Year-over-year giving comparison by month.</div>
          <div id="rpt-trend-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingTrend()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-insights">
        <div class="tile-icon">&#128202;</div>
        <div class="tile-title">Giving Insights</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Top givers, lapsed givers, frequency, and average gift trends.</div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="rpt-insights-year" name="rpt-insights-year" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="runGivingInsights()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-yoy">
        <div class="tile-icon">&#128200;</div>
        <div class="tile-title">Giving Trends</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Year-over-year giving changes per person — who increased, decreased, or lapsed.</div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="rpt-yoy-year" name="rpt-yoy-year" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="runGivingYoy()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="giving-vs-attendance">
        <div class="tile-icon">&#128202;</div>
        <div class="tile-title">Giving &times; Attendance</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Weekly giving vs. weekly attendance &mdash; see correlation between engagement and giving.</div>
          <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-gva-from" name="rpt-gva-from" style="font-size:.82rem;padding:4px 8px;"></div>
          <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-gva-to" name="rpt-gva-to" style="font-size:.82rem;padding:4px 8px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="runGivingVsAttendance()">Run Report</button>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="batch-send-statements">
        <div class="tile-icon">&#128140;</div>
        <div class="tile-title">Batch Send Statements</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Send year-end giving letters via email to all givers for a year.</div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="batch-stmt-year" name="batch-stmt-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="loadBatchStatementGivers()">Load Givers</button>
          <div id="batch-stmt-status" class="import-status" style="margin-top:6px;"></div>
          <div id="batch-stmt-list" style="margin-top:8px;max-height:200px;overflow-y:auto;"></div>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="batch-send-midyear">
        <div class="tile-icon">&#128140;</div>
        <div class="tile-title">Batch Send Mid-Year Update</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Send a mid-year giving update &mdash; thanks them, shows year-to-date giving for review, and suggests ways to set up recurring giving.</div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="batch-mid-year" name="batch-mid-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="loadBatchMidyearGivers()">Load Givers</button>
          <div id="batch-mid-status" class="import-status" style="margin-top:6px;"></div>
          <div id="batch-mid-list" style="margin-top:8px;max-height:200px;overflow-y:auto;"></div>
        </div>
      </div>
      <div class="report-tile require-finance" data-tile-id="batch-send-appeal">
        <div class="tile-icon">&#128140;</div>
        <div class="tile-title">Send Giving Appeal to All Member Households</div>
        <div class="tile-desc">
          <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Sends the Mid-Year Update letter to every member household &mdash; not just people who've already given &mdash; one email per household, so it can also prompt households that haven't given yet. Households with $0 recorded will show a $0 total in the letter.</div>
          <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="batch-appeal-year" name="batch-appeal-year" value="" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="loadBatchAppealHouseholds()">Load Member Households</button>
          <div id="batch-appeal-status" class="import-status" style="margin-top:6px;"></div>
          <div id="batch-appeal-list" style="margin-top:8px;max-height:200px;overflow-y:auto;"></div>
        </div>
      </div>
    </div>
    <div id="giv-rpt-output" class="report-output"></div>
  </div>

  <div id="giv-view-settings" style="display:none;max-width:900px;">
    <div id="giv-settings-status" class="status-msg" style="margin-bottom:8px;"></div>
    <!-- Church Info Card -->
    <div class="import-card require-finance" style="margin-bottom:14px;">
      <h3>&#9962; Church Information</h3>
      <p>Used in giving letters, email headers, and reports.</p>
      <div class="modal-2col" style="margin-bottom:10px;">
        <div class="field"><label>Church Name</label><input type="text" id="st-church-name" name="st-church-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>EIN (Tax ID)</label><input type="text" id="st-ein" name="st-ein" placeholder="XX-XXXXXXX" style="width:100%;"></div>
      </div>
      <div class="modal-2col" style="margin-bottom:4px;">
        <div class="field"><label>Sending Name (shown as the "From" name on outgoing emails)</label><input type="text" id="st-from-name" name="st-from-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>Sending Email Address (must be a verified sender in Brevo)</label><input type="email" id="st-from-email" name="st-from-email" placeholder="giving@notify.timothystl.org" style="width:100%;"></div>
      </div>
      <div style="font-size:.76rem;color:var(--warm-gray);margin-bottom:12px;">This is the address giving statements and mid-year updates are emailed from &mdash; not a contact/reply-to address. Giving letters send via Brevo (the same account used for the newsletter sync), so this address&rsquo;s domain needs to show as verified under <a href="https://app.brevo.com/senders/domain/list" target="_blank" rel="noopener">Brevo &rarr; Senders &amp; IP &rarr; Domains</a>; otherwise sends will fail.</div>
      <div class="field" style="margin-bottom:12px;">
        <label>Online Giving URL (optional)</label>
        <input type="text" id="st-giving-url" name="st-giving-url" placeholder="https://timothystl.org/give" style="width:100%;">
        <div style="font-size:.76rem;color:var(--warm-gray);margin-top:4px;">Shown in the Mid-Year Giving Update letter as a link for setting up recurring/automatic giving. Leave blank to omit.</div>
      </div>
      <div class="field" style="margin-bottom:12px;">
        <label>Letterhead Logo (optional)</label>
        <div style="font-size:.76rem;color:var(--warm-gray);margin-bottom:6px;">Replaces the plain church-name text at the top of giving letters (view, email, and batch send) with this image. Uploaded separately from the buttons below &mdash; no need to click Save Church Info.</div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <img id="st-logo-preview" style="max-height:56px;display:none;border:1px solid var(--border);border-radius:6px;padding:4px;background:var(--white);">
          <input type="file" id="st-logo-file" name="st-logo-file" accept="image/*" style="display:none;" onchange="uploadLetterheadLogo(this.files[0])">
          <button class="btn-secondary" style="font-size:.82rem;" onclick="document.getElementById('st-logo-file').click()">&#128247; Upload Logo</button>
          <button class="btn-secondary" id="st-logo-remove-btn" style="font-size:.82rem;display:none;" onclick="removeLetterheadLogo()">Remove Logo</button>
          <span id="st-logo-status" class="import-status"></span>
        </div>
      </div>
      <button class="btn-primary" onclick="saveSettings()">Save Church Info</button>
    </div>
    <!-- Breeze Giving Sync Card -->
    <div class="import-card require-finance" style="margin-bottom:14px;">
      <h3>&#9729; Breeze Giving Sync</h3>
      <p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 8px;">Pull contribution records from the Breeze account log. Already-imported contributions are skipped (safe to re-sync). Groups by Breeze batch number. Fund names can be renamed in Settings &rarr; Import/Export after import.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <div class="field" style="margin:0;"><label>From</label><input type="date" id="giving-sync-from" name="giving-sync-from" style="font-size:.85rem;padding:4px 8px;"></div>
        <div class="field" style="margin:0;"><label>To</label><input type="date" id="giving-sync-to" name="giving-sync-to" style="font-size:.85rem;padding:4px 8px;"></div>
      </div>
      <button class="btn-primary" onclick="runBreezeGivingSync()">Sync Date Range</button>
      <div class="import-status" id="giving-sync-status"></div>
      <pre id="giving-sync-diagnostics" style="display:none;margin-top:10px;padding:10px;background:#f4f0ea;border:1px solid var(--border);border-radius:6px;font-size:.72rem;overflow:auto;max-height:400px;white-space:pre-wrap;word-break:break-all;"></pre>
      <div style="margin-top:12px;">
        <p style="margin:0 0 8px;"><strong>Sync All History</strong> — loops through every year from start year to today, one year at a time.</p>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
          <div class="field" style="margin:0;"><label>Start Year</label><input type="number" id="giving-sync-start-year" name="giving-sync-start-year" value="2020" min="2000" max="2099" style="width:90px;font-size:.85rem;padding:4px 8px;"></div>
        </div>
        <button class="btn-primary" id="giving-all-btn" onclick="runBreezeGivingAll()">Sync All History</button>
        <div class="import-status" id="giving-all-status"></div>
      </div>
      <div style="margin-top:12px;">
        <p style="margin:0 0 8px;"><strong>Breeze Audit Log Export</strong> — Download every contribution-related event from Breeze (added, updated, deleted) as a CSV for reconciliation. Uses the same date range as the sync above.</p>
        <button class="btn-secondary" onclick="downloadBreezeAuditLog()">&#128229; Download Audit Log CSV</button>
      </div>
    </div>
    <!-- Letter Template Card -->
    <div class="import-card require-finance" style="margin-bottom:14px;">
      <h3>&#128140; Year-End Giving Letter Template</h3>
      <p>Used when generating giving letters. Available placeholders: <code>{{name}}</code>, <code>{{year}}</code>, <code>{{total}}</code>, <code>{{ein}}</code>, <code>{{date}}</code>, <code>{{gift_table}}</code></p>
      <textarea id="st-letter-tpl" name="st-letter-tpl" rows="10" style="width:100%;font-family:monospace;font-size:.82rem;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;"></textarea>
      <div style="margin-top:8px;">
        <button class="btn-primary" onclick="saveSettings()">Save Template</button>
        <button class="btn-secondary" onclick="previewLetterTemplate(&#39;year_end&#39;)" style="margin-left:8px;">&#128065; Preview</button>
        <button class="btn-secondary" onclick="resetLetterTemplate()" style="margin-left:8px;">Reset to Default</button>
      </div>
    </div>
    <!-- Mid-Year Letter Template Card -->
    <div class="import-card require-finance" style="margin-bottom:14px;">
      <h3>&#128140; Mid-Year Giving Update Letter Template</h3>
      <p>Used for the mid-year giving update &mdash; thanks givers, shows year-to-date giving for them to review, and suggests ways to set up recurring/automatic giving. Available placeholders: <code>{{name}}</code>, <code>{{year}}</code>, <code>{{total}}</code>, <code>{{date}}</code>, <code>{{gift_table}}</code>, <code>{{giving_url}}</code></p>
      <textarea id="st-midyear-letter-tpl" name="st-midyear-letter-tpl" rows="10" style="width:100%;font-family:monospace;font-size:.82rem;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;"></textarea>
      <div style="margin-top:8px;">
        <button class="btn-primary" onclick="saveSettings()">Save Template</button>
        <button class="btn-secondary" onclick="previewLetterTemplate(&#39;midyear&#39;)" style="margin-left:8px;">&#128065; Preview</button>
        <button class="btn-secondary" onclick="resetMidyearLetterTemplate()" style="margin-left:8px;">Reset to Default</button>
      </div>
    </div>
  </div>
</div>

<!-- ═══ REPORTS TAB ═══ -->
<div id="tab-reports" class="tab-panel">
  <div style="padding:10px 16px 0;display:flex;align-items:center;gap:8px;">
    <button class="btn-secondary" style="font-size:.8rem;padding:4px 10px;" onclick="openRptCustomize()">&#9881; Customize</button>
  </div>
  <div class="report-tiles" id="rpt-tiles-grid">
    <div class="report-tile" data-tile-id="membership" onclick="runMembership()">
      <div class="tile-icon">&#128100;</div>
      <div class="tile-title">Membership Summary</div>
      <div class="tile-desc">Counts by member type</div>
    </div>
    <div class="report-tile no-member" data-tile-id="contact-completeness" onclick="runContactCompleteness()">
      <div class="tile-icon">&#128231;</div>
      <div class="tile-title">Contact Completeness</div>
      <div class="tile-desc">Missing email, phone, address, DOB, photo</div>
    </div>
    <div class="report-tile no-member" data-tile-id="people-insights" onclick="runPeopleInsights()">
      <div class="tile-icon">&#128196;</div>
      <div class="tile-title">People Insights</div>
      <div class="tile-desc">Growth, age, gender, households, sacramental pipeline</div>
    </div>
    <div class="report-tile" data-tile-id="attendance-summary">
      <div class="tile-icon">&#128197;</div>
      <div class="tile-title">Attendance Summary</div>
      <div class="tile-desc">
        <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Year-over-year Sunday attendance comparison.</div>
        <div id="rpts-att-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
        <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runAttendanceRpt()">Run Report</button>
      </div>
    </div>
  </div>
  <div class="modal-overlay" id="rpt-cust-modal" onclick="if(event.target===this)closeModal('rpt-cust-modal')">
    <div class="modal" style="max-width:480px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h3 style="font-family:var(--font-head);color:var(--steel-anchor);">Customize Report Tiles</h3>
        <button onclick="closeModal('rpt-cust-modal')" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--warm-gray);">&#x2715;</button>
      </div>
      <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:10px;">Check to show. Drag &#9776; or use &#8593;&#8595; to reorder.</div>
      <div id="rpt-cust-list" style="max-height:400px;overflow-y:auto;"></div>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end;">
        <button class="btn-secondary" onclick="closeModal('rpt-cust-modal')">Cancel</button>
        <button class="btn-primary" onclick="rptSaveCustomize()">Save</button>
      </div>
    </div>
  </div>
  <div class="report-output" id="rpt-output"></div>
</div>

<!-- ═══ ATTENDANCE TAB ═══ -->
<div id="tab-attendance" class="tab-panel">
  <div style="padding:16px 20px 20px;">
    <!-- Chart card -->
    <div class="att-chart-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">
        <div class="att-stats-row" id="att-stats" style="flex:1;flex-wrap:wrap;"></div>
        <div style="display:flex;gap:4px;flex-shrink:0;padding-left:8px;">
          <button class="btn-sm" id="att-mode-line" onclick="setAttChartMode(&#39;line&#39;)" style="padding:3px 8px;font-size:.75rem;" title="Weekly timeline">Line</button>
          <button class="btn-sm" id="att-mode-yoy" onclick="setAttChartMode(&#39;yoy&#39;)" style="padding:3px 8px;font-size:.75rem;opacity:.55;" title="Year-over-year comparison">YoY</button>
          <button class="btn-sm" id="att-mode-bars" onclick="setAttChartMode(&#39;bars&#39;)" style="padding:3px 8px;font-size:.75rem;opacity:.55;" title="Monthly bars">Bars</button>
          <button class="btn-sm" onclick="downloadAttChart()" style="padding:3px 8px;font-size:.75rem;opacity:.7;" title="Download chart as PNG">&#8595; PNG</button>
        </div>
      </div>
      <div id="att-chart-wrap" style="overflow-x:auto;overflow-y:hidden;"></div>
      <div id="att-chart-resize" style="height:8px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;margin-top:2px;opacity:0.4;" onmousedown="attChartResizeStart(event)" title="Drag to resize chart"><div style="width:32px;height:3px;background:var(--warm-gray);border-radius:2px;"></div></div>
      <div id="att-special-wrap" style="margin-top:14px;"></div>
    </div>
    <!-- Controls row -->
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn-primary" style="font-size:.85rem;" onclick="openNewSundayEntry()">+ Add Sunday</button>
      <button class="btn-secondary" style="font-size:.8rem;" onclick="openSpecialServiceEntry()">+ Special</button>
      <button class="btn-secondary" style="font-size:.8rem;" onclick="seedYearSundays()">&#128197; Pre-fill Year Sundays</button>
      <div style="flex:1;"></div>
      <input type="date" id="att-from" name="att-from" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
      <span style="font-size:.8rem;color:var(--warm-gray);">to</span>
      <input type="date" id="att-to" name="att-to" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
      <button class="btn-sm" onclick="loadAttendance()" style="padding:4px 8px;font-size:.75rem;">Filter</button>
      <button class="btn-sm" id="att-order-btn" onclick="toggleAttOrder()" style="padding:4px 8px;font-size:.75rem;min-width:56px;" title="Toggle sort order">&#8595; Desc</button>
      <select id="att-group-by" name="att-group-by" onchange="renderAttendanceListFromLoaded()" style="font-size:.78rem;padding:3px 6px;border:1px solid var(--border);border-radius:6px;">
        <option value="none">No grouping</option>
        <option value="month">By Month</option>
      </select>
    </div>
    <!-- "Add Sunday" inline form slot -->
    <div id="att-add-form" style="display:none;background:var(--white);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:12px;"></div>
    <!-- Service list -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
      <button id="att-table-toggle" class="btn-sm" style="padding:3px 10px;font-size:.75rem;" onclick="toggleAttTable()">&#9660; Hide Table</button>
    </div>
    <div id="att-list"></div>
    <!-- ── Inline Attendance Reports ── -->
    <div style="margin-top:28px;border-top:2px solid var(--border);padding-top:20px;">
      <div style="font-family:var(--font-head);font-size:1.05rem;font-weight:700;color:var(--steel-anchor);margin-bottom:16px;">Attendance Reports</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;margin-bottom:16px;">
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;flex:1;min-width:220px;">
          <div style="font-weight:700;font-size:.88rem;color:var(--steel-anchor);margin-bottom:6px;">&#128101; Year-over-Year</div>
          <div style="font-size:.8rem;color:var(--warm-gray);margin-bottom:8px;">Select years to compare:</div>
          <div id="rpt-att-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
          <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runAttendanceSummary()">Run Report</button>
        </div>
        <div style="background:var(--white);border:1px solid var(--border);border-radius:12px;padding:16px;flex:1;min-width:220px;">
          <div style="font-weight:700;font-size:.88rem;color:var(--steel-anchor);margin-bottom:6px;">&#128337; Attendance by Service</div>
          <div style="display:flex;gap:6px;margin-bottom:8px;">
            <button id="att-svc-mode-range" class="btn-secondary active" style="font-size:.78rem;padding:3px 10px;" onclick="setAttByServiceMode(\'range\')">Date Range</button>
            <button id="att-svc-mode-years" class="btn-secondary" style="font-size:.78rem;padding:3px 10px;" onclick="setAttByServiceMode(\'years\')">Multi-Year</button>
          </div>
          <div id="att-svc-range-inputs">
            <div class="field" style="margin:6px 0 4px;"><label>From</label><input type="date" id="rpt-att-from" name="rpt-att-from" style="font-size:.82rem;padding:4px 8px;"></div>
            <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-att-to" name="rpt-att-to" style="font-size:.82rem;padding:4px 8px;"></div>
          </div>
          <div id="att-svc-years-inputs" style="display:none;">
            <div style="font-size:.8rem;color:var(--warm-gray);margin-bottom:6px;">Select years to compare:</div>
            <div id="rpt-att-svc-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px;"></div>
          </div>
          <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runAttendanceByTime()">Run Report</button>
        </div>
      </div>
      <div id="att-rpt-output" style="display:none;"></div>
    </div>
  </div>
</div>

<!-- ═══ IMPORT TAB (content moved to Settings) ═══ -->
<div id="tab-import" class="tab-panel">
</div>

<!-- ═══ SETTINGS TAB ═══ -->
<div id="tab-settings" class="tab-panel">
  <div style="padding:16px 20px 24px;max-width:900px;">
    <div id="st-status" class="status-msg" style="margin-bottom:8px;"></div>
    <!-- Users Card (admin only) -->
    <div class="import-card require-admin" style="margin-bottom:14px;">
      <h3>&#128100; Users</h3>
      <p>Create named login accounts. Each user gets their own username and password for their role.</p>
      <div id="st-users-list" style="margin:12px 0;"></div>
      <button class="btn-primary" style="font-size:.85rem;padding:6px 14px;" onclick="openUserForm(null)">+ Add User</button>
    </div>
    <!-- Role Permissions Card (admin only) -->
    <div class="import-card require-admin" style="margin-bottom:14px;">
      <h3>&#128274; Role Permissions</h3>
      <p>Controls what the Finance, Staff, and Office user types can access. Admin always has full access; Member is a separate read-only directory view and isn&rsquo;t configurable here.</p>
      <div id="role-perm-status" class="status-msg" style="margin-bottom:8px;"></div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:.88rem;min-width:480px;">
          <thead><tr style="border-bottom:1px solid var(--border);">
            <th style="text-align:left;padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Access</th>
            <th style="padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Finance</th>
            <th style="padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Staff</th>
            <th style="padding:6px 8px;font-size:.72rem;color:var(--warm-gray);font-weight:700;text-transform:uppercase;">Office</th>
          </tr></thead>
          <tbody id="role-perm-tbody"></tbody>
        </table>
      </div>
      <button class="btn-primary" style="margin-top:12px;" onclick="saveRolePermissions()">Save Role Permissions</button>
    </div>
    <!-- Volunteer Site & Notifications Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#128101; Volunteer Site &amp; Notifications</h3>
      <p>Shown on the public volunteer sign-up site, plus who gets notified about new sign-ups.</p>
      <div class="field" style="margin-bottom:10px;"><label>Address</label><input type="text" id="st-vol-address" name="st-vol-address" placeholder="6704 Fyler Ave, St. Louis, MO 63139" style="width:100%;"></div>
      <div class="modal-2col" style="margin-bottom:12px;">
        <div class="field"><label>Public contact email</label><input type="email" id="st-vol-email" name="st-vol-email" placeholder="office@timothystl.org" style="width:100%;"></div>
        <div class="field"><label>Phone</label><input type="text" id="st-vol-phone" name="st-vol-phone" placeholder="(314) 555-0100" style="width:100%;"></div>
      </div>
      <div style="font-size:.82rem;font-weight:700;color:var(--charcoal);margin-bottom:8px;">Who gets notified</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
        <label class="toggle-switch" style="background:var(--linen);border-radius:8px;padding:10px 12px;"><input type="checkbox" id="st-notify-new-signup"><span class="toggle-track"></span><span style="font-size:.85rem;color:var(--charcoal);">Email the office on every new volunteer sign-up</span></label>
        <label class="toggle-switch" style="background:var(--linen);border-radius:8px;padding:10px 12px;"><input type="checkbox" id="st-notify-weekly-digest"><span class="toggle-track"></span><span style="font-size:.85rem;color:var(--charcoal);">Weekly digest to ministry leaders</span></label>
      </div>
      <p style="font-size:.76rem;color:var(--warm-gray);margin-bottom:10px;">The weekly digest isn&rsquo;t built yet &mdash; this just saves the preference for when it is.</p>
      <button class="btn-primary" onclick="saveVolunteerSettings()">Save Volunteer Settings</button>
    </div>
    <!-- Tags Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9881; Tags</h3>
      <p>Tags are used to categorize people. You can filter by tag in the People tab.</p>
      <div id="settings-tags-list" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input type="text" id="st-new-tag-name" name="st-new-tag-name" placeholder="New tag name" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;width:160px;">
        <input type="color" id="st-new-tag-color" name="st-new-tag-color" value="#2E7EA6" style="width:40px;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px;cursor:pointer;">
        <button class="btn-primary" style="font-size:.85rem;padding:6px 14px;" onclick="createTagSettings()">Add Tag</button>
      </div>
    </div>
    <!-- Member Types Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9965; Member Types</h3>
      <p>Define the member types available for people records.</p>
      <div id="settings-member-types-list" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" id="st-new-type-name" name="st-new-type-name" placeholder="New type name" style="padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:.88rem;width:180px;">
        <button class="btn-primary" style="font-size:.85rem;padding:6px 14px;" onclick="addMemberTypeSettings()">Add Type</button>
      </div>
    </div>
    <!-- Breeze Status Mapping Card -->
    <div class="import-card">
      <h3>&#128279; Breeze Status &rarr; Member Type Mapping</h3>
      <p>After a Breeze import, each status name that came in from Breeze appears here. Map it to your local member type so future imports assign the right type automatically.</p>
      <div id="settings-mt-map-list" style="margin-bottom:10px;"></div>
      <div id="settings-mt-map-hint" style="font-size:.8rem;color:var(--warm-gray);"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-top:10px;">
        <button class="btn-primary" style="font-size:.82rem;" id="mt-map-save-btn" onclick="saveMtMap()">Save Mapping</button>
        <button class="btn-secondary" style="font-size:.82rem;" onclick="loadMemberTypeMap()">&#8635; Refresh</button>
        <span id="mt-map-status" style="font-size:.82rem;"></span>
      </div>
    </div>

    <!-- ── Data Import & Sync ─────────────────────────────────── -->
    <h2 style="font-size:1rem;font-weight:700;margin:24px 0 12px;color:var(--warm-gray);">Data Import &amp; Sync</h2>
    <!-- Old System Comparison Card -->
    <div class="import-card require-admin" style="margin-bottom:14px;" id="old-sys-compare-card">
      <h3>&#128202; Old System Comparison</h3>
      <p>Upload a spreadsheet from a previous system to compare dates (baptism, confirmation, birthday, anniversary), email, phone, and address against what&#8217;s currently in Connect. Identify missing or mismatched data before deciding what to patch.</p>
      <p style="font-size:.82rem;color:var(--warm-gray);margin-bottom:10px;">Accepts <strong>.csv</strong> (preferred) or <strong>.xlsx</strong> (Excel). To use Excel: File &#8594; Save As &#8594; CSV. Matches people by full name. After upload, map your column headers to the fields below, then run the comparison.</p>
      <input type="file" id="old-sys-file" accept=".csv,.xlsx,.xls,.tsv,.txt" style="display:none;" onchange="oldSysFileSelected(this)">
      <button class="btn-secondary" onclick="document.getElementById('old-sys-file').click()">&#128196; Choose Spreadsheet…</button>
      <span id="old-sys-filename" style="font-size:.82rem;color:var(--warm-gray);margin-left:10px;"></span>
      <div id="old-sys-col-map" style="display:none;margin-top:14px;">
        <p style="font-weight:600;font-size:.88rem;margin-bottom:8px;">Map spreadsheet columns to fields:</p>
        <div id="old-sys-col-map-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:.84rem;max-width:560px;"></div>
        <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
          <button class="btn-primary" onclick="runOldSysCompare()">Run Comparison</button>
          <span id="old-sys-status" class="import-status" style="display:inline;padding:0;background:none;border:none;"></span>
        </div>
      </div>
      <div id="old-sys-results" style="margin-top:18px;"></div>
    </div>
    <div class="import-card">
      <h3>&#9729; Breeze Sync</h3>
      <p>Direct syncing with the Breeze API for people and fund names. Giving sync moved to Giving &rarr; Settings.</p>

      <h4 style="font-size:.9rem;margin:0 0 6px;">People</h4>
      <p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 8px;">Existing records (matched by Breeze ID) are updated; new people are added. Dates and photos already in the system are preserved if Breeze doesn't return a value.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
        <button class="btn-primary" onclick="runBreezeImport()">Sync People from Breeze</button>
        <button class="btn-secondary" onclick="runBreezeTagSync(this)">&#127991; Sync Tags Only</button>
      </div>
      <div class="progress-bar" id="breeze-bar"><div class="progress-fill" id="breeze-fill" style="width:0%"></div></div>
      <div class="import-status" id="breeze-status"></div>
      <div class="import-status" id="breeze-tag-status" style="margin-top:4px;"></div>
      <div id="breeze-diag" style="display:none;margin-top:10px;font-size:.78rem;font-family:monospace;background:var(--linen);padding:10px;border-radius:6px;white-space:pre-wrap;"></div>

      <hr style="margin:16px 0;border:none;border-top:1px solid var(--warm-gray-light,#e0d9d0);">
      <h4 style="font-size:.9rem;margin:0 0 6px;">Fund Names</h4>
      <p style="font-size:.85rem;color:var(--warm-gray);margin:0 0 8px;">After the giving sync, imported funds may show as "Breeze Fund XXXXXXX". Use <strong>Auto-Fix from Breeze</strong> to look up the real names directly from Breeze and rename them automatically. If any funds still have placeholder names after that, use the manual mapping tool below.</p>
      <button class="btn-primary" onclick="fixFundNames()" style="margin-bottom:8px;">&#128260; Auto-Fix Fund Names from Breeze</button>
      <div class="import-status" id="fix-fund-names-status" style="margin-bottom:10px;"></div>
      <div id="manual-fund-rename-area" style="display:none;margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;" id="manual-fund-rename-table"></table>
        <button class="btn-primary" onclick="applyManualFundRenames()" style="margin-top:8px;">Save Fund Names</button>
      </div>
      <p style="margin:10px 0 8px;font-size:.88rem;color:var(--warm-gray);">Manual mapping — reassign contributions from a placeholder fund to a real fund name:</p>
      <button class="btn-secondary" onclick="loadFundMapping()" style="margin-bottom:10px;">Load Fund Mapping</button>
      <div id="fund-map-area" style="display:none;">
        <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:10px;" id="fund-map-table">
          <thead><tr style="text-align:left;border-bottom:1px solid #ccc;"><th style="padding:4px 8px;">Breeze Fund</th><th style="padding:4px 8px;">Gifts</th><th style="padding:4px 8px;">Total</th><th style="padding:4px 8px;">Map to &rarr;</th></tr></thead>
          <tbody id="fund-map-rows"></tbody>
        </table>
        <button class="btn-primary" onclick="applyFundMapping()">Apply Mapping</button>
      </div>
      <div class="import-status" id="fund-map-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128181; Import Giving from Breeze CSV Export</h3>
      <p>Export from Breeze: Contributions &rarr; Export to CSV. Drag &amp; drop the file below or click to browse. Already-imported contributions are skipped (safe to re-run).</p>
      <div id="giving-csv-drop"
        style="border:2px dashed var(--border);border-radius:8px;padding:28px 16px;text-align:center;cursor:pointer;margin-bottom:8px;transition:background .15s;"
        onclick="document.getElementById(&#39;giving-csv-file&#39;).click()"
        ondragover="event.preventDefault();this.style.background=&#39;#f0f4f8&#39;;"
        ondragleave="this.style.background=&#39;&#39;;"
        ondrop="event.preventDefault();this.style.background=&#39;&#39;;importGivingCSV(event.dataTransfer.files[0]);">
        <div style="font-size:2rem;margin-bottom:6px;">&#128228;</div>
        <div id="giving-csv-name" style="font-size:.88rem;color:var(--warm-gray);">Drop CSV here or click to browse</div>
      </div>
      <input type="file" id="giving-csv-file" accept=".csv,.txt" style="display:none;" onchange="importGivingCSV(this.files[0]);">
      <div class="import-status" id="giving-csv-status"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#128203; Find Duplicate Funds</h3>
      <p>Finds fund records that share the exact same name (e.g. two "40085 General Fund" rows) — common when a Breeze fund was re-created or is no longer in Breeze at all. Lets you pick which one to keep; all contributions from the others are reassigned to it and the duplicate rows are deleted.</p>
      <button class="btn-secondary" onclick="loadDuplicateFunds()" style="margin-bottom:10px;">Find Duplicate Funds</button>
      <div id="dup-funds-area"></div>
      <div class="import-status" id="dup-funds-status"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#128203; Manage Funds</h3>
      <p>List of every fund on file. Uncheck "Active" for placeholder/unused funds (e.g. leftover "Breeze Fund 12345" rows with 0 gifts) to hide them from the Giving by Fund report and every other fund picker — this does not delete the fund or touch any gifts already recorded against it, so it's safe even for a fund that turns out to still be needed later.</p>
      <button class="btn-secondary" onclick="loadManageFunds()" style="margin-bottom:10px;">Load Funds</button>
      <div id="manage-funds-area"></div>
      <div class="import-status" id="manage-funds-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128101; Migrate Scheduler Volunteers to People</h3>
      <p>Links each of the Scheduler's existing volunteers to a real ChMS person record (instead of a separate, disconnected list). For each legacy volunteer this suggests a match against real People — by Breeze ID first, then by name — but never links anyone automatically; review and confirm (or search for someone else, or create a new person) before committing.</p>
      <button class="btn-secondary" onclick="loadSchedulerVolunteerMigration()" style="margin-bottom:10px;">Load Volunteers to Migrate</button>
      <div id="sv-mig-area"></div>
      <div class="import-status" id="sv-mig-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128197; Import Attendance (Simple CSV)</h3>
      <p>Paste or upload a 3-column file: <code>date, service_name, attendance</code>. Date must be YYYY-MM-DD. One row per service. Header row optional. Existing records for the same date+time are updated; new ones are inserted.</p>
      <textarea id="att-simple-text" name="att-simple-text" rows="6" style="width:100%;font-family:monospace;font-size:.8rem;padding:6px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;" placeholder="2024-03-10&#9;Sunday 8am&#9;112&#10;2024-03-10&#9;Sunday 10:45am&#9;187"></textarea>
      <button class="btn-primary" onclick="importAttendanceSimple()">Import</button>
      <div class="import-status" id="att-simple-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128229; Export Data</h3>
      <p>Download records as CSV files for reporting, backups, or transfer to other software.</p>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn-secondary" onclick="exportPeople()">&#128100; Export All People</button>
          <span style="font-size:.82rem;color:var(--warm-gray);">All members and contacts with contact info, dates, and household.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn-secondary" onclick="exportGiving()">&#128181; Export Giving</button>
          <select id="export-giving-year" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:.88rem;">
            <option value="">All Years</option>
          </select>
          <span style="font-size:.82rem;color:var(--warm-gray);">All gifts with date, person, fund, amount, method.</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn-secondary" onclick="exportRegister()">&#128214; Export Register</button>
          <span style="font-size:.82rem;color:var(--warm-gray);">All baptism, confirmation, and wedding records.</span>
        </div>
      </div>
      <div class="import-status" id="export-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128140; Brevo Newsletter Sync</h3>
      <p style="font-size:.88rem;color:var(--warm-gray);margin-bottom:10px;">Syncs active members with email addresses to your Brevo contact list. Use "Check Sync" to see who's missing, then bulk-add all at once.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-secondary" style="font-size:.88rem;" onclick="brevoCheckSync()">&#128269; Check Brevo Sync</button>
        <button class="btn-secondary" style="font-size:.88rem;" onclick="brevoBulkSyncAll()">&#8593; Bulk Sync All Members</button>
      </div>
      <div id="brevo-reconcile-status" class="import-status" style="margin-top:8px;"></div>
      <div id="brevo-reconcile-results" style="margin-top:10px;"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#9993; Automated Emails (EM2)</h3>
      <p style="font-size:.88rem;color:var(--warm-gray);margin-bottom:10px;">Daily cron sends birthday emails to active members and anniversary emails to couples at 9am Central. Use these buttons to trigger manually or test.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-secondary" style="font-size:.88rem;" onclick="runEmailTest('birthday')">&#127874; Send Birthday Emails (Today)</button>
        <button class="btn-secondary" style="font-size:.88rem;" onclick="runEmailTest('anniversary')">&#10084; Send Anniversary Emails (Today)</button>
      </div>
      <div class="import-status" id="email-test-status" style="margin-top:8px;"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#128241; Automated Texts (SMS1)</h3>
      <p style="font-size:.88rem;color:var(--warm-gray);margin-bottom:10px;">Daily cron sends birthday and anniversary SMS via Brevo to members with SMS opt-in enabled and a valid phone number. Use these buttons to trigger manually or test.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn-secondary" style="font-size:.88rem;" onclick="runSmsTest(\'birthday\')">&#127874; Send Birthday Texts (Today)</button>
        <button class="btn-secondary" style="font-size:.88rem;" onclick="runSmsTest(\'anniversary\')">&#10084; Send Anniversary Texts (Today)</button>
      </div>
      <div class="import-status" id="sms-test-status" style="margin-top:8px;"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#128276; Push Notifications (Member Portal)</h3>
      <p style="font-size:.88rem;color:var(--warm-gray);margin-bottom:10px;">Send an announcement to all member-portal users who have enabled push notifications on their device.</p>
      <button class="btn-secondary" style="font-size:.88rem;" onclick="openPushBroadcastModal()">&#128276; Send Push Notification</button>
    </div>
    <div class="import-card">
      <h3>&#127968; Household Head Assignment</h3>
      <p id="hq4-status-text">Loading…</p>
      <p style="font-size:.82rem;color:var(--warm-gray);">Heads are used for display names and anniversary pairing. Promotes a spouse (or first member) to Head when none is assigned.</p>
      <button class="btn-secondary" onclick="fixHouseholdHeads()" style="font-size:.88rem;">Fix Household Heads</button>
      <div class="import-status" id="hq4-status"></div>
    </div>
    <div class="import-card require-admin">
      <h3>&#127911; Cascade Household Photos</h3>
      <p>Copy each household's photo to its members who currently have no photo. Members with their own profile picture are never overwritten. Run after uploading new household photos or after a Breeze sync.</p>
      <button class="btn-secondary" onclick="applyAllHouseholdPhotos()" style="font-size:.88rem;">Apply Household Photos</button>
      <div class="import-status" id="cascade-photos-status"></div>
    </div>
    <div class="import-card role-admin">
      <h3>&#128222; Normalize Phone Numbers</h3>
      <p>Reformats all phone numbers in the database to <strong>(XXX) XXX-XXXX</strong>. Safe to run multiple times — unchanged numbers are skipped. Run once after migrating data from Breeze or another source.</p>
      <button class="btn-secondary" onclick="normalizeAllPhones()" style="font-size:.88rem;">Normalize All Phones</button>
      <div class="import-status" id="normalize-phones-status"></div>
    </div>
    <div class="import-card role-admin">
      <h3>&#127968; Validate All Addresses</h3>
      <p>Runs every active person with a street address through USPS address validation and standardizes the format. Undeliverable addresses are left unchanged. Uses USPS Web Tools if configured, otherwise falls back to Census Bureau geocoding (free, no key needed).</p>
      <button class="btn-secondary" onclick="bulkValidateAddresses()" id="bulk-validate-addr-btn" style="font-size:.88rem;">Validate All Addresses</button>
      <div class="import-status" id="bulk-validate-addr-status"></div>
    </div>
  </div>
</div>
<!-- ═══ REGISTER TAB ═══ -->
<div id="tab-register" class="tab-panel">
  <div class="reg-shell">
    <!-- Sub-tab bar -->
    <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);padding:0 20px;flex-shrink:0;background:var(--white);">
      <button class="pv-tab active" data-rtab="baptism" onclick="showRegisterTab('baptism')" style="font-size:13px;padding:12px 18px;">Baptisms</button>
      <button class="pv-tab" data-rtab="confirmation" onclick="showRegisterTab('confirmation')" style="font-size:13px;padding:12px 18px;">Confirmations</button>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
        <button class="btn-secondary" style="display:none;font-size:.8rem;" id="reg-add-toggle" onclick="toggleRegForm()">+ Add</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="openRegFromPeoplePrompt()" title="Generate register entries from people records">&#128100; From People</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="openRegImport()">&#8679; Import File</button>
        <button class="btn-secondary" style="font-size:.8rem;" onclick="printRegister()">Print</button>
      </div>
    </div>
    <!-- Filter toolbar -->
    <div class="reg-toolbar">
      <input class="reg-search" type="search" id="reg-search" placeholder="Search by name&#8230;" oninput="filterRegister()">
      <select class="reg-year-select" id="reg-year-filter" onchange="filterRegister()">
        <option value="">All Years</option>
      </select>
      <span class="reg-stat-txt" id="reg-stat-txt"></span>
    </div>
    <!-- Body: form left + list right -->
    <div class="reg-body">
      <!-- Add / Edit form -->
      <div class="reg-form-panel" id="reg-form-panel">
        <div class="reg-form-title" id="reg-form-title">Add Baptism</div>
        <div class="field"><label>Date</label><input type="date" id="reg-date" name="reg-date"></div>
        <div class="field"><label id="reg-name-lbl">Name Baptized</label><input type="text" id="reg-name" name="reg-name" placeholder="Full name"></div>
        <div class="field"><label>Date of Birth</label><input type="date" id="reg-dob" name="reg-dob"></div>
        <div class="field"><label>Place of Birth</label><input type="text" id="reg-place-of-birth" name="reg-place-of-birth" placeholder="Optional"></div>
        <div class="field"><label>Baptism Place</label><input type="text" id="reg-baptism-place" name="reg-baptism-place" placeholder="Optional"></div>
        <div class="field"><label>Father</label><input type="text" id="reg-father" name="reg-father" placeholder="Optional"></div>
        <div class="field"><label>Mother</label><input type="text" id="reg-mother" name="reg-mother" placeholder="Optional"></div>
        <div class="field"><label>Sponsors / Godparents</label><input type="text" id="reg-sponsors" name="reg-sponsors" placeholder="Optional"></div>
        <div class="field"><label>Officiant</label><input type="text" id="reg-officiant" name="reg-officiant" placeholder="Pastor name"></div>
        <div class="field"><label>Record Type</label><input type="text" id="reg-record-type" name="reg-record-type" placeholder="e.g. Infant, Adult (optional)"></div>
        <div class="field"><label>Notes</label><textarea id="reg-notes" name="reg-notes" placeholder="Optional notes" style="width:100%;height:64px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;"></textarea></div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn-primary" style="font-size:.85rem;" id="reg-save-btn" onclick="saveRegisterEntry()">Add Entry</button>
          <button class="btn-secondary" style="font-size:.85rem;display:none;" id="reg-cancel-btn" onclick="cancelRegisterEdit()">Cancel</button>
        </div>
      </div>
      <!-- List -->
      <div class="reg-list-panel">
        <div id="reg-list"></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ VOLUNTEERS TAB ═══ -->
<div id="tab-volunteers" class="tab-panel">
  <div style="padding:16px 20px;max-width:1100px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
      <h2 style="font-size:1.1rem;font-weight:700;color:var(--charcoal);">Volunteers</h2>
    </div>

    <div class="vol-shell" style="display:flex;align-items:flex-start;gap:0;background:var(--white);border-radius:20px;box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05);overflow:hidden;margin-bottom:28px;">
      <!-- Sub-nav: Signups / Ministry Roles / Events -->
      <div id="vol-subnav" class="vol-subnav">
        <button class="vol-subtab-btn active" onclick="volShowSection('signups',this)">Signups</button>
        <button class="vol-subtab-btn" onclick="volShowSection('mroles',this)">Ministry Roles</button>
        <button class="vol-subtab-btn" onclick="volShowSection('events',this)">Events</button>
        <div class="vol-subnav-divider"></div>
        <button class="vol-subtab-btn" onclick="volShowSection('templates',this)">Templates</button>
      </div>

      <div class="vol-content-pane" style="flex:1;min-width:0;padding:20px 24px;">
    <div id="vol-panel-signups">
      <!-- Signups section -->
      <div id="vol-signups-section" style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
          <h3 id="vol-signups-title" style="font-size:1rem;font-weight:600;color:var(--charcoal);">All Volunteers <span id="vol-signups-count" style="background:var(--navy);color:var(--white);border-radius:99px;padding:1px 8px;font-size:.75rem;margin-left:4px;">…</span></h3>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn-secondary" style="font-size:.8rem;" onclick="volToggleDuplicates()" id="vol-dup-btn">Show Duplicates</button>
            <button class="btn-secondary" style="font-size:.8rem;" onclick="window.print()">Print List</button>
            <a id="vol-export-link" href="/admin/api/export.csv" class="btn-secondary" style="font-size:.8rem;" download>Export CSV</a>
          </div>
        </div>
        <div id="vol-duplicates-panel" style="display:none;background:#fff8f0;border:1px solid #e0b060;border-radius:10px;padding:14px;margin-bottom:12px;">
          <h4 style="font-size:.9rem;font-weight:600;color:#8a5000;margin-bottom:10px;">Emails with multiple signups</h4>
          <div id="vol-duplicates-list"></div>
        </div>
        <div id="vol-status-pills" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;"></div>
        <div id="vol-signups-list" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
      </div>
    </div>

    <!-- Ministry Roles management -->
    <div id="vol-panel-mroles" style="display:none;">
      <div id="vol-mroles-section" style="margin-bottom:28px;">
        <div class="ev-master-detail">
          <div class="ev-list-col ev-list-col-wide">
            <div class="ev-list-header"><h4>Ministry Roles <span id="vol-mroles-count" style="background:rgba(30,45,74,.08);color:var(--ev-navy);border-radius:99px;padding:1px 8px;font-size:.7rem;font-family:var(--font-body);margin-left:2px;">…</span></h4></div>
            <div class="ev-list-search"><input type="text" placeholder="Search roles…" oninput="volFilterMRoles(this.value)"></div>
            <div class="ev-list-rows" id="vol-mroles-list" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
            <div class="ev-list-footer"><button onclick="volNewMinistryRole()">Add role</button></div>
          </div>
          <div class="ev-detail-col" id="vol-mrole-detail" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
        </div>
      </div>
    </div>

    <!-- Events management -->
    <div id="vol-panel-events" style="display:none;">
      <div id="vol-events-section" style="margin-bottom:28px;">
        <div id="vol-add-event-form" style="display:none;background:var(--white);border-radius:10px;border:1px solid var(--border);padding:16px;margin-bottom:12px;">
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;">
            <div style="flex:1;min-width:180px;"><label style="font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--charcoal);display:block;margin-bottom:4px;">Event Name *</label><input type="text" id="vol-new-ev-name" name="vol-new-ev-name" class="form-input" style="width:100%;" placeholder="e.g. Easter Egg Hunt"></div>
            <div style="flex:0 0 160px;"><label style="font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--charcoal);display:block;margin-bottom:4px;">Date</label><input type="date" id="vol-new-ev-date" name="vol-new-ev-date" class="form-input" style="width:100%;"></div>
          </div>
          <div style="margin-bottom:8px;"><label style="font-size:.78rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--charcoal);display:block;margin-bottom:4px;">Description</label><textarea id="vol-new-ev-desc" name="vol-new-ev-desc" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:.85rem;font-family:inherit;height:60px;resize:vertical;" placeholder="Brief description…"></textarea></div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;"><input type="checkbox" id="vol-new-ev-time-slots" checked style="width:auto;margin:0;"><label for="vol-new-ev-time-slots" style="font-size:.83rem;cursor:pointer;">Roles have scheduled time slots</label></div>
          <div style="display:flex;gap:6px;">
            <button class="btn-primary" style="font-size:.82rem;" onclick="volSaveNewEvent()">Save Event</button>
            <button class="btn-secondary" style="font-size:.82rem;" onclick="document.getElementById('vol-add-event-form').style.display='none'">Cancel</button>
          </div>
        </div>
        <div class="ev-master-detail">
          <div class="ev-list-col">
            <div class="ev-list-header ev-list-header-row"><h4>Events <span id="vol-events-count" style="background:rgba(30,45,74,.08);color:var(--ev-navy);border-radius:99px;padding:1px 8px;font-size:.7rem;font-family:var(--font-body);margin-left:2px;">…</span></h4><button class="ev-new-btn" onclick="volShowAddEventForm()">+ New</button></div>
            <div class="ev-list-rows" id="vol-events-list" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
          </div>
          <div class="ev-detail-col" id="vol-event-detail" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
        </div>
      </div>
    </div>

    <!-- Email Templates section -->
    <div id="vol-panel-templates" style="display:none;">
    <div id="vol-templates-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="font-size:1rem;font-weight:600;color:var(--charcoal);margin-bottom:2px;">Outreach Email Templates</h3>
          <p style="font-size:.8rem;color:var(--warm-gray);margin:0;">Reusable form letters for welcoming volunteers. Variables: <code style="font-size:.78rem;">{{first_name}}</code> <code style="font-size:.78rem;">{{last_name}}</code> <code style="font-size:.78rem;">{{name}}</code> <code style="font-size:.78rem;">{{ministry}}</code> <code style="font-size:.78rem;">{{roles}}</code> <code style="font-size:.78rem;">{{service}}</code> <code style="font-size:.78rem;">{{sundays}}</code> <code style="font-size:.78rem;">{{notes}}</code></p>
        </div>
      </div>
      <div id="vol-templates-list" style="margin-bottom:12px;"></div>
      <!-- Add / Edit form -->
      <div id="vol-tmpl-form" style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;">
        <div style="font-size:.82rem;font-weight:600;color:var(--charcoal);margin-bottom:8px;" id="vol-tmpl-form-title">Add Template</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <div style="flex:2;min-width:160px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Template Name *</label><input type="text" id="vol-tmpl-name" class="form-input" style="width:100%;" placeholder="e.g. Worship Welcome"></div>
          <div style="flex:1;min-width:120px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Ministry</label>
            <select id="vol-tmpl-ministry" class="form-input" style="width:100%;">
              <option value="">All ministries</option>
              <option value="worship">Worship</option>
              <option value="events">Events</option>
              <option value="education">Education</option>
              <option value="acceptance">Acceptance</option>
              <option value="outreach">Outreach</option>
              <option value="general">General</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:8px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Subject *</label><input type="text" id="vol-tmpl-subject" class="form-input" style="width:100%;" placeholder="e.g. Welcome to the Worship Ministry at Timothy!"></div>
        <div style="margin-bottom:10px;"><label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Message Body *</label><textarea id="vol-tmpl-body" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;height:120px;resize:vertical;" placeholder="Hi {{first_name}},&#10;&#10;Thank you for your interest in the Worship Ministry! We meet every Sunday…"></textarea></div>
        <div style="display:flex;gap:6px;">
          <button class="btn-primary" style="font-size:.82rem;" id="vol-tmpl-save-btn" onclick="volSaveTemplate()">Add Template</button>
          <button class="btn-secondary" style="font-size:.82rem;display:none;" id="vol-tmpl-cancel-btn" onclick="volCancelEditTemplate()">Cancel</button>
        </div>
      </div>
    </div>
    </div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ VOLUNTEER: LINK PERSON MODAL ═══ -->
<div id="vol-link-person-modal" class="modal-overlay" onclick="if(event.target===this)closeModal('vol-link-person-modal')">
  <div class="modal" style="max-width:520px;width:95%;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="font-size:1rem;font-weight:700;color:var(--charcoal);">Link to Person Record</h3>
      <button onclick="closeModal('vol-link-person-modal')" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--warm-gray);">✕</button>
    </div>
    <div style="font-size:.85rem;color:#4A4860;margin-bottom:10px;">Signup: <strong id="vol-link-signup-name"></strong></div>
    <!-- Current link -->
    <div id="vol-link-current" style="display:none;background:rgba(46,126,166,.08);border:1px solid rgba(46,126,166,.2);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:.83rem;display:flex;align-items:center;justify-content:space-between;gap:8px;">
      <span>Currently linked: <strong id="vol-link-current-name"></strong> <span style="color:var(--warm-gray);">#<span id="vol-link-current-id"></span></span></span>
      <button class="btn-secondary" style="font-size:.75rem;padding:2px 8px;color:var(--danger);" onclick="volDoUnlinkPerson()">Unlink</button>
    </div>
    <!-- Search -->
    <div style="display:flex;gap:6px;margin-bottom:8px;">
      <input type="text" id="vol-link-search" class="form-input" style="flex:1;" placeholder="Search by name or email…" onkeydown="if(event.key==='Enter')volSearchPeople()">
      <button class="btn-primary" style="font-size:.82rem;" onclick="volSearchPeople()">Search</button>
    </div>
    <div id="vol-link-results" style="max-height:220px;overflow-y:auto;margin-bottom:10px;"></div>
    <div style="border-top:1px solid var(--border);padding-top:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span style="font-size:.8rem;color:var(--warm-gray);">No match? Create a new Visitor profile from this sign-up.</span>
      <button class="btn-secondary" style="font-size:.82rem;" onclick="volDoCreatePerson()">+ Create New Person</button>
    </div>
  </div>
</div>

<!-- ═══ VOLUNTEER: SEND EMAIL MODAL ═══ -->
<div id="vol-send-email-modal" class="modal-overlay" onclick="if(event.target===this)closeModal('vol-send-email-modal')">
  <div class="modal" style="max-width:580px;width:95%;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <h3 style="font-size:1rem;font-weight:700;color:var(--charcoal);">Send Outreach Email</h3>
      <button onclick="closeModal('vol-send-email-modal')" style="background:none;border:none;cursor:pointer;font-size:1.2rem;color:var(--warm-gray);">✕</button>
    </div>
    <div style="font-size:.82rem;color:#4A4860;margin-bottom:12px;">To: <strong id="vol-send-to"></strong></div>
    <!-- Template picker -->
    <div style="margin-bottom:10px;">
      <label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:4px;">Start from a template</label>
      <div style="display:flex;gap:6px;">
        <select id="vol-send-template-select" class="form-input" style="flex:1;"><option value="">— Select a template —</option></select>
        <button class="btn-secondary" style="font-size:.82rem;" onclick="volApplyTemplate()">Apply</button>
      </div>
    </div>
    <div style="margin-bottom:8px;">
      <label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Subject *</label>
      <input type="text" id="vol-send-subject" class="form-input" style="width:100%;" placeholder="Email subject…">
    </div>
    <div style="margin-bottom:12px;">
      <label style="font-size:.75rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:3px;">Message *</label>
      <textarea id="vol-send-body" style="width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:.83rem;font-family:inherit;height:160px;resize:vertical;" placeholder="Type your message here…"></textarea>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
      <span id="vol-send-status" style="font-size:.83rem;"></span>
      <div style="display:flex;gap:6px;">
        <button class="btn-secondary" style="font-size:.82rem;" onclick="closeModal('vol-send-email-modal')">Cancel</button>
        <button class="btn-primary" style="font-size:.82rem;" id="vol-send-btn" onclick="volDoSendEmail()">Send</button>
      </div>
    </div>
  </div>
</div>

<!-- ═══ VOLUNTEER: ADD/EDIT SHIFT MODAL ═══ -->
<div id="vol-shift-modal" class="modal-overlay" style="background:rgba(30,45,74,.35);" onclick="if(event.target===this)closeModal('vol-shift-modal')">
  <div class="modal ev-fields" style="max-width:440px;width:95%;padding:24px;gap:14px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h3 id="vol-shift-modal-title" style="font-family:'Lora',serif;font-weight:600;font-size:1.05rem;color:var(--ev-navy);margin:0;">Edit shift</h3>
      <span id="vol-shift-day-label" style="font-size:.72rem;color:var(--ev-muted);"></span>
    </div>
    <div><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">Shift name</label><input type="text" id="vol-shift-name"></div>
    <div><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">Description</label><textarea id="vol-shift-desc" style="min-height:52px;"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">Date</label><input type="date" id="vol-shift-date"></div>
      <div><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">Start</label><input type="time" id="vol-shift-start"></div>
      <div><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">End</label><input type="time" id="vol-shift-end"></div>
    </div>
    <div style="max-width:110px;"><label style="font-size:.66rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ev-muted);display:block;margin-bottom:5px;">Spots</label><input type="number" id="vol-shift-slots" min="0"></div>
    <div id="vol-shift-filled-hint" style="font-size:.72rem;color:var(--ev-muted);margin:-6px 0 2px;"></div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">
      <a href="javascript:void(0)" id="vol-shift-delete" style="color:#c0392b;font-size:.78rem;font-weight:600;text-decoration:none;cursor:pointer;" onclick="volDeleteShift()">Delete shift</a>
      <div style="display:flex;gap:8px;">
        <button class="ev-btn-secondary" onclick="closeModal('vol-shift-modal')">Cancel</button>
        <button class="ev-btn-primary" onclick="volSaveShift()">Save shift</button>
      </div>
    </div>
  </div>
</div>

`;

export const HTML_TABS_2 = String.raw`
<!-- ═══ PROFILE VIEW ═══ -->
<div id="profile-view">
  <div class="topbar">
    <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
    <span class="topbar-back" onclick="closeProfile()">&#8592; People</span>
    <span id="pv-topbar-name" style="font-size:15px;font-weight:500;color:var(--charcoal);margin-left:8px;"></span>
    <div style="display:flex;gap:8px;margin-left:auto;align-items:center;">
      <div id="pv-status-actions" style="display:flex;gap:6px;align-items:center;"></div>
      <button class="btn-secondary" onclick="window.print()">Print</button>
    </div>
  </div>
  <div class="pv-body">
    <div class="pv-hdr">
      <div class="pv-photo-wrap" id="pv-photo-wrap">
        <div class="pv-photo" id="pv-photo"></div>
        <div class="pv-photo-upload-overlay require-edit" id="pv-photo-overlay" onclick="triggerPhotoUpload()" title="Upload photo" style="display:none;">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="white" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
        <button type="button" id="pv-photo-remove-btn" class="require-edit" onclick="removePersonPhoto()" title="Remove photo" style="display:none;position:absolute;top:-4px;right:-4px;width:22px;height:22px;border-radius:50%;border:none;background:var(--clay-red);color:white;font-size:14px;line-height:1;cursor:pointer;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.3);">&times;</button>
        <button type="button" id="pv-photo-recrop-btn" class="require-edit" onclick="recropPersonPhoto()" title="Re-crop current photo" style="display:none;position:absolute;top:-4px;left:-4px;width:22px;height:22px;border-radius:50%;border:none;background:var(--steel-anchor);color:white;font-size:12px;line-height:1;cursor:pointer;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.3);">&#9986;</button>
        <button type="button" id="pv-photo-pick-btn" class="require-edit" onclick="openPVPhotoPicker()" title="Use a family member's photo" style="display:none;position:absolute;bottom:-4px;left:-4px;width:22px;height:22px;border-radius:50%;border:none;background:var(--moss-green);color:white;font-size:12px;line-height:1;cursor:pointer;padding:0;box-shadow:0 1px 3px rgba(0,0,0,.3);">&#128100;</button>
      </div>
      <input type="file" id="pv-photo-input" accept="image/*" style="display:none;" onchange="handlePhotoFileSelected(this)">
      <div class="pv-hdr-info">
        <div class="pv-fullname" id="pv-fullname"></div>
        <div class="pv-meta">
          <span id="pv-badge"></span>
          <span id="pv-hh" class="pv-hh-link"></span>
          <span id="pv-role" class="pv-role-txt"></span>
        </div>
      </div>
      <div class="pv-hdr-actions" id="pv-hdr-actions"></div>
    </div>
    <div class="pv-tabs">
      <div class="pv-tab active" data-ptab="info" onclick="showPvTab('info')">Information</div>
      <div class="pv-tab require-finance" data-ptab="giving" onclick="showPvTab('giving')">Giving</div>
      <div class="pv-tab" data-ptab="attendance" onclick="showPvTab('attendance')">Attendance</div>
      <div class="pv-tab" data-ptab="timeline" onclick="showPvTab('timeline')">Timeline</div>
    </div>
    <div class="pv-layout">
      <div class="pv-main">
        <div id="ptab-info" class="ptab-panel active"></div>
        <div id="ptab-giving" class="ptab-panel">
          <div style="padding:16px 0 0;" class="require-finance">
            <button class="btn-primary" onclick="togglePvQuickGift()" id="pv-gift-btn">+ Add Gift</button>
            <div id="pv-quick-gift" style="display:none;margin-top:12px;background:var(--linen);border-radius:10px;padding:16px;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
                <div class="field"><label>Date</label><input type="date" id="pv-gift-date" name="pv-gift-date" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field"><label>Amount ($)</label><input type="number" id="pv-gift-amount" name="pv-gift-amount" min="0.01" step="0.01" placeholder="0.00" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field"><label>Fund</label><select id="pv-gift-fund" name="pv-gift-fund" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></select></div>
                <div class="field"><label>Method</label><select id="pv-gift-method" name="pv-gift-method" onchange="togglePvCheckNum()" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;">
                  <option value="cash">Cash</option><option value="check">Check</option><option value="online">Online</option><option value="stock">Stock</option><option value="other">Other</option>
                </select></div>
                <div class="field" id="pv-gift-check-row" style="display:none;"><label>Check #</label><input type="text" id="pv-gift-check" name="pv-gift-check" placeholder="e.g. 1042" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
                <div class="field" style="grid-column:1/-1;"><label>Notes</label><input type="text" id="pv-gift-notes" name="pv-gift-notes" placeholder="Optional note…" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></div>
              </div>
              <div style="display:flex;gap:8px;">
                <button class="btn-primary" onclick="submitPvQuickGift()">Save Gift</button>
                <button class="btn-secondary" onclick="togglePvQuickGift()">Cancel</button>
              </div>
              <div id="pv-gift-err" style="color:var(--danger);font-size:.82rem;margin-top:6px;display:none;"></div>
            </div>
          </div>
          <div id="pv-giving-content" style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Loading giving history…</div>
        </div>
        <div id="ptab-attendance" class="ptab-panel">
          <div style="color:var(--warm-gray);font-size:13px;padding:20px 0;">Attendance records for this person will appear here.</div>
        </div>
        <div id="ptab-timeline" class="ptab-panel">
          <div style="color:var(--warm-gray);font-size:13px;padding:20px 0;font-style:italic;">Timeline coming soon — pastoral notes and visit log.</div>
        </div>
      </div>
      <div class="pv-aside" id="pv-aside"></div>
    </div>
  </div>
  <div class="pv2-toast" id="pv2-toast"><span class="ck">&#10003;</span> Changes saved</div>
</div>

<!-- ═══ HOUSEHOLD VIEW ═══ -->
<div id="household-view">
  <div class="topbar">
    <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
    <span class="topbar-back" onclick="closeHouseholdView()">&#8592; Households</span>
    <span id="hv-topbar-name" style="font-size:15px;font-weight:500;color:var(--charcoal);margin-left:8px;"></span>
    <div style="display:flex;gap:8px;margin-left:auto;align-items:center;">
      <button class="btn-outline-cream require-edit" id="hv-edit-btn">Edit</button>
    </div>
  </div>
  <div class="pv-body">
    <div id="hv-info"></div>
  </div>
  <div class="pv2-toast" id="hv-toast"><span class="ck">&#10003;</span> Changes saved</div>
</div>

<!-- ═══ ORGANIZATION VIEW (full page, mirrors Household View) ═══ -->
<div id="organization-view">
  <div class="topbar">
    <button class="hamburger" onclick="openSidebar()" aria-label="Menu"><svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
    <span class="topbar-back" onclick="closeOrganizationView()">&#8592; Organizations</span>
    <span id="ov-topbar-name" style="font-size:15px;font-weight:500;color:var(--charcoal);margin-left:8px;"></span>
    <div style="display:flex;gap:8px;margin-left:auto;align-items:center;">
      <button class="btn-outline-cream require-edit" id="ov-edit-btn">Edit</button>
    </div>
  </div>
  <div class="pv-body">
    <div id="ov-info"></div>
  </div>
  <div class="pv2-toast" id="ov-toast"><span class="ck">&#10003;</span> Changes saved</div>
</div>

<!-- ═══ TUITION AID PLANNER TAB ═══ -->
<div id="tab-tuitionaid" class="tab-panel">
  <div style="padding:16px 20px 20px;">
    <div id="tap-loading" style="color:var(--warm-gray);font-size:.85rem;">Loading…</div>
    <div id="tap-root" style="display:none;">

      <section class="tap-kpi-row" id="tap-kpi-row"></section>

      <section class="tap-pathway">
        <h3 style="margin:0 0 2px;font-size:1rem;color:var(--navy);">The Pathway — where this year's students stand</h3>
        <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">PK4 &rarr; Kindergarten (aid begins) &rarr; grades 1&ndash;8 at Timothy &rarr; Lutheran High School South, grades 9&ndash;12</p>
        <div class="tap-path-track" id="tap-path-track"></div>
        <div class="tap-flags" id="tap-flags"></div>
      </section>

      <section class="tap-grid2">
        <div class="dash-card">
          <div class="dash-card-hdr">Tuition Rate &amp; Family Share by Year</div>
          <div class="dash-card-body" style="padding:14px 18px;"><div id="tap-history-chart"></div></div>
        </div>
        <div class="dash-card">
          <div class="dash-card-hdr">Aid Composition, Current Year</div>
          <div class="dash-card-body" style="padding:14px 18px;"><div id="tap-composition-chart"></div></div>
        </div>
      </section>

      <section class="tap-grid2b">
        <div class="dash-card">
          <div class="dash-card-hdr">Budget Projection</div>
          <div class="dash-card-body" style="padding:14px 18px;"><div id="tap-projection-chart"></div></div>
        </div>
        <div class="dash-card">
          <div class="dash-card-hdr">Enrollment Mix by Year</div>
          <div class="dash-card-body" style="padding:14px 18px;"><div id="tap-enroll-chart"></div></div>
        </div>
      </section>

      <section class="dash-card" style="margin-bottom:16px;">
        <div class="dash-card-hdr">K-8 Family Detail, Current Year</div>
        <div class="dash-card-body" style="padding:14px 18px;overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem;" id="tap-detail-table">
            <thead>
              <tr style="border-bottom:2px solid var(--navy);">
                <th style="text-align:left;padding:6px 8px;">Family</th>
                <th style="text-align:left;padding:6px 8px;">Child</th>
                <th style="text-align:left;padding:6px 8px;">Grade</th>
                <th style="text-align:right;padding:6px 8px;">Outside Aid</th>
                <th style="text-align:right;padding:6px 8px;">Timothy Owes</th>
                <th style="text-align:right;padding:6px 8px;">Family Owes</th>
                <th style="text-align:left;padding:6px 8px;">Linked Person</th>
              </tr>
            </thead>
            <tbody id="tap-detail-body"></tbody>
          </table>
        </div>
      </section>

      <section class="dash-card" style="margin-bottom:16px;">
        <div class="dash-card-hdr">Year Navigator</div>
        <div class="dash-card-body" style="padding:14px 18px;">
          <div class="tap-controls">
            <label>View year: <select id="tap-year-select" onchange="tapSetYear(this.value)"></select></label>
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;">
              Actual tuition for <b id="tap-year-rate-label">–</b>: $<input type="number" id="tap-year-rate-input" min="0" step="1" style="width:90px;">
              <button class="btn-secondary" style="font-size:.72rem;padding:4px 10px;" onclick="tapSaveYearRate()">Save</button>
            </span>
            <button class="btn-secondary" onclick="tapOpenImportHistory()">Import History from Excel&hellip;</button>
          </div>
          <p style="font-size:.72rem;color:var(--warm-gray);margin:6px 0 0;" id="tap-year-rate-note"></p>
        </div>
      </section>

      <div id="tap-planner-current">
      <section class="dash-card" style="margin-bottom:16px;">
        <div class="dash-card-hdr">Total Timothy Aid — K-8 (WOL) + LHS combined</div>
        <div class="dash-card-body" style="padding:14px 18px;">
          <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 12px;">One shared pool, not two separate budgets: LHS awards come off the top first (LHS enrollment isn't something set directly, it just is what it is each year), and whatever's left over becomes the K-8 budget below.</p>
          <div style="margin-bottom:10px;">
            <div class="tap-gauge-track"><div class="tap-gauge-fill" id="tap-total-gauge-fill"></div></div>
            <div class="tap-gauge-label">
              <span class="tap-gauge-text" id="tap-total-gauge-text">–</span>
              <span id="tap-total-gauge-cap">Total Timothy Aid Budget: –</span>
            </div>
          </div>
          <div class="tap-controls">
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:.82rem;">
              Total Timothy Aid Budget: $<input type="number" id="tap-total-budget-input" min="0" step="1" style="width:110px;">
              <button class="btn-secondary" style="font-size:.72rem;padding:4px 10px;" onclick="tapSaveTotalBudget()">Save</button>
            </span>
          </div>
        </div>
      </section>
      <section class="dash-card" style="margin-bottom:16px;">
        <div class="dash-card-hdr">Student Aid Planner — keep Timothy's award under budget</div>
        <div class="dash-card-body" style="padding:14px 18px;">
          <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 12px;">Each slider sets the family's assigned share of the total tuition bill — outside scholarships apply against that share first. Timothy commits at least $2,000/student. Project a future year and the roster moves: grades advance, 8th graders graduate into the LHS planner, and 12th graders age out. Editing outside aid, family share, or LHS award while viewing a year other than the current one pins that year's numbers without touching any other year.</p>

          <div class="tap-pipeline-box">
            <h4>Kids in the Pipeline <span style="font-weight:400;font-size:.7rem;color:#8A7440;">— not yet enrolled, tracked by birth year</span></h4>
            <div id="tap-pipeline-list"></div>
            <div class="tap-pipeline-form">
              <input type="text" id="tap-pipe-family" placeholder="Family name" style="width:150px;">
              <input type="text" id="tap-pipe-child" placeholder="Child's name" style="width:150px;">
              <input type="number" id="tap-pipe-birthyear" placeholder="Birth year" min="2010" max="2032" style="width:120px;">
              <select id="tap-pipe-grade" title="Only needed if birth year alone would guess wrong — e.g. a kid close to the cutoff date, or one being held back a year">
                <option value="">Grade (auto by birth year)</option>
                <option value="PK 3">PK 3</option>
                <option value="PK 4">PK 4</option>
                <option value="K">K</option>
                <option value="1">1st</option>
                <option value="2">2nd</option>
                <option value="3">3rd</option>
                <option value="4">4th</option>
                <option value="5">5th</option>
                <option value="6">6th</option>
                <option value="7">7th</option>
                <option value="8">8th</option>
              </select>
              <button class="btn-secondary" onclick="tapAddPipeline()">+ Add to Pipeline</button>
            </div>
            <div style="font-size:.75rem;color:var(--danger);margin-top:6px;min-height:14px;" id="tap-pipeline-error"></div>
          </div>

          <div class="tap-controls">
            <button class="btn-secondary" onclick="tapResetAwards()">Reset to Current Awards</button>
            <button class="btn-primary" onclick="tapApplyPolicy()">Apply Aid Policy</button>
            <button class="btn-secondary" onclick="tapAutoBalance()">Auto-Balance to Fit Budget</button>
            <button class="btn-secondary" onclick="tapOpenAddStudent()">+ Add Student</button>
          </div>
          <p style="font-size:.72rem;color:var(--warm-gray);margin:-6px 0 12px;">
            <b>Apply Aid Policy:</b> no family pays more than 50% of the bill, Timothy commits at least $2,000/student — and if budget room remains, it's given proportionally to whoever still owes something.
          </p>

          <div style="margin-bottom:14px;">
            <div class="tap-gauge-track"><div class="tap-gauge-fill" id="tap-k8-gauge-fill"></div></div>
            <div class="tap-gauge-label">
              <span class="tap-gauge-text" id="tap-k8-gauge-text">–</span>
              <span id="tap-k8-gauge-cap">Budget: –</span>
            </div>
          </div>

          <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead id="tap-k8-thead">
              <tr style="border-bottom:2px solid var(--navy);">
                <th style="text-align:left;padding:6px 8px;">Family</th>
                <th style="text-align:left;padding:6px 8px;">Child</th>
                <th style="text-align:left;padding:6px 8px;">Grade</th>
                <th style="text-align:right;padding:6px 8px;">Tuition</th>
                <th style="text-align:right;padding:6px 8px;">Outside Aid</th>
                <th style="text-align:left;padding:6px 8px;min-width:190px;">Family Share %</th>
                <th style="text-align:right;padding:6px 8px;">Timothy Award $</th>
                <th style="text-align:right;padding:6px 8px;">Family Owes $</th>
                <th style="padding:6px 8px;"></th>
              </tr>
            </thead>
            <tbody id="tap-k8-body"></tbody>
          </table>
          </div>
        </div>
      </section>

      <section class="dash-card" style="margin-bottom:16px;">
        <div class="dash-card-hdr">LHS Aid Planner — scales with enrollment</div>
        <div class="dash-card-body" style="padding:14px 18px;">
          <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 12px;">Not a fixed pool — it waxes and wanes with how many Timothy graduates actually attend LHS that year. The bar compares against the standard $1,200/student rate for however many are enrolled, not a hard cap.</p>
          <div style="margin-bottom:14px;">
            <div class="tap-gauge-track"><div class="tap-gauge-fill" id="tap-lhs-gauge-fill"></div></div>
            <div class="tap-gauge-label">
              <span class="tap-gauge-text" id="tap-lhs-gauge-text">–</span>
              <span id="tap-lhs-gauge-cap">Standard rate: –</span>
            </div>
          </div>
          <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
            <thead id="tap-lhs-thead">
              <tr style="border-bottom:2px solid var(--navy);">
                <th style="text-align:left;padding:6px 8px;">Family</th>
                <th style="text-align:left;padding:6px 8px;">Child</th>
                <th style="text-align:left;padding:6px 8px;">Grade</th>
                <th style="text-align:left;padding:6px 8px;min-width:190px;">LHSA Award</th>
                <th style="text-align:right;padding:6px 8px;">Award $</th>
                <th style="padding:6px 8px;"></th>
              </tr>
            </thead>
            <tbody id="tap-lhs-body"></tbody>
          </table>
          </div>
        </div>
      </section>
      </div>

      <section class="dash-card" id="tap-planner-past" style="display:none;margin-bottom:16px;">
        <div class="dash-card-hdr">Past Year Record</div>
        <div class="dash-card-body" style="padding:14px 18px;">
          <div id="tap-past-year-body"></div>
        </div>
      </section>

    </div>
  </div>
</div>

<!-- ═══ FINANCE OVERVIEW TAB ═══ -->
<div id="tab-finance" class="tab-panel">
  <div style="padding:16px 20px 20px;">
    <div id="fin-toast" style="display:none;background:var(--navy);color:var(--white);padding:8px 14px;border-radius:6px;font-size:.82rem;margin-bottom:12px;"></div>
    <div id="fin-loading" style="color:var(--warm-gray);font-size:.85rem;">Loading…</div>
    <div id="fin-root" style="display:none;">

      <div id="fin-subnav-mount-finance" class="fin-subnav"></div>

      <div style="font-size:.78rem;color:var(--warm-gray);margin-bottom:14px;">Need help with this tab? <a href="mailto:office@timothystl.org">Contact the office</a>.</div>

      <div id="fin-panel-overview">

        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:18px;">
          <div>
            <h2 id="fin-ov-title" style="font-family:var(--font-display);font-size:26px;font-weight:700;color:var(--color-navy);margin:0 0 2px;">Financial Overview</h2>
            <div id="fin-ov-caption" style="font-size:.82rem;color:var(--warm-gray);">&nbsp;</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <select id="fin-ov-domain" class="fin-domain-select" onchange="finOverviewSetDomain(this.value)">
              <option value="church">Church Operating</option>
              <option value="daycare">Daycare (MDO)</option>
              <option value="property">Commercial Property</option>
            </select>
            <span id="fin-ov-sync-pill" class="fin-sync-pill" style="display:none;"></span>
          </div>
        </div>

        <div id="fin-ov-dashboard">Loading…</div>

        <div style="margin:26px 0 14px;font-size:.78rem;color:var(--warm-gray);border-top:1px solid var(--warm-border);padding-top:16px;">Data sync, connections, and manual-entry tools are below.</div>

        <section class="dash-card" style="margin-bottom:16px;">
          <div class="dash-card-hdr">Board Packet</div>
          <div class="dash-card-body" style="padding:14px 18px;">
            <p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 12px;">Downloads one JSON file with this year's Income Statement, Balance Sheet, 5-year trends, and the full daycare ledger — hand it to a Claude session (or any analyst) each month and ask it to write the board's finance summary, flagging anything unusual. This app doesn't write the narrative itself; it just packages the numbers.</p>
            <button class="btn-primary" id="fin-board-packet-btn" onclick="finExportBoardPacket()">Export Board Packet</button>
          </div>
        </section>

        <section class="dash-card" style="margin-bottom:16px;">
          <div class="dash-card-hdr">QuickBooks Connection</div>
          <div class="dash-card-body" style="padding:14px 18px;" id="fin-connection"></div>
        </section>

        <section class="dash-card" style="margin-bottom:16px;">
          <div class="dash-card-hdr">Budget vs. Actual</div>
          <div class="dash-card-body" style="padding:14px 18px;" id="fin-budget"></div>
        </section>

        <section class="dash-card" style="margin-bottom:16px;">
          <div class="dash-card-hdr">Account Balances</div>
          <div class="dash-card-body" style="padding:14px 18px;" id="fin-accounts"></div>
        </section>

        <section class="dash-card" style="margin-bottom:16px;">
          <div class="dash-card-hdr">Daycare Sync</div>
          <div class="dash-card-body" style="padding:14px 18px;">
            <div id="fin-daycare-sync" style="margin-bottom:12px;"></div>
            <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 12px;">The full period-by-period breakdown pulled from the daycare app lives in the <b>Daycare Report</b> tab (year-by-year summary) — this card is just the sync control and hand-entered adjustments.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
              <label style="font-size:.75rem;color:var(--warm-gray);">Period<br><input type="text" id="fin-dc-period" placeholder="2026-07" style="width:100px;"></label>
              <label style="font-size:.75rem;color:var(--warm-gray);">Category<br><input type="text" id="fin-dc-category" placeholder="Tuition Income" style="width:160px;"></label>
              <label style="font-size:.75rem;color:var(--warm-gray);">Type<br>
                <select id="fin-dc-type"><option value="actual">Actual</option><option value="budget">Budget</option></select>
              </label>
              <label style="font-size:.75rem;color:var(--warm-gray);">Amount ($)<br><input type="number" id="fin-dc-amount" step="0.01" style="width:110px;"></label>
              <label style="font-size:.75rem;color:var(--warm-gray);">Notes<br><input type="text" id="fin-dc-notes" style="width:160px;"></label>
              <button class="btn-primary" id="fin-dc-submit-btn" onclick="finSaveDaycare()">+ Add Entry</button>
              <button class="btn-secondary" id="fin-dc-cancel-btn" style="display:none;" onclick="finCancelEditDaycare()">Cancel</button>
            </div>
            <div style="font-size:.75rem;color:var(--danger);margin-top:6px;min-height:14px;" id="fin-dc-error"></div>

            <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
              <div style="font-weight:600;font-size:.85rem;margin-bottom:4px;">Bulk-Enter Past Years</div>
              <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 8px;">Paste one entry per line: <code>period, category, type, amount, notes</code> — period is <code>YYYY</code> or <code>YYYY-MM</code>, type is <code>actual</code> or <code>budget</code> (defaults to actual if omitted), notes is optional. Example: <code>2023, Tuition Income, actual, 285000</code></p>
              <textarea id="fin-dc-bulk-text" rows="5" style="width:100%;font-family:monospace;font-size:.8rem;padding:8px;border:1px solid var(--border);border-radius:6px;" placeholder="2023, Tuition Income, actual, 285000&#10;2023, Payroll, actual, 190000&#10;2023, Payroll, budget, 200000"></textarea>
              <div style="display:flex;gap:8px;margin-top:8px;align-items:center;">
                <button class="btn-secondary" onclick="finDaycareBulkPreview()">Preview</button>
                <span id="fin-dc-bulk-error" style="font-size:.78rem;color:var(--danger);"></span>
              </div>
              <div id="fin-dc-bulk-preview" style="margin-top:8px;"></div>
            </div>

            <details style="margin-top:14px;">
              <summary style="font-size:.78rem;color:var(--warm-gray);cursor:pointer;">Show all synced line items (<span id="fin-daycare-count">0</span> rows)</summary>
              <div style="overflow-x:auto;margin-top:8px;">
                <table style="width:100%;border-collapse:collapse;font-size:.82rem;">
                  <thead>
                    <tr style="border-bottom:2px solid var(--navy);">
                      <th style="text-align:left;padding:6px 8px;">Period</th>
                      <th style="text-align:left;padding:6px 8px;">Category</th>
                      <th style="text-align:left;padding:6px 8px;">Type</th>
                      <th style="text-align:right;padding:6px 8px;">Amount</th>
                      <th style="text-align:left;padding:6px 8px;">Notes / Source</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody id="fin-daycare-body"></tbody>
                </table>
              </div>
            </details>
          </div>
        </section>

      </div>

      <div id="fin-panel-church" style="display:none;">
        <section class="dash-card fin-printable" style="margin-bottom:16px;">
          <div class="dash-card-hdr" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span>Church Report</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <button id="fin-church-mode-year" class="btn-secondary active" style="font-size:.78rem;padding:3px 10px;" onclick="finSetChurchReportMode('year')">This Year</button>
              <button id="fin-church-mode-multiyear" class="btn-secondary" style="font-size:.78rem;padding:3px 10px;" onclick="finSetChurchReportMode('multiyear')">Multi-Year</button>
              <button id="fin-church-mode-balances" class="btn-secondary" style="font-size:.78rem;padding:3px 10px;" onclick="finSetChurchReportMode('balances')">Balance Sheet</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="finOpenChurchImport()">Import Budget</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="finOpenChurchMonthlyImport()">Import Monthly P&amp;L</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="finOpenChurchBalanceImport()">Import Balance Sheet</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="finExportChurchCsv()">Export CSV</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="window.print()">Print</button>
            </div>
          </div>
          <div class="dash-card-body" style="padding:14px 18px;">
            <div id="fin-church-year-view"></div>
            <div id="fin-church-multiyear-view" style="display:none;"></div>
            <div id="fin-church-balances-view" style="display:none;"></div>
          </div>
        </section>
      </div>

      <div id="fin-panel-daycare" style="display:none;">
        <section class="dash-card fin-printable" style="margin-bottom:16px;">
          <div class="dash-card-hdr" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Daycare Report — Year by Year</span>
            <div style="display:flex;gap:8px;">
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="finExportDaycareCsv()">Export CSV</button>
              <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="window.print()">Print</button>
            </div>
          </div>
          <div class="dash-card-body" style="padding:14px 18px;">
            <div id="fin-daycare-mdo-note"></div>
            <div style="background:var(--warm-surface-page);border-radius:10px;padding:12px 14px;margin-bottom:14px;">
              <div style="font-weight:600;font-size:.85rem;margin-bottom:4px;">Import from Church Budget (MDO accounts)</div>
              <p style="font-size:.78rem;color:var(--warm-gray);margin:0 0 10px;">The single source of truth for this report (see the note above the table below). Pulls the Mother's Day Out line items (any account with "MDO" or "Mother's Day Out" in its name) out of a Church Report Budget you've already imported for a given year, and categorizes them into the Daycare Report's categories automatically.</p>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
                <label style="font-size:.75rem;color:var(--warm-gray);">Church Budget Year<br><input type="number" id="fin-dc-cb-year" placeholder="2025" style="width:100px;"></label>
                <button class="btn-secondary" onclick="finDaycareChurchBudgetPreview()">Preview</button>
              </div>
              <div id="fin-dc-cb-preview" style="margin-top:10px;"></div>
            </div>
            <div id="fin-daycare-report"></div>
          </div>
        </section>
      </div>

      <div id="fin-panel-property" style="display:none;">
        <section class="dash-card fin-printable" style="margin-bottom:16px;">
          <div class="dash-card-hdr" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Commercial Property — 3277 Ivanhoe</span>
            <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;" onclick="window.print()">Print</button>
          </div>
          <div class="dash-card-body" style="padding:14px 18px;" id="fin-property-root"></div>
        </section>
      </div>

      <div id="fin-panel-planning" style="display:none;">
        <section class="dash-card fin-printable" style="margin-bottom:16px;">
          <div class="dash-card-hdr">Church Budget Planning</div>
          <div class="dash-card-body" style="padding:14px 18px;">
            <p style="font-size:.82rem;color:var(--warm-gray);margin:0 0 12px;">Forward multi-year what-if planning for categories like Property Expenses, Salaries &amp; Benefits, Utilities, and Insurance — independent of QuickBooks. Generate a projection from a starting amount and a growth rate, hand-adjust any year, then commit a year's plan into the real Church Budget once you're ready (it shows up as a placeholder budget until real synced or imported data for that year takes over).</p>
            <div id="fin-plan-root"></div>
          </div>
        </section>
        <section class="dash-card fin-printable" style="margin-bottom:16px;">
          <div class="dash-card-hdr">3277 Ivanhoe — Multi-Year Forecast</div>
          <div class="dash-card-body" style="padding:14px 18px;" id="fin-plan-property-root"></div>
        </section>
      </div>

      <div id="fin-panel-compensation" style="display:none;">
        <div style="margin-bottom:16px;">
          <h2 style="font-family:var(--font-display);font-size:26px;font-weight:700;color:var(--color-navy);margin:0 0 2px;">Compensation Planner — FY<span id="fin-comp-year-label"></span></h2>
          <div style="font-size:.82rem;color:var(--warm-gray);">Set base salaries using the LCMS Missouri District compensation guidelines, and model group health plan renewal options. Applies into the Planning tab's budget via each card's own "Apply to Plan"/"Use as Projected" controls.</div>
        </div>
        <div id="fin-comp-root">Loading…</div>
      </div>

    </div>
  </div>
</div>

</div><!-- /content-area -->

<!-- ═══ PEOPLE FILTER DRAWER ═══ -->
<div id="people-filter-overlay" onclick="closeFilterDrawer()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:1100;"></div>
<div id="people-filter-drawer" style="display:none;position:fixed;right:0;top:0;bottom:0;width:300px;max-width:90vw;background:var(--white);box-shadow:-4px 0 24px rgba(0,0,0,.18);z-index:1101;flex-direction:column;overflow:hidden;">
  <div style="display:flex;align-items:center;padding:16px 18px;border-bottom:1px solid var(--border);flex-shrink:0;">
    <span style="font-size:16px;font-weight:700;flex:1;">Filters</span>
    <button onclick="clearAllFilters()" style="font-size:.78rem;color:var(--teal);background:none;border:none;cursor:pointer;font-weight:600;padding:4px 8px;">Clear All</button>
    <button onclick="closeFilterDrawer()" style="background:none;border:none;cursor:pointer;font-size:22px;color:var(--warm-gray);line-height:1;margin-left:4px;">&#215;</button>
  </div>
  <div style="flex:1;overflow-y:auto;padding:16px 18px;">
    <div style="margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Sort By</div>
      <div id="fd-sort"></div>
    </div>
    <div style="margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Member Type</div>
      <div id="fd-member-types"></div>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Tags</div>
      <div id="fd-tags"></div>
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Gender</div>
      <div id="fd-gender"></div>
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Age Range</div>
      <div id="fd-age-range"></div>
    </div>
    <div style="margin-top:20px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--warm-gray);margin-bottom:10px;">Missing Field</div>
      <div id="fd-missing"></div>
    </div>
  </div>
  <div style="padding:14px 18px;border-top:1px solid var(--border);flex-shrink:0;">
    <div id="fd-result-count" style="font-size:.78rem;color:var(--warm-gray);margin-bottom:10px;text-align:center;"></div>
    <button class="btn-primary" style="width:100%;padding:10px;" onclick="closeFilterDrawer()">Done</button>
  </div>
</div>

</div><!-- /app-shell -->
<div class="sidebar-overlay" id="sidebar-overlay" onclick="closeSidebar()"></div>

<!-- ═══ MODALS ═══ -->
<!-- Register import modal -->
<div class="modal-overlay" id="reg-import-modal" style="display:none;" onclick="if(event.target===this)closeRegImport()">
  <div class="modal" style="max-width:820px;width:95vw;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <h2 style="margin:0;flex:1;">Import Register Records</h2>
      <button class="btn-secondary" style="font-size:.8rem;" onclick="closeRegImport()">&#215; Close</button>
    </div>
    <!-- Step 1: file pick -->
    <div id="reg-import-step1">
      <p style="font-size:.875rem;color:var(--warm-gray);margin:0 0 12px;">
        Upload a <strong>tab-separated (.tsv)</strong> or <strong>comma-separated (.csv)</strong> file exported from your spreadsheet.
        The importer auto-detects these column headers:
      </p>
      <div style="margin-bottom:10px;">
        <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:6px;">Register Type</label>
        <select id="reg-import-type" style="padding:7px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;" onchange="updateRegImportHeaders()">
          <option value="baptism">Baptisms</option>
          <option value="confirmation">Confirmations</option>
        </select>
      </div>
      <div id="reg-import-headers" style="background:var(--linen);border-radius:8px;padding:10px 14px;font-size:.78rem;color:var(--charcoal);margin-bottom:16px;line-height:1.8;"></div>
      <label style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:var(--teal);color:white;border-radius:8px;cursor:pointer;font-size:.875rem;font-weight:600;">
        &#8679; Choose File
        <input type="file" id="reg-import-file" accept=".csv,.tsv,.txt" style="display:none;" onchange="regImportFileChosen(this)">
      </label>
      <span id="reg-import-filename" style="margin-left:10px;font-size:.85rem;color:var(--warm-gray);"></span>
      <div style="margin-top:14px;padding:10px 14px;background:#fff8f0;border:1px solid #f0c080;border-radius:8px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.85rem;">
          <input type="checkbox" id="reg-import-clear" style="width:15px;height:15px;flex-shrink:0;">
          <span><strong>Delete existing records of this type before importing</strong> — use this to re-import after fixing data issues</span>
        </label>
      </div>
    </div>
    <!-- Step 2: preview -->
    <div id="reg-import-step2" style="display:none;">
      <div id="reg-import-summary" style="font-size:.875rem;margin-bottom:14px;"></div>
      <div style="overflow-x:auto;max-height:280px;border:1px solid var(--border);border-radius:8px;margin-bottom:16px;">
        <table id="reg-import-preview" style="width:100%;border-collapse:collapse;font-size:.78rem;min-width:600px;">
          <thead id="reg-import-preview-head" style="position:sticky;top:0;background:var(--linen);"></thead>
          <tbody id="reg-import-preview-body"></tbody>
        </table>
      </div>
      <div id="reg-import-warn" style="font-size:.82rem;color:var(--danger);margin-bottom:12px;display:none;"></div>
      <div style="display:flex;gap:10px;align-items:center;">
        <button class="btn-primary" onclick="runRegImport()">Import <span id="reg-import-count"></span> Records</button>
        <button class="btn-secondary" onclick="resetRegImport()">&#8592; Choose Different File</button>
        <span id="reg-import-progress" style="font-size:.85rem;color:var(--warm-gray);display:none;"></span>
      </div>
    </div>
    <!-- Step 3: done -->
    <div id="reg-import-step3" style="display:none;text-align:center;padding:24px 0;">
      <div style="font-size:2.4rem;margin-bottom:10px;">&#10003;</div>
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:6px;" id="reg-import-done-msg"></div>
      <div style="font-size:.875rem;color:var(--warm-gray);margin-bottom:20px;" id="reg-import-done-sub"></div>
      <button class="btn-primary" onclick="closeRegImport()">Done</button>
    </div>
  </div>
</div>
<!-- Person edit modal -->
<div class="modal-overlay" id="person-modal">
  <div class="modal">
    <h2 id="person-modal-title">Add Person</h2>
    <input type="hidden" id="pm-id">
    <div class="modal-section">Name</div>
    <div id="pm-name-2col" class="modal-2col">
      <div class="field"><label>First Name</label><input type="text" id="pm-first" name="pm-first"></div>
      <div class="field"><label>Last Name</label><input type="text" id="pm-last" name="pm-last"></div>
    </div>
    <div id="pm-name-1col" style="display:none;">
      <div class="field"><label>Name</label><input type="text" id="pm-org-name" name="pm-org-name" style="width:100%;"></div>
    </div>
    <div id="pm-name-2col-b" class="modal-2col">
      <div class="field"><label>Middle Name</label><input type="text" id="pm-middle" name="pm-middle"></div>
      <div class="field"><label>Preferred Name (goes by)</label><input type="text" id="pm-preferred" name="pm-preferred" placeholder="e.g. Jack"></div>
    </div>
    <div class="modal-section">Contact</div>
    <div class="modal-2col">
      <div class="field"><label>Email</label><input type="email" id="pm-email" name="pm-email"></div>
      <div class="field"><label>Phone</label><input type="tel" id="pm-phone" name="pm-phone" onblur="formatPhoneOnBlur(this)" placeholder="(314) 555-0100"></div>
    </div>
    <div style="margin:-4px 0 8px;"><label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;"><input type="checkbox" id="pm-sms-opt-in"> Opt in to birthday &amp; anniversary texts (SMS)</label></div>
    <div class="modal-section" id="pm-addr-section">Address <span id="pm-addr-hint" style="font-weight:400;text-transform:none;">(leave blank to use household address)</span></div>
    <div class="field" style="margin-bottom:8px;"><label>Street</label><input type="text" id="pm-addr1" name="pm-addr1" placeholder="123 Main St"></div>
    <div class="field" style="margin-bottom:8px;"><label>Apt / Unit</label><input type="text" id="pm-addr2" name="pm-addr2" placeholder="Apt 1S, Unit B, Suite 200…"></div>
    <div class="modal-2col">
      <div class="field"><label>City</label><input type="text" id="pm-city" name="pm-city"></div>
      <div class="field"><label>State / ZIP</label><div style="display:flex;gap:6px;"><input type="text" id="pm-state" name="pm-state" style="width:60px;" maxlength="2" placeholder="MO"><input type="text" id="pm-zip" name="pm-zip" placeholder="63000"></div></div>
    </div>
    <div style="margin-top:4px;display:flex;align-items:center;gap:10px;">
      <button type="button" id="pm-addr-validate-btn" class="btn-secondary" style="font-size:.78rem;padding:3px 10px;" onclick="validatePersonAddress()">Validate Address</button>
      <span id="pm-addr-validate-status" style="font-size:.78rem;"></span>
    </div>
    <div class="modal-section">Church Info</div>
    <div class="modal-2col">
      <div class="field"><label>Member Type</label>
        <select id="pm-type" name="pm-type" onchange="updatePersonNameMode()"><!-- populated dynamically by openPersonEdit() from _memberTypes --></select>
      </div>
      <div class="field" id="pm-role-field"><label>Family Role</label>
        <select id="pm-role" name="pm-role"><option value="">—</option><option value="head">Head</option><option value="spouse">Spouse</option><option value="child">Child</option><option value="other">Other</option></select>
      </div>
    </div>
    <div class="field" id="pm-hh-field" style="margin-bottom:8px;"><label>Household</label>
      <div class="ac-wrap"><input type="text" id="pm-hh-search" name="pm-hh-search" placeholder="Search household…" oninput="acHouseholdSearch()"><div class="ac-dropdown" id="pm-hh-ac"></div></div>
      <input type="hidden" id="pm-hh-id">
    </div>
    <div id="pm-dates-section">
      <div class="modal-section">Demographics</div>
      <div class="modal-2col">
        <div class="field"><label>Gender</label>
          <select id="pm-gender" name="pm-gender" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
            <option value="">— not set —</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="field"><label>Marital Status</label>
          <select id="pm-marital" name="pm-marital" style="padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;width:100%;">
            <option value="">— not set —</option>
            <option value="Single">Single</option>
            <option value="Married">Married</option>
            <option value="Widowed">Widowed</option>
            <option value="Divorced">Divorced</option>
            <option value="Separated">Separated</option>
          </select>
        </div>
      </div>
      <div class="modal-section">Dates</div>
      <div class="modal-2col">
        <div class="field">
          <label>Date of Birth</label>
          <input type="date" id="pm-dob" name="pm-dob">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.78rem;color:var(--warm-gray);"><input type="checkbox" id="pm-dob-noyear" onchange="pmYearUnknownChanged('pm-dob-noyear','pm-dob')"> Year unknown (just month/day)</label><button type="button" class="pm-date-clear" onclick="clearDateField('pm-dob','pm-dob-noyear')">Clear</button></div>
        </div>
        <div class="field">
          <label>Baptism</label>
          <input type="date" id="pm-baptism" name="pm-baptism">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.78rem;color:var(--warm-gray);"><input type="checkbox" id="pm-baptism-noyear" onchange="pmYearUnknownChanged('pm-baptism-noyear','pm-baptism')"> Year unknown (just month/day)</label><button type="button" class="pm-date-clear" onclick="clearDateField('pm-baptism','pm-baptism-noyear')">Clear</button></div>
        </div>
        <div class="field">
          <label>Confirmation</label>
          <input type="date" id="pm-confirm" name="pm-confirm">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.78rem;color:var(--warm-gray);"><input type="checkbox" id="pm-confirm-noyear" onchange="pmYearUnknownChanged('pm-confirm-noyear','pm-confirm')"> Year unknown (just month/day)</label><button type="button" class="pm-date-clear" onclick="clearDateField('pm-confirm','pm-confirm-noyear')">Clear</button></div>
        </div>
        <div class="field">
          <label>Anniversary</label>
          <input type="date" id="pm-anniv" name="pm-anniv">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:3px;"><label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.78rem;color:var(--warm-gray);"><input type="checkbox" id="pm-anniv-noyear" onchange="pmYearUnknownChanged('pm-anniv-noyear','pm-anniv')"> Year unknown (just month/day)</label><button type="button" class="pm-date-clear" onclick="clearDateField('pm-anniv','pm-anniv-noyear')">Clear</button></div>
        </div>
        <div class="field"><label>Death Date</label><input type="date" id="pm-death" name="pm-death"><div style="margin-top:3px;text-align:right;"><button type="button" class="pm-date-clear" onclick="clearDateField('pm-death')">Clear</button></div></div>
      </div>
      <div style="margin-bottom:10px;display:flex;gap:24px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem;">
          <input type="checkbox" id="pm-deceased">
          Mark as deceased
        </label>
        <div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.88rem;" title="Uncheck to hide this person from printed/public directories">
            <input type="checkbox" id="pm-public" checked onchange="document.getElementById('pm-dir-fields').style.opacity=this.checked?'1':'.4'">
            Include in directory
          </label>
          <div id="pm-dir-fields" style="margin-top:5px;margin-left:24px;display:flex;gap:16px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;color:var(--warm-gray);"><input type="checkbox" id="pm-hide-addr"> Hide address</label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;color:var(--warm-gray);"><input type="checkbox" id="pm-hide-phone"> Hide phone</label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;color:var(--warm-gray);"><input type="checkbox" id="pm-hide-email"> Hide email</label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;color:var(--warm-gray);"><input type="checkbox" id="pm-hide-dob"> Hide birthday</label>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:.8rem;color:var(--warm-gray);"><input type="checkbox" id="pm-hide-anniversary"> Hide anniversary</label>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-section">Tags</div>
    <div class="tag-picker" id="pm-tag-picker"></div>
    <div class="modal-section">Church Records</div>
    <div class="modal-2col">
      <div class="field"><label>Envelope #</label><input type="text" id="pm-envelope" name="pm-envelope" placeholder="e.g. 42" maxlength="20"></div>
      <div class="field"><label>Last Seen</label><input type="date" id="pm-last-seen" name="pm-last-seen"></div>
    </div>
    <div class="modal-section">Notes</div>
    <div class="field"><textarea id="pm-notes" name="pm-notes" rows="2" style="resize:vertical;"></textarea></div>
    <div class="modal-actions">
      <button class="btn-danger" id="pm-del-btn" onclick="deletePerson()" style="margin-right:auto;display:none;">Delete</button>
      <button class="btn-secondary" onclick="closeModal('person-modal')">Cancel</button>
      <button class="btn-primary" onclick="savePerson()">Save</button>
    </div>
  </div>
</div>

<!-- Edit gift modal -->
<div class="modal-overlay" id="edit-gift-modal" onclick="if(event.target===this)closeModal('edit-gift-modal')">
  <div class="modal" style="max-width:420px;">
    <h2 style="margin:0 0 18px;">Edit Gift</h2>
    <div class="modal-2col">
      <div class="field"><label>Date</label><input type="date" id="egm-date" name="egm-date"></div>
      <div class="field"><label>Amount ($)</label><input type="number" id="egm-amount" name="egm-amount" step="0.01" min="0.01" placeholder="0.00"></div>
      <div class="field"><label>Fund</label><select id="egm-fund" name="egm-fund" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"></select></div>
      <div class="field"><label>Method</label><select id="egm-method" name="egm-method" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;"><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="ach">ACH</option><option value="other">Other</option></select></div>
      <div class="field"><label>Check #</label><input type="text" id="egm-check" name="egm-check" placeholder="optional"></div>
      <div class="field"><label>Notes</label><input type="text" id="egm-notes" name="egm-notes" placeholder="optional"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('edit-gift-modal')">Cancel</button>
      <button class="btn-primary" onclick="saveEditGift()">Save</button>
    </div>
  </div>
</div>

<!-- Household edit modal -->
<div class="modal-overlay" id="hh-modal">
  <div class="modal">
    <h2 id="hh-modal-title">New Household</h2>
    <input type="hidden" id="hm-id">
    <div class="field" style="margin-bottom:10px;"><label>Family Name</label><input type="text" id="hm-name" name="hm-name" placeholder="e.g. Smith Family">
      <button type="button" class="btn-secondary" id="hm-hyphenate-btn" style="display:none;margin-top:6px;font-size:.75rem;padding:3px 9px;" onclick="hhHyphenateName()">Hyphenate from members' last names</button>
    </div>
    <div class="field" style="margin-bottom:8px;"><label>Street Address</label><input type="text" id="hm-addr1" name="hm-addr1"></div>
    <div class="field" style="margin-bottom:8px;"><label>Address Line 2</label><input type="text" id="hm-addr2" name="hm-addr2"></div>
    <div class="modal-2col">
      <div class="field"><label>City</label><input type="text" id="hm-city" name="hm-city"></div>
      <div class="field"><label>State / ZIP</label><div style="display:flex;gap:6px;"><input type="text" id="hm-state" name="hm-state" style="width:60px;" maxlength="2" value="MO"><input type="text" id="hm-zip" name="hm-zip" placeholder="63000"></div></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>Notes</label><textarea id="hm-notes" name="hm-notes" rows="2" style="resize:vertical;"></textarea></div>
    <div class="field" style="margin-top:10px;">
      <label>Family Photo</label>
      <input type="hidden" id="hm-photo">
      <div style="display:flex;align-items:center;gap:12px;margin-top:4px;">
        <img id="hm-photo-preview" src="" alt="" style="display:none;width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">
        <button type="button" id="hm-photo-upload-btn" class="btn-secondary require-edit" style="display:none;font-size:.82rem;padding:5px 12px;" onclick="triggerHHPhotoUpload()">&#128247; Upload Photo</button>
        <button type="button" id="hm-photo-pick-btn" class="btn-secondary require-edit" style="display:none;font-size:.82rem;padding:5px 12px;" onclick="openHHPhotoPicker()">&#128100; Use Member's Photo</button>
        <button type="button" id="hm-photo-recrop-btn" class="btn-secondary require-edit" style="display:none;font-size:.82rem;padding:5px 12px;" onclick="recropHHPhoto()">&#9986; Re-crop</button>
        <button type="button" id="hm-photo-remove-btn" class="btn-secondary require-edit" style="display:none;font-size:.82rem;padding:5px 12px;color:var(--clay-red);" onclick="removeHHPhoto()">&times; Remove</button>
        <button type="button" id="hm-apply-photo-btn" class="btn-secondary require-edit" style="display:none;font-size:.82rem;padding:5px 12px;" onclick="applyHHPhotoToMembers()">&#128247; Apply to Family</button>
        <input type="file" id="hm-photo-input" accept="image/*" style="display:none;" onchange="handleHHPhotoSelected(this)">
      </div>
    </div>
    <div id="hm-members" style="margin-top:14px;"></div>
    <div id="hm-push-addr-row" style="display:none;margin-top:10px;">
      <button class="btn-secondary" style="font-size:.78rem;padding:4px 10px;width:100%;" onclick="hhPushAddress()">Push address to household members without one</button>
    </div>
    <div class="modal-actions">
      <button class="btn-danger" id="hm-del-btn" onclick="deleteHousehold()" style="margin-right:auto;display:none;">Delete</button>
      <button class="btn-secondary" onclick="closeModal('hh-modal')">Cancel</button>
      <button class="btn-primary" onclick="saveHousehold()">Save</button>
    </div>
  </div>
</div>

<!-- Organization edit modal -->
<div class="modal-overlay" id="org-modal" onclick="if(event.target===this)closeModal('org-modal')">
  <div class="modal">
    <h2 id="org-modal-title">New Organization</h2>
    <input type="hidden" id="om-id">
    <div class="modal-2col">
      <div class="field" style="grid-column:1/-1;"><label>Organization Name *</label><input type="text" id="om-name" name="om-name" placeholder="e.g. Community Food Pantry"></div>
      <div class="field"><label>Type</label>
        <select id="om-type" name="om-type" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:.88rem;">
          <option value="">— Select —</option>
          <option value="Ministry">Ministry / Church</option>
          <option value="Nonprofit">Nonprofit</option>
          <option value="Business">Business</option>
          <option value="Government">Government</option>
          <option value="School">School</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="field"><label>Primary Contact</label><input type="text" id="om-contact" name="om-contact" placeholder="Contact person's name"></div>
      <div class="field"><label>Phone</label><input type="tel" id="om-phone" name="om-phone"></div>
      <div class="field"><label>Email</label><input type="email" id="om-email" name="om-email"></div>
      <div class="field" style="grid-column:1/-1;"><label>Website</label><input type="url" id="om-website" name="om-website" placeholder="https://…"></div>
      <div class="field" style="grid-column:1/-1;"><label>Street Address</label><input type="text" id="om-addr1" name="om-addr1"></div>
      <div class="field"><label>City</label><input type="text" id="om-city" name="om-city"></div>
      <div class="field"><label>State / ZIP</label><div style="display:flex;gap:6px;"><input type="text" id="om-state" name="om-state" style="width:60px;" maxlength="2" value="MO"><input type="text" id="om-zip" name="om-zip" placeholder="63000"></div></div>
      <div class="field" style="grid-column:1/-1;"><label>Notes</label><textarea id="om-notes" name="om-notes" rows="2" style="resize:vertical;"></textarea></div>
    </div>
    <div class="modal-actions">
      <button class="btn-danger" id="om-del-btn" onclick="deleteOrg()" style="margin-right:auto;display:none;">Delete</button>
      <button class="btn-secondary" onclick="closeModal('org-modal')">Cancel</button>
      <button class="btn-primary" onclick="saveOrg()">Save</button>
    </div>
  </div>
</div>

<!-- Letter template preview modal -->
<div class="modal-overlay" id="letter-preview-modal">
  <div class="modal" style="max-width:640px;">
    <h2 id="letter-preview-title">Letter Preview</h2>
    <p style="font-size:.8rem;color:var(--warm-gray);margin-top:-6px;">Rendered with sample data using the text currently in the box below &mdash; this preview updates live but is not saved until you click Save Template.</p>
    <div id="letter-preview-body" style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:22px 26px;font-size:.9rem;line-height:1.6;max-height:60vh;overflow-y:auto;"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('letter-preview-modal')">Close</button>
    </div>
  </div>
</div>

<!-- New batch modal -->
<div class="modal-overlay" id="batch-modal">
  <div class="modal" style="max-width:380px;">
    <h2>New Batch</h2>
    <div class="field" style="margin-bottom:10px;"><label>Date</label><input type="date" id="bm-date" name="bm-date"></div>
    <div class="field"><label>Description</label><input type="text" id="bm-desc" name="bm-desc" placeholder="e.g. Sunday AM Offering"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('batch-modal')">Cancel</button>
      <button class="btn-primary" onclick="createBatch()">Create</button>
    </div>
  </div>
</div>

<!-- Tags manager modal -->
<div class="modal-overlay" id="tags-modal">
  <div class="modal">
    <h2>Manage Tags</h2>
    <div id="tags-list" style="margin-bottom:14px;"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field"><label>Name</label><input type="text" id="new-tag-name" name="new-tag-name" placeholder="e.g. Council"></div>
      <div class="field"><label>Color</label><input type="color" id="new-tag-color" name="new-tag-color" value="#5C8FA8" style="width:44px;height:36px;padding:2px;border-radius:6px;cursor:pointer;"></div>
      <button class="btn-primary" onclick="createTag()">Add Tag</button>
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('tags-modal')">Close</button></div>
  </div>
</div>
<!-- Member Types manager modal -->
<!-- Follow-up modal -->
<div class="modal-overlay" id="dash-customize-modal">
  <div class="modal" style="max-width:380px;">
    <h2>Customize Dashboard</h2>
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:14px;">Choose which cards to show on the dashboard.</p>
    <div id="dash-prefs-list" style="display:flex;flex-direction:column;gap:10px;"></div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="closeModal('dash-customize-modal')">Done</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="crop-modal">
  <div class="modal" style="max-width:640px;padding:20px;">
    <h2 style="margin-bottom:12px;">Crop Profile Photo</h2>
    <div id="crop-canvas-wrap" style="text-align:center;background:#222;border-radius:8px;overflow:auto;max-height:60vh;line-height:0;user-select:none;">
      <canvas id="crop-canvas" style="cursor:crosshair;touch-action:none;display:inline-block;"
        onmousedown="cropMouseDown(event)"
        onmousemove="cropMouseMove(event)"
        onmouseup="cropMouseUp(event)"
        onmouseleave="cropMouseUp(event)"></canvas>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px;justify-content:center;">
      <span style="font-size:.82rem;color:var(--warm-gray);">Zoom</span>
      <button type="button" class="btn-secondary" style="font-size:.82rem;padding:3px 10px;" onclick="cropZoom(-1)">−</button>
      <input type="range" id="crop-zoom" min="100" max="500" step="10" value="100" oninput="cropZoomSlider(this.value)" style="flex:0 1 200px;">
      <button type="button" class="btn-secondary" style="font-size:.82rem;padding:3px 10px;" onclick="cropZoom(1)">+</button>
      <span id="crop-zoom-label" style="font-size:.82rem;color:var(--warm-gray);min-width:42px;text-align:right;">100%</span>
    </div>
    <div style="font-size:.8rem;color:var(--warm-gray);margin-top:6px;text-align:center;">Drag box to reposition · Drag corners to resize · Zoom in for tighter crop</div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="cropApply()">Crop &amp; Upload</button>
      <button class="btn-secondary" onclick="cropSkip()">Use Full Image</button>
      <button class="btn-secondary" onclick="closeModal('crop-modal');_cropCallback=null;">Cancel</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="followup-modal">
  <div class="modal" style="max-width:440px;">
    <h2>Add Follow-up Item</h2>
    <input type="hidden" id="fu-modal-pid">
    <div class="field"><label>Person (optional)</label>
      <input type="text" id="fu-modal-name" name="fu-modal-name" placeholder="Type a name to search…" style="width:100%;">
    </div>
    <div class="field"><label>Type</label>
      <select id="fu-modal-type" name="fu-modal-type" style="width:100%;">
        <option value="general">General Follow-up</option>
        <option value="pastoral_call">Pastoral Call</option>
        <option value="prayer">Prayer Follow-up</option>
        <option value="first_gift">First Gift</option>
        <option value="not_seen">Not Seen Recently</option>
        <option value="newsletter">Newsletter</option>
      </select>
    </div>
    <div class="field"><label>Notes</label>
      <textarea id="fu-modal-notes" name="fu-modal-notes" placeholder="Optional notes…" style="width:100%;height:72px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="saveFollowUpModal()">Save</button>
      <button class="btn-secondary" onclick="closeModal('followup-modal')">Cancel</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="prayer-modal">
  <div class="modal" style="max-width:500px;">
    <h2>Add Prayer Request</h2>
    <p style="font-size:.83rem;color:var(--warm-gray);margin-bottom:10px;">Record a paper prayer card or a request received in person. Website submissions arrive here automatically.</p>
    <input type="hidden" id="prayer-req-personid">
    <div class="field"><label>Linked person (optional)</label>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="btn-secondary" style="padding:5px 12px;font-size:.85rem;" onclick="prayerPickPerson()">Search…</button>
        <span id="prayer-req-personlabel" style="flex:1;font-size:.85rem;color:var(--charcoal);"></span>
        <button class="btn-secondary" style="padding:3px 8px;font-size:.75rem;" onclick="prayerClearPerson()" title="Clear linked person">&#10005;</button>
      </div>
    </div>
    <div class="field"><label>Requester name (if not linked)</label>
      <input type="text" id="prayer-req-name" placeholder="e.g. Jane Doe" style="width:100%;">
    </div>
    <div class="field"><label>Requester email (optional)</label>
      <input type="email" id="prayer-req-email" placeholder="optional" style="width:100%;">
    </div>
    <div class="field"><label>Date received</label>
      <input type="date" id="prayer-req-date" style="width:100%;">
    </div>
    <div class="field"><label>Prayer request</label>
      <textarea id="prayer-req-text" placeholder="What are we praying for?" style="width:100%;height:110px;resize:vertical;padding:6px 8px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:inherit;"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn-primary" onclick="savePrayerRequest()">Save</button>
      <button class="btn-secondary" onclick="closeModal('prayer-modal')">Cancel</button>
    </div>
  </div>
</div>
<div class="modal-overlay" id="member-types-modal">
  <div class="modal">
    <h2>Member Types</h2>
    <p style="font-size:.85rem;color:var(--warm-gray);margin-bottom:12px;">Add or remove the types available in the Member Type dropdown. Removing a type won't change existing people — they'll still have that type until edited.</p>
    <div id="member-types-list" style="margin-bottom:14px;"></div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="new-type-name" name="new-type-name" placeholder="New type name…" style="flex:1;font-size:.88rem;">
      <button class="btn-primary" onclick="addMemberType()">Add</button>
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('member-types-modal')">Close</button></div>
  </div>
</div>
<div class="modal-overlay" id="pv-photo-pick-modal" onclick="if(event.target===this)closeModal('pv-photo-pick-modal')">
  <div class="modal" style="max-width:520px;">
    <h2 style="margin-bottom:6px;">Use a Family Photo</h2>
    <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:12px;">Pick the household photo or a family member's photo to use as this person's profile picture.</div>
    <div id="pv-photo-pick-list" style="display:flex;flex-wrap:wrap;gap:10px;max-height:50vh;overflow-y:auto;"></div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('pv-photo-pick-modal')">Cancel</button></div>
  </div>
</div>
<div class="modal-overlay" id="hh-photo-pick-modal" onclick="if(event.target===this)closeModal('hh-photo-pick-modal')">
  <div class="modal" style="max-width:520px;">
    <h2 style="margin-bottom:6px;">Use a Member's Photo</h2>
    <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:12px;">Choose a household member whose profile photo should become the household photo.</div>
    <div id="hh-photo-pick-list" style="display:flex;flex-wrap:wrap;gap:10px;max-height:50vh;overflow-y:auto;"></div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('hh-photo-pick-modal')">Cancel</button></div>
  </div>
</div>
<div class="modal-overlay" id="add-to-hh-modal" onclick="if(event.target===this)closeModal('add-to-hh-modal')">
  <div class="modal">
    <h2>Add Person to Household</h2>
    <input type="text" id="add-hh-search" placeholder="Search by name…" style="width:100%;margin-bottom:10px;" oninput="searchAddToHh(this.value)">
    <div id="add-hh-results" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;min-height:60px;"></div>
    <div style="margin-top:12px;">
      <button id="add-hh-new-toggle" class="btn-secondary" style="font-size:.82rem;width:100%;" onclick="toggleAddHhNew(this)">+ Create new person instead</button>
      <div id="add-hh-new" style="display:none;margin-top:10px;padding:12px;background:var(--linen);border-radius:8px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
          <div class="field" style="margin:0;"><label style="font-size:11px;">First Name</label><input type="text" id="anh-first" name="anh-first" style="width:100%;box-sizing:border-box;"></div>
          <div class="field" style="margin:0;"><label style="font-size:11px;">Last Name</label><input type="text" id="anh-last" name="anh-last" style="width:100%;box-sizing:border-box;"></div>
        </div>
        <div class="field" style="margin:0 0 10px;"><label style="font-size:11px;">Member Type</label><select id="anh-type" name="anh-type" style="width:100%;"></select></div>
        <button class="btn-primary" style="font-size:.82rem;" onclick="createAndAddToHh()">Create &amp; Add to Household</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn-secondary" onclick="closeModal('add-to-hh-modal')">Cancel</button></div>
  </div>
</div>

<!-- User edit modal -->
<div class="modal-overlay" id="user-modal" onclick="if(event.target===this)closeModal('user-modal')">
  <div class="modal" style="max-width:420px;">
    <h2 id="user-modal-title">Add User</h2>
    <div id="user-modal-body"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('user-modal')">Cancel</button>
      <button class="btn-primary" id="user-modal-save" onclick="saveUser()">Create User</button>
    </div>
  </div>
</div>

<!-- Push broadcast modal -->
<div class="modal-overlay" id="push-broadcast-modal">
  <div class="modal-card" style="max-width:460px;">
    <div class="modal-header"><span>&#128276; Send Push Notification</span><button class="modal-close" onclick="closeModal('push-broadcast-modal')">&#10005;</button></div>
    <div style="padding:0 0 8px;">
      <p style="font-size:.84rem;color:var(--warm-gray);margin-bottom:14px;">Sends an instant push notification to all member-portal users who have notifications enabled on their device.</p>
      <div class="field"><label>Title <span style="color:var(--danger);">*</span></label><input type="text" id="push-broadcast-title" placeholder="e.g. Sunday Service Update" maxlength="100"></div>
      <div class="field"><label>Message (optional)</label><textarea id="push-broadcast-body" rows="3" placeholder="Additional details…" style="width:100%;resize:vertical;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-size:.9rem;font-family:inherit;"></textarea></div>
      <div id="push-broadcast-result" style="font-size:.84rem;margin-top:6px;min-height:20px;"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('push-broadcast-modal')">Cancel</button>
      <button class="btn-primary" id="push-broadcast-send-btn" onclick="sendPushBroadcast()">Send Notification</button>
    </div>
  </div>
</div>

<!-- Tuition Aid: Add/Link Student modal -->
<div class="modal-overlay" id="tap-student-modal">
  <div class="modal" style="max-width:440px;">
    <div class="modal-header"><span>Add Student / Pipeline Entrant</span><button class="modal-close" onclick="closeModal('tap-student-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <div class="field" style="margin-bottom:10px;">
        <label>Link to a person (optional)</label>
        <div class="ac-wrap">
          <input type="text" id="tap-add-person-search" placeholder="Search people…" oninput="acSearch(this,'tap-add-person-ac','tap-add-person-id')" autocomplete="off">
          <div class="ac-dropdown" id="tap-add-person-ac"></div>
        </div>
        <input type="hidden" id="tap-add-person-id" value="">
      </div>
      <div class="field" style="margin-bottom:10px;"><label>Family name</label><input type="text" id="tap-add-family"></div>
      <div class="field" style="margin-bottom:10px;"><label>Child's first name</label><input type="text" id="tap-add-child"></div>
      <div class="field" style="margin-bottom:10px;">
        <label><input type="checkbox" id="tap-add-is-pipeline" onchange="tapToggleAddMode()"> Not yet enrolled (pipeline — track by birth year)</label>
      </div>
      <div class="field" style="margin-bottom:10px;" id="tap-add-grade-wrap"><label>Current grade</label>
        <select id="tap-add-grade">
          <option value="K">K</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
          <option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option>
          <option value="9">9</option><option value="10">10</option><option value="11">11</option><option value="12">12</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:10px;display:none;" id="tap-add-birthyear-wrap"><label>Birth year</label><input type="number" id="tap-add-birthyear" min="2010" max="2032"></div>
      <div style="font-size:.75rem;color:var(--danger);min-height:14px;" id="tap-add-error"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('tap-student-modal')">Cancel</button>
      <button class="btn-primary" onclick="tapSaveNewStudent()">Add</button>
    </div>
  </div>
</div>

<!-- Tuition Aid: Link existing student to a Person record -->
<div class="modal-overlay" id="tap-link-modal">
  <div class="modal" style="max-width:400px;">
    <div class="modal-header"><span>Link to a Person</span><button class="modal-close" onclick="closeModal('tap-link-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <div class="field" style="margin-bottom:10px;">
        <label>Search people</label>
        <div id="tap-link-suggestions" style="margin-bottom:6px;"></div>
        <div class="ac-wrap">
          <input type="text" id="tap-link-person-search" placeholder="Search people…" oninput="acSearch(this,'tap-link-person-ac','tap-link-person-id')" autocomplete="off">
          <div class="ac-dropdown" id="tap-link-person-ac"></div>
        </div>
        <input type="hidden" id="tap-link-person-id" value="">
      </div>
      <div style="font-size:.75rem;color:var(--danger);min-height:14px;" id="tap-link-error"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('tap-link-modal')">Cancel</button>
      <button class="btn-primary" onclick="tapSaveLinkPerson()">Link</button>
    </div>
  </div>
</div>

<!-- Tuition Aid: per-student year-over-year history -->
<div class="modal-overlay" id="tap-history-modal">
  <div class="modal" style="max-width:640px;width:95vw;">
    <div class="modal-header"><span id="tap-history-title">History</span><button class="modal-close" onclick="closeModal('tap-history-modal')">&#10005;</button></div>
    <div style="padding:4px 0;" id="tap-history-body"></div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('tap-history-modal')">Close</button>
    </div>
  </div>
</div>

<!-- Tuition Aid: add a historical family record to a past year -->
<div class="modal-overlay" id="tap-past-add-modal">
  <div class="modal" style="max-width:460px;">
    <div class="modal-header"><span>Add Record for <span id="tap-past-add-year-label">–</span></span><button class="modal-close" onclick="closeModal('tap-past-add-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <div class="field" style="margin-bottom:10px;">
        <label>Link to a person (optional)</label>
        <div class="ac-wrap">
          <input type="text" id="tap-past-add-person-search" placeholder="Search people…" oninput="acSearch(this,'tap-past-add-person-ac','tap-past-add-person-id')" autocomplete="off">
          <div class="ac-dropdown" id="tap-past-add-person-ac"></div>
        </div>
        <input type="hidden" id="tap-past-add-person-id" value="">
      </div>
      <div class="field" style="margin-bottom:10px;"><label>Family name</label><input type="text" id="tap-past-add-family"></div>
      <div class="field" style="margin-bottom:10px;"><label>Child's first name</label><input type="text" id="tap-past-add-child"></div>
      <div class="field" style="margin-bottom:10px;"><label>Grade that year</label><input type="text" id="tap-past-add-grade" placeholder="e.g. 5 or 10"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="field" style="margin-bottom:10px;"><label>Outside Aid $</label><input type="number" id="tap-past-add-outside" min="0" step="1"></div>
        <div class="field" style="margin-bottom:10px;"><label>LHS Award $</label><input type="number" id="tap-past-add-lhs" min="0" step="1"></div>
        <div class="field" style="margin-bottom:10px;"><label>Timothy Award $</label><input type="number" id="tap-past-add-timothy" min="0" step="1"></div>
        <div class="field" style="margin-bottom:10px;"><label>Family Owed $</label><input type="number" id="tap-past-add-family-owed" min="0" step="1"></div>
      </div>
      <p style="font-size:.72rem;color:var(--warm-gray);margin:-4px 0 10px;">Leave Timothy Award / Family Owed / LHS Award blank if unknown — only fields you fill in are saved.</p>
      <div style="font-size:.75rem;color:var(--danger);min-height:14px;" id="tap-past-add-error"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('tap-past-add-modal')">Cancel</button>
      <button class="btn-primary" onclick="tapSavePastAdd()">Add</button>
    </div>
  </div>
</div>

<!-- Tuition Aid: import per-student history from an uploaded Excel workbook -->
<div class="modal-overlay" id="tap-import-modal">
  <div class="modal" style="max-width:640px;width:95vw;">
    <div class="modal-header"><span>Import History from Excel</span><button class="modal-close" onclick="closeModal('tap-import-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <p style="font-size:.8rem;color:var(--warm-gray);margin:0 0 12px;">Upload an updated copy of the tuition workbook — it's read entirely in your browser, nothing is sent anywhere until you confirm. Works directly with the school's real per-year award workbook (grade, outside aid, Timothy award, and LHS award are pulled automatically); or, if the file has a "Student Tuition History" sheet, that simpler Family/Child/"Parent YYYY-YY" format is used instead.</p>
      <input type="file" id="tap-import-file" accept=".xlsx" onchange="tapImportFileSelected(this)">
      <div style="font-size:.8rem;color:var(--warm-gray);margin:10px 0;" id="tap-import-status"></div>
      <div id="tap-import-preview"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('tap-import-modal')">Close</button>
      <button class="btn-primary" id="tap-import-confirm-btn" style="display:none;" onclick="tapConfirmImportHistory()">Import Selected</button>
    </div>
  </div>
</div>

<!-- Church Report: import a "Budget vs. Actuals" Excel export (backfill/resilience path when a
     live QuickBooks sync isn't available or returns wrong data — see FIN2/FIN6) -->
<div class="modal-overlay" id="fin-church-import-modal">
  <div class="modal" style="max-width:640px;width:95vw;">
    <div class="modal-header"><span>Import Budget from Excel</span><button class="modal-close" onclick="closeModal('fin-church-import-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <p style="font-size:.8rem;color:var(--warm-gray);margin:0 0 12px;">Upload a QuickBooks "Budget vs. Actuals" export (.xlsx) for one fiscal year. The file is parsed on the server, then you'll get a preview to review and uncheck anything before it's saved — nothing is written until you click Import Selected. Importing a year replaces any previously-imported data for that same year; a live QuickBooks sync for the same year always defers to an import.</p>
      <input type="file" id="fin-church-import-file" accept=".xlsx" onchange="finChurchImportFileSelected(this)">
      <div style="font-size:.8rem;color:var(--warm-gray);margin:10px 0;" id="fin-church-import-status"></div>
      <div id="fin-church-import-preview"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('fin-church-import-modal')">Close</button>
      <button class="btn-primary" id="fin-church-import-confirm-btn" style="display:none;" onclick="finChurchConfirmImport()">Import Selected</button>
    </div>
  </div>
</div>

<!-- Church Report: import a "Profit and Loss by Month" Excel export — unlocks the Overview's
     Income vs. Expenses trend / Year-End Projection cards, which need month-by-month data that
     the annual Budget vs. Actuals import above can't provide (see FIN2 — live QuickBooks sync,
     the only other source of monthly data, is still pending approval). -->
<div class="modal-overlay" id="fin-church-monthly-import-modal">
  <div class="modal" style="max-width:640px;width:95vw;">
    <div class="modal-header"><span>Import Monthly P&amp;L from Excel</span><button class="modal-close" onclick="closeModal('fin-church-monthly-import-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <p style="font-size:.8rem;color:var(--warm-gray);margin:0 0 12px;">Upload a QuickBooks "Profit and Loss by Month" export (.xlsx) — one column per month, not the Actual/Budget shape the Budget import above expects. This is what feeds the Overview tab's Income vs. Expenses trend and Year-End Projection cards. Importing a year replaces any previously-imported monthly data for that year; a live QuickBooks monthly sync (once connected) always takes precedence over this import for the same year.</p>
      <input type="file" id="fin-church-monthly-import-file" accept=".xlsx" onchange="finChurchMonthlyImportFileSelected(this)">
      <div style="font-size:.8rem;color:var(--warm-gray);margin:10px 0;" id="fin-church-monthly-import-status"></div>
      <div id="fin-church-monthly-import-preview"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('fin-church-monthly-import-modal')">Close</button>
      <button class="btn-primary" id="fin-church-monthly-import-confirm-btn" style="display:none;" onclick="finChurchConfirmMonthlyImport()">Import</button>
    </div>
  </div>
</div>

<!-- Church Report: import a Balance Sheet / Statement of Financial Position Excel export -->
<div class="modal-overlay" id="fin-church-balance-import-modal">
  <div class="modal" style="max-width:640px;width:95vw;">
    <div class="modal-header"><span>Import Balance Sheet from Excel</span><button class="modal-close" onclick="closeModal('fin-church-balance-import-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <p style="font-size:.8rem;color:var(--warm-gray);margin:0 0 12px;">Upload a QuickBooks "Balance Sheet" or "Statement of Financial Position" export (.xlsx) — a point-in-time snapshot of Assets/Liabilities/Equity. The file is parsed on the server, then you'll get a preview to review and uncheck anything before it's saved — nothing is written until you click Import Selected. Importing a year replaces any previously-imported balance sheet for that same year.</p>
      <input type="file" id="fin-church-balance-import-file" accept=".xlsx" onchange="finChurchBalanceImportFileSelected(this)">
      <div style="font-size:.8rem;color:var(--warm-gray);margin:10px 0;" id="fin-church-balance-import-status"></div>
      <div id="fin-church-balance-import-preview"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('fin-church-balance-import-modal')">Close</button>
      <button class="btn-primary" id="fin-church-balance-import-confirm-btn" style="display:none;" onclick="finChurchConfirmBalanceImport()">Import Selected</button>
    </div>
  </div>
</div>

<!-- Commercial Property: add/edit one month's financials -->
<div class="modal-overlay" id="fin-property-month-modal">
  <div class="modal" style="max-width:520px;width:95vw;">
    <div class="modal-header"><span>Property — Month Financials</span><button class="modal-close" onclick="closeModal('fin-property-month-modal')">&#10005;</button></div>
    <div style="padding:4px 0;">
      <div class="modal-2col">
        <div class="field"><label>Period (YYYY-MM)</label><input type="text" id="fpm-period" placeholder="2026-06"></div>
        <div class="field"><label>Occupancy %</label><input type="number" id="fpm-occupancy" step="0.1" placeholder="100"></div>
      </div>
      <div class="modal-2col">
        <div class="field"><label>Total Revenue ($)</label><input type="number" id="fpm-revenue" step="0.01"></div>
        <div class="field"><label>Total Expenses ($)</label><input type="number" id="fpm-expenses" step="0.01"></div>
      </div>
      <div class="modal-2col">
        <div class="field"><label>Net Income ($)</label><input type="number" id="fpm-net-income" step="0.01"></div>
        <div class="field"><label>Net Operating Income ($)</label><input type="number" id="fpm-noi" step="0.01"></div>
      </div>
      <div class="modal-2col">
        <div class="field"><label>Available for Distribution ($)</label><input type="number" id="fpm-afd" step="0.01"></div>
        <div class="field"><label>Reserve Balance ($)</label><input type="number" id="fpm-reserve" step="0.01"></div>
      </div>
      <div class="modal-2col">
        <div class="field"><label>Loan Payment ($) <span style="font-weight:400;color:var(--warm-gray);">from bank rec</span></label><input type="number" id="fpm-loan-payment" step="0.01"></div>
        <div class="field"><label>Interest Expense ($) <span style="font-weight:400;color:var(--warm-gray);">from income statement</span></label><input type="number" id="fpm-interest-expense" step="0.01"></div>
      </div>
      <p style="font-size:.72rem;color:var(--warm-gray);margin:0 0 8px;">Fill in both to let the Mortgage Remaining card roll forward automatically (principal paid = loan payment − interest expense). Leave blank if this month's report doesn't break these out.</p>
      <div class="field"><label>Source Report</label><input type="text" id="fpm-source" placeholder="2026-06 - 3277 Ivanhoe Property Management Report.pdf" style="width:100%;"></div>
      <div style="font-size:.78rem;color:var(--danger);margin-top:6px;" id="fpm-error"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('fin-property-month-modal')">Cancel</button>
      <button class="btn-primary" onclick="finPropertySaveMonth()">Save</button>
    </div>
  </div>
</div>
`;
