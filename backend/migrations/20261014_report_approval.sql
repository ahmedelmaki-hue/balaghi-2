-- Run only for an existing Balaghi database created before approval was added.
-- Reports that were already public stay visible. New reports remain private until approved.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports'
      AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE public.reports ADD COLUMN approved_at TIMESTAMPTZ;
    -- Preserve visibility only for reports that predate this migration.
    UPDATE public.reports SET approved_at = created_at
    WHERE status <> 'rejected';
  END IF;

  ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.profiles(id);

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reports'::regclass
      AND conname = 'approval_requires_time'
  ) THEN
    ALTER TABLE public.reports ADD CONSTRAINT approval_requires_time
      CHECK (approved_by IS NULL OR approved_at IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_public_created
  ON public.reports(created_at DESC)
  WHERE approved_at IS NOT NULL AND status <> 'rejected';
