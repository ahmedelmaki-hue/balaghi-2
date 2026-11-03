const express = require('express');
const multer = require('multer');
const { HttpError, asyncRoute } = require('../http');
const { prepareImage, MAX_IMAGE_BYTES } = require('../storage');
const { isPointInTripoliCenter } = require('../report_area');
const { optionalChoice, positiveInteger, pagination } = require('../params');
const { fillReportAddress } = require('../geocode');

const CATEGORIES = ['pothole', 'water_leak', 'garbage'];
const AGENCY_BY_CATEGORY = {
  pothole: 'roads_maintenance', water_leak: 'water_sewer', garbage: 'public_services',
};
const STATUSES = ['new', 'in_progress', 'resolved', 'rejected'];
const PUBLIC_STATUSES = STATUSES.filter((status) => status !== 'rejected');
const NEXT_STATUS = {
  new: ['rejected'],
  in_progress: ['rejected'],
  resolved: [],
  rejected: [],
};
const REPORT_COLUMNS = `r.id, r.category, r.description, r.image_path, r.latitude,
  r.longitude, r.address_text, r.status, r.approved_at, r.assigned_agency,
  r.created_at, r.updated_at`;
const PUBLIC_COLUMNS = `r.id, r.category, r.description, r.image_path, r.latitude,
  r.longitude, r.address_text, r.status, r.created_at`;
const MARKER_COLUMNS = 'r.id, r.category, r.latitude, r.longitude, r.status, r.created_at';
const REJECTION_REASON = `(SELECT h.change_reason FROM public.status_history h
  WHERE h.report_id = r.id AND h.new_status = 'rejected'
  ORDER BY h.changed_at DESC, h.id DESC LIMIT 1) AS rejection_reason`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reports one citizen may send per calendar day in Tripoli. Every sent report counts,
// rejected ones included; resending the same request returns it and costs nothing.
const DAILY_REPORT_LIMIT = 10;
// What counts as "near" when a reviewer looks for a report sent before.
const NEARBY_RADIUS_M = 100;
const NEARBY_RESOLVED_DAYS = 30;
const SENT_TODAY = `SELECT COUNT(*)::int AS total FROM public.reports
  WHERE user_id = $1
    AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Africa/Tripoli') AT TIME ZONE 'Africa/Tripoli')`;
const MAX_REPORT_ID = 9_223_372_036_854_775_807n;
const FIELD_ISSUE_REASONS = ['not_found', 'wrong_location', 'duplicate', 'inaccessible', 'other'];
const VERIFICATION_RESULTS = ['exists', 'wrong_location', 'not_found', 'unable'];
const NO_PENDING_FIELD_ISSUE = `NOT EXISTS (SELECT 1 FROM public.field_issue_reviews fi
  WHERE fi.report_id = r.id AND fi.decision IS NULL)`;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 7 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return callback(new HttpError(400, 'JPG or PNG image required'));
    }
    callback(null, true);
  },
});

function reportId(value) {
  if (typeof value !== 'string' || value.length > 19 ||
      !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_REPORT_ID) {
    throw new HttpError(400, 'invalid report id');
  }
  return value;
}

function bbox(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'bbox required');
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((part) => !part.trim())) {
    throw new HttpError(400, 'invalid bbox');
  }
  const [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite) ||
      west < -180 || east > 180 || south < -90 || north > 90 ||
      west >= east || south >= north) {
    throw new HttpError(400, 'invalid bbox');
  }
  return { west, south, east, north };
}

function cursorFrom(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new HttpError(400, 'invalid cursor');
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof decoded.created_at !== 'string' ||
        !Number.isFinite(Date.parse(decoded.created_at)) ||
        typeof decoded.id !== 'string' || !/^[1-9]\d*$/.test(decoded.id) ||
        BigInt(decoded.id) > MAX_REPORT_ID) {
      throw new Error('invalid cursor');
    }
    return decoded;
  } catch {
    throw new HttpError(400, 'invalid cursor');
  }
}

function nextCursor(row) {
  return Buffer.from(JSON.stringify({
    created_at: new Date(row.created_at).toISOString(),
    id: String(row.id),
  })).toString('base64url');
}

function validDate(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, 'invalid date');
  }
  return value;
}

function publicReport(row) {
  const { id, category, description, image_path, latitude, longitude,
    address_text, status, created_at } = row;
  return { id, category, description, image_path, latitude, longitude,
    address_text, status, created_at };
}

function mapMarker(row) {
  const { id, category, latitude, longitude, status, created_at } = row;
  return { id, category, latitude, longitude, status, created_at };
}

