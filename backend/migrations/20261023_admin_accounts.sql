-- Account administration: deactivation instead of deletion, a forced change of
-- temporary passwords, owner administrators with permissions they grant to other
-- administrators, and an audit record of every administrative action.
-- Every statement can run again safely on a database that already has an earlier version.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deactivated_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_permissions TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profile_identity_by_role;
ALTER TABLE public.profiles ADD CONSTRAINT profile_identity_by_role CHECK (
  (role = 'citizen' AND phone IS NOT NULL AND staff_username IS NULL AND staff_auth_email IS NULL)
  OR
  (role IN ('staff', 'field_worker', 'admin') AND phone IS NULL
    AND staff_username IS NOT NULL AND staff_auth_email IS NOT NULL)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_deactivation_complete') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profile_deactivation_complete CHECK (
      (is_active AND deactivated_at IS NULL AND deactivated_by IS NULL AND deactivated_reason IS NULL)
      OR (NOT is_active AND deactivated_at IS NOT NULL AND deactivated_by IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citizen_has_no_password') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT citizen_has_no_password CHECK (
      role <> 'citizen' OR (must_change_password = FALSE AND password_changed_at IS NULL)
    );
  END IF;
  -- Owner status and permissions belong to administrators only. An owner holds
  -- every permission, so its own list stays empty.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_flags_only_for_admins') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT admin_flags_only_for_admins CHECK (
      (role = 'admin' OR (is_owner = FALSE AND admin_permissions = '{}'))
      AND (NOT is_owner OR admin_permissions = '{}')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_permissions_valid') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT admin_permissions_valid CHECK (
      admin_permissions <@ ARRAY['manage_staff', 'manage_workers', 'manage_citizens',
        'view_audit']::TEXT[]
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('account_created', 'account_updated',
    'account_deactivated', 'account_reactivated', 'password_reset', 'password_changed')),
  target_id UUID REFERENCES public.profiles(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_created ON public.profiles(role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON public.admin_audit_log(target_id, created_at DESC);

-- Administrators created by the server script before owners existed become owners.
UPDATE public.profiles p SET is_owner = TRUE, admin_permissions = '{}'
WHERE p.role = 'admin' AND NOT p.is_owner AND EXISTS (
  SELECT 1 FROM public.admin_audit_log a
  WHERE a.target_id = p.id AND a.action = 'account_created'
    AND a.details->>'source' = 'server script'
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
