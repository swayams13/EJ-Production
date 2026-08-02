// Mirrors backend/app/auth/rbac.py's MANAGEMENT role list. Login stores the
// real role string (e.g. "Production Manager") in localStorage, never the
// literal "MANAGEMENT" — check membership in this list, not equality.
const MANAGEMENT_ROLES = ["Developer", "GM", "Admin", "Production Manager", "CEO", "MD"];

export function isManagementRole(role: string | null): boolean {
  return !!role && MANAGEMENT_ROLES.includes(role);
}
