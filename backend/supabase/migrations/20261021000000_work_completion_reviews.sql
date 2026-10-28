-- A worker submits finished work; staff confirms resolution or returns it for more work.
CREATE TABLE IF NOT EXISTS public.work_completion_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id),
  note VARCHAR(500),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT CHECK (decision IN ('confirmed', 'returned')),
  decision_note VARCHAR(500),
  decided_by UUID REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ,
  CONSTRAINT work_completion_decision_complete CHECK (
    (decision IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT work_completion_return_reason CHECK (
    decision <> 'returned' OR NULLIF(BTRIM(decision_note), '') IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_completion_one_pending
  ON public.work_completion_reviews(report_id) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_completion_pending
  ON public.work_completion_reviews(submitted_at ASC) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_completion_report
  ON public.work_completion_reviews(report_id, submitted_at DESC);

ALTER TABLE public.work_completion_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.work_completion_reviews FROM anon, authenticated;
