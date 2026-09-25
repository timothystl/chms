// Facilities pages (v3 design): Overview, Assets (+ one asset's record), Service history,
// Capital projects, Preventive maintenance. Server-rendered; editing uses plain form posts to
// the facilities-* writers and is shown only to roles that may edit (the server re-checks).
import { escapeHtml, formatCents } from './render-helpers.js';
import {
  DUE_SOON_DAYS, FACILITY_CATEGORIES, NEAR_END_OF_LIFE_PCT, PROJECT_STATUSES, SERVICE_TYPES,
  formatDay, formatMonth,
} from './facilities-service.js';
import { INLINE_IMAGE_TYPES, MAX_FILES_PER_UPLOAD, MAX_FILE_BYTES, formatBytes, recordReturn } from './facility-files.js';
import { formatCompactCents } from './health-pages.js';

const e = escapeHtml;
const dollars = (cents) => (cents ? formatCents(cents) : '—');
const inputDollars = (cents) => (cents ? (cents / 100).toFixed(2) : '');

function link(page, params = {}) {
  const search = new URLSearchParams({ section: 'facilities', page, ...params });
  return `/?${search.toString().replace(/&/g, '&amp;')}`;
}

function kpis(items) {
  return `<div class="grid">${items.map(([label, value, note, tone]) => `<div class="card"><small>${e(label)}</small><strong>${value}</strong>${note ? `<span class="${tone ? `tone-${tone}` : ''}">${note}</span>` : ''}</div>`).join('')}</div>`;
}

function chips(page, param, values, active, extra = {}) {
  return `<div class="chip-row">${['All', ...values].map((value) => {
    const on = (value === 'All' && !active) || value === active;
    const href = value === 'All' ? link(page, extra) : link(page, { ...extra, [param]: value });
    return on ? `<span class="chip is-on">${e(value)}</span>` : `<a class="chip" href="${href}">${e(value)}</a>`;
  }).join('')}</div>`;
}

function pill(label, tone) {
  return `<span class="pill pill-${tone}">${e(label)}</span>`;
}

function select(name, options, selected, { blank } = {}) {
  return `<select name="${name}">${blank ? `<option value="">${e(blank)}</option>` : ''}${options.map(([value, label]) => `<option value="${e(String(value))}"${String(value) === String(selected ?? '') ? ' selected' : ''}>${e(label)}</option>`).join('')}</select>`;
}

function field(label, control, wide) {
  return `<label class="field${wide ? ' field-wide' : ''}"><span>${e(label)}</span>${control}</label>`;
}

function statusBanner(status) {
  if (!status) return '';
  return `<p class="status${status.ok ? '' : ' status-error'}">${e(status.message)}</p>`;
}

function lifeTone(life) {
  return life.state === 'past' ? 'bad' : life.state === 'near' ? 'warn' : 'ok';
}

function lifeLabel(life) {
  return life.state === 'past' ? 'Past life' : `${Math.round(life.pctUsed)}% of life`;
}

function pmPill(schedule) {
  if (schedule.state === 'overdue') return pill(`Overdue ${-schedule.daysUntil}d`, 'bad');
  if (schedule.state === 'never') return pill('Not yet done', 'bad');
  if (schedule.state === 'soon') return pill('Due soon', 'warn');
  return pill('Scheduled', 'good');
}

