-- تصميم مستهدف لبلاغي على PostgreSQL في Supabase، قبل بدء التنفيذ.
-- Supabase Auth يدير OTP للمواطن وكلمة مرور الموظف في مخطط auth؛ ويُربط الملف الشخصي بـ auth.users.
-- لا تُخزَّن رموز OTP أو كلمات المرور في الجداول العامة.

CREATE TYPE public.user_role AS ENUM ('citizen', 'staff');
CREATE TYPE public.report_status AS ENUM ('new', 'in_progress', 'resolved', 'rejected');
CREATE TYPE public.report_category AS ENUM ('pothole', 'water_leak', 'garbage');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name VARCHAR(100),
  phone VARCHAR(20) UNIQUE,
  staff_username VARCHAR(50) UNIQUE,
  staff_auth_email VARCHAR(150) UNIQUE,
  role public.user_role NOT NULL DEFAULT 'citizen',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_identity_by_role CHECK (
    (role = 'citizen' AND phone IS NOT NULL AND staff_username IS NULL AND staff_auth_email IS NULL)
    OR
    (role = 'staff' AND phone IS NULL AND staff_username IS NOT NULL AND staff_auth_email IS NOT NULL)
  ),
  CONSTRAINT staff_username_format CHECK (
    staff_username IS NULL OR staff_username ~ '^[a-z][a-z0-9_.-]{2,49}$'
  ),
  CONSTRAINT staff_auth_email_lowercase CHECK (
    staff_auth_email IS NULL OR staff_auth_email = LOWER(staff_auth_email)
  )
);

-- ينشئ المسؤول حساب موظف بالبريد وكلمة المرور في Supabase Auth، ثم يربط معرّفه
-- باسم مستخدم وبريد داخلي في profiles. لا يظهر البريد الداخلي في واجهة الموظف.
-- لا يتيح API عامًا إنشاء موظف أو تعديل role.
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT approval_requires_time CHECK (approved_by IS NULL OR approved_at IS NOT NULL),
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

CREATE INDEX idx_reports_status_created ON public.reports(status, created_at DESC);
CREATE INDEX idx_reports_public_created ON public.reports(created_at DESC)
  WHERE approved_at IS NOT NULL AND status <> 'rejected';
CREATE INDEX idx_reports_category_created ON public.reports(category, created_at DESC);
CREATE INDEX idx_reports_location ON public.reports(latitude, longitude);
CREATE INDEX idx_reports_user_created ON public.reports(user_id, created_at DESC);
CREATE INDEX idx_status_history_report ON public.status_history(report_id, changed_at DESC);

-- يمر الوصول إلى هذه الجداول عبر Express في هذا التصميم.
-- يُفصل الرد العام عن رد الموظف داخل API، وتُحفظ أسرار قاعدة البيانات والخدمة على الخادم.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles, public.reports, public.status_history FROM anon, authenticated;
-- إذا تقرر لاحقًا وصول Flutter/React إلى الجداول مباشرة، يلزم إضافة منح وصلاحيات RLS
-- دقيقة ومختبرة قبل تفعيل ذلك المسار.