function createReportsRouter({ pool, auth, storage, geocoder = null }) {
  const router = express.Router();
  // The street name is looked up after the response is sent; when the lookup
  // fails or finds nothing, screens keep showing the coordinates.
  const lookUpAddress = (id) => {
    if (!geocoder) return;
    fillReportAddress(pool, geocoder, id)
      .then((address) => console.log(address
        ? `Address lookup for report ${id}: ${address}`
        : `Address lookup for report ${id}: no street name found`))
      .catch((error) => console.warn(`Address lookup for report ${id} failed: ${error.message}`));
  };

  router.get('/public', asyncRoute(async (req, res) => {
    const bounds = bbox(req.query.bbox);
    const category = optionalChoice(req.query.category, CATEGORIES, 'category');
    const status = optionalChoice(req.query.status, PUBLIC_STATUSES, 'status');
    const limit = positiveInteger(req.query.limit, 500, 500, 'limit');
    const cursor = cursorFrom(req.query.cursor);
    const params = [bounds.south, bounds.north, bounds.west, bounds.east];
    const conditions = [
      'r.approved_at IS NOT NULL',
      "r.status <> 'rejected'",
      NO_PENDING_FIELD_ISSUE,
      'r.latitude BETWEEN $1 AND $2',
      'r.longitude BETWEEN $3 AND $4',
    ];
    if (category) { params.push(category); conditions.push(`r.category = $${params.length}`); }
    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    if (cursor) {
      params.push(cursor.created_at, cursor.id);
      conditions.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
    }
    params.push(limit + 1);
    const { rows } = await pool.query(
      `SELECT ${MARKER_COLUMNS} FROM public.reports r
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
      params
    );
    const items = rows.slice(0, limit);
    res.json({
      items: items.map(mapMarker),
      next_cursor: rows.length > limit ? nextCursor(items[items.length - 1]) : null,
    });
  }));

  router.get('/mine', auth('citizen'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const status = optionalChoice(req.query.status, STATUSES, 'status');
    const params = [req.user.id];
    const conditions = ['r.user_id = $1'];
    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.reports r ${where}`,
      params
    );
    const listParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT ${REPORT_COLUMNS}, ${REJECTION_REASON} FROM public.reports r
       ${where} ORDER BY r.created_at DESC, r.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const total = count.rows[0].total;
    res.json({ items: await storage.withSignedImages(rows), page, total,
      total_pages: Math.ceil(total / limit) });
  }));

  router.get('/staff', auth('staff'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const status = optionalChoice(req.query.status, STATUSES, 'status');
    const category = optionalChoice(req.query.category, CATEGORIES, 'category');
    const date = validDate(req.query.date);
    const review = optionalChoice(req.query.review, ['pending', 'approved', 'rejected'], 'review');
    const fieldReview = optionalChoice(req.query.field_review, ['pending'], 'field_review');
    const completion = optionalChoice(req.query.completion, ['pending'], 'completion');
    const acceptance = optionalChoice(req.query.acceptance, ['pending'], 'acceptance');
    const sort = optionalChoice(req.query.sort, ['newest', 'oldest'], 'sort') || 'newest';
    const searchedId = req.query.report_id === undefined ? null : reportId(req.query.report_id);
    const params = [];
    const conditions = [];
    if (status) { params.push(status); conditions.push(`r.status = $${params.length}`); }
    if (review === 'pending') conditions.push("r.approved_at IS NULL AND r.status <> 'rejected'");
    if (review === 'approved') conditions.push("r.approved_at IS NOT NULL AND r.status <> 'rejected'");
    if (review === 'rejected') conditions.push("r.status = 'rejected'");
    if (fieldReview === 'pending') conditions.push(`EXISTS (SELECT 1 FROM public.field_issue_reviews fi
      WHERE fi.report_id = r.id AND fi.decision IS NULL)`);
    if (completion === 'pending') conditions.push(`EXISTS (SELECT 1 FROM public.work_completion_reviews wc
      WHERE wc.report_id = r.id AND wc.decision IS NULL)`);
    // Published and assigned to an agency, but no worker has claimed it yet.
    if (acceptance === 'pending') {
      conditions.push("r.approved_at IS NOT NULL AND r.status = 'new' AND r.accepted_at IS NULL");
    }
    if (category) { params.push(category); conditions.push(`r.category = $${params.length}`); }
    if (searchedId) { params.push(searchedId); conditions.push(`r.id = $${params.length}`); }
    const sortColumn = fieldReview === 'pending' ? `(SELECT fi.raised_at FROM public.field_issue_reviews fi
        WHERE fi.report_id = r.id AND fi.decision IS NULL)`
      : completion === 'pending' ? `(SELECT wc.submitted_at FROM public.work_completion_reviews wc
        WHERE wc.report_id = r.id AND wc.decision IS NULL)` : 'r.created_at';
    if (date) {
      params.push(date);
      conditions.push(`${sortColumn} >= ($${params.length}::date AT TIME ZONE 'Africa/Tripoli')`);
      conditions.push(`${sortColumn} < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE 'Africa/Tripoli')`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const direction = sort === 'oldest' ? 'ASC' : 'DESC';
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.reports r ${where}`, params
    );
    const listParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT ${REPORT_COLUMNS}, r.user_id, p.full_name AS reporter_name,
         p.phone AS reporter_phone, ${REJECTION_REASON},
         (SELECT fi.raised_at FROM public.field_issue_reviews fi
          WHERE fi.report_id = r.id AND fi.decision IS NULL) AS field_issue_raised_at,
         (SELECT wc.submitted_at FROM public.work_completion_reviews wc
          WHERE wc.report_id = r.id AND wc.decision IS NULL) AS completion_submitted_at,
         (SELECT v.result FROM public.report_verifications v
          WHERE v.report_id = r.id ORDER BY v.id DESC LIMIT 1) AS verification_result,
         (SELECT v.requested_at FROM public.report_verifications v
          WHERE v.report_id = r.id ORDER BY v.id DESC LIMIT 1) AS verification_requested_at,
         r.accepted_at, r.work_started_at, worker.full_name AS assigned_worker_name,
         worker.staff_username AS assigned_worker_username
       FROM public.reports r JOIN public.profiles p ON p.id = r.user_id
       LEFT JOIN public.profiles worker ON worker.id = r.assigned_worker_id
       ${where} ORDER BY ${sortColumn} ${direction}, r.id ${direction}
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const total = count.rows[0].total;
    res.json({ items: await storage.withSignedImages(rows), page, total,
      total_pages: Math.ceil(total / limit) });
  }));

  router.get('/field/assigned', auth('field_worker'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const view = optionalChoice(req.query.view, ['active', 'resolved'], 'view') || 'active';
    const params = view === 'resolved' ? [req.user.id] : [req.user.id, req.user.agency];
    const where = view === 'resolved'
      ? `WHERE r.assigned_worker_id = $1 AND r.status = 'resolved'`
      : `WHERE (r.assigned_worker_id = $1 OR
          (r.assigned_worker_id IS NULL AND r.assigned_agency = $2))
          AND r.approved_at IS NOT NULL AND r.status IN ('new', 'in_progress')
          AND ${NO_PENDING_FIELD_ISSUE}`;
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.reports r ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT ${REPORT_COLUMNS}, r.assigned_at, r.accepted_at, r.work_started_at,
         r.assigned_worker_id,
         EXISTS (SELECT 1 FROM public.field_issue_reviews fi
           WHERE fi.report_id = r.id AND fi.decision IS NULL) AS field_issue_pending,
         (SELECT fi.note FROM public.field_issue_reviews fi
          WHERE fi.report_id = r.id AND fi.decision IS NULL) AS field_issue_note,
         EXISTS (SELECT 1 FROM public.work_completion_reviews wc
           WHERE wc.report_id = r.id AND wc.decision IS NULL) AS completion_pending,
         (SELECT CASE WHEN wc.decision = 'returned' THEN wc.decision_note END
          FROM public.work_completion_reviews wc WHERE wc.report_id = r.id
          ORDER BY wc.id DESC LIMIT 1) AS completion_return_note
       FROM public.reports r ${where}
       ORDER BY ${view === 'resolved' ? 'r.updated_at' : 'r.created_at'} DESC, r.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    const total = count.rows[0].total;
    res.json({ items: await storage.withSignedImages(rows), page, total,
      total_pages: Math.ceil(total / limit) });
  }));

  router.get('/field/verifications', auth('field_worker'), asyncRoute(async (req, res) => {
    const { page, limit, offset } = pagination(req.query);
    const where = `WHERE v.agency = $1 AND v.result IS NULL
      AND (v.claimed_by IS NULL OR v.claimed_by = $2)
      AND r.approved_at IS NULL AND r.status = 'new'`;
    const params = [req.user.agency, req.user.id];
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.report_verifications v
       JOIN public.reports r ON r.id = v.report_id ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT ${REPORT_COLUMNS}, v.id AS verification_id, v.request_note,
         v.requested_at, v.claimed_by, v.claimed_at
       FROM public.report_verifications v
       JOIN public.reports r ON r.id = v.report_id ${where}
       ORDER BY v.requested_at ASC, v.id ASC LIMIT $3 OFFSET $4`,
      [req.user.agency, req.user.id, limit, offset]
    );
    const total = count.rows[0].total;
    res.json({ items: await storage.withSignedImages(rows), page, total,
      total_pages: Math.ceil(total / limit) });
  }));

  router.get('/staff/map', auth('staff'), asyncRoute(async (req, res) => {
    const bounds = bbox(req.query.bbox);
    const category = optionalChoice(req.query.category, CATEGORIES, 'category');
    const limit = positiveInteger(req.query.limit, 500, 500, 'limit');
    const cursor = cursorFrom(req.query.cursor);
    const params = [bounds.south, bounds.north, bounds.west, bounds.east];
    const conditions = [
      "r.status <> 'rejected'",
      'r.latitude BETWEEN $1 AND $2',
      'r.longitude BETWEEN $3 AND $4',
    ];
    if (category) { params.push(category); conditions.push(`r.category = $${params.length}`); }
    if (cursor) {
      params.push(cursor.created_at, cursor.id);
      conditions.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::bigint)`);
    }
    params.push(limit + 1);
    const { rows } = await pool.query(
      `SELECT ${MARKER_COLUMNS}, r.approved_at FROM public.reports r
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC, r.id DESC LIMIT $${params.length}`,
      params
    );
    const items = rows.slice(0, limit);
    res.json({
      items: items.map((row) => ({ ...mapMarker(row), approved_at: row.approved_at })),
      next_cursor: rows.length > limit ? nextCursor(items[items.length - 1]) : null,
    });
  }));

  // Possible duplicates for the reviewer: same category within NEARBY_RADIUS_M,
  // still open or resolved recently (an old fixed pothole reported again is new).
  router.get('/:id/nearby', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const target = await pool.query(
      'SELECT id, category, latitude, longitude FROM public.reports WHERE id = $1', [id]
    );
    if (!target.rows[0]) throw new HttpError(404, 'not found');
    const { category, latitude, longitude } = target.rows[0];
    const lat = Number(latitude);
    const lng = Number(longitude);
    // A box a little larger than the radius lets the index narrow the rows first.
    const latDelta = (NEARBY_RADIUS_M * 1.2) / 111320;
    const lngDelta = (NEARBY_RADIUS_M * 1.2) / (111320 * Math.cos(lat * Math.PI / 180));
    const nearby = await pool.query(
      `SELECT * FROM (
         SELECT ${REPORT_COLUMNS},
           ROUND(6371000 * 2 * ASIN(SQRT(
             POWER(SIN(RADIANS(r.latitude::float8 - $3) / 2), 2) +
             COS(RADIANS($3)) * COS(RADIANS(r.latitude::float8)) *
             POWER(SIN(RADIANS(r.longitude::float8 - $4) / 2), 2))))::int AS distance_m
         FROM public.reports r
         WHERE r.id <> $1 AND r.category = $2 AND r.status <> 'rejected'
           AND (r.status <> 'resolved' OR r.updated_at >= NOW() - INTERVAL '${NEARBY_RESOLVED_DAYS} days')
           AND r.latitude BETWEEN $3::float8 - $5 AND $3::float8 + $5
           AND r.longitude BETWEEN $4::float8 - $6 AND $4::float8 + $6
       ) candidates
       WHERE distance_m <= $7
       ORDER BY distance_m ASC, created_at DESC
       LIMIT 5`,
      [id, category, lat, lng, latDelta, lngDelta, NEARBY_RADIUS_M]
    );
    res.json({ radius_m: NEARBY_RADIUS_M, items: await storage.withSignedImages(nearby.rows) });
  }));

  router.get('/:id/staff', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const report = await pool.query(
      `SELECT ${REPORT_COLUMNS}, r.user_id, p.full_name AS reporter_name,
         p.phone AS reporter_phone, r.assigned_worker_id, r.assigned_by,
         r.assigned_at, r.accepted_at, r.work_started_at,
         worker.full_name AS assigned_worker_name,
         worker.staff_username AS assigned_worker_username,
         worker.is_active AS assigned_worker_active,
         approver.full_name AS approved_by_name,
         approver.staff_username AS approved_by_username, ${REJECTION_REASON}
       FROM public.reports r JOIN public.profiles p ON p.id = r.user_id
       LEFT JOIN public.profiles worker ON worker.id = r.assigned_worker_id
       LEFT JOIN public.profiles approver ON approver.id = r.approved_by
       WHERE r.id = $1`,
      [id]
    );
    if (!report.rows[0]) throw new HttpError(404, 'not found');
    const history = await pool.query(
      `SELECT h.id, h.old_status, h.new_status, h.change_reason, h.changed_at,
         h.changed_by, p.full_name AS changed_by_name
       FROM public.status_history h
       JOIN public.profiles p ON p.id = h.changed_by
       WHERE h.report_id = $1 ORDER BY h.changed_at ASC, h.id ASC`,
      [id]
    );
    const fieldReviews = await pool.query(
      `SELECT fi.id, fi.reason, fi.note, fi.raised_at, fi.decision,
         fi.decision_note, fi.decided_at, fi.corrected_latitude,
         fi.corrected_longitude, worker.full_name AS worker_name,
         worker.staff_username AS worker_username, reviewer.full_name AS reviewer_name
       FROM public.field_issue_reviews fi
       JOIN public.profiles worker ON worker.id = fi.worker_id
       LEFT JOIN public.profiles reviewer ON reviewer.id = fi.decided_by
       WHERE fi.report_id = $1 ORDER BY fi.raised_at DESC, fi.id DESC`, [id]
    );
    const completions = await pool.query(
      `SELECT wc.id, wc.note, wc.after_image_path, wc.photo_latitude,
         wc.photo_longitude, wc.photo_accuracy_m, wc.submitted_at, wc.decision, wc.decision_note,
         wc.decided_at, worker.full_name AS worker_name,
         worker.staff_username AS worker_username, reviewer.full_name AS reviewer_name
       FROM public.work_completion_reviews wc
       JOIN public.profiles worker ON worker.id = wc.worker_id
       LEFT JOIN public.profiles reviewer ON reviewer.id = wc.decided_by
       WHERE wc.report_id = $1 ORDER BY wc.submitted_at DESC, wc.id DESC`, [id]
    );
    const verifications = await pool.query(
      `SELECT v.id, v.agency, v.request_note, v.requested_at,
         v.claimed_at, v.result, v.result_note, v.completed_at,
         v.corrected_latitude, v.corrected_longitude, v.corrected_at
       FROM public.report_verifications v WHERE v.report_id = $1
       ORDER BY v.id DESC`, [id]
    );
    const completionPhotos = await storage.withSignedImages(completions.rows
      .filter((item) => item.after_image_path)
      .map((item) => ({ id: item.id, image_path: item.after_image_path })));
    const photoUrls = new Map(completionPhotos.map((item) => [String(item.id), item.image_url]));
    res.json({ report: (await storage.withSignedImages(report.rows))[0],
      status_history: history.rows, field_reviews: fieldReviews.rows,
      verifications: verifications.rows,
      completions: completions.rows.map(({ after_image_path: _path, ...item }) => ({
        ...item, after_image_url: photoUrls.get(String(item.id)) || null,
      })) });
  }));

  router.get('/:id/public', asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { rows } = await pool.query(
      `SELECT ${PUBLIC_COLUMNS} FROM public.reports r
       WHERE r.id = $1 AND r.approved_at IS NOT NULL AND r.status <> 'rejected'
         AND ${NO_PENDING_FIELD_ISSUE}`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'not found');
    res.json((await storage.withSignedImages([publicReport(rows[0])]))[0]);
  }));

  router.post('/', auth('citizen'), upload.single('image'), asyncRoute(async (req, res) => {
    if (!req.user.full_name) throw new HttpError(409, 'profile incomplete');
    const { category, description, latitude, longitude, address_text: addressText,
      client_request_id: clientRequestId } = req.body || {};
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'invalid category');
    if (typeof clientRequestId !== 'string' || !UUID_RE.test(clientRequestId)) {
      throw new HttpError(400, 'invalid client_request_id');
    }
    if (typeof latitude !== 'string' || typeof longitude !== 'string' ||
        latitude.trim() === '' || longitude.trim() === '') {
      throw new HttpError(400, 'location required');
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new HttpError(400, 'invalid location');
    }
    if (!isPointInTripoliCenter(lng, lat)) {
      throw new HttpError(422, 'report location is outside Tripoli Center service area');
    }
    if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
      throw new HttpError(400, 'invalid description');
    }
    if (addressText !== undefined && (typeof addressText !== 'string' || addressText.length > 255)) {
      throw new HttpError(400, 'invalid address_text');
    }
    if (!req.file) throw new HttpError(400, 'image required');

    const findSent = (db) => db.query(
      `SELECT ${REPORT_COLUMNS} FROM public.reports r
       WHERE r.user_id = $1 AND r.client_request_id = $2`,
      [req.user.id, clientRequestId]
    );
    const existing = await findSent(pool);
    if (existing.rows[0]) {
      return res.json((await storage.withSignedImages(existing.rows))[0]);
    }
    // Checked before the upload so a citizen at the limit stores nothing.
    if ((await pool.query(SENT_TODAY, [req.user.id])).rows[0].total >= DAILY_REPORT_LIMIT) {
      throw new HttpError(429, 'daily report limit reached');
    }

    const imageBuffer = await prepareImage(req.file);
    const imagePath = await storage.upload(req.user.id, imageBuffer);
    const client = await pool.connect();
    let created;
    try {
      await client.query('BEGIN');
      // One citizen's submissions take turns here, so two sent together
      // cannot both pass the count, and a retry finds the report its twin saved.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [req.user.id]);
      const twin = await findSent(client);
      if (twin.rows[0]) {
        await client.query('ROLLBACK');
        await storage.remove(imagePath);
        return res.json((await storage.withSignedImages(twin.rows))[0]);
      }
      if ((await client.query(SENT_TODAY, [req.user.id])).rows[0].total >= DAILY_REPORT_LIMIT) {
        throw new HttpError(429, 'daily report limit reached');
      }
      const result = await client.query(
        `INSERT INTO public.reports
         (user_id, client_request_id, category, description, image_path,
          latitude, longitude, address_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, category, description, image_path, latitude, longitude,
           address_text, status, approved_at, created_at, updated_at`,
        [req.user.id, clientRequestId, category, description?.trim() || null,
          imagePath, lat, lng, addressText?.trim() || null]
      );
      await client.query('COMMIT');
      created = result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      await storage.remove(imagePath);
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json((await storage.withSignedImages([created]))[0]);
    if (!created.address_text) lookUpAddress(created.id);
  }));

  router.patch('/:id/verification/request', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const note = req.body?.note;
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 500) {
      throw new HttpError(400, 'verification reason required (1 to 500 characters)');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, category, status, approved_at FROM public.reports
         WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'new' || current.rows[0].approved_at) {
        throw new HttpError(409, 'report is not awaiting approval');
      }
      const latest = await client.query(
        `SELECT id, result, corrected_at FROM public.report_verifications
         WHERE report_id = $1 ORDER BY id DESC LIMIT 1`, [id]
      );
      if (latest.rows[0] && !latest.rows[0].result) {
        throw new HttpError(409, 'verification already requested');
      }
      if (latest.rows[0]?.result === 'wrong_location' && !latest.rows[0].corrected_at) {
        throw new HttpError(409, 'correct the verified location before requesting another check');
      }
      const { rows } = await client.query(
        `INSERT INTO public.report_verifications
         (report_id, agency, requested_by, request_note)
         VALUES ($1, $2, $3, $4)
         RETURNING id, report_id, agency, request_note, requested_at`,
        [id, AGENCY_BY_CATEGORY[current.rows[0].category], req.user.id, note.trim()]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.patch('/:id/verification/claim', auth('field_worker'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { rows } = await pool.query(
      `UPDATE public.report_verifications v
       SET claimed_by = $2, claimed_at = COALESCE(v.claimed_at, NOW())
       FROM public.reports r
       WHERE v.report_id = r.id AND r.id = $1 AND v.agency = $3
         AND v.result IS NULL AND (v.claimed_by IS NULL OR v.claimed_by = $2)
         AND r.approved_at IS NULL AND r.status = 'new'
       RETURNING v.id, v.report_id, v.claimed_by, v.claimed_at`,
      [id, req.user.id, req.user.agency]
    );
    if (!rows[0]) throw new HttpError(409, 'verification unavailable to this worker');
    res.json(rows[0]);
  }));

  router.patch('/:id/verification/respond', auth('field_worker'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { result, note } = req.body || {};
    if (!VERIFICATION_RESULTS.includes(result)) throw new HttpError(400, 'invalid verification result');
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 500) {
      throw new HttpError(400, 'verification note required (1 to 500 characters)');
    }
    const { rows } = await pool.query(
      `UPDATE public.report_verifications v
       SET result = $3, result_note = $4, completed_by = $2, completed_at = NOW()
       FROM public.reports r
       WHERE v.report_id = r.id AND r.id = $1 AND v.agency = $5
         AND v.claimed_by = $2 AND v.result IS NULL
         AND r.approved_at IS NULL AND r.status = 'new'
       RETURNING v.id, v.report_id, v.result, v.result_note, v.completed_at`,
      [id, req.user.id, result, note.trim(), req.user.agency]
    );
    if (!rows[0]) throw new HttpError(409, 'verification must be claimed first');
    res.json(rows[0]);
  }));

  router.patch('/:id/verification/cancel', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const note = req.body?.note;
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 500) {
      throw new HttpError(400, 'cancellation reason required (1 to 500 characters)');
    }
    const { rows } = await pool.query(
      `UPDATE public.report_verifications v
       SET result = 'cancelled', result_note = $3, completed_by = $2,
           completed_at = NOW()
       FROM public.reports r
       WHERE v.report_id = r.id AND r.id = $1 AND v.result IS NULL
         AND r.approved_at IS NULL AND r.status = 'new'
       RETURNING v.id, v.report_id, v.result, v.completed_at`,
      [id, req.user.id, note.trim()]
    );
    if (!rows[0]) throw new HttpError(409, 'no pending verification');
    res.json(rows[0]);
  }));

  router.patch('/:id/verification/location', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { latitude, longitude } = req.body || {};
    if (latitude === undefined || longitude === undefined ||
        String(latitude).trim() === '' || String(longitude).trim() === '') {
      throw new HttpError(400, 'corrected location required');
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new HttpError(400, 'invalid corrected location');
    }
    if (!isPointInTripoliCenter(lng, lat)) {
      throw new HttpError(422, 'report location is outside Tripoli Center service area');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, approved_at, latitude, longitude
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'new' || current.rows[0].approved_at) {
        throw new HttpError(409, 'report is not awaiting approval');
      }
      if (Number(current.rows[0].latitude) === lat &&
          Number(current.rows[0].longitude) === lng) {
        throw new HttpError(400, 'corrected location must differ from the reported location');
      }
      const latest = await client.query(
        `SELECT id, result FROM public.report_verifications
         WHERE report_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE`, [id]
      );
      if (latest.rows[0]?.result !== 'wrong_location') {
        throw new HttpError(409, 'no incorrect-location verification result');
      }
      await client.query(
        `UPDATE public.reports SET latitude = $2, longitude = $3,
           address_text = NULL, updated_at = NOW() WHERE id = $1`, [id, lat, lng]
      );
      await client.query(
        `UPDATE public.report_verifications SET corrected_latitude = $2,
           corrected_longitude = $3, corrected_by = $4, corrected_at = NOW()
         WHERE id = $1`, [latest.rows[0].id, lat, lng, req.user.id]
      );
      await client.query('COMMIT');
      res.json({ id, latitude: lat, longitude: lng });
      lookUpAddress(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.patch('/:id/category', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const category = req.body?.category;
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'invalid category');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, category, status, approved_at FROM public.reports
         WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'new' || current.rows[0].approved_at) {
        throw new HttpError(409, 'category can only be corrected before approval');
      }
      const open = await client.query(
        `SELECT id FROM public.report_verifications
         WHERE report_id = $1 AND result IS NULL`, [id]
      );
      if (open.rows[0]) throw new HttpError(409, 'complete or cancel verification first');
      const { rows } = await client.query(
        `UPDATE public.reports r SET category = $2, updated_at = NOW()
         WHERE r.id = $1 RETURNING ${REPORT_COLUMNS}`,
        [id, category]
      );
      await client.query('COMMIT');
      res.json((await storage.withSignedImages(rows))[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.patch('/:id/approve', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const client = await pool.connect();
    let approved;
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, category, status, approved_at FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'new' || current.rows[0].approved_at) {
        throw new HttpError(409, 'report is not awaiting approval');
      }
      const latest = await client.query(
        `SELECT result, corrected_at FROM public.report_verifications
         WHERE report_id = $1 ORDER BY id DESC LIMIT 1`, [id]
      );
      if (latest.rows[0] && !latest.rows[0].result) {
        throw new HttpError(409, 'complete or cancel verification first');
      }
      if (latest.rows[0]?.result === 'wrong_location' && !latest.rows[0].corrected_at) {
        throw new HttpError(409, 'correct the verified location before approval');
      }
      const { rows } = await client.query(
        `UPDATE public.reports r SET approved_at = NOW(), approved_by = $2,
           assigned_agency = $3, assigned_by = $2, assigned_at = NOW(),
           updated_at = NOW() WHERE r.id = $1 RETURNING ${REPORT_COLUMNS}`,
        [id, req.user.id, AGENCY_BY_CATEGORY[current.rows[0].category]]
      );
      approved = rows[0];
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.json((await storage.withSignedImages([approved]))[0]);
  }));

  router.patch('/:id/accept', auth('field_worker'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { rows } = await pool.query(
      `UPDATE public.reports r SET assigned_worker_id = $2,
         accepted_at = NOW(), updated_at = NOW()
       WHERE r.id = $1 AND (r.assigned_worker_id = $2 OR
         (r.assigned_worker_id IS NULL AND r.assigned_agency = $3))
         AND r.approved_at IS NOT NULL
         AND r.status = 'new' AND r.accepted_at IS NULL
         AND ${NO_PENDING_FIELD_ISSUE}
       RETURNING r.id, r.assigned_worker_id, r.accepted_at`,
      [id, req.user.id, req.user.agency]
    );
    if (!rows[0]) throw new HttpError(409, 'report is not awaiting acceptance by this worker');
    res.json(rows[0]);
  }));

  router.patch('/:id/start', auth('field_worker'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const client = await pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT status, approved_at, assigned_worker_id, accepted_at,
          EXISTS (SELECT 1 FROM public.field_issue_reviews fi
            WHERE fi.report_id = public.reports.id AND fi.decision IS NULL) AS field_issue_pending
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'new' || !current.rows[0].approved_at ||
          current.rows[0].assigned_worker_id !== req.user.id ||
          !current.rows[0].accepted_at || current.rows[0].field_issue_pending) {
        throw new HttpError(409, 'report must be accepted by the assigned worker first');
      }
      const result = await client.query(
        `UPDATE public.reports r SET status = 'in_progress', work_started_at = NOW(),
           updated_at = NOW() WHERE r.id = $1
         RETURNING r.id, r.status, r.work_started_at`, [id]
      );
      updated = result.rows[0];
      await client.query(
        `INSERT INTO public.status_history
         (report_id, old_status, new_status, changed_by, change_reason)
         VALUES ($1, 'new', 'in_progress', $2, NULL)`,
        [id, req.user.id]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.json(updated);
  }));

  // A report held by a worker who cannot finish it (deactivated, moved, absent)
  // returns to its agency's queue for another worker to claim. Work already
  // started is undone in the public status, in_progress back to new, and the
  // reason is kept in the history.
  router.patch('/:id/release', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const reason = req.body?.reason;
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
      throw new HttpError(400, 'release reason required (1 to 500 characters)');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT status, approved_at, assigned_worker_id,
          EXISTS (SELECT 1 FROM public.field_issue_reviews fi
            WHERE fi.report_id = public.reports.id AND fi.decision IS NULL) AS field_issue_pending,
          EXISTS (SELECT 1 FROM public.work_completion_reviews wc
            WHERE wc.report_id = public.reports.id AND wc.decision IS NULL) AS completion_pending
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      const report = current.rows[0];
      if (!report) throw new HttpError(404, 'not found');
      if (!report.approved_at || !report.assigned_worker_id ||
          !['new', 'in_progress'].includes(report.status)) {
        throw new HttpError(409, 'report has no worker to release');
      }
      if (report.completion_pending) throw new HttpError(409, 'decide pending work completion first');
      if (report.field_issue_pending) throw new HttpError(409, 'decide pending field issue first');
      await client.query(
        `UPDATE public.reports SET status = 'new', assigned_worker_id = NULL,
           accepted_at = NULL, work_started_at = NULL, updated_at = NOW()
         WHERE id = $1`, [id]
      );
      await client.query(
        `INSERT INTO public.status_history
         (report_id, old_status, new_status, changed_by, change_reason)
         VALUES ($1, $2, 'new', $3, $4)`,
        [id, report.status, req.user.id, reason.trim()]
      );
      await client.query('COMMIT');
      res.json({ id, status: 'new', released_from: report.status });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.post('/:id/completion', auth('field_worker'), upload.single('image'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const note = req.body?.note;
    if (note !== undefined && (typeof note !== 'string' || note.trim().length > 500)) {
      throw new HttpError(400, 'invalid completion note');
    }
    if (!req.file) throw new HttpError(400, 'completion image required');
    const locationFields = ['photo_latitude', 'photo_longitude', 'photo_accuracy_m'];
    const locationValues = locationFields.map((key) => req.body?.[key]);
    const hasLocation = locationValues.some((value) => value !== undefined);
    if (hasLocation && locationValues.some((value) =>
      typeof value !== 'string' || !value.trim())) {
      throw new HttpError(400, 'incomplete photo location');
    }
    const [latitude, longitude, accuracy] = hasLocation
      ? locationValues.map(Number) : [null, null, null];
    if (hasLocation && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 99999999)) {
      throw new HttpError(400, 'invalid photo location');
    }
    const imageBuffer = await prepareImage(req.file);
    const imagePath = await storage.upload(req.user.id, imageBuffer);
    let client;
    let committed = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, approved_at, assigned_worker_id, work_started_at
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].status !== 'in_progress' || !current.rows[0].approved_at ||
          current.rows[0].assigned_worker_id !== req.user.id ||
          !current.rows[0].work_started_at) {
        throw new HttpError(409, 'only the assigned worker can submit finished work');
      }
      const pending = await client.query(
        `SELECT EXISTS (SELECT 1 FROM public.field_issue_reviews fi
           WHERE fi.report_id = $1 AND fi.decision IS NULL) AS field_issue,
          EXISTS (SELECT 1 FROM public.work_completion_reviews wc
           WHERE wc.report_id = $1 AND wc.decision IS NULL) AS completion`, [id]
      );
      if (pending.rows[0].field_issue || pending.rows[0].completion) {
        throw new HttpError(409, 'report already awaits staff review');
      }
      const { rows } = await client.query(
        `INSERT INTO public.work_completion_reviews
         (report_id, worker_id, note, after_image_path, photo_latitude,
          photo_longitude, photo_accuracy_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, report_id, note, submitted_at`,
        [id, req.user.id, note?.trim() || null, imagePath,
          latitude, longitude, accuracy]
      );
      await client.query('COMMIT');
      committed = true;
      res.status(201).json(rows[0]);
    } catch (error) {
      if (!committed) {
        try { if (client) await client.query('ROLLBACK'); }
        finally { await storage.remove(imagePath); }
      }
      throw error;
    } finally { client?.release(); }
  }));

  router.patch('/:id/completion/review', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { decision, note } = req.body || {};
    if (!['confirmed', 'returned'].includes(decision)) {
      throw new HttpError(400, 'invalid completion decision');
    }
    if (note !== undefined && (typeof note !== 'string' || note.trim().length > 500)) {
      throw new HttpError(400, 'invalid completion decision note');
    }
    if (decision === 'returned' && !note?.trim()) {
      throw new HttpError(400, 'return reason required');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, approved_at, assigned_worker_id
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      const pending = await client.query(
        `SELECT id FROM public.work_completion_reviews
         WHERE report_id = $1 AND decision IS NULL FOR UPDATE`, [id]
      );
      if (!pending.rows[0] || current.rows[0].status !== 'in_progress' ||
          !current.rows[0].approved_at || !current.rows[0].assigned_worker_id) {
        throw new HttpError(409, 'report is not awaiting completion review');
      }
      if (decision === 'confirmed') {
        await client.query(
          `UPDATE public.reports SET status = 'resolved', updated_at = NOW()
           WHERE id = $1`, [id]
        );
        await client.query(
          `INSERT INTO public.status_history
           (report_id, old_status, new_status, changed_by, change_reason)
           VALUES ($1, 'in_progress', 'resolved', $2, NULL)`,
          [id, req.user.id]
        );
      }
      const { rows } = await client.query(
        `UPDATE public.work_completion_reviews
         SET decision = $2, decision_note = $3, decided_by = $4, decided_at = NOW()
         WHERE id = $1 RETURNING id, report_id, decision, decided_at`,
        [pending.rows[0].id, decision, note?.trim() || null, req.user.id]
      );
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.post('/:id/field-issue', auth('field_worker'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { reason, note } = req.body || {};
    if (!FIELD_ISSUE_REASONS.includes(reason)) throw new HttpError(400, 'invalid field issue reason');
    if (typeof note !== 'string' || !note.trim() || note.trim().length > 500) {
      throw new HttpError(400, 'field issue note required (1 to 500 characters)');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, approved_at, assigned_worker_id, assigned_agency
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      const belongsToWorker = current.rows[0].assigned_worker_id === req.user.id ||
        (current.rows[0].assigned_worker_id === null &&
          current.rows[0].assigned_agency === req.user.agency);
      if (!current.rows[0].approved_at || !belongsToWorker ||
          !['new', 'in_progress'].includes(current.rows[0].status)) {
        throw new HttpError(409, 'report is not active for this worker');
      }
      const pending = await client.query(
        `SELECT id FROM public.field_issue_reviews
         WHERE report_id = $1 AND decision IS NULL`, [id]
      );
      if (pending.rows[0]) throw new HttpError(409, 'report already awaits field review');
      const completion = await client.query(
        `SELECT id FROM public.work_completion_reviews
         WHERE report_id = $1 AND decision IS NULL`, [id]
      );
      if (completion.rows[0]) throw new HttpError(409, 'report awaits completion review');
      const { rows } = await client.query(
        `INSERT INTO public.field_issue_reviews (report_id, worker_id, reason, note)
         VALUES ($1, $2, $3, $4) RETURNING id, report_id, reason, note, raised_at`,
        [id, req.user.id, reason, note.trim()]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.patch('/:id/field-issue/review', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { decision, note, agency, latitude, longitude } = req.body || {};
    if (!['continue', 'correct_location', 'reject'].includes(decision)) {
      throw new HttpError(400, 'invalid field review decision');
    }
    if (note !== undefined && (typeof note !== 'string' || note.trim().length > 500)) {
      throw new HttpError(400, 'invalid decision note');
    }
    if (decision === 'reject' && !note?.trim()) {
      throw new HttpError(400, 'rejection reason required');
    }
    if (agency !== undefined) {
      throw new HttpError(400, 'agency is determined by report category');
    }
    if (decision !== 'correct_location' &&
        (latitude !== undefined || longitude !== undefined)) {
      throw new HttpError(400, 'location only applies to correction');
    }
    const correctingLocation = latitude !== undefined || longitude !== undefined;
    const coordinateInput = (value) => (typeof value === 'string' || typeof value === 'number') &&
      String(value).trim() !== '';
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (correctingLocation && (!coordinateInput(latitude) || !coordinateInput(longitude) ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
      throw new HttpError(400, 'valid latitude and longitude required');
    }
    if (decision === 'correct_location' && !correctingLocation) {
      throw new HttpError(400, 'corrected location required');
    }
    if (correctingLocation && !isPointInTripoliCenter(lng, lat)) {
      throw new HttpError(422, 'report location is outside Tripoli Center service area');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, status, assigned_worker_id, approved_at
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      const issue = await client.query(
        `SELECT id FROM public.field_issue_reviews
         WHERE report_id = $1 AND decision IS NULL FOR UPDATE`, [id]
      );
      if (!issue.rows[0] || !current.rows[0].approved_at ||
          !['new', 'in_progress'].includes(current.rows[0].status)) {
        throw new HttpError(409, 'report is not awaiting field review');
      }
      if (decision === 'correct_location') {
        await client.query(
          `UPDATE public.reports SET latitude = $2, longitude = $3,
             address_text = NULL, updated_at = NOW() WHERE id = $1`,
          [id, lat, lng]
        );
      } else if (decision === 'reject') {
        await client.query(
          `UPDATE public.reports SET status = 'rejected', updated_at = NOW() WHERE id = $1`, [id]
        );
        await client.query(
          `INSERT INTO public.status_history
           (report_id, old_status, new_status, changed_by, change_reason)
           VALUES ($1, $2, 'rejected', $3, $4)`,
          [id, current.rows[0].status, req.user.id, note.trim()]
        );
      }
      const result = await client.query(
        `UPDATE public.field_issue_reviews
         SET decision = $2, decision_note = $3, decided_by = $4, decided_at = NOW(),
           corrected_latitude = $5, corrected_longitude = $6
         WHERE id = $1 RETURNING id, report_id, decision, decided_at`,
        [issue.rows[0].id, decision, note?.trim() || null, req.user.id,
          correctingLocation ? lat : null, correctingLocation ? lng : null]
      );
      await client.query('COMMIT');
      res.json(result.rows[0]);
      if (correctingLocation) lookUpAddress(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }));

  router.patch('/:id/status', auth('staff'), asyncRoute(async (req, res) => {
    const id = reportId(req.params.id);
    const { status, reason } = req.body || {};
    if (!STATUSES.includes(status)) throw new HttpError(400, 'invalid status');
    if (status === 'in_progress') throw new HttpError(409, 'field worker confirmation required');
    if (status === 'resolved') throw new HttpError(409, 'work completion review required');
    if (status === 'rejected') {
      if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) {
        throw new HttpError(400, 'rejection reason required (1 to 500 characters)');
      }
    } else if (reason !== undefined) {
      throw new HttpError(400, 'reason is only used for rejection');
    }

    const client = await pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT status, approved_at,
          EXISTS (SELECT 1 FROM public.field_issue_reviews fi
            WHERE fi.report_id = public.reports.id AND fi.decision IS NULL) AS field_issue_pending,
          EXISTS (SELECT 1 FROM public.report_verifications v
            WHERE v.report_id = public.reports.id AND v.result IS NULL) AS verification_pending,
          EXISTS (SELECT 1 FROM public.work_completion_reviews wc
            WHERE wc.report_id = public.reports.id AND wc.decision IS NULL) AS completion_pending
         FROM public.reports WHERE id = $1 FOR UPDATE`, [id]
      );
      if (!current.rows[0]) throw new HttpError(404, 'not found');
      if (current.rows[0].field_issue_pending) {
        throw new HttpError(409, 'decide pending field issue first');
      }
      if (current.rows[0].verification_pending) {
        throw new HttpError(409, 'complete or cancel pending verification first');
      }
      if (current.rows[0].completion_pending) {
        throw new HttpError(409, 'decide pending work completion first');
      }
      const oldStatus = current.rows[0].status;
      if (!NEXT_STATUS[oldStatus]?.includes(status)) {
        throw new HttpError(409, 'invalid status transition');
      }
      if (status !== 'rejected' && !current.rows[0].approved_at) {
        throw new HttpError(409, 'report awaits approval');
      }
      const result = await client.query(
        `UPDATE public.reports r SET status = $1, updated_at = NOW()
         WHERE r.id = $2 RETURNING r.id, r.category, r.description, r.image_path,
           r.latitude, r.longitude, r.address_text, r.status, r.approved_at,
           r.created_at, r.updated_at`,
        [status, id]
      );
      updated = result.rows[0];
      await client.query(
        `INSERT INTO public.status_history
         (report_id, old_status, new_status, changed_by, change_reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, oldStatus, status, req.user.id, status === 'rejected' ? reason.trim() : null]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    res.json((await storage.withSignedImages([updated]))[0]);
  }));

  return router;
}

module.exports = { createReportsRouter };
