-- Optional on-site verification before staff publishes a citizen report.
CREATE TABLE IF NOT EXISTS public.report_verifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  agency TEXT NOT NULL CHECK (agency IN
    ('public_services', 'water_sewer', 'roads_maintenance')),
  requested_by UUID NOT NULL REFERENCES public.profiles(id),
  request_note VARCHAR(500) NOT NULL CHECK (NULLIF(BTRIM(request_note), '') IS NOT NULL),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by UUID REFERENCES public.profiles(id),
  claimed_at TIMESTAMPTZ,
  result TEXT CHECK (result IN
    ('exists', 'wrong_location', 'not_found', 'unable', 'cancelled')),
  result_note VARCHAR(500),
  completed_by UUID REFERENCES public.profiles(id),
  completed_at TIMESTAMPTZ,
  corrected_latitude DOUBLE PRECISION CHECK (corrected_latitude BETWEEN -90 AND 90),
  corrected_longitude DOUBLE PRECISION CHECK (corrected_longitude BETWEEN -180 AND 180),
  corrected_by UUID REFERENCES public.profiles(id),
  corrected_at TIMESTAMPTZ,
  CONSTRAINT verification_claim_pair CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  CONSTRAINT verification_completion_pair CHECK (
    (result IS NULL AND result_note IS NULL AND completed_by IS NULL AND completed_at IS NULL)
    OR (result IS NOT NULL AND result_note IS NOT NULL
      AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
  )
);

ALTER TABLE public.report_verifications
  ADD COLUMN IF NOT EXISTS corrected_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS corrected_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

ALTER TABLE public.report_verifications
  DROP CONSTRAINT IF EXISTS verification_correction_complete;
ALTER TABLE public.report_verifications
  ADD CONSTRAINT verification_correction_complete CHECK (
    (corrected_latitude IS NULL AND corrected_longitude IS NULL
      AND corrected_by IS NULL AND corrected_at IS NULL)
    OR (corrected_latitude BETWEEN -90 AND 90
      AND corrected_longitude BETWEEN -180 AND 180
      AND corrected_by IS NOT NULL AND corrected_at IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_one_open_verification
  ON public.report_verifications(report_id) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS idx_report_verifications_agency
  ON public.report_verifications(agency, requested_at DESC) WHERE result IS NULL;
CREATE INDEX IF NOT EXISTS idx_report_verifications_report
  ON public.report_verifications(report_id, requested_at DESC);

ALTER TABLE public.report_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_verifications FROM anon, authenticated;
