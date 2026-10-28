-- A field worker can raise a concern, but only staff can decide its outcome.
CREATE TABLE IF NOT EXISTS public.field_issue_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL CHECK (reason IN
    ('not_found', 'wrong_location', 'duplicate', 'inaccessible', 'other')),
  note VARCHAR(500) NOT NULL CHECK (NULLIF(BTRIM(note), '') IS NOT NULL),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT CHECK (decision IN ('continue', 'correct_location', 'reassign', 'reject')),
  decision_note VARCHAR(500),
  decided_by UUID REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ,
  corrected_latitude DOUBLE PRECISION CHECK (corrected_latitude BETWEEN -90 AND 90),
  corrected_longitude DOUBLE PRECISION CHECK (corrected_longitude BETWEEN -180 AND 180),
  CONSTRAINT field_review_decision_complete CHECK (
    (decision IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT field_review_location_pair CHECK (
    (corrected_latitude IS NULL) = (corrected_longitude IS NULL)
  )
);

-- Re-running the local migration also upgrades an earlier copy of this table.
ALTER TABLE public.field_issue_reviews
  DROP CONSTRAINT IF EXISTS field_issue_reviews_decision_check;
ALTER TABLE public.field_issue_reviews
  ADD CONSTRAINT field_issue_reviews_decision_check CHECK
    (decision IN ('continue', 'correct_location', 'reassign', 'reject'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_issue_one_pending
  ON public.field_issue_reviews(report_id) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_field_issue_pending
  ON public.field_issue_reviews(raised_at DESC) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_field_issue_report
  ON public.field_issue_reviews(report_id, raised_at DESC);

ALTER TABLE public.field_issue_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.field_issue_reviews FROM anon, authenticated;
