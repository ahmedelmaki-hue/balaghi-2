-- Add a restricted field-worker role and keep assignment separate from public report status.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'field_worker';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profile_identity_by_role;
ALTER TABLE public.profiles ADD CONSTRAINT profile_identity_by_role CHECK (
  (role::text = 'citizen' AND phone IS NOT NULL AND staff_username IS NULL AND staff_auth_email IS NULL)
  OR (role::text IN ('staff', 'field_worker') AND phone IS NULL
      AND staff_username IS NOT NULL AND staff_auth_email IS NOT NULL)
);

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS assigned_worker_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_started_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reports'::regclass AND conname = 'assignment_requires_worker') THEN
    ALTER TABLE public.reports ADD CONSTRAINT assignment_requires_worker CHECK (
      (assigned_worker_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL
        AND accepted_at IS NULL AND work_started_at IS NULL)
      OR (assigned_worker_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reports'::regclass AND conname = 'start_requires_acceptance') THEN
    ALTER TABLE public.reports ADD CONSTRAINT start_requires_acceptance CHECK (
      work_started_at IS NULL OR accepted_at IS NOT NULL
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reports_assigned_worker
  ON public.reports(assigned_worker_id, created_at DESC)
  WHERE assigned_worker_id IS NOT NULL;
