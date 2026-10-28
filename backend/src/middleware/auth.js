const { HttpError, asyncRoute } = require('../http');
const { authPhone } = require('../phone');

const ACCOUNT_ROLES = ['staff', 'field_worker', 'admin'];
// An administrator also does everything a staff member does. Field-worker
// routes stay limited to field workers, so one person cannot both submit
// finished work and confirm it.
const ROLE_ACCESS = { staff: ['staff', 'admin'] };

function createAuthMiddleware({ pool, authClientFactory }) {
  return (role, { allowPasswordChange = false } = {}) => asyncRoute(async (req, res, next) => {
    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    if (!match) throw new HttpError(401, 'authentication required');

    const { data, error } = await authClientFactory().auth.getUser(match[1]);
    if (error || !data?.user?.id) {
      throw new HttpError(401, 'invalid session');
    }

    const { rows } = await pool.query(
      `SELECT id, full_name, phone, staff_username, staff_auth_email, role, agency,
         is_active, must_change_password, is_owner, admin_permissions
       FROM public.profiles WHERE id = $1`,
      [data.user.id]
    );
    const profile = rows[0];
    const citizenValid = profile?.role === 'citizen' && !!authPhone(data.user.phone)
      && profile.phone === authPhone(data.user.phone);
    const staffValid = ACCOUNT_ROLES.includes(profile?.role) && !!data.user.email
      && profile.staff_auth_email === data.user.email.toLowerCase();
    if (!citizenValid && !staffValid) throw new HttpError(401, 'invalid session');
    // Checked on every request, so deactivation takes effect before the token expires.
    if (profile.is_active === false) throw new HttpError(403, 'account disabled');
    if (profile.must_change_password === true && !allowPasswordChange) {
      throw new HttpError(403, 'password change required');
    }
    if (role && !(ROLE_ACCESS[role] || [role]).includes(profile.role)) {
      throw new HttpError(403, 'forbidden');
    }

    req.user = {
      id: profile.id,
      full_name: profile.full_name,
      phone: profile.phone,
      staff_username: profile.staff_username || null,
      role: profile.role,
      agency: profile.agency || null,
      must_change_password: profile.must_change_password === true,
      is_owner: profile.is_owner === true,
      admin_permissions: Array.isArray(profile.admin_permissions) ? profile.admin_permissions : [],
    };
    next();
  });
}

module.exports = { createAuthMiddleware, ACCOUNT_ROLES };
