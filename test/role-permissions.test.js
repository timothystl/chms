import { describe, it, expect } from 'vitest';
import { resolveRolePermissions, permissionsForRole, DEFAULT_ROLE_PERMISSIONS, ROLE_PERMISSION_ROLES, ROLE_PERMISSION_KEYS } from '../src/api-utils.js';

describe('resolveRolePermissions', () => {
  it('returns the exact historical defaults when nothing is stored', () => {
    const perms = resolveRolePermissions(null);
    expect(perms).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('returns defaults for an empty string / undefined / malformed JSON', () => {
    expect(resolveRolePermissions('')).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions(undefined)).toEqual(DEFAULT_ROLE_PERMISSIONS);
    expect(resolveRolePermissions('{not valid json')).toEqual(DEFAULT_ROLE_PERMISSIONS);
  });

  it('applies a partial override without disturbing other keys/roles', () => {
    const perms = resolveRolePermissions(JSON.stringify({ staff: { finance: true } }));
    expect(perms.staff.finance).toBe(true);
    // untouched staff keys keep their default
    expect(perms.staff.staff).toBe(true);
    expect(perms.staff.register).toBe(true);
    expect(perms.staff.reports).toBe(true);
    // other roles unaffected
    expect(perms.finance).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(perms.office).toEqual(DEFAULT_ROLE_PERMISSIONS.office);
  });

  it('a full override matrix replaces every key for every role listed', () => {
    const override = {
      finance: { finance: true, staff: true, register: true, reports: true },
      office:  { finance: false, staff: false, register: false, reports: true },
    };
    const perms = resolveRolePermissions(JSON.stringify(override));
    expect(perms.finance).toEqual(override.finance);
    expect(perms.office).toEqual(override.office);
    // staff untouched by this particular override, still default
    expect(perms.staff).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
  });

  it('every role in the defaults has every permission key defined', () => {
    for (const role of ROLE_PERMISSION_ROLES) {
      for (const key of ROLE_PERMISSION_KEYS) {
        expect(typeof DEFAULT_ROLE_PERMISSIONS[role][key]).toBe('boolean');
      }
    }
  });
});

describe('permissionsForRole', () => {
  const perms = resolveRolePermissions(null);

  it('admin always gets full access regardless of the stored matrix', () => {
    expect(permissionsForRole(perms, 'admin')).toEqual({ finance: true, staff: true, register: true, reports: true });
    // even if the matrix somehow had an "admin" key (it never should), admin bypasses it
    const weirdPerms = resolveRolePermissions(JSON.stringify({ admin: { finance: false } }));
    expect(permissionsForRole(weirdPerms, 'admin')).toEqual({ finance: true, staff: true, register: true, reports: true });
  });

  it('member gets all-false — a structurally different, non-configurable view', () => {
    expect(permissionsForRole(perms, 'member')).toEqual({ finance: false, staff: false, register: false, reports: false });
  });

  it('finance/staff/office get their resolved matrix entry', () => {
    expect(permissionsForRole(perms, 'finance')).toEqual(DEFAULT_ROLE_PERMISSIONS.finance);
    expect(permissionsForRole(perms, 'staff')).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
    expect(permissionsForRole(perms, 'office')).toEqual(DEFAULT_ROLE_PERMISSIONS.office);
  });

  it('an unknown/garbage role string gets all-false rather than throwing', () => {
    expect(permissionsForRole(perms, 'not_a_real_role')).toEqual({ finance: false, staff: false, register: false, reports: false });
  });

  it('reflects a granted override for a role that did not have it by default', () => {
    const granted = resolveRolePermissions(JSON.stringify({ staff: { finance: true } }));
    expect(permissionsForRole(granted, 'staff')).toEqual({ finance: true, staff: true, register: true, reports: true });
  });
});
