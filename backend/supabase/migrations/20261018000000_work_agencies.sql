-- Assign reports to a responsible organization; a worker in that organization
-- claims the report before confirming that work has started.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS agency TEXT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS assigned_agency TEXT;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_agency_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_agency_check CHECK
  (agency IS NULL OR agency IN ('public_services', 'water_sewer', 'roads_maintenance'));
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_agency_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_agency_check CHECK
  (assigned_agency IS NULL OR assigned_agency IN
    ('public_services', 'water_sewer', 'roads_maintenance'));

-- Preserve existing personally assigned reports during this upgrade.
UPDATE public.reports SET assigned_agency = CASE category::text
  WHEN 'garbage' THEN 'public_services'
  WHEN 'water_leak' THEN 'water_sewer'
  ELSE 'roads_maintenance' END
WHERE assigned_worker_id IS NOT NULL AND assigned_agency IS NULL;

UPDATE public.profiles p SET agency = COALESCE(
  (SELECT r.assigned_agency FROM public.reports r
   WHERE r.assigned_worker_id = p.id ORDER BY r.assigned_at DESC NULLS LAST LIMIT 1),
  'roads_maintenance')
WHERE p.role = 'field_worker' AND p.agency IS NULL;

ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS assignment_requires_worker;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS assignment_requires_agency;
ALTER TABLE public.reports ADD CONSTRAINT assignment_requires_agency CHECK (
  (assigned_agency IS NULL AND assigned_worker_id IS NULL AND assigned_by IS NULL
    AND assigned_at IS NULL AND accepted_at IS NULL AND work_started_at IS NULL)
  OR (assigned_agency IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
);
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS acceptance_requires_worker;
ALTER TABLE public.reports ADD CONSTRAINT acceptance_requires_worker CHECK
  (accepted_at IS NULL OR assigned_worker_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_reports_assigned_agency
  ON public.reports(assigned_agency, created_at DESC)
  WHERE assigned_agency IS NOT NULL AND assigned_worker_id IS NULL;
