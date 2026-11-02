const express = require('express');
const { HttpError, asyncRoute } = require('../http');
const { validPhone, authPhone } = require('../phone');
const { ACCOUNT_ROLES } = require('../middleware/auth');
const { passwordProblem, audit } = require('../accounts');
const { AUTH_LIMITS } = require('../rateLimit');

const CODE_RE = /^\d{6,10}$/;
const USERNAME_RE = /^[a-z][a-z0-9_.-]{2,49}$/;

function publicProfile(profile) {
  return {
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
}

function sessionResponse(session, profile) {
  return {
    user: profile,
    needs_profile: profile.role === 'citizen' && !profile.full_name,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    },
  };
}

function createAuthRouter({ pool, authClientFactory, authAdmin, auth, limit }) {
  const router = express.Router();

  async function assertCitizenActive(phone) {
    const { rows } = await pool.query(
      `SELECT is_active FROM public.profiles WHERE phone = $1 AND role = 'citizen'`,
      [phone]
    );
    if (rows[0]?.is_active === false) throw new HttpError(403, 'account disabled');
  }

  async function syncProfile(authUser) {
    const phone = authPhone(authUser?.phone);
    if (!authUser?.id || !phone) {
      throw new HttpError(502, 'invalid auth response');
    }
    const { rows } = await pool.query(
      `INSERT INTO public.profiles (id, phone, role)
       VALUES ($1, $2, 'citizen')
       ON CONFLICT (id) DO UPDATE SET phone = EXCLUDED.phone
       WHERE public.profiles.role = 'citizen'
       RETURNING id, full_name, phone, staff_username, role, is_active`,
      [authUser.id, phone]
    );
    if (!rows[0]) throw new HttpError(401, 'invalid session');
    if (rows[0].is_active === false) throw new HttpError(403, 'account disabled');
    return publicProfile(rows[0]);
  }

  async function staffProfile(authUser) {
    if (!authUser?.id || !authUser.email) throw new HttpError(401, 'invalid session');
    const { rows } = await pool.query(
      `SELECT id, full_name, phone, staff_username, staff_auth_email, role, agency,
         is_active, must_change_password, is_owner, admin_permissions
       FROM public.profiles WHERE id = $1 AND role = ANY($2::public.user_role[])`,
      [authUser.id, ACCOUNT_ROLES]
    );
    const profile = rows[0];
    if (!profile || profile.staff_auth_email !== authUser.email.toLowerCase()) {
      throw new HttpError(401, 'invalid session');
    }
    if (profile.is_active === false) throw new HttpError(403, 'account disabled');
    return publicProfile(profile);
  }

  router.post('/otp/send', limit(AUTH_LIMITS.otpSend), asyncRoute(async (req, res) => {
    const { phone } = req.body || {};
    if (!validPhone(phone)) throw new HttpError(400, 'phone must use international format');
    await assertCitizenActive(phone);

    const { error } = await authClientFactory().auth.signInWithOtp({ phone });
    if (error) {
      if (error.status === 429) throw new HttpError(429, 'try again later');
      throw new HttpError(400, 'could not send code');
    }
    res.json({ message: 'verification code requested' });
  }));

  router.post('/otp/verify', limit(AUTH_LIMITS.otpVerify), asyncRoute(async (req, res) => {
    const { phone, code } = req.body || {};
    if (!validPhone(phone) || typeof code !== 'string' || !CODE_RE.test(code)) {
      throw new HttpError(400, 'invalid phone or code');
    }
    await assertCitizenActive(phone);

    const { data, error } = await authClientFactory().auth.verifyOtp({
      phone,
      token: code,
      type: 'sms',
    });
    if (error || !data?.session || authPhone(data.user?.phone) !== phone) {
      throw new HttpError(401, 'invalid or expired code');
    }

    const profile = await syncProfile(data.user);
    res.json(sessionResponse(data.session, profile));
  }));

  router.post('/staff/login', limit(AUTH_LIMITS.staffLogin), asyncRoute(async (req, res) => {
    const { username, password } = req.body || {};
    const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
    if (!USERNAME_RE.test(normalized) || typeof password !== 'string' || !password) {
      throw new HttpError(401, 'invalid credentials');
    }
    const { rows } = await pool.query(
      `SELECT id, staff_auth_email FROM public.profiles
       WHERE staff_username = $1 AND role = ANY($2::public.user_role[])`,
      [normalized, ACCOUNT_ROLES]
    );
    if (!rows[0]) throw new HttpError(401, 'invalid credentials');
    const { data, error } = await authClientFactory().auth.signInWithPassword({
      email: rows[0].staff_auth_email,
      password,
    });
    if (error || !data?.session || data.user?.id !== rows[0].id) {
      throw new HttpError(401, 'invalid credentials');
    }
    let profile;
    try {
      profile = await staffProfile(data.user);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) {
        throw new HttpError(401, 'invalid credentials');
      }
      throw error;
    }
    res.json(sessionResponse(data.session, profile));
  }));

  router.post('/refresh', asyncRoute(async (req, res) => {
    const { refresh_token: refreshToken } = req.body || {};
    if (typeof refreshToken !== 'string' || !refreshToken) {
      throw new HttpError(400, 'refresh token required');
    }
    const { data, error } = await authClientFactory().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data?.session || !data.user?.id) {
      throw new HttpError(401, 'invalid session');
    }
    const profile = data.user.phone
      ? await syncProfile(data.user)
      : await staffProfile(data.user);
    res.json(sessionResponse(data.session, profile));
  }));

  router.get('/me', auth(null, { allowPasswordChange: true }), (req, res) => res.json({ user: req.user }));

  router.patch('/me', auth('citizen'), asyncRoute(async (req, res) => {
    const { full_name: fullName } = req.body || {};
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 100) {
      throw new HttpError(400, 'full_name must be 1 to 100 characters');
    }
    const { rows } = await pool.query(
      `UPDATE public.profiles SET full_name = $1 WHERE id = $2
       RETURNING id, full_name, phone, role`,
      [fullName.trim(), req.user.id]
    );
    res.json({ user: rows[0] });
  }));

  // Dashboard accounts change their own password: required after a temporary
  // password, optional at any other time. The administrator never learns it.
  router.post('/password', auth(null, { allowPasswordChange: true }),
    limit(AUTH_LIMITS.passwordChange), asyncRoute(async (req, res) => {
    if (req.user.role === 'citizen') throw new HttpError(403, 'forbidden');
    const { current_password: current, new_password: next } = req.body || {};
    if (typeof current !== 'string' || !current) {
      throw new HttpError(400, 'current password required');
    }
    const problem = passwordProblem(next, current);
    if (problem) throw new HttpError(400, problem);

    const { rows } = await pool.query(
      'SELECT staff_auth_email FROM public.profiles WHERE id = $1', [req.user.id]
    );
    const email = rows[0]?.staff_auth_email;
    const check = await authClientFactory().auth.signInWithPassword({ email, password: current });
    // 400 rather than 401, so the dashboard does not treat it as an expired session.
    if (check.error || check.data?.user?.id !== req.user.id) {
      throw new HttpError(400, 'current password incorrect');
    }
    const updated = await authAdmin.updateUserById(req.user.id, { password: next });
    if (updated.error) throw new HttpError(502, 'auth service unavailable');
    const signedIn = await authClientFactory().auth.signInWithPassword({ email, password: next });
    if (signedIn.error || !signedIn.data?.session) {
      throw new HttpError(502, 'auth service unavailable');
    }
    // End every other session, including any opened with the old password.
    const ended = await authAdmin.signOut(signedIn.data.session.access_token, 'others');
    if (ended?.error) console.error('Could not end other sessions', ended.error);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE public.profiles SET must_change_password = FALSE,
           password_changed_at = NOW() WHERE id = $1`, [req.user.id]
      );
      await audit(client, req.user.id, 'password_changed', req.user.id,
        { forced: req.user.must_change_password });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.json(sessionResponse(signedIn.data.session,
      { ...req.user, must_change_password: false }));
  }));

  return router;
}

module.exports = { createAuthRouter };
