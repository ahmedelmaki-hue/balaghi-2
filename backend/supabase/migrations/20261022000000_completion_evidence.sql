-- Keep evidence captured after field work private to staff review.
ALTER TABLE public.work_completion_reviews
  ADD COLUMN IF NOT EXISTS after_image_path TEXT,
  ADD COLUMN IF NOT EXISTS photo_latitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS photo_longitude NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS photo_accuracy_m NUMERIC(10,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_completion_photo_location_valid') THEN
    ALTER TABLE public.work_completion_reviews
      ADD CONSTRAINT work_completion_photo_location_valid CHECK (
        (photo_latitude IS NULL AND photo_longitude IS NULL AND photo_accuracy_m IS NULL)
        OR (photo_latitude BETWEEN -90 AND 90
          AND photo_longitude BETWEEN -180 AND 180
          AND photo_accuracy_m >= 0)
      );
  END IF;
END $$;
