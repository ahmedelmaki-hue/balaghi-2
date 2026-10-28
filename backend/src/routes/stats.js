const express = require('express');
const { asyncRoute } = require('../http');

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

  return router;
}

module.exports = { createStatsRouter };
