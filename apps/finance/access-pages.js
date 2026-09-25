// Accounts & Data → Access & roles (v3 design). Roles and permissions live in Connect
// (connect.finance-access-roles.v1); this page shows them and what each role can open and change
// in Finance, worked out with the same checks Finance applies on every page and save.
import { escapeHtml as e } from './render-helpers.js';
import { FINANCE_PARITY_SECTIONS } from './parity-manifest.js';
import { roleCanAccessSection } from './connect-role-client.js';
import { canEditFacilities } from './facilities-routes.js';
import { canEditPlanning } from './planning-scenarios-service.js';

const ROLE_LABELS = { admin: 'Admin', finance: 'Finance', council: 'Council', compensation: 'Compensation', staff: 'Staff', member: 'Member' };
const LEVEL_LABELS = { none: '—', anon: 'Totals only', view: 'View', edit: 'Edit' };

// What each role can change in Finance. Each line mirrors the check on that save; the server
// still re-checks every save against the person's real Connect role.
export function financeChanges(role, permissions = {}) {
  if (role === 'admin') return ['Everything'];
  const verified = { ok: true, role, permissions };
  const out = [];
  if (permissions.giving === 'edit') out.push('Gift entry and giving nudges');
  if (role === 'council' && permissions.budget === 'edit') out.push('Their own copy of budget lines');
  if (canEditPlanning(verified)) out.push('Planning scenarios');
  if (role === 'compensation') out.push('Compensation plan');
  if (role === 'council' && permissions.compensation === 'edit') out.push('Their own compensation draft');
  if (canEditFacilities(verified)) out.push('Facilities records');
  return out.length ? out : ['Nothing'];
}

export function financeSections(role, permissions = {}) {
  if (role === 'admin') return ['Everything'];
  const groups = [];
  for (const section of FINANCE_PARITY_SECTIONS) {
    if (roleCanAccessSection(role, section, permissions) && !groups.includes(section.group || section.label)) groups.push(section.group || section.label);
  }
  return groups.length ? groups : ['Nothing'];
}

export function renderAccessPage({ result }) {
  if (!result.ok) return `<p class="status status-error">Roles could not be read from Connect: ${e(result.message)}</p>`;
  const { roles, items, names_included: named } = result.data;
  const rows = roles.map((r) => {
    const people = named
      ? (r.people.length ? e(r.people.join(', ')) : '<span class="tone-muted">Nobody</span>')
      : `${r.people_count} ${r.people_count === 1 ? 'person' : 'people'}`;
    return `<tr><td><b>${ROLE_LABELS[r.role] || e(r.role)}</b></td><td>${people}</td><td>${e(financeSections(r.role, r.permissions).join(', '))}</td><td>${e(financeChanges(r.role, r.permissions).join('; '))}</td></tr>`;
  }).join('');
  const matrix = `<tr><th>Connect permission</th>${roles.map((r) => `<th>${ROLE_LABELS[r.role] || e(r.role)}</th>`).join('')}</tr>`;
  const matrixRows = items.map((item) => `<tr><td>${e(item.label)}</td>${roles.map((r) => {
    const level = r.permissions[item.key] || 'none';
    return `<td class="acc-level acc-${level}">${LEVEL_LABELS[level] || e(level)}</td>`;
  }).join('')}</tr>`).join('');
  return `<p class="lede">Roles come from Connect. Finance re-checks the signed-in person’s role on every page and every save, so this page describes access; it does not grant it.</p>
    <div class="panel panel-spaced list-panel"><h2>Access by role</h2><div class="table-scroll"><table class="pm-table"><thead><tr><th>Role</th><th>People</th><th>Can see in Finance</th><th>Can change in Finance</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${named ? '' : '<p class="muted-line">Names of the people in each role are shown to admins only.</p>'}</div>
    <div class="panel panel-spaced list-panel"><h2>Connect permissions</h2><div class="table-scroll"><table class="pm-table acc-matrix"><thead>${matrix}</thead><tbody>${matrixRows}</tbody></table></div>
      <p class="muted-line">“Totals only” on Giving means the role sees what was given, never who gave it. Admins change roles and permissions in <a href="https://connect.timothystl.org/#settings">Connect → Settings</a>.</p></div>`;
}

export const ACCESS_STYLES = `
    .acc-matrix td:not(:first-child), .acc-matrix th:not(:first-child) { text-align:center; }
    .acc-level.acc-none { color:#9CA3AF; }
    .acc-level.acc-edit { color:#1F6F43; font-weight:600; }
    .acc-level.acc-anon { color:#9A6B12; }
`;
