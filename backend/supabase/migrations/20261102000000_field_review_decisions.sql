-- "reassign" stopped being a field-review decision when reports became
-- assigned automatically by category; returning a report to its agency is now
-- its own action (PATCH /reports/:id/release). Drop the value, unless an older
-- database still holds reviews that used it, so their history stays valid.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.field_issue_reviews WHERE decision = 'reassign') THEN
    ALTER TABLE public.field_issue_reviews DROP CONSTRAINT IF EXISTS field_issue_reviews_decision_check;
    ALTER TABLE public.field_issue_reviews ADD CONSTRAINT field_issue_reviews_decision_check
      CHECK (decision IN ('continue', 'correct_location', 'reject'));
  END IF;
END $$;