function everyLabel(months) {
  if (months === 1) return 'Month';
  if (months === 12) return 'Year';
  if (months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

function assetOptions(view, selected, blank) {
  return select('asset_id', view.assets.map((a) => [a.id, a.name]), selected, { blank });
}

function emptyNote(text) {
  return `<div class="empty-note">${text}</div>`;
}

// ── Photos & documents ────────────────────────────────────────────────────────────────────────

const RETURN_KEY = { asset: 'asset', pm_task: 'task', service: 'entry', project: 'project' };

function returnFields(recordType, recordId) {
  const { page } = recordReturn(recordType, recordId);
  return `<input type="hidden" name="return_page" value="${page}"><input type="hidden" name="return_${RETURN_KEY[recordType]}" value="${recordId}">`;
}

function fileUrl(file) {
  return `/api/v1/facilities/file?id=${file.id}`;
}

function fileTile(file, recordType, recordId, canEdit) {
  const label = file.caption || file.file_name;
  const remove = canEdit ? `<form method="POST" action="/api/v1/facilities/file-remove" class="inline-form"><input type="hidden" name="id" value="${file.id}">${returnFields(recordType, recordId)}<button type="submit" class="link-button" title="Remove this file">Remove</button></form>` : '';
  const preview = INLINE_IMAGE_TYPES.includes(file.content_type)
    ? `<img src="${fileUrl(file)}" alt="${e(label)}" loading="lazy">`
    : `<span class="doc-badge">${file.content_type === 'application/pdf' ? 'PDF' : 'Photo'}</span>`;
  return `<figure class="file-tile"><a class="file-open" href="${fileUrl(file)}" target="_blank" rel="noopener">${preview}</a><figcaption><a href="${fileUrl(file)}" target="_blank" rel="noopener">${e(label)}</a><small>${e(file.created_at ? formatDay(file.created_at.slice(0, 10)) : '')} · ${formatBytes(file.byte_size)}</small>${remove}</figcaption></figure>`;
}

// Chooser for photos and PDFs. On a phone the browser offers the camera, the photo library, and
// files (including scanned documents).
function fileInput({ required } = {}) {
  return `<input type="file" name="files" accept="image/*,application/pdf" multiple${required ? ' required' : ''}>`;
}

const FILE_HINT = `Photos and PDFs, up to ${MAX_FILES_PER_UPLOAD} at a time, ${MAX_FILE_BYTES / 1024 / 1024} MB each. On a phone you can take the picture right here.`;

function filesPanel(view, recordType, recordId, canEdit, { heading = 'Photos &amp; documents', empty = 'No photos or documents attached yet.' } = {}) {
  const files = view.filesFor(recordType, recordId);
  const gallery = files.length ? `<div class="file-grid">${files.map((f) => fileTile(f, recordType, recordId, canEdit)).join('')}</div>` : emptyNote(empty);
  const upload = canEdit ? `<form method="POST" action="/api/v1/facilities/file-upload" enctype="multipart/form-data" class="form-grid facility-form upload-form">
      <input type="hidden" name="record_type" value="${recordType}"><input type="hidden" name="record_id" value="${recordId}">${returnFields(recordType, recordId)}
      ${field('Add photos or a scanned document', fileInput({ required: true }))}
      ${field('Caption (optional)', '<input name="caption" maxlength="200" placeholder="e.g. Nameplate label, service order #1142">')}
      <div class="form-actions"><button type="submit">Attach</button><p class="muted-line">${FILE_HINT}</p></div>
    </form>` : '';
  return `<div class="panel panel-spaced"><div class="panel-head"><h2>${heading}</h2>${files.length ? `<span class="muted">${files.length} file${files.length === 1 ? '' : 's'}</span>` : ''}</div>${gallery}${upload}</div>`;
}

function fileCount(view, recordType, recordId) {
  const n = view.filesFor(recordType, recordId).length;
  return n ? `${n} file${n === 1 ? '' : 's'}` : '';
}

// ── Overview ──────────────────────────────────────────────────────────────────────────────────

function renderOverview(view) {
  const largest = view.largestPlanned ? `${e(view.largestPlanned.name)} is the largest item` : 'No open projects in the next five years';
  const top = kpis([
    ['Assets on record', String(view.assets.length), view.locations ? `Across ${view.locations} location${view.locations === 1 ? '' : 's'}` : 'Add assets to build the register'],
    [`Maintenance due in ${DUE_SOON_DAYS} days`, String(view.dueSoon.length), view.overdue.length ? `${view.overdue.length} overdue` : 'Nothing overdue', view.overdue.length ? 'bad' : 'good'],
    ['Near end of useful life', String(view.nearEnd.length), `${NEAR_END_OF_LIFE_PCT}% or more of expected life used`, view.nearEnd.length ? 'warn' : ''],
    ['Capital planned, next 5 years', formatCompactCents(view.planned5Cents), largest],
  ]);
  const due = view.dueSoon.length
    ? view.dueSoon.slice(0, 10).map((t) => `<li><div><b>${e(t.name)}</b><small>${e([t.covers, t.assignee].filter(Boolean).join(' · '))}</small></div><div class="right">${pmPill(t.schedule)}<small>${t.schedule.state === 'overdue' ? `${-t.schedule.daysUntil} days overdue` : t.schedule.state === 'never' ? 'No completion on record' : `Due ${formatDay(t.schedule.nextDue)}`}</small></div></li>`).join('')
    : `<li class="muted-row">Nothing is due in the next ${DUE_SOON_DAYS} days.</li>`;
  const aging = view.nearEnd.length
    ? view.nearEnd.slice(0, 8).map((a) => `<li class="life-row"><div class="life-head"><b>${e(a.name)}</b><span>${a.replacement_cost_cents ? `Replace ~${formatCompactCents(a.replacement_cost_cents)}` : ''}</span></div><div class="life-bar"><span class="tone-bg-${lifeTone(a.life)}" style="width:${Math.min(100, a.life.pctUsed).toFixed(1)}%"></span></div><small>${Math.floor(a.life.ageYears)} of ${a.expected_life_years} years · ${a.life.state === 'past' ? 'past expected life' : `about ${Math.round(a.life.yearsLeft)} left`}${a.location ? ` · ${e(a.location)}` : ''}</small></li>`).join('')
    : '<li class="muted-row">No asset has used 85% of its expected life.</li>';
  const max = Math.max(1, ...view.capitalByYear.map((y) => y.cents));
  const chart = `<div class="bar-chart">${view.capitalByYear.map((y) => `<div class="bar-col"><span class="bar-value">${y.cents ? formatCompactCents(y.cents) : '—'}</span><div class="bar" style="height:${y.cents ? Math.max(4, y.cents / max * 150).toFixed(0) : 2}px"></div><span class="bar-label">${y.year}</span></div>`).join('')}</div>`;
  return `<p class="lede">The building’s history in one place: what we own, what’s been done to it, what’s coming due, and what it will cost to replace.</p>
    ${top}
    <div class="panel-grid">
      <div class="panel"><div class="panel-head"><h2>Due in the next ${DUE_SOON_DAYS} days</h2><a href="${link('preventive-maintenance')}">All maintenance</a></div><ul class="row-list">${due}</ul></div>
      <div class="panel"><div class="panel-head"><h2>Nearing end of useful life</h2><a href="${link('assets')}">All assets</a></div><ul class="row-list">${aging}</ul></div>
    </div>
    <div class="panel panel-spaced"><div class="panel-head"><h2>Capital plan by year</h2><span class="muted">Planned and in-progress projects</span></div>${chart}</div>`;
}

// ── Assets ────────────────────────────────────────────────────────────────────────────────────

function assetForm(asset = {}) {
  const categories = FACILITY_CATEGORIES.map((c) => [c, c]);
  return `<form method="POST" action="/api/v1/facilities/asset-save" class="form-grid facility-form">
    ${asset.id ? `<input type="hidden" name="id" value="${asset.id}">` : ''}
    ${field('Name', `<input name="name" required maxlength="160" value="${e(asset.name || '')}" placeholder="e.g. RTU #1 · Carrier 48FC 10-ton">`, true)}
    ${field('Category', select('category', categories, asset.category || 'HVAC'))}
    ${field('Location', `<input name="location" maxlength="160" value="${e(asset.location || '')}" placeholder="Building or room">`)}
    ${field('Installed', `<input type="month" name="installed_month" required value="${e(asset.installed_month || '')}">`)}
    ${field('Expected life (years)', `<input type="number" name="expected_life_years" min="1" max="150" required value="${e(String(asset.expected_life_years || ''))}">`)}
    ${field('Replacement cost ($)', `<input name="replacement_cost" inputmode="decimal" value="${inputDollars(asset.replacement_cost_cents)}" placeholder="0.00">`)}
    ${field('Model', `<input name="model" maxlength="160" value="${e(asset.model || '')}">`)}
    ${field('Serial', `<input name="serial" maxlength="120" value="${e(asset.serial || '')}">`)}
    ${field('Warranty', `<input name="warranty" maxlength="200" value="${e(asset.warranty || '')}" placeholder="e.g. Parts to May 2030">`)}
    ${field('Contractor', `<input name="vendor" maxlength="160" value="${e(asset.vendor || '')}">`)}
    ${field('Notes', `<input name="notes" maxlength="2000" value="${e(asset.notes || '')}">`, true)}
    ${asset.id ? field('Status', select('status', [['active', 'In service'], ['retired', 'Retired / removed']], asset.status)) : ''}
    <div class="form-actions"><button type="submit">${asset.id ? 'Save changes' : 'Add asset'}</button></div>
  </form>`;
}

function renderAssetDetail(view, asset, canEdit) {
  const life = view.assets.find((a) => a.id === asset.id)?.life;
  const history = view.service.filter((s) => s.asset_id === asset.id);
  const tasks = view.pmTasks.filter((t) => t.asset_id === asset.id);
  const facts = [
    ['Category', asset.category], ['Location', asset.location], ['Installed', formatMonth(asset.installed_month)],
    ['Expected life', `${asset.expected_life_years} years`], ['Replacement cost', dollars(asset.replacement_cost_cents)],
    ['Model', asset.model], ['Serial', asset.serial], ['Warranty', asset.warranty], ['Contractor', asset.vendor],
  ];
  return `<p class="crumb"><a href="${link('assets')}">All assets</a></p>
    <div class="panel">
      <div class="panel-head"><h2>${e(asset.name)}</h2>${asset.status === 'retired' ? pill('Retired', 'plain') : life ? pill(lifeLabel(life), lifeTone(life) === 'ok' ? 'good' : lifeTone(life)) : ''}</div>
      ${life ? `<div class="life-bar"><span class="tone-bg-${lifeTone(life)}" style="width:${Math.min(100, life.pctUsed).toFixed(1)}%"></span></div><p class="meter-note">${Math.floor(life.ageYears)} of ${asset.expected_life_years} years used${life.state === 'past' ? ' · past expected life' : ` · about ${Math.round(life.yearsLeft)} years left`}</p>` : ''}
      <dl class="fact-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v || '—')}</dd></div>`).join('')}</dl>
      ${asset.notes ? `<p>${e(asset.notes)}</p>` : ''}
    </div>
    ${filesPanel(view, 'asset', asset.id, canEdit, { empty: 'No photos yet. Add the unit, its nameplate label, and anything a contractor will ask about.' })}
    <div class="panel panel-spaced"><h2>Service history</h2>${history.length ? `<ul class="row-list">${history.map((s) => serviceRow(view, s)).join('')}</ul>` : emptyNote('No service logged for this asset yet.')}</div>
    ${tasks.length ? `<div class="panel panel-spaced"><h2>Recurring maintenance</h2><ul class="row-list">${tasks.map((t) => `<li><div><b><a href="${link('preventive-maintenance', { task: String(t.id) })}">${e(t.name)}</a></b><small>Every ${everyLabel(t.interval_months).toLowerCase()} · ${e(t.assignee || 'Unassigned')}</small></div><div class="right">${pmPill(t.schedule)}<small>Next ${formatDay(t.schedule.nextDue)}</small></div></li>`).join('')}</ul></div>` : ''}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"><summary>Edit this asset</summary>${assetForm(asset)}</details>` : ''}`;
}

