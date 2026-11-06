const express = require('express');
const { HttpError, asyncRoute } = require('../http');
const { optionalChoice, pagination } = require('../params');
const { ACCOUNT_ROLES } = require('../middleware/auth');
const {
  temporaryPassword, audit, BAN_FOREVER, ADMIN_PERMISSIONS, hasPermission, canManageRole,
} = require('../accounts');

const AGENCIES = ['public_services', 'water_sewer', 'roads_maintenance'];
const USERNAME_RE = /^[a-z][a-z0-9_.-]{2,49}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_ACTIONS = ['account_created', 'account_updated', 'account_deactivated',
  'account_reactivated', 'password_reset', 'password_changed'];
const ACCOUNT_COLUMNS = `p.id, p.full_name, p.staff_username, p.role, p.agency,
  p.is_active, p.deactivated_reason, p.deactivated_at, p.must_change_password,
  p.password_changed_at, p.is_owner, p.admin_permissions, p.contact_phone, p.created_at`;
const OWNER_LOCKED = 'owner accounts are managed on the server';

function profileId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new HttpError(400, 'invalid account id');
  }
  return value.toLowerCase();
}

function fullName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new HttpError(400, 'full_name must be 1 to 100 characters');
  }
  return value.trim();
}

// A Libyan mobile number in any common form (0912345678, 912345678, 218..., +218...),
// stored as +2189XXXXXXXX. It is for contacting the account holder, not for sign-in.
function contactPhone(value) {
  const digits = typeof value === 'string' ? value.replace(/[\s()-]/g, '') : '';
  const national = digits.replace(/^(\+?218|0)/, '');
  if (!/^9\d{8}$/.test(national)) {
    throw new HttpError(400, 'contact_phone must be a Libyan mobile number');
  }
  return `+218${national}`;
}

function searchText(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) throw new HttpError(400, 'invalid search');
  return value.trim() || null;
}

function likePattern(value) {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

function reason(value, required) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, 'reason required (1 to 500 characters)');
    return null;
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500) {
    throw new HttpError(400, 'reason required (1 to 500 characters)');
  }
  return value.trim();
}

function permissionsInput(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => !ADMIN_PERMISSIONS.includes(item)) ||
      new Set(value).size !== value.length) {
    throw new HttpError(400, 'invalid permissions');
  }
  return [...value].sort();
}

function forbidden() {
  return new HttpError(403, 'forbidden');
}

// Agency belongs to field workers only, and every field worker needs one.
function agencyFor(role, value) {
  if (role !== 'field_worker') {
    if (value !== undefined && value !== null && value !== '') {
      throw new HttpError(400, 'agency applies to field workers only');
    }
    return null;
  }
  if (!AGENCIES.includes(value)) throw new HttpError(400, 'field workers need a valid agency');
  return value;
}

