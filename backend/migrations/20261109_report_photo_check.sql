-- The automatic photo check: what Claude saw in a report's photo, kept with the
-- report as a suggestion for the reviewing staff. 'other' means no clear problem
-- of any report type. The four result columns are set together or not at all;
-- ai_checked_by names the staff member who ran it again, and stays empty when the
-- check ran by itself after the report was sent. Run once on an existing hosted database.
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_category TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_confidence TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_reason VARCHAR(500);
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_checked_at TIMESTAMPTZ;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS ai_checked_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_photo_check_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_photo_check_check CHECK (
  (ai_category IS NULL AND ai_confidence IS NULL AND ai_reason IS NULL
    AND ai_checked_at IS NULL AND ai_checked_by IS NULL)
  OR (ai_category IN ('pothole', 'water_leak', 'garbage', 'other')
    AND ai_confidence IN ('high', 'medium', 'low')
    AND ai_reason IS NOT NULL AND ai_checked_at IS NOT NULL)
);
