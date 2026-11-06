const express = require('express');
const { asyncRoute } = require('../http');

// Two fortnights, so the page can compare the last one with the one before.
const INSIGHT_DAYS = 28;

function createStatsRouter({ pool, auth }) {
  const router = express.Router();

  router.get('/overview', auth('staff'), asyncRoute(async (req, res) => {
    const [byStatus, byCategory, total, pendingReview, pendingFieldReview, pendingCompletion] = await Promise.all([
      pool.query('SELECT status, COUNT(*)::int AS count FROM public.reports GROUP BY status'),
      pool.query('SELECT category, COUNT(*)::int AS count FROM public.reports GROUP BY category'),
      pool.query('SELECT COUNT(*)::int AS total FROM public.reports'),
      pool.query(`SELECT COUNT(*)::int AS total FROM public.reports
        WHERE approved_at IS NULL AND status <> 'rejected'`),
      pool.query(`SELECT COUNT(*)::int AS total FROM public.field_issue_reviews
        WHERE decision IS NULL`),
      pool.query(`SELECT COUNT(*)::int AS total FROM public.work_completion_reviews
        WHERE decision IS NULL`),
    ]);
    res.json({
      total: total.rows[0].total,
      byStatus: byStatus.rows,
      byCategory: byCategory.rows,
      pending_review: pendingReview.rows[0].total,
      pending_field_review: pendingFieldReview.rows[0].total,
      pending_completion: pendingCompletion.rows[0].total,
    });
  }));

  // Everything the statistics page draws beyond the totals, in one request:
  // arrivals per Tripoli day for the last 28 days (two fortnights to compare),
  // each category's reports by stage, the unclaimed count, and the median wait
  // between steps across all reports.
  router.get('/insights', auth('staff'), asyncRoute(async (req, res) => {
    const [daily, breakdown, unclaimed, waits] = await Promise.all([
      pool.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COUNT(r.id)::int AS count
        FROM generate_series(
          (NOW() AT TIME ZONE 'Africa/Tripoli')::date - ${INSIGHT_DAYS - 1},
          (NOW() AT TIME ZONE 'Africa/Tripoli')::date, INTERVAL '1 day') AS d(day)
        LEFT JOIN public.reports r ON (r.created_at AT TIME ZONE 'Africa/Tripoli')::date = d.day::date
        GROUP BY d.day ORDER BY d.day`),
      pool.query(`SELECT category, CASE WHEN status = 'rejected' THEN 'rejected'
          WHEN approved_at IS NULL THEN 'pending' ELSE status::text END AS stage,
          COUNT(*)::int AS count
        FROM public.reports GROUP BY 1, 2`),
      pool.query(`SELECT COUNT(*)::int AS total FROM public.reports
        WHERE approved_at IS NOT NULL AND status = 'new' AND accepted_at IS NULL`),
      pool.query(`SELECT
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM approved_at - created_at) / 60)
            FILTER (WHERE approved_at >= created_at) AS approve,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM accepted_at - approved_at) / 60)
            FILTER (WHERE accepted_at >= approved_at) AS claim,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM work_started_at - accepted_at) / 60)
            FILTER (WHERE work_started_at >= accepted_at) AS start
        FROM public.reports WHERE status <> 'rejected'`),
    ]);
    const minutes = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);
    res.json({
      days: daily.rows,
      breakdown: breakdown.rows,
      unclaimed: unclaimed.rows[0].total,
      median_minutes: {
        approve: minutes(waits.rows[0]?.approve),
        claim: minutes(waits.rows[0]?.claim),
        start: minutes(waits.rows[0]?.start),
      },
    });
  }));

  return router;
}

module.exports = { createStatsRouter };
