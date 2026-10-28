-- Route approved, unclaimed legacy reports to the agency for their category.
-- Approval now assigns new reports atomically; this only repairs older records.
UPDATE public.reports
SET assigned_agency = CASE category::text
      WHEN 'garbage' THEN 'public_services'
      WHEN 'water_leak' THEN 'water_sewer'
      WHEN 'pothole' THEN 'roads_maintenance'
    END,
    assigned_by = approved_by,
    assigned_at = COALESCE(approved_at, NOW()),
    updated_at = NOW()
WHERE approved_at IS NOT NULL
  AND approved_by IS NOT NULL
  AND status = 'new'
  AND assigned_agency IS NULL
  AND assigned_worker_id IS NULL
  AND category::text IN ('garbage', 'water_leak', 'pothole');
