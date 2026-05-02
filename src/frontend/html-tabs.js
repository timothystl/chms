export const HTML_TABS_1 = String.raw`<!-- ═══ HOME / DASHBOARD TAB ═══ -->
<div id="tab-home" class="tab-panel active">
  <div id="dash-body" style="padding:24px;max-width:1100px;"></div>
</div>

<!-- ═══ PEOPLE TAB ═══ -->
<div id="tab-people" class="tab-panel">
  <div class="toolbar">
    <div class="search-wrap"><input type="search" id="p-search" placeholder="Search name, email, phone…" oninput="debouncePeople()"></div>
    <button class="btn-secondary" id="p-filter-btn" onclick="toggleFilterDrawer()" style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
      <svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;flex-shrink:0;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
      Filters
      <span id="p-filter-count" style="display:none;background:var(--teal);color:#fff;border-radius:99px;padding:1px 7px;font-size:.72rem;font-weight:700;"></span>
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
  <div id="p-bulk-bar" style="display:none;position:sticky;bottom:0;z-index:500;background:var(--steel-anchor);color:#fff;padding:10px 16px;display:none;align-items:center;gap:10px;flex-wrap:wrap;">
    <span id="p-bulk-count" style="font-size:.9rem;font-weight:700;">0 selected</span>
    <div style="flex:1;"></div>
    <select id="p-bulk-mt" style="padding:5px 8px;border-radius:6px;border:none;font-size:.85rem;background:#fff;color:var(--charcoal);">
      <option value="">Change Member Type…</option>
    </select>
    <button class="btn-sm" onclick="applyBulkMemberType()" style="background:#fff;color:var(--steel-anchor);">Apply</button>
    <button class="btn-sm" onclick="openBulkTagsPanel()" style="background:#fff;color:var(--steel-anchor);">&#9881; Tags</button>
    <button class="btn-sm" onclick="clearSelection()" style="background:rgba(255,255,255,.2);color:#fff;">Cancel</button>
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
  <!-- Desktop grid -->
  <div id="p-grid"></div>
  <!-- Mobile contact list -->
  <div class="contact-list" id="p-contact-list"></div>
  <!-- Pagination -->
  <div id="p-pager" style="display:flex;align-items:center;justify-content:center;padding:16px 0;gap:8px;"></div>
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
  <div class="giving-layout">
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
</div>

<!-- ═══ REPORTS TAB ═══ -->
<div id="tab-reports" class="tab-panel">
  <div class="report-tiles">
    <div class="report-tile" onclick="runMembership()">
      <div class="tile-icon">&#128100;</div>
      <div class="tile-title">Membership Summary</div>
      <div class="tile-desc">Counts by member type</div>
    </div>
    <div class="report-tile no-member" onclick="runContactCompleteness()">
      <div class="tile-icon">&#128231;</div>
      <div class="tile-title">Contact Completeness</div>
      <div class="tile-desc">Missing email, phone, address, DOB, photo</div>
    </div>
    <div class="report-tile no-member" onclick="runPeopleInsights()">
      <div class="tile-icon">&#128196;</div>
      <div class="tile-title">People Insights</div>
      <div class="tile-desc">Growth, age, gender, households, sacramental pipeline</div>
    </div>
    <div class="report-tile require-finance">
      <div class="tile-icon">&#128200;</div>
      <div class="tile-title">Giving by Fund</div>
      <div class="tile-desc">
        <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-from" name="rpt-from" style="font-size:.82rem;padding:4px 8px;"></div>
        <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-to" name="rpt-to" style="font-size:.82rem;padding:4px 8px;"></div>
        <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingSummary()">Run Report</button>
      </div>
    </div>
    <div class="report-tile require-finance">
      <div class="tile-icon">&#128179;</div>
      <div class="tile-title">Giving by Method</div>
      <div class="tile-desc">
        <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-method-from" name="rpt-method-from" style="font-size:.82rem;padding:4px 8px;"></div>
        <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-method-to" name="rpt-method-to" style="font-size:.82rem;padding:4px 8px;"></div>
        <button class="btn-primary" style="margin-top:8px;font-size:.8rem;padding:5px 12px;" onclick="runGivingByMethod()">Run Report</button>
      </div>
    </div>
    <div class="report-tile require-finance">
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
          <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingStatementLetter()">View Letter</button>
          <button class="btn-secondary" style="font-size:.8rem;padding:5px 12px;" onclick="downloadStatement()">CSV</button>
        </div>
      </div>
    </div>
  </div>
  <div class="report-tiles require-finance" style="margin-top:0;padding-top:0;">
    <div class="report-tile">
      <div class="tile-icon">&#128200;</div>
      <div class="tile-title">Giving Trend</div>
      <div class="tile-desc">
        <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Year-over-year giving comparison by month.</div>
        <div id="rpt-trend-years" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;"></div>
        <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;" onclick="runGivingTrend()">Run Report</button>
      </div>
    </div>
    <div class="report-tile">
      <div class="tile-icon">&#128202;</div>
      <div class="tile-title">Giving Insights</div>
      <div class="tile-desc">
        <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Top givers, lapsed givers, frequency, and average gift trends.</div>
        <div class="field" style="margin:4px 0;"><label>Year</label><input type="number" id="rpt-insights-year" name="rpt-insights-year" style="font-size:.82rem;padding:4px 8px;width:90px;"></div>
        <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="runGivingInsights()">Run Report</button>
      </div>
    </div>
    <div class="report-tile">
      <div class="tile-icon">&#128202;</div>
      <div class="tile-title">Giving &times; Attendance</div>
      <div class="tile-desc">
        <div style="font-size:.82rem;color:var(--warm-gray);margin-bottom:8px;">Weekly giving vs. weekly attendance &mdash; see correlation between engagement and giving.</div>
        <div class="field" style="margin:8px 0 4px;"><label>From</label><input type="date" id="rpt-gva-from" name="rpt-gva-from" style="font-size:.82rem;padding:4px 8px;"></div>
        <div class="field" style="margin:4px 0;"><label>To</label><input type="date" id="rpt-gva-to" name="rpt-gva-to" style="font-size:.82rem;padding:4px 8px;"></div>
        <button class="btn-primary" style="font-size:.8rem;padding:5px 12px;margin-top:6px;" onclick="runGivingVsAttendance()">Run Report</button>
      </div>
    </div>
    <div class="report-tile">
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
    <!-- Church Info Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#9962; Church Information</h3>
      <p>Used in giving letters, email headers, and reports.</p>
      <div class="modal-2col" style="margin-bottom:10px;">
        <div class="field"><label>Church Name</label><input type="text" id="st-church-name" name="st-church-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>EIN (Tax ID)</label><input type="text" id="st-ein" name="st-ein" placeholder="XX-XXXXXXX" style="width:100%;"></div>
      </div>
      <div class="modal-2col" style="margin-bottom:12px;">
        <div class="field"><label>From Name (for emails)</label><input type="text" id="st-from-name" name="st-from-name" placeholder="Timothy Lutheran Church" style="width:100%;"></div>
        <div class="field"><label>From Email</label><input type="email" id="st-from-email" name="st-from-email" placeholder="giving@yourdomain.org" style="width:100%;"></div>
      </div>
      <button class="btn-primary" onclick="saveSettings()">Save Church Info</button>
    </div>
    <!-- Letter Template Card -->
    <div class="import-card" style="margin-bottom:14px;">
      <h3>&#128140; Year-End Giving Letter Template</h3>
      <p>Used when generating giving letters. Available placeholders: <code>{{name}}</code>, <code>{{year}}</code>, <code>{{total}}</code>, <code>{{ein}}</code>, <code>{{date}}</code>, <code>{{gift_table}}</code></p>
      <textarea id="st-letter-tpl" name="st-letter-tpl" rows="10" style="width:100%;font-family:monospace;font-size:.82rem;padding:10px;border:1px solid var(--border);border-radius:8px;resize:vertical;"></textarea>
      <div style="margin-top:8px;">
        <button class="btn-primary" onclick="saveSettings()">Save Template</button>
        <button class="btn-secondary" onclick="resetLetterTemplate()" style="margin-left:8px;">Reset to Default</button>
      </div>
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
    <div class="import-card">
      <h3>&#9729; Sync People from Breeze</h3>
      <p>Pull people records directly from the Breeze API. Existing records (matched by Breeze ID) are updated; new people are added. Dates and photos already in the system are preserved if Breeze doesn't return a value.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;">
        <button class="btn-primary" onclick="runBreezeImport()">Sync People from Breeze</button>
        <button class="btn-secondary" onclick="runBreezeTagSync()">&#127991; Sync Tags Only</button>
      </div>
      <div class="progress-bar" id="breeze-bar"><div class="progress-fill" id="breeze-fill" style="width:0%"></div></div>
      <div class="import-status" id="breeze-status"></div>
      <div class="import-status" id="breeze-tag-status" style="margin-top:4px;"></div>
      <div id="breeze-diag" style="display:none;margin-top:10px;font-size:.78rem;font-family:monospace;background:var(--linen);padding:10px;border-radius:6px;white-space:pre-wrap;"></div>
    </div>
    <div class="import-card">
      <h3>&#128181; Sync Giving from Breeze</h3>
      <p>Pull contribution records from the Breeze account log. Already-imported contributions are skipped (safe to re-sync). Groups by Breeze batch number. Fund names can be renamed in Giving &rarr; Funds after import.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;align-items:center;">
        <div class="field" style="margin:0;"><label>From</label><input type="date" id="giving-sync-from" name="giving-sync-from" style="font-size:.85rem;padding:4px 8px;"></div>
        <div class="field" style="margin:0;"><label>To</label><input type="date" id="giving-sync-to" name="giving-sync-to" style="font-size:.85rem;padding:4px 8px;"></div>
      </div>
      <button class="btn-primary" onclick="runBreezeGivingSync()">Sync Date Range</button>
      <div class="import-status" id="giving-sync-status"></div>
      <pre id="giving-sync-diagnostics" style="display:none;margin-top:10px;padding:10px;background:#f4f0ea;border:1px solid var(--border);border-radius:6px;font-size:.72rem;overflow:auto;max-height:400px;white-space:pre-wrap;word-break:break-all;"></pre>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--warm-gray-light,#e0d9d0);">
      <p style="margin:0 0 8px;"><strong>Sync All History</strong> — loops through every year from start year to today, one year at a time.</p>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
        <div class="field" style="margin:0;"><label>Start Year</label><input type="number" id="giving-sync-start-year" name="giving-sync-start-year" value="2020" min="2000" max="2099" style="width:90px;font-size:.85rem;padding:4px 8px;"></div>
      </div>
      <button class="btn-primary" id="giving-all-btn" onclick="runBreezeGivingAll()">Sync All History</button>
      <div class="import-status" id="giving-all-status"></div>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--warm-gray-light,#e0d9d0);">
      <p style="margin:0 0 8px;"><strong>Breeze Audit Log Export</strong> — Download every contribution-related event from Breeze (added, updated, deleted) as a CSV for reconciliation. Uses the same date range as the sync above.</p>
      <button class="btn-secondary" onclick="downloadBreezeAuditLog()">&#128229; Download Audit Log CSV</button>
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
    <div class="import-card">
      <h3>&#128260; Map Breeze Funds to Real Fund Names</h3>
      <p>After the giving sync, imported funds may show as "Breeze Fund XXXXXXX". Use <strong>Auto-Fix from Breeze</strong> to look up the real names directly from Breeze and rename them automatically. If any funds still have placeholder names after that, use the manual mapping tool below.</p>
      <button class="btn-primary" onclick="fixFundNames()" style="margin-bottom:8px;">&#128260; Auto-Fix Fund Names from Breeze</button>
      <div class="import-status" id="fix-fund-names-status" style="margin-bottom:10px;"></div>
      <div id="manual-fund-rename-area" style="display:none;margin-bottom:12px;">
        <table style="width:100%;border-collapse:collapse;" id="manual-fund-rename-table"></table>
        <button class="btn-primary" onclick="applyManualFundRenames()" style="margin-top:8px;">Save Fund Names</button>
      </div>
      <hr style="margin:10px 0;border:none;border-top:1px solid var(--border);">
      <p style="margin:0 0 8px;font-size:.88rem;color:var(--warm-gray);">Manual mapping — reassign contributions from a placeholder fund to a real fund name:</p>
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
      <h3>&#128197; Import Attendance (Simple CSV)</h3>
      <p>Paste or upload a 3-column file: <code>date, service_name, attendance</code>. Date must be YYYY-MM-DD. One row per service. Header row optional. Existing records for the same date+time are updated; new ones are inserted.</p>
      <textarea id="att-simple-text" name="att-simple-text" rows="6" style="width:100%;font-family:monospace;font-size:.8rem;padding:6px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;" placeholder="2024-03-10&#9;Sunday 8am&#9;112&#10;2024-03-10&#9;Sunday 10:45am&#9;187"></textarea>
      <button class="btn-primary" onclick="importAttendanceSimple()">Import</button>
      <div class="import-status" id="att-simple-status"></div>
    </div>
    <div class="import-card">
      <h3>&#128465; Prune Empty Batches</h3>
      <p>Remove any giving batches that have no entries (can be left behind by failed or partial imports). Safe to run at any time.</p>
      <button class="btn-secondary" onclick="pruneEmptyBatches()">Delete Empty Batches</button>
      <div class="import-status" id="prune-batches-status"></div>
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
    <div class="import-card">
      <h3>&#127968; Household Head Assignment</h3>
      <p id="hq4-status-text">Loading…</p>
      <p style="font-size:.82rem;color:var(--warm-gray);">Heads are used for display names and anniversary pairing. Promotes a spouse (or first member) to Head when none is assigned.</p>
      <button class="btn-secondary" onclick="fixHouseholdHeads()" style="font-size:.88rem;">Fix Household Heads</button>
      <div class="import-status" id="hq4-status"></div>
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
    <div class="import-card" style="border-color:#e74c3c;">
      <h3 style="color:#e74c3c;">&#9888; Clear Giving Data for One Year</h3>
      <p>Deletes all giving entries and batches for a single year. Use this to re-import one year without touching other years. <strong>This cannot be undone.</strong></p>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="number" id="clear-year-input" placeholder="e.g. 2026" min="2000" max="2099" style="width:110px;padding:6px 10px;border:1px solid #e74c3c;border-radius:6px;font-size:.88rem;">
        <button style="background:#e74c3c;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:700;cursor:pointer;" onclick="clearGivingByYear()">&#9888; Clear Year</button>
      </div>
      <div class="import-status" id="clear-year-status" style="margin-top:8px;"></div>
    </div>
    <div class="import-card" style="border-color:#e74c3c;">
      <h3 style="color:#e74c3c;">&#9888; Clear All Giving Data</h3>
      <p>Permanently deletes <strong>all</strong> giving entries and batches across every year. Use this to fully reset giving data before a clean re-import. <strong>This cannot be undone.</strong></p>
      <button style="background:#e74c3c;color:#fff;border:none;padding:8px 18px;border-radius:8px;font-size:.88rem;font-weight:700;cursor:pointer;" onclick="clearAllGiving()">&#9888; Clear All Giving Data</button>
      <div class="import-status" id="clear-giving-status"></div>
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
    <!-- Ministry filter tabs -->
    <div id="vol-ministry-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      <button class="btn-secondary active" onclick="volSetTab('all',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">All</button>
      <button class="btn-secondary" onclick="volSetTab('worship',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">Worship</button>
      <button class="btn-secondary" onclick="volSetTab('events',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">Events</button>
      <button class="btn-secondary" onclick="volSetTab('education',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">Education</button>
      <button class="btn-secondary" onclick="volSetTab('acceptance',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">Acceptance</button>
      <button class="btn-secondary" onclick="volSetTab('outreach',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">Outreach</button>
      <button class="btn-secondary" onclick="volSetTab('general',this)" style="border-radius:99px;font-size:.82rem;padding:4px 14px;">General</button>
    </div>
    <!-- Signups section -->
    <div id="vol-signups-section" style="margin-bottom:28px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <h3 id="vol-signups-title" style="font-size:1rem;font-weight:600;color:var(--charcoal);">All Volunteers <span id="vol-signups-count" style="background:var(--navy);color:#fff;border-radius:99px;padding:1px 8px;font-size:.75rem;margin-left:4px;">…</span></h3>
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
      <div id="vol-signups-list" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
    </div>
    <!-- Events management -->
    <div id="vol-events-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
        <h3 style="font-size:1rem;font-weight:600;color:var(--charcoal);">Community Events <span id="vol-events-count" style="background:var(--navy);color:#fff;border-radius:99px;padding:1px 8px;font-size:.75rem;margin-left:4px;">…</span></h3>
        <button class="btn-primary" style="font-size:.82rem;" onclick="volShowAddEventForm()">+ Add Event</button>
      </div>
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
      <div id="vol-events-list" style="font-size:.85rem;color:var(--warm-gray);">Loading…</div>
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
      <button class="btn-secondary require-edit" onclick="openPersonEdit(_currentPvPerson)">Edit</button>
    </div>
  </div>
  <div class="pv-body">
    <div class="pv-hdr">
      <div class="pv-photo-wrap" id="pv-photo-wrap">
        <div class="pv-photo" id="pv-photo"></div>
        <div class="pv-photo-upload-overlay require-edit" id="pv-photo-overlay" onclick="triggerPhotoUpload()" title="Upload photo" style="display:none;">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="white" stroke-width="1.8"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </div>
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
        <div class="field"><label>Date of Birth</label><input type="date" id="pm-dob" name="pm-dob"></div>
        <div class="field"><label>Baptism</label><input type="date" id="pm-baptism" name="pm-baptism"></div>
        <div class="field"><label>Confirmation</label><input type="date" id="pm-confirm" name="pm-confirm"></div>
        <div class="field"><label>Anniversary</label><input type="date" id="pm-anniv" name="pm-anniv"></div>
        <div class="field"><label>Death Date</label><input type="date" id="pm-death" name="pm-death"></div>
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

<!-- Household detail modal -->
<div class="modal-overlay" id="hh-detail-modal" onclick="if(event.target===this)closeModal('hh-detail-modal')">
  <div class="modal" style="max-width:480px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <h2 style="margin:0;">Household</h2>
      <button class="btn-secondary" style="padding:4px 10px;font-size:.82rem;" onclick="closeModal('hh-detail-modal')">Close</button>
    </div>
    <div id="hh-detail-body"></div>
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
    <div class="field" style="margin-bottom:10px;"><label>Family Name</label><input type="text" id="hm-name" name="hm-name" placeholder="e.g. Smith Family"></div>
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
  <div class="modal" style="max-width:600px;padding:20px;">
    <h2 style="margin-bottom:12px;">Crop Profile Photo</h2>
    <div style="text-align:center;background:#222;border-radius:8px;overflow:hidden;line-height:0;user-select:none;">
      <canvas id="crop-canvas" style="max-width:100%;cursor:crosshair;touch-action:none;"
        onmousedown="cropMouseDown(event)"
        onmousemove="cropMouseMove(event)"
        onmouseup="cropMouseUp(event)"
        onmouseleave="cropMouseUp(event)"></canvas>
    </div>
    <div style="font-size:.8rem;color:var(--warm-gray);margin-top:8px;text-align:center;">Drag box to reposition · Drag corners to resize</div>
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
`;