function renderAssets(view, params, canEdit) {
  const assetId = Number(params.get('asset'));
  const asset = assetId ? view.allAssets.find((a) => a.id === assetId) : null;
  if (asset) return renderAssetDetail(view, asset, canEdit);
  const category = FACILITY_CATEGORIES.includes(params.get('category')) ? params.get('category') : null;
  const used = FACILITY_CATEGORIES.filter((c) => view.assets.some((a) => a.category === c));
  const list = view.assets.filter((a) => !category || a.category === category);
  const retired = view.allAssets.filter((a) => a.status === 'retired');
  return `<p class="lede">Select an asset to see its record: model and serial, warranty, contractor, expected life and service history.</p>
    ${used.length > 1 ? chips('assets', 'category', used, category) : ''}
    <div class="panel list-panel">${list.length
    ? `<ul class="row-list">${list.map((a) => `<li><a class="row-link" href="${link('assets', { asset: String(a.id) })}"><div><b>${e(a.name)}</b><small>${e([a.category, a.location].filter(Boolean).join(' · '))}</small></div><div class="right"><span class="tone-${lifeTone(a.life)} strong-small">${lifeLabel(a.life)}</span><small>Installed ${formatMonth(a.installed_month)}${fileCount(view, 'asset', a.id) ? ` · ${fileCount(view, 'asset', a.id)}` : ''}</small></div></a></li>`).join('')}</ul>`
    : emptyNote(view.assets.length ? 'No assets in this category.' : 'No assets on record yet. Add the building systems, roofs, vehicles, and equipment you want to track.')}</div>
    ${retired.length ? `<p class="muted-line">${retired.length} retired asset${retired.length === 1 ? '' : 's'} kept for history: ${retired.map((a) => `<a href="${link('assets', { asset: String(a.id) })}">${e(a.name)}</a>`).join(', ')}.</p>` : ''}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.assets.length ? '' : ' open'}><summary>Add an asset</summary>${assetForm()}</details>` : ''}`;
}

// ── Service history ───────────────────────────────────────────────────────────────────────────

const TYPE_TONE = { Repair: 'bad', Inspection: 'info', Preventive: 'good', Replacement: 'warn' };

function serviceRow(view, s, canRemove) {
  const files = fileCount(view, 'service', s.id);
  return `<li class="service-row"><span class="date">${formatDay(s.service_date)}</span><div class="grow"><b><a class="plain-link" href="${link('service-history', { entry: String(s.id) })}">${e(s.description)}</a></b><small>${e([s.assetName, s.vendor].filter(Boolean).join(' · '))}${files ? ` · <a href="${link('service-history', { entry: String(s.id) })}">${files}</a>` : ''}</small></div><div class="right"><b>${s.cost_cents ? formatCents(s.cost_cents) : '—'}</b><small class="tone-${TYPE_TONE[s.service_type]}">${e(s.service_type)}</small>${canRemove === true ? `<form method="POST" action="/api/v1/facilities/service-remove" class="inline-form"><input type="hidden" name="id" value="${s.id}"><button type="submit" class="link-button" title="Remove an entry logged by mistake">Remove</button></form>` : ''}</div></li>`;
}

function renderServiceEntry(view, entry, canEdit) {
  const facts = [
    ['Date', formatDay(entry.service_date)], ['Type', entry.service_type], ['Asset', entry.assetName],
    ['Contractor', entry.vendor || '—'], ['Cost', dollars(entry.cost_cents)],
  ];
  const assetLink = entry.asset_id && view.allAssets.some((a) => a.id === entry.asset_id) ? ` · <a href="${link('assets', { asset: String(entry.asset_id) })}">Open asset</a>` : '';
  return `<p class="crumb"><a href="${link('service-history')}">All service history</a>${assetLink}</p>
    <div class="panel"><h2>${e(entry.description)}</h2><dl class="fact-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join('')}</dl></div>
    ${filesPanel(view, 'service', entry.id, canEdit, { heading: 'Service order, invoice &amp; photos', empty: 'Nothing attached yet. Add a photo or scan of the service order or invoice.' })}`;
}

function renderService(view, params, canEdit) {
  const entry = view.service.find((s) => String(s.id) === params.get('entry'));
  if (entry) return renderServiceEntry(view, entry, canEdit);
  const type = SERVICE_TYPES.includes(params.get('type')) ? params.get('type') : null;
  const list = view.service.filter((s) => !type || s.service_type === type);
  const form = canEdit ? `<div class="panel"><h2>Log service or repair</h2>
    <form method="POST" action="/api/v1/facilities/service-log" enctype="multipart/form-data" class="form-grid facility-form">
      ${field('Asset', assetOptions(view, '', 'General / no single asset'))}
      ${field('Date', `<input type="date" name="service_date" required value="${view.today}">`)}
      ${field('Type', select('service_type', SERVICE_TYPES.map((t) => [t, t]), 'Repair'))}
      ${field('Contractor', `<input name="vendor" maxlength="160" placeholder="Company or staff">`)}
      ${field('Cost ($)', `<input name="cost" inputmode="decimal" placeholder="0.00">`)}
      ${field('What was done', `<input name="description" required maxlength="500" placeholder="e.g. Boiler pump replaced; old pump seized">`, true)}
      ${field('Service order or photos (optional)', fileInput(), true)}
      <div class="form-actions"><button type="submit">Add to history</button><p class="muted-line">${FILE_HINT}</p></div>
    </form></div>` : '';
  return `${form}
    ${chips('service-history', 'type', SERVICE_TYPES, type)}
    <div class="panel list-panel">${list.length ? `<ul class="row-list">${list.map((s) => serviceRow(view, s, canEdit)).join('')}</ul>` : emptyNote('No service logged yet.')}</div>`;
}

// ── Capital projects ──────────────────────────────────────────────────────────────────────────

function projectForm(project = {}) {
  return `<form method="POST" action="/api/v1/facilities/project-save" class="form-grid facility-form">
    ${project.id ? `<input type="hidden" name="id" value="${project.id}">` : ''}
    ${field('Project', `<input name="name" required maxlength="160" value="${e(project.name || '')}">`, true)}
    ${field('Status', select('status', PROJECT_STATUSES.map((s) => [s, s]), project.status || 'Planned'))}
    ${field('Target or completed month', `<input type="month" name="target_month" required value="${e(project.target_month || '')}">`)}
    ${field('Cost or estimate ($)', `<input name="cost" inputmode="decimal" required value="${inputDollars(project.cost_cents)}">`)}
    ${field('Useful life (years)', `<input type="number" name="useful_life_years" min="1" max="150" value="${e(String(project.useful_life_years || ''))}">`)}
    ${field('Contractor', `<input name="vendor" maxlength="160" value="${e(project.vendor || '')}">`)}
    ${field('Warranty', `<input name="warranty" maxlength="200" value="${e(project.warranty || '')}">`)}
    ${field('Funding', `<input name="funding" maxlength="200" value="${e(project.funding || '')}" placeholder="e.g. Capital reserve">`)}
    ${field('Scope', `<input name="scope" maxlength="600" value="${e(project.scope || '')}">`, true)}
    ${field('Notes', `<input name="notes" maxlength="2000" value="${e(project.notes || '')}">`, true)}
    <div class="form-actions"><button type="submit">${project.id ? 'Save changes' : 'Add project'}</button></div>
  </form>`;
}

const STATUS_TONE = { Planned: 'warn', 'In progress': 'info', Completed: 'good' };

function projectThumbs(view, project) {
  const images = view.filesFor('project', project.id).filter((f) => INLINE_IMAGE_TYPES.includes(f.content_type)).slice(-4);
  if (!images.length) return '';
  return `<div class="thumb-row">${images.map((f) => `<a href="${link('capital-projects', { project: String(project.id) })}"><img src="${fileUrl(f)}" alt="${e(f.caption || f.file_name)}" loading="lazy"></a>`).join('')}</div>`;
}

function renderProjectDetail(view, project, canEdit) {
  return `<p class="crumb"><a href="${link('capital-projects')}">All capital projects</a></p>
    <div class="panel"><div class="panel-head"><div><h2>${e(project.name)}</h2>${project.scope ? `<p class="scope">${e(project.scope)}</p>` : ''}</div>${pill(project.status, STATUS_TONE[project.status])}</div>
      <dl class="fact-grid">
        <div><dt>${project.status === 'Completed' ? 'Completed' : 'Target'}</dt><dd>${formatMonth(project.target_month)}</dd></div>
        <div><dt>${project.status === 'Planned' ? 'Estimate' : 'Cost'}</dt><dd>${formatCents(project.cost_cents)}</dd></div>
        <div><dt>Contractor</dt><dd>${e(project.vendor || '—')}</dd></div>
        <div><dt>Warranty</dt><dd>${e(project.warranty || '—')}</dd></div>
      </dl>
      ${project.notes ? `<p class="scope">${e(project.notes)}</p>` : ''}
    </div>
    ${filesPanel(view, 'project', project.id, canEdit, { empty: 'Nothing attached yet. Add bids, contracts, before-and-after photos, or warranty papers.' })}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"><summary>Edit this project</summary>${projectForm(project)}</details>` : ''}`;
}

