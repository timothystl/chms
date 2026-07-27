import { describe, it, expect } from 'vitest';
import {
  resolveRolePermissions, permissionsForRole, DEFAULT_ROLE_PERMISSIONS,
  ROLE_PERMISSION_ROLES, ROLE_PERMISSION_ITEM_KEYS, ROLE_PERMISSION_LEVELS,
} from '../src/api-utils.js';

describe('resolveRolePermissions', () => {
  it('returns the exact defaults when nothing is stored', () => {
    expect(resolveRolePermissions(null)).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('returns defaults for an empty string / undefined / malformed JSON', () => {
    expect(resolveRolePermissions('')).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions(undefined)).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions('{not valid json')).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('defaults preserve historical access exactly', () => {
    const d = DEFAULT_ROLE_PERMISSIONS;
    // finance = giving/tuition/finance edit + reports view
    expect(d.finance).toEqual({ giving: 'edit', tuitionaid: 'edit', finance: 'edit', attendance: 'none', followups: 'none', audit: 'none', register: 'none', reports: 'view' });
    // staff = attendance/follow-ups/register edit + audit/reports view
    expect(d.staff.attendance).toBe('edit');
    expect(d.staff.register).toBe('edit');
    expect(d.staff.audit).toBe('view');
    expect(d.staff.giving).toBe('none');
    // office = register only
    expect(d.office.register).toBe('edit');
    expect(d.office.reports).toBe('none');
    // member = nothing extra
    expect(d.member.reports).toBe('none');
  });

  it('applies a partial override without disturbing other items/roles', () => {
    const perms = resolveRolePermissions(JSON.stringify({ office: { reports: 'view' } }));
    expect(perms.office.reports).toBe('view');
    // untouched office items keep their default
    expect(perms.office.register).toBe('edit');
    expect(perms.office.giving).toBe('none');
    // other roles unaffected
    expect(perms.finance).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(perms.staff).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
  });

  it('clamps read-only items (reports/audit) to view even if edit is requested', () => {
    const perms = resolveRolePermissions(JSON.stringify({ staff: { reports: 'edit', audit: 'edit' } }));
    expect(perms.staff.reports).toBe('view');
    expect(perms.staff.audit).toBe('view');
  });

  it('coerces an unknown level string to none', () => {
    const perms = resolveRolePermissions(JSON.stringify({ office: { giving: 'superuser' } }));
    expect(perms.office.giving).toBe('none');
  });

  it('member can never be granted edit and only the safe reports item is honored', () => {
    const perms = resolveRolePermissions(JSON.stringify({
      member: { reports: 'edit', giving: 'edit', attendance: 'view', register: 'edit' },
    }));
    expect(perms.member.reports).toBe('view');   // edit clamped to view
    expect(perms.member.giving).toBe('none');    // not a member-safe item
    expect(perms.member.attendance).toBe('none');
    expect(perms.member.register).toBe('none');
  });

  it('migrates a legacy boolean matrix forward, preserving effective access', () => {
    const legacy = {
      finance: { finance: true,  staff: false, register: false, reports: true },
      staff:   { finance: false, staff: true,  register: true,  reports: true },
      office:  { finance: false, staff: false, register: true,  reports: false },
    };
    const perms = resolveRolePermissions(JSON.stringify(legacy));
    expect(perms.finance).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(perms.staff).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
    expect(perms.office).toEqual(DEFAULT_ROLE_PERMISSIONS.office);
  });

  it('every role in the defaults has every item defined with a valid level', () => {
    for (const role of ROLE_PERMISSION_ROLES) {
      for (const item of ROLE_PERMISSION_ITEM_KEYS) {
        expect(ROLE_PERMISSION_LEVELS).toContain(DEFAULT_ROLE_PERMISSIONS[role][item]);
      }
    }
  });
});

describe('permissionsForRole', () => {
  const perms = resolveRolePermissions(null);

  it('admin always gets each item at its ceiling (edit where editable, view for read-only)', () => {
    const a = permissionsForRole(perms, 'admin');
    expect(a.giving).toBe('edit');
    expect(a.register).toBe('edit');
    expect(a.reports).toBe('view');   // read-only item
    expect(a.audit).toBe('view');
  });

  it('finance/staff/office/member get their resolved matrix entry', () => {
    expect(permissionsForRole(perms, 'finance')).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(permissionsForRole(perms, 'staff')).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
    expect(permissionsForRole(perms, 'office')).toEqual(DEFAULT_ROLE_PERMISSIONS.office);
    expect(permissionsForRole(perms, 'member')).toEqual(DEFAULT_ROLE_PERMISSIONS.member);
  });

  it('an unknown/garbage role string gets all-none rather than throwing', () => {
    const r = permissionsForRole(perms, 'not_a_real_role');
    for (const item of ROLE_PERMISSION_ITEM_KEYS) expect(r[item]).toBe('none');
  });

  it('reflects a granted override for a role that did not have it by default', () => {
    const granted = resolveRolePermissions(JSON.stringify({ office: { attendance: 'view' } }));
    expect(permissionsForRole(granted, 'office').attendance).toBe('view');
    // and edit for an item that was none by default
    const granted2 = resolveRolePermissions(JSON.stringify({ finance: { register: 'edit' } }));
    expect(permissionsForRole(granted2, 'finance').register).toBe('edit');
  });
});