function createAdminRouter({ pool, auth, authAdmin, staffEmailDomain }) {
  const router = express.Router();
  router.use(auth('admin'));
  const requirePermission = (permission) => (req, res, next) =>
    next(hasPermission(req.user, permission) ? undefined : forbidden());

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function setBan(id, active) {
    const { error } = await authAdmin.updateUserById(id, {
      ban_duration: active ? 'none' : BAN_FOREVER,
    });
    // The database flag is authoritative and checked on every request.
    if (error) console.error('Could not update Auth ban', error);
  }

  // A worker who leaves or changes job must not keep reports nobody else can take.
  // Claimed but unstarted reports and pre-approval checks return to the agency queue.
  async function releaseUnstartedWork(db, workerId) {
    const reports = await db.query(
      `UPDATE public.reports SET assigned_worker_id = NULL, accepted_at = NULL,
         updated_at = NOW()
       WHERE assigned_worker_id = $1 AND status = 'new' AND work_started_at IS NULL
       RETURNING id`, [workerId]
    );
    const checks = await db.query(
      `UPDATE public.report_verifications SET claimed_by = NULL, claimed_at = NULL
       WHERE claimed_by = $1 AND result IS NULL RETURNING id`, [workerId]
    );
    const inProgress = await db.query(
      `SELECT COUNT(*)::int AS total FROM public.reports
       WHERE assigned_worker_id = $1 AND status = 'in_progress'`, [workerId]
    );
    return {
      released_reports: reports.rows.map((row) => String(row.id)),
      released_verifications: checks.rows.length,
      in_progress_reports: inProgress.rows[0].total,
    };
  }

  async function lockAccount(db, id) {
    const { rows } = await db.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM public.profiles p
       WHERE p.id = $1 AND p.role = ANY($2::public.user_role[]) FOR UPDATE`,
      [id, ACCOUNT_ROLES]
    );
    if (!rows[0]) throw new HttpError(404, 'not found');
    return rows[0];
  }

  router.get('/users', asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const role = optionalChoice(req.query.role, ACCOUNT_ROLES, 'role');
    const status = optionalChoice(req.query.status, ['active', 'inactive'], 'status');
    const search = searchText(req.query.search);
    // Each administrator sees only the kinds of accounts they may manage.
    const visible = ACCOUNT_ROLES.filter((item) => canManageRole(req.user, item));
    if (!visible.length || (role && !visible.includes(role))) throw forbidden();
    const params = [visible];
    const conditions = ['p.role = ANY($1::public.user_role[])'];
    if (role) { params.push(role); conditions.push(`p.role = $${params.length}`); }
    if (status) conditions.push(status === 'active' ? 'p.is_active' : 'NOT p.is_active');
    if (search) {
      params.push(likePattern(search));
      conditions.push(`(p.full_name ILIKE $${params.length} OR p.staff_username ILIKE $${params.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.profiles p ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM public.profiles p ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = count.rows[0].total;
    res.json({ items: rows, page, total, total_pages: Math.ceil(total / limit) });
  }));

  router.post('/users', asyncRoute(async (req, res) => {
    const body = req.body || {};
    const name = fullName(body.full_name);
    const phone = contactPhone(body.contact_phone);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'username must be 3 to 50 lowercase letters, digits, _ . or -');
    }
    if (!ACCOUNT_ROLES.includes(body.role)) throw new HttpError(400, 'invalid role');
    if (!canManageRole(req.user, body.role)) throw forbidden();
    const agency = agencyFor(body.role, body.agency);
    const permissions = permissionsInput(body.admin_permissions);
    if (permissions && body.role !== 'admin') {
      throw new HttpError(400, 'permissions apply to administrators only');
    }
    const existing = await pool.query(
      'SELECT 1 FROM public.profiles WHERE staff_username = $1', [username]
    );
    if (existing.rows[0]) throw new HttpError(409, 'username already exists');

    const password = temporaryPassword();
    const email = `${username}@${staffEmailDomain}`;
    const created = await authAdmin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data?.user?.id) {
      if (created.error?.code === 'email_exists') throw new HttpError(409, 'username already exists');
      throw new HttpError(502, 'auth service unavailable');
    }
    const id = created.data.user.id;
    let account;
    try {
      account = await transaction(async (db) => {
        const { rows } = await db.query(
          `INSERT INTO public.profiles AS p
           (id, full_name, staff_username, staff_auth_email, role, agency,
            admin_permissions, contact_phone, must_change_password)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
           RETURNING ${ACCOUNT_COLUMNS}`,
          [id, name, username, email, body.role, agency, permissions || [], phone]
        );
        await audit(db, req.user.id, 'account_created', id, {
          username, role: body.role, agency, contact_phone: phone,
          ...(body.role === 'admin' ? { admin_permissions: permissions || [] } : {}),
        });
        return rows[0];
      });
    } catch (error) {
      await authAdmin.deleteUser(id);
      if (error.code === '23505') throw new HttpError(409, 'username already exists');
      throw error;
    }
    res.status(201).json({ user: account, temporary_password: password });
  }));

  router.patch('/users/:id', asyncRoute(async (req, res) => {
    const id = profileId(req.params.id);
    const body = req.body || {};
    const result = await transaction(async (db) => {
      const current = await lockAccount(db, id);
      const self = id === req.user.id;
      const role = body.role === undefined ? current.role : body.role;
      if (!ACCOUNT_ROLES.includes(role)) throw new HttpError(400, 'invalid role');
      if (self && role !== current.role) {
        throw new HttpError(409, 'cannot change own role');
      }
      // Anyone may correct their own name; everything else needs the matching permission.
      if (!self && current.is_owner) throw new HttpError(409, OWNER_LOCKED);
      if (!self && (!canManageRole(req.user, current.role) || !canManageRole(req.user, role))) {
        throw forbidden();
      }
      const requested = permissionsInput(body.admin_permissions);
      if (requested && (role !== 'admin' || self || current.is_owner)) {
        throw new HttpError(400, 'permissions apply to other administrators only');
      }
      const permissions = role !== 'admin' || current.is_owner ? []
        : requested || (current.role === 'admin' ? [...current.admin_permissions].sort() : []);
      const agency = agencyFor(role,
        body.agency === undefined && role === current.role ? current.agency : body.agency);
      const name = body.full_name === undefined ? current.full_name : fullName(body.full_name);
      // Required on every edit, so accounts made before it existed gain one when next saved.
      if (body.contact_phone === undefined && !current.contact_phone) {
        throw new HttpError(400, 'contact_phone must be a Libyan mobile number');
      }
      const phone = body.contact_phone === undefined ? current.contact_phone
        : contactPhone(body.contact_phone);
      const changes = {};
      if (name !== current.full_name) changes.full_name = { from: current.full_name, to: name };
      if (phone !== current.contact_phone) {
        changes.contact_phone = { from: current.contact_phone, to: phone };
      }
      if (role !== current.role) changes.role = { from: current.role, to: role };
      if (agency !== current.agency) changes.agency = { from: current.agency, to: agency };
      const before = [...(current.admin_permissions || [])].sort();
      if (before.join(',') !== permissions.join(',')) {
        changes.admin_permissions = { from: before, to: permissions };
      }
      if (!Object.keys(changes).length) throw new HttpError(400, 'no changes');

      let released = null;
      if (current.role === 'field_worker' && (changes.role || changes.agency)) {
        released = await releaseUnstartedWork(db, id);
        if (released.in_progress_reports) {
          throw new HttpError(409, 'worker has reports in progress');
        }
      }
      // The acting administrator stays an active admin, so at least one always remains.
      const { rows } = await db.query(
        `UPDATE public.profiles AS p SET full_name = $2, role = $3, agency = $4,
           admin_permissions = $5, contact_phone = $6
         WHERE p.id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
        [id, name, role, agency, permissions, phone]
      );
      await audit(db, req.user.id, 'account_updated', id,
        released ? { changes, ...released } : { changes });
      return { user: rows[0], released };
    });
    res.json(result);
  }));

  router.patch('/users/:id/status', asyncRoute(async (req, res) => {
    const id = profileId(req.params.id);
    const { active } = req.body || {};
    if (typeof active !== 'boolean') throw new HttpError(400, 'active must be true or false');
    const note = reason(req.body.reason, false);
    if (id === req.user.id) throw new HttpError(409, 'cannot change own account status');
    const result = await transaction(async (db) => {
      const current = await lockAccount(db, id);
      if (current.is_owner) throw new HttpError(409, OWNER_LOCKED);
      if (!canManageRole(req.user, current.role)) throw forbidden();
      if (current.is_active === active) throw new HttpError(409, 'account already has this status');
      const released = !active && current.role === 'field_worker'
        ? await releaseUnstartedWork(db, id) : null;
      const { rows } = await db.query(
        `UPDATE public.profiles AS p SET is_active = $2,
           deactivated_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
           deactivated_at = CASE WHEN $2 THEN NULL ELSE NOW() END,
           deactivated_by = CASE WHEN $2 THEN NULL ELSE $4::uuid END
         WHERE p.id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
        [id, active, note, req.user.id]
      );
      await audit(db, req.user.id, active ? 'account_reactivated' : 'account_deactivated', id,
        { reason: note, ...(released || {}) });
      return { user: rows[0], released };
    });
    await setBan(id, active);
    res.json(result);
  }));

  router.post('/users/:id/reset-password', asyncRoute(async (req, res) => {
    const id = profileId(req.params.id);
    if (id === req.user.id) throw new HttpError(409, 'use password change for your own account');
    const password = temporaryPassword();
    await transaction(async (db) => {
      const current = await lockAccount(db, id);
      // Owners may reset each other's passwords, so one forgotten password never
      // locks the system; otherwise the matching permission is required.
      if (current.is_owner ? !req.user.is_owner : !canManageRole(req.user, current.role)) {
        throw forbidden();
      }
      const { error } = await authAdmin.updateUserById(id, { password });
      if (error) throw new HttpError(502, 'auth service unavailable');
      // Until the owner chooses a new password, every session of this account,
      // including ones opened earlier, is refused except the password change.
      await db.query(
        'UPDATE public.profiles SET must_change_password = TRUE WHERE id = $1', [id]
      );
      await audit(db, req.user.id, 'password_reset', id);
    });
    res.json({ temporary_password: password });
  }));

  router.get('/citizens', requirePermission('manage_citizens'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const status = optionalChoice(req.query.status, ['active', 'inactive'], 'status');
    const search = searchText(req.query.search);
    const params = [];
    const conditions = ["p.role = 'citizen'"];
    if (status) conditions.push(status === 'active' ? 'p.is_active' : 'NOT p.is_active');
    if (search) {
      // Phones are stored as +2189XXXXXXXX; match local forms such as 0912345678.
      const digits = search.replace(/\D/g, '').replace(/^(218|0)/, '');
      params.push(likePattern(search));
      const nameMatch = `p.full_name ILIKE $${params.length}`;
      if (digits) {
        params.push(likePattern(digits));
        conditions.push(`(${nameMatch} OR p.phone LIKE $${params.length})`);
      } else conditions.push(nameMatch);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.profiles p ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT p.id, p.full_name, p.phone, p.is_active, p.deactivated_reason,
         p.deactivated_at, p.created_at,
         (SELECT COUNT(*)::int FROM public.reports r WHERE r.user_id = p.id) AS report_count
       FROM public.profiles p ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = count.rows[0].total;
    res.json({ items: rows, page, total, total_pages: Math.ceil(total / limit) });
  }));

  router.patch('/citizens/:id/status', requirePermission('manage_citizens'), asyncRoute(async (req, res) => {
    const id = profileId(req.params.id);
    const { active } = req.body || {};
    if (typeof active !== 'boolean') throw new HttpError(400, 'active must be true or false');
    const note = reason(req.body.reason, !active);
    const user = await transaction(async (db) => {
      const current = await db.query(
        `SELECT is_active FROM public.profiles WHERE id = $1 AND role = 'citizen' FOR UPDATE`,
        [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].is_active === active) {
        throw new HttpError(409, 'account already has this status');
      }
      const { rows } = await db.query(
        `UPDATE public.profiles SET is_active = $2,
           deactivated_reason = CASE WHEN $2 THEN NULL ELSE $3 END,
           deactivated_at = CASE WHEN $2 THEN NULL ELSE NOW() END,
           deactivated_by = CASE WHEN $2 THEN NULL ELSE $4::uuid END
         WHERE id = $1
         RETURNING id, full_name, phone, is_active, deactivated_reason, deactivated_at, created_at`,
        [id, active, note, req.user.id]
      );
      await audit(db, req.user.id, active ? 'account_reactivated' : 'account_deactivated', id,
        { reason: note });
      return rows[0];
    });
    await setBan(id, active);
    res.json({ user });
  }));

  router.get('/audit', requirePermission('view_audit'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const action = optionalChoice(req.query.action, AUDIT_ACTIONS, 'action');
    const params = action ? [action] : [];
    const where = action ? 'WHERE a.action = $1' : '';
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.admin_audit_log a ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.details, a.created_at,
         actor.full_name AS actor_name, actor.staff_username AS actor_username,
         a.target_id, target.full_name AS target_name,
         target.staff_username AS target_username, target.phone AS target_phone,
         target.role AS target_role
       FROM public.admin_audit_log a
       JOIN public.profiles actor ON actor.id = a.actor_id
       LEFT JOIN public.profiles target ON target.id = a.target_id
       ${where} ORDER BY a.created_at DESC, a.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = count.rows[0].total;
    res.json({ items: rows, page, total, total_pages: Math.ceil(total / limit) });
  }));

  return router;
}

module.exports = { createAdminRouter };
