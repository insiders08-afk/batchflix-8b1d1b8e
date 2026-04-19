-- 1. Add new columns to attendance for audit + conflict resolution
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS marked_at_client_ts TIMESTAMPTZ;

-- 2. Audit table
CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attendance_id UUID NOT NULL,
  batch_id UUID NOT NULL,
  student_id UUID NOT NULL,
  institute_code TEXT NOT NULL,
  date DATE NOT NULL,
  prev_present BOOLEAN,
  new_present BOOLEAN NOT NULL,
  changed_by UUID,
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_batch_date
  ON public.attendance_audit (batch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_student
  ON public.attendance_audit (student_id, changed_at DESC);

ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Institute admins and teachers can view audit"
  ON public.attendance_audit;
CREATE POLICY "Institute admins and teachers can view audit"
  ON public.attendance_audit
  FOR SELECT
  TO authenticated
  USING (
    institute_code = public.get_my_institute_code()
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'teacher'::app_role)
    )
  );

-- 3. Trigger: write audit + maintain updated_at on UPDATE/INSERT, and reject stale offline replays
CREATE OR REPLACE FUNCTION public.attendance_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_client_ts TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_at := now();
    IF NEW.updated_by IS NULL THEN
      NEW.updated_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path: stale-replay guard
  IF NEW.marked_at_client_ts IS NOT NULL
     AND OLD.marked_at_client_ts IS NOT NULL
     AND NEW.marked_at_client_ts < OLD.marked_at_client_ts THEN
    -- Silently keep the existing (newer) row instead of overwriting
    RETURN OLD;
  END IF;

  NEW.updated_at := now();
  IF NEW.updated_by IS NULL THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_before_write ON public.attendance;
CREATE TRIGGER trg_attendance_before_write
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_before_write();

-- Audit trigger (AFTER): write before/after on every change
CREATE OR REPLACE FUNCTION public.attendance_after_write_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name TEXT;
BEGIN
  SELECT full_name INTO v_actor_name
    FROM public.profiles WHERE user_id = COALESCE(NEW.updated_by, NEW.marked_by, auth.uid())
    LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.attendance_audit
      (attendance_id, batch_id, student_id, institute_code, date,
       prev_present, new_present, changed_by, changed_by_name)
    VALUES
      (NEW.id, NEW.batch_id, NEW.student_id, NEW.institute_code, NEW.date,
       NULL, NEW.present, COALESCE(NEW.updated_by, NEW.marked_by, auth.uid()), v_actor_name);
  ELSIF TG_OP = 'UPDATE' AND OLD.present IS DISTINCT FROM NEW.present THEN
    INSERT INTO public.attendance_audit
      (attendance_id, batch_id, student_id, institute_code, date,
       prev_present, new_present, changed_by, changed_by_name)
    VALUES
      (NEW.id, NEW.batch_id, NEW.student_id, NEW.institute_code, NEW.date,
       OLD.present, NEW.present, COALESCE(NEW.updated_by, NEW.marked_by, auth.uid()), v_actor_name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_after_write_audit ON public.attendance;
CREATE TRIGGER trg_attendance_after_write_audit
  AFTER INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_after_write_audit();

-- 4. Helper RPCs
CREATE OR REPLACE FUNCTION public.get_server_today()
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.is_day_off(p_batch_id UUID, p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements
    WHERE batch_id = p_batch_id
      AND type = 'day_off'
      AND content LIKE '%day_off_date:' || to_char(p_date, 'YYYY-MM-DD') || '%'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_attendance_last_marker(p_batch_id UUID, p_date DATE)
RETURNS TABLE(
  marker_id UUID,
  marker_name TEXT,
  marked_at TIMESTAMPTZ,
  rows_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT
      COALESCE(updated_by, marked_by) AS uid,
      MAX(updated_at) AS last_at,
      COUNT(*) AS cnt
    FROM public.attendance
    WHERE batch_id = p_batch_id
      AND date = p_date
      AND institute_code = public.get_my_institute_code()
    GROUP BY COALESCE(updated_by, marked_by)
    ORDER BY MAX(updated_at) DESC
    LIMIT 1
  )
  SELECT l.uid, p.full_name, l.last_at, l.cnt
  FROM latest l
  LEFT JOIN public.profiles p ON p.user_id = l.uid;
$$;