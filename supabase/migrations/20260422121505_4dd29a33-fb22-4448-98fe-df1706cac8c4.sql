-- RPC: lookup_institute_for_signup
-- Lets anonymous users (and authenticated users) safely check whether an
-- institute code exists and whether enrollment is open for a given role,
-- WITHOUT exposing the full institutes row. The current RLS only allows
-- SELECT on institutes when status = 'approved', which prevents legit
-- students/teachers from registering against a freshly-created institute
-- that is still 'pending' super-admin approval.
--
-- This RPC bypasses RLS via SECURITY DEFINER and returns only the boolean
-- flags needed for the signup form — no PII leakage.

CREATE OR REPLACE FUNCTION public.lookup_institute_for_signup(
  p_institute_code text,
  p_role text
)
RETURNS TABLE (
  exists_flag boolean,
  enrollment_enabled boolean,
  institute_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    TRUE AS exists_flag,
    CASE
      WHEN p_role = 'student' THEN COALESCE(i.student_enrollment_enabled, true)
      WHEN p_role = 'teacher' THEN COALESCE(i.teacher_enrollment_enabled, true)
      ELSE TRUE
    END AS enrollment_enabled,
    i.status::text AS institute_status
  FROM public.institutes i
  WHERE i.institute_code = p_institute_code
  LIMIT 1;
$$;

-- Allow both anonymous and authenticated clients to call this lookup.
GRANT EXECUTE ON FUNCTION public.lookup_institute_for_signup(text, text) TO anon, authenticated;