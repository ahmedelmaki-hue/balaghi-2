-- مخطط بلاغي الكامل لقاعدة PostgreSQL جديدة في Supabase.
-- Supabase Auth يدير OTP للمواطن وكلمة مرور الموظف في مخطط auth؛ ويُربط الملف الشخصي بـ auth.users.
-- لا تُخزَّن رموز OTP أو كلمات المرور في الجداول العامة.

CREATE TYPE public.user_role AS ENUM ('citizen', 'staff', 'field_worker', 'admin');
CREATE TYPE public.report_status AS ENUM ('new', 'in_progress', 'resolved', 'rejected');
CREATE TYPE public.report_category AS ENUM ('pothole', 'water_leak', 'garbage');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(100),
  phone VARCHAR(20) UNIQUE,
  staff_username VARCHAR(50) UNIQUE,
  staff_auth_email VARCHAR(150) UNIQUE,
  role public.user_role NOT NULL DEFAULT 'citizen',
  agency TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  deactivated_reason VARCHAR(500),
  deactivated_at TIMESTAMPTZ,
  deactivated_by UUID REFERENCES public.profiles(id),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_changed_at TIMESTAMPTZ,
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  admin_permissions TEXT[] NOT NULL DEFAULT '{}',
  -- رقم للتواصل مع الموظف أو العامل أو المسؤول، منفصل عن phone الذي يدخل به المواطن.
  -- يفرضه الخادم عند الإنشاء والتعديل، ويبقى فارغًا للحسابات القديمة حتى يُضاف.
  contact_phone VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profiles_contact_phone_check CHECK (
    contact_phone IS NULL OR (role <> 'citizen' AND contact_phone ~ '^\+2189[0-9]{8}$')
  ),
  CONSTRAINT profiles_agency_check CHECK (
    agency IS NULL OR agency IN ('public_services', 'water_sewer', 'roads_maintenance')
  ),
  CONSTRAINT profile_identity_by_role CHECK (
    (role = 'citizen' AND phone IS NOT NULL AND staff_username IS NULL AND staff_auth_email IS NULL)
    OR
    (role IN ('staff', 'field_worker', 'admin') AND phone IS NULL
      AND staff_username IS NOT NULL AND staff_auth_email IS NOT NULL)
  ),
  CONSTRAINT profile_deactivation_complete CHECK (
    (is_active AND deactivated_at IS NULL AND deactivated_by IS NULL AND deactivated_reason IS NULL)
    OR (NOT is_active AND deactivated_at IS NOT NULL AND deactivated_by IS NOT NULL)
  ),
  CONSTRAINT citizen_has_no_password CHECK (
    role <> 'citizen' OR (must_change_password = FALSE AND password_changed_at IS NULL)
  ),
  -- المسؤول الرئيسي يملك كل الصلاحيات؛ قائمة الصلاحيات للمسؤول العادي فقط.
  CONSTRAINT admin_flags_only_for_admins CHECK (
    (role = 'admin' OR (is_owner = FALSE AND admin_permissions = '{}'))
    AND (NOT is_owner OR admin_permissions = '{}')
  ),
  CONSTRAINT admin_permissions_valid CHECK (
    admin_permissions <@ ARRAY['manage_staff', 'manage_workers', 'manage_citizens',
      'view_audit']::TEXT[]
  ),
  CONSTRAINT staff_username_format CHECK (
    staff_username IS NULL OR staff_username ~ '^[a-z][a-z0-9_.-]{2,49}$'
  ),
  CONSTRAINT staff_auth_email_lowercase CHECK (
    staff_auth_email IS NULL OR staff_auth_email = LOWER(staff_auth_email)
  )
);

-- ينشئ المسؤول (admin) حسابات الموظفين والعمال والمسؤولين من اللوحة عبر Express:
-- مستخدم في Supabase Auth ببريد داخلي وكلمة مؤقتة، ثم صف في profiles مع
-- must_change_password = TRUE. لا يظهر البريد الداخلي في الواجهة.
-- لا يتيح API عامًا إنشاء حساب أو تعديل role. المسؤول الرئيسي (is_owner) يُنشأ بسكربت
-- على الخادم فقط، ويحدد صلاحيات المسؤولين العاديين (admin_permissions).
-- الحسابات لا تُحذف بل تُعطَّل (is_active = FALSE) حفاظًا على سجلات البلاغات.
-- full_name قد يكون فارغًا بعد أول تحقق OTP إلى أن يُكمل المواطن بياناته.