function renderProjects(view, params, canEdit) {
  const project = view.projects.find((p) => String(p.id) === params.get('project'));
  if (project) return renderProjectDetail(view, project, canEdit);
  const status = PROJECT_STATUSES.includes(params.get('status')) ? params.get('status') : null;
  const list = view.projects.filter((p) => !status || p.status === status);
  const firstCompleted = view.completed.list.map((p) => p.target_month).sort()[0];
  const plannedYears = view.planned.list.map((p) => p.target_month.slice(0, 4)).sort();
  const top = kpis([
    [`Completed${firstCompleted ? ` since ${firstCompleted.slice(0, 4)}` : ''}`, formatCompactCents(view.completed.cents), `${view.completed.count} project${view.completed.count === 1 ? '' : 's'}`],
    ['In progress', formatCompactCents(view.inProgress.cents), view.inProgress.count === 1 ? e(view.inProgress.list[0].name) : `${view.inProgress.count} projects`],
    [`Planned${plannedYears.length ? ` ${plannedYears[0]}${plannedYears.at(-1) !== plannedYears[0] ? `–${plannedYears.at(-1)}` : ''}` : ''}`, formatCompactCents(view.planned.cents), `${view.planned.count} project${view.planned.count === 1 ? '' : 's'}`],
  ]);
  const cards = list.map((p) => {
    const done = p.status === 'Completed';
    const next = p.useful_life_years ? Number(p.target_month.slice(0, 4)) + p.useful_life_years : null;
    return `<div class="project-card">
      <div class="panel-head"><div><h3>${e(p.name)}</h3>${p.scope ? `<p class="scope">${e(p.scope)}</p>` : ''}</div>${pill(p.status, STATUS_TONE[p.status])}</div>
      <strong class="project-cost">${p.status === 'Planned' ? 'Est. ' : ''}${formatCents(p.cost_cents)}</strong>
      <dl class="fact-grid two">
        <div><dt>${done ? 'Completed' : 'Target'}</dt><dd>${formatMonth(p.target_month)}</dd></div>
        <div><dt>Contractor</dt><dd>${e(p.vendor || '—')}</dd></div>
        <div><dt>Warranty</dt><dd>${e(p.warranty || '—')}</dd></div>
        <div><dt>Useful life</dt><dd>${p.useful_life_years ? `${p.useful_life_years} years` : '—'}</dd></div>
        <div><dt>Funding</dt><dd>${e(p.funding || '—')}</dd></div>
        <div><dt>${done ? 'Replace around' : 'Next after'}</dt><dd>${next || '—'}</dd></div>
      </dl>
      ${p.notes ? `<p class="scope">${e(p.notes)}</p>` : ''}
      ${projectThumbs(view, p)}
      <p class="card-links"><a href="${link('capital-projects', { project: String(p.id) })}">Photos &amp; documents${fileCount(view, 'project', p.id) ? ` (${view.filesFor('project', p.id).length})` : ''}</a></p>
      ${canEdit ? `<details class="edit-inline"><summary>Edit</summary>${projectForm(p)}</details>` : ''}
    </div>`;
  }).join('');
  return `<p class="lede">Major projects are tracked apart from ordinary repairs, with cost, contractor, warranty, funding and expected useful life.</p>
    ${top}
    ${chips('capital-projects', 'status', PROJECT_STATUSES, status)}
    ${list.length ? `<div class="project-grid">${cards}</div>` : `<div class="panel list-panel">${emptyNote(view.projects.length ? 'No projects with this status.' : 'No capital projects on record yet.')}</div>`}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.projects.length ? '' : ' open'}><summary>Add a project</summary>${projectForm()}</details>` : ''}`;
}

// ── Preventive maintenance ────────────────────────────────────────────────────────────────────

function pmForm(view, task = {}) {
  return `<form method="POST" action="/api/v1/facilities/pm-save" class="form-grid facility-form">
    ${task.id ? `<input type="hidden" name="id" value="${task.id}">` : ''}
    ${field('Task', `<input name="name" required maxlength="160" value="${e(task.name || '')}" placeholder="e.g. HVAC filters, all RTUs">`, true)}
    ${field('Covers', `<input name="covers" maxlength="200" value="${e(task.covers || '')}" placeholder="What or where">`)}
    ${field('Asset', assetOptions(view, task.asset_id, 'Not tied to one asset'))}
    ${field('Every (months)', `<input type="number" name="interval_months" min="1" max="120" required value="${e(String(task.interval_months || ''))}">`)}
    ${field('Last done', `<input type="date" name="last_done_on" value="${e(task.last_done_on || '')}">`)}
    ${field('Who', `<input name="assignee" maxlength="160" value="${e(task.assignee || '')}" placeholder="Contractor or staff">`)}
    ${task.id ? field('Status', select('active', [['1', 'Active'], ['0', 'Stopped']], String(task.active ?? 1))) : ''}
    <div class="form-actions"><button type="submit">${task.id ? 'Save changes' : 'Add task'}</button></div>
  </form>`;
}

function renderPmTask(view, task, canEdit) {
  const asset = task.asset_id ? view.allAssets.find((a) => a.id === task.asset_id) : null;
  const facts = [
    ['Every', everyLabel(task.interval_months)], ['Last done', formatDay(task.last_done_on)],
    ['Next due', task.schedule.state === 'never' ? 'Now' : formatDay(task.schedule.nextDue)], ['Who', task.assignee || '—'],
  ];
  const history = view.service.filter((s) => s.pm_task_id === task.id);
  return `<p class="crumb"><a href="${link('preventive-maintenance')}">All maintenance</a>${asset ? ` · <a href="${link('assets', { asset: String(asset.id) })}">${e(asset.name)}</a>` : ''}</p>
    <div class="panel"><div class="panel-head"><div><h2>${e(task.name)}</h2>${task.covers ? `<p class="scope">${e(task.covers)}</p>` : ''}</div>${pmPill(task.schedule)}</div>
      <dl class="fact-grid">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
    </div>
    ${filesPanel(view, 'pm_task', task.id, canEdit, { empty: 'Nothing attached yet. Add the service contract, a checklist, or photos of what gets checked.' })}
    ${history.length ? `<div class="panel panel-spaced"><h2>Completions</h2><ul class="row-list">${history.map((s) => serviceRow(view, s)).join('')}</ul></div>` : ''}
    ${canEdit ? `<details class="panel panel-spaced edit-panel"><summary>Edit this task</summary>${pmForm(view, task)}</details>` : ''}`;
}

function renderPm(view, params, canEdit) {
  const detail = view.pmTasks.find((t) => String(t.id) === params.get('task'));
  if (detail) return renderPmTask(view, detail, canEdit);
  const editing = canEdit ? view.pmTasks.find((t) => String(t.id) === params.get('edit')) : null;
  const overdue = view.pmTasks.filter((t) => t.schedule.state === 'overdue' || t.schedule.state === 'never').length;
  const soon = view.pmTasks.filter((t) => t.schedule.state === 'soon').length;
  const top = kpis([
    ['Recurring tasks', String(view.pmTasks.length)],
    ['Overdue', String(overdue), overdue ? 'Needs attention' : 'Nothing overdue', overdue ? 'bad' : 'good'],
    [`Due in ${DUE_SOON_DAYS} days`, String(soon)],
  ]);
  const rows = view.pmTasks.map((t) => `<tr class="${t.schedule.state === 'overdue' || t.schedule.state === 'never' ? 'row-alert' : ''}">
      <td><b><a class="plain-link" href="${link('preventive-maintenance', { task: String(t.id) })}">${e(t.name)}</a></b>${t.covers || fileCount(view, 'pm_task', t.id) ? `<small>${e([t.covers, fileCount(view, 'pm_task', t.id)].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td>${everyLabel(t.interval_months)}</td>
      <td>${formatDay(t.last_done_on)}</td>
      <td><b>${t.schedule.state === 'never' ? 'Now' : formatDay(t.schedule.nextDue)}</b></td>
      <td>${e(t.assignee || '—')}</td>
      <td>${pmPill(t.schedule)}</td>
      ${canEdit ? `<td class="actions"><form method="POST" action="/api/v1/facilities/pm-done" class="inline-form"><input type="hidden" name="id" value="${t.id}"><input type="date" name="done_on" value="${view.today}" aria-label="Done on"><button type="submit" class="button-outline">Mark done</button></form> <a class="edit-link" href="${link('preventive-maintenance', { edit: String(t.id) })}">Edit</a></td>` : ''}
    </tr>`).join('');
  return `${top}
    ${editing ? `<div class="panel panel-spaced"><div class="panel-head"><h2>Edit: ${e(editing.name)}</h2><a href="${link('preventive-maintenance')}">Cancel</a></div>${pmForm(view, editing)}</div>` : ''}
    <div class="panel list-panel">${view.pmTasks.length
    ? `<div class="table-scroll"><table class="pm-table"><thead><tr><th>Task</th><th>Every</th><th>Last done</th><th>Next due</th><th>Who</th><th>Status</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div><p class="muted-line">Marking a task done logs it to service history and schedules the next one.</p>`
    : emptyNote('No recurring maintenance on record yet. Add filter changes, inspections, and service contracts to get reminders on the Overview.')}</div>
    ${canEdit ? `<details class="panel panel-spaced edit-panel"${view.pmTasks.length ? '' : ' open'}><summary>Add a recurring task</summary>${pmForm(view)}</details>` : ''}`;
}

