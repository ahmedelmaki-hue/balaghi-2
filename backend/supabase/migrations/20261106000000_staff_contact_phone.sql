-- A contact number for administrators, staff and field workers, kept apart from
-- the citizen sign-in phone (profiles.phone), which must stay unique and empty for
-- staff. The server requires it for new accounts and on every edit; the column
-- stays nullable so accounts created before this change keep working until an
-- administrator adds their number. Run once on an existing hosted database.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_contact_phone_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_contact_phone_check CHECK (
  contact_phone IS NULL
  OR (role <> 'citizen' AND contact_phone ~ '^\+2189[0-9]{8}$')
);