CREATE TABLE public.reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_request_id UUID NOT NULL,
  category public.report_category NOT NULL,
  description TEXT,
  image_path TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  address_text VARCHAR(255),
  status public.report_status NOT NULL DEFAULT 'new',
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id),
  assigned_agency TEXT,
  assigned_worker_id UUID REFERENCES public.profiles(id),
  assigned_by UUID REFERENCES public.profiles(id),
  assigned_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  work_started_at TIMESTAMPTZ,
  -- Automatic photo check (a suggestion for staff): what the photo shows.
  ai_category TEXT,
  ai_confidence TEXT,
  ai_reason VARCHAR(500),
  ai_checked_at TIMESTAMPTZ,
  ai_checked_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT approval_requires_time CHECK (approved_by IS NULL OR approved_at IS NOT NULL),
  CONSTRAINT reports_photo_check_check CHECK (
    (ai_category IS NULL AND ai_confidence IS NULL AND ai_reason IS NULL
      AND ai_checked_at IS NULL AND ai_checked_by IS NULL)
    OR (ai_category IN ('pothole', 'water_leak', 'garbage', 'other')
      AND ai_confidence IN ('high', 'medium', 'low')
      AND ai_reason IS NOT NULL AND ai_checked_at IS NOT NULL)
  ),
  CONSTRAINT reports_agency_check CHECK (
    assigned_agency IS NULL OR assigned_agency IN
      ('public_services', 'water_sewer', 'roads_maintenance')
  ),
  CONSTRAINT assignment_requires_agency CHECK (
    (assigned_agency IS NULL AND assigned_worker_id IS NULL AND assigned_by IS NULL
      AND assigned_at IS NULL AND accepted_at IS NULL AND work_started_at IS NULL)
    OR (assigned_agency IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
  ),
  CONSTRAINT acceptance_requires_worker CHECK (accepted_at IS NULL OR assigned_worker_id IS NOT NULL),
  CONSTRAINT start_requires_acceptance CHECK (work_started_at IS NULL OR accepted_at IS NOT NULL),
  CONSTRAINT reports_retry_unique UNIQUE (user_id, client_request_id)
);

CREATE TABLE public.status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  old_status public.report_status,
  new_status public.report_status NOT NULL,
  changed_by UUID NOT NULL REFERENCES public.profiles(id),
  change_reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rejection_requires_reason CHECK (
    new_status <> 'rejected' OR NULLIF(BTRIM(change_reason), '') IS NOT NULL
  )
);

CREATE TABLE public.field_issue_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL CHECK (reason IN
    ('not_found', 'wrong_location', 'duplicate', 'inaccessible', 'other')),
  note VARCHAR(500) NOT NULL CHECK (NULLIF(BTRIM(note), '') IS NOT NULL),
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT CHECK (decision IN ('continue', 'correct_location', 'reject')),
  decision_note VARCHAR(500),
  decided_by UUID REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ,
  corrected_latitude DOUBLE PRECISION CHECK (corrected_latitude BETWEEN -90 AND 90),
  corrected_longitude DOUBLE PRECISION CHECK (corrected_longitude BETWEEN -180 AND 180),
  CONSTRAINT field_review_decision_complete CHECK (
    (decision IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT field_review_location_pair CHECK (
    (corrected_latitude IS NULL) = (corrected_longitude IS NULL)
  )
);

CREATE TABLE public.report_verifications (
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
  ),
  CONSTRAINT verification_correction_complete CHECK (
    (corrected_latitude IS NULL AND corrected_longitude IS NULL
      AND corrected_by IS NULL AND corrected_at IS NULL)
    OR (corrected_latitude BETWEEN -90 AND 90
      AND corrected_longitude BETWEEN -180 AND 180
      AND corrected_by IS NOT NULL AND corrected_at IS NOT NULL)
  )
);

