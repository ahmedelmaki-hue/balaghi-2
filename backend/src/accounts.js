const crypto = require('node:crypto');

const PASSWORD_MIN = 10;
// Supabase Auth hashes passwords with bcrypt, which reads at most 72 bytes.
const PASSWORD_MAX = 72;
const BAN_FOREVER = '876000h';
const ADMIN_PERMISSIONS = ['manage_staff', 'manage_workers', 'manage_citizens', 'view_audit'];
// The permission that manages each kind of dashboard account. Administrator
// accounts have none: only an owner manages them.
const ROLE_PERMISSION = { staff: 'manage_staff', field_worker: 'manage_workers' };

// An owner holds every permission; other administrators hold what an owner granted.
function hasPermission(user, permission) {
  return user.role === 'admin' && (user.is_owner || user.admin_permissions.includes(permission));
}

function canManageRole(user, role) {
  return role === 'admin' ? user.role === 'admin' && user.is_owner
    : hasPermission(user, ROLE_PERMISSION[role]);
}

function passwordProblem(value, previous) {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN ||
      Buffer.byteLength(value) > PASSWORD_MAX) {
    return `password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`;
  }
  if (previous !== undefined && value === previous) return 'new password must differ';
  return null;
}

// Shown once to the administrator; the owner must replace it at first sign-in.
function temporaryPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

async function audit(db, actorId, action, targetId, details = {}) {
  await db.query(
    `INSERT INTO public.admin_audit_log (actor_id, action, target_id, details)
     VALUES ($1, $2, $3, $4)`,
    [actorId, action, targetId, JSON.stringify(details)]
  );
}

module.exports = {
  passwordProblem, temporaryPassword, audit, BAN_FOREVER, ADMIN_PERMISSIONS,
  hasPermission, canManageRole,
};