// ── Entry point ───────────────────────────────────────────────────────────────────────────────

export function renderFacilitiesPage(pageId, { view, params, canEdit, status }) {
  const body = pageId === 'assets' ? renderAssets(view, params, canEdit)
    : pageId === 'service-history' ? renderService(view, params, canEdit)
      : pageId === 'capital-projects' ? renderProjects(view, params, canEdit)
        : pageId === 'preventive-maintenance' ? renderPm(view, params, canEdit)
          : renderOverview(view);
  return `<section class="facilities" aria-label="Facilities">${statusBanner(status)}${body}</section>`;
}

export const FACILITIES_STYLES = `
    .chip-row { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
    .chip { padding:6px 12px; border:1px solid var(--line); border-radius:999px; background:#fff; color:var(--ink); font-size:13px; text-decoration:none; }
    .chip:hover { border-color:#C9D0DC; color:var(--navy); }
    .chip.is-on { background:var(--navy); border-color:var(--navy); color:#fff; }
    .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap; }
    .pill-bad { background:#FBEAE6; color:var(--red); }
    .pill-warn { background:#FBF1DC; color:var(--gold-ink); }
    .pill-good { background:#E6F2EC; color:var(--green); }
    .pill-info { background:#EAF3F8; color:var(--teal); }
    .pill-plain { background:var(--page); color:var(--muted); }
    .tone-info { color:var(--teal) !important; }
    .tone-ok { color:var(--muted); }
    .tone-bg-bad { background:var(--red); }
    .tone-bg-warn { background:#8A611C; }
    .tone-bg-ok { background:var(--teal); }
    .panel-head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .panel-head h3 { margin:0; font-size:17px; }
    .panel-head a, .muted { font-size:13px; color:var(--muted); }
    .panel-spaced { margin-top:14px; }
    .list-panel { margin-top:14px; padding:6px 22px; }
    .row-list { list-style:none; margin:0; padding:0; }
    .row-list > li { display:flex; justify-content:space-between; gap:14px; padding:12px 0; border-bottom:1px solid var(--line-soft); }
    .row-list > li:last-child { border-bottom:0; }
    .row-list b { display:block; font-weight:600; font-size:14px; color:var(--ink); }
    .row-list small { display:block; margin-top:2px; color:var(--muted); font-size:12px; }
    .row-list .right { text-align:right; flex-shrink:0; display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
    .row-link { display:flex; justify-content:space-between; gap:14px; width:100%; color:inherit; text-decoration:none; }
    .row-link:hover b { color:var(--gold-ink); }
    .strong-small { font-size:12.5px; font-weight:600; }
    .muted-row { color:var(--muted); font-size:14px; }
    .life-row { display:block !important; }
    .life-head { display:flex; justify-content:space-between; gap:10px; font-size:14px; }
    .life-head span { color:var(--muted); font-size:13px; }
    .life-bar { height:6px; margin:8px 0 6px; border-radius:3px; background:var(--line-soft); overflow:hidden; }
    .life-bar span { display:block; height:100%; border-radius:3px; }
    .bar-chart { display:flex; align-items:flex-end; gap:24px; height:210px; padding:10px 20px 0; border-bottom:1px solid #D5DAE3; }
    .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:6px; height:100%; }
    .bar { width:min(44px,60%); background:var(--navy); border-radius:3px 3px 0 0; }
    .bar-value { font-size:12px; color:var(--muted); }
    .bar-label { position:relative; top:26px; font-size:12px; color:var(--muted); }
    .bar-chart + * { margin-top:30px; }
    .panel .bar-chart { margin-bottom:24px; }
    .service-row .date { width:7.5rem; flex-shrink:0; color:var(--muted); font-size:14px; }
    .service-row .grow { flex:1; min-width:0; }
    .inline-form { display:inline-flex; gap:6px; align-items:center; margin:0; }
    .link-button { margin:0; padding:0; background:none; color:var(--muted); font-size:12px; font-weight:500; text-decoration:underline; }
    .link-button:hover { background:none; color:var(--red); }
    .button-outline { margin:0; padding:6px 14px; background:#fff; border:1px solid var(--navy); color:var(--navy); font-size:13px; }
    .button-outline:hover { background:var(--hover); }
    .facility-form { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px 14px; margin-top:14px; }
    .facility-form .field { margin-top:0; }
    .facility-form .field span { color:var(--muted); font-size:12.5px; font-weight:600; }
    .field-wide { grid-column:1 / -1; }
    .form-actions { grid-column:1 / -1; }
    .form-actions button { margin-top:4px; }
    details.edit-panel > summary, details.edit-inline > summary { cursor:pointer; color:var(--navy); font-weight:600; font-size:14px; }
    details.edit-inline { margin-top:10px; }
    details.edit-inline > summary { font-size:13px; font-weight:500; color:var(--muted); }
    .empty-note { padding:18px 0; color:var(--muted); font-size:14px; }
    .muted-line { color:var(--muted); font-size:12.5px; margin:10px 0; }
    .crumb { margin:14px 0 10px; font-size:13px; }
    .fact-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px 20px; margin:16px 0 0; }
    .fact-grid.two { grid-template-columns:1fr 1fr; }
    .fact-grid dt { color:var(--muted); font-size:12px; }
    .fact-grid dd { margin:2px 0 0; font-size:14px; color:var(--ink); }
    .project-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr)); gap:14px; margin-top:14px; }
    .project-card { padding:20px 22px; border:1px solid var(--line); border-radius:10px; background:#fff; }
    .project-card .scope { margin:4px 0 0; font-size:13px; }
    .project-cost { display:block; margin:12px 0 14px; padding-bottom:14px; border-bottom:1px solid var(--line-soft); font-family:"Outfit",sans-serif; font-weight:500; font-size:26px; color:var(--navy); }
    .table-scroll { overflow-x:auto; }
    .pm-table th, .pm-table td { text-align:left !important; vertical-align:middle; }
    .pm-table th { background:none; border-bottom:1px solid var(--navy); font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; }
    .pm-table td small { display:block; color:var(--muted); font-size:12px; }
    .pm-table .row-alert td { background:#FBF1EE; }
    .pm-table .actions { white-space:nowrap; }
    .pm-table .actions input[type=date] { padding:5px 6px; font-size:12.5px; }
    .edit-link { margin-left:8px; font-size:13px; }
    .plain-link { color:inherit; text-decoration:none; }
    .plain-link:hover { color:var(--gold-ink); text-decoration:underline; }
    .file-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(125px,1fr)); gap:12px; margin-top:14px; }
    .file-tile { margin:0; min-width:0; }
    .file-open { display:flex; align-items:center; justify-content:center; aspect-ratio:4 / 3; border:1px solid var(--line); border-radius:8px; background:var(--page); overflow:hidden; text-decoration:none; }
    .file-open img { width:100%; height:100%; object-fit:cover; display:block; }
    .doc-badge { padding:6px 12px; border:1px solid var(--navy); border-radius:6px; color:var(--navy); font-weight:600; font-size:13px; letter-spacing:.04em; }
    .file-tile figcaption { margin-top:6px; font-size:13px; overflow-wrap:anywhere; }
    .file-tile figcaption a { color:var(--ink); text-decoration:none; font-weight:500; }
    .file-tile figcaption small { display:block; color:var(--muted); font-size:12px; margin:2px 0; }
    .upload-form { margin-top:18px; padding-top:16px; border-top:1px solid var(--line-soft); }
    .upload-form input[type=file] { padding:8px 0; border:0; background:none; }
    .thumb-row { display:flex; gap:8px; margin:12px 0 0; }
    .thumb-row img { width:64px; height:48px; object-fit:cover; border-radius:6px; border:1px solid var(--line); display:block; }
    .card-links { margin:10px 0 0; font-size:13px; }
`;