CREATE TABLE public.work_completion_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  worker_id UUID NOT NULL REFERENCES public.profiles(id),
  note VARCHAR(500),
  after_image_path TEXT,
  photo_latitude NUMERIC(9,6),
  photo_longitude NUMERIC(9,6),
  photo_accuracy_m NUMERIC(10,2),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT CHECK (decision IN ('confirmed', 'returned')),
  decision_note VARCHAR(500),
  decided_by UUID REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ,
  CONSTRAINT work_completion_decision_complete CHECK (
    (decision IS NULL AND decided_by IS NULL AND decided_at IS NULL)
    OR (decision IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CONSTRAINT work_completion_return_reason CHECK (
    decision <> 'returned' OR NULLIF(BTRIM(decision_note), '') IS NOT NULL
  ),
  CONSTRAINT work_completion_photo_location_valid CHECK (
    (photo_latitude IS NULL AND photo_longitude IS NULL AND photo_accuracy_m IS NULL)
    OR (photo_latitude BETWEEN -90 AND 90
      AND photo_longitude BETWEEN -180 AND 180
      AND photo_accuracy_m >= 0)
  )
);

CREATE TABLE public.admin_audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID NOT NULL REFERENCES public.profiles(id),
  action TEXT NOT NULL CHECK (action IN ('account_created', 'account_updated',
    'account_deactivated', 'account_reactivated', 'password_reset', 'password_changed')),
  target_id UUID REFERENCES public.profiles(id),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_role_created ON public.profiles(role, created_at DESC);
CREATE INDEX idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_target ON public.admin_audit_log(target_id, created_at DESC);
CREATE INDEX idx_reports_status_created ON public.reports(status, created_at DESC);
CREATE INDEX idx_reports_public_created ON public.reports(created_at DESC)
  WHERE approved_at IS NOT NULL AND status <> 'rejected';
CREATE INDEX idx_reports_category_created ON public.reports(category, created_at DESC);
CREATE INDEX idx_reports_location ON public.reports(latitude, longitude);
CREATE INDEX idx_reports_user_created ON public.reports(user_id, created_at DESC);
CREATE INDEX idx_reports_assigned_worker ON public.reports(assigned_worker_id, created_at DESC)
  WHERE assigned_worker_id IS NOT NULL;
CREATE INDEX idx_reports_assigned_agency ON public.reports(assigned_agency, created_at DESC)
  WHERE assigned_agency IS NOT NULL AND assigned_worker_id IS NULL;
CREATE INDEX idx_status_history_report ON public.status_history(report_id, changed_at DESC);
CREATE UNIQUE INDEX idx_field_issue_one_pending ON public.field_issue_reviews(report_id)
  WHERE decision IS NULL;
CREATE INDEX idx_field_issue_pending ON public.field_issue_reviews(raised_at DESC)
  WHERE decision IS NULL;
CREATE INDEX idx_field_issue_report ON public.field_issue_reviews(report_id, raised_at DESC);
CREATE UNIQUE INDEX idx_report_one_open_verification ON public.report_verifications(report_id)
  WHERE result IS NULL;
CREATE INDEX idx_report_verifications_agency
  ON public.report_verifications(agency, requested_at DESC) WHERE result IS NULL;
CREATE INDEX idx_report_verifications_report
  ON public.report_verifications(report_id, requested_at DESC);
CREATE UNIQUE INDEX idx_work_completion_one_pending ON public.work_completion_reviews(report_id)
  WHERE decision IS NULL;
CREATE INDEX idx_work_completion_pending ON public.work_completion_reviews(submitted_at ASC)
  WHERE decision IS NULL;
CREATE INDEX idx_work_completion_report ON public.work_completion_reviews(report_id, submitted_at DESC);

-- يمر الوصول إلى هذه الجداول عبر Express في هذا التصميم.
-- يُفصل الرد العام عن رد الموظف داخل API، وتُحفظ أسرار قاعدة البيانات والخدمة على الخادم.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_issue_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_completion_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.reports, public.status_history,
  public.field_issue_reviews, public.report_verifications,
  public.work_completion_reviews, public.admin_audit_log FROM anon, authenticated;
-- إذا تقرر لاحقًا وصول Flutter/React إلى الجداول مباشرة، يلزم إضافة منح وصلاحيات RLS
-- دقيقة ومختبرة قبل تفعيل ذلك المسار.
