-- Adds the administrator role. It stays in its own migration because
-- PostgreSQL cannot use a new enum value in the transaction that adds it.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
