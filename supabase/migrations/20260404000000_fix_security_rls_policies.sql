-- ============================================================
-- SECURITY FIX 1: super_admin_applications SELECT policy
-- Problem: USING (true) exposes PII (full_name, email, phone,
--          position, city, facial_image_url) to ALL authenticated users
-- Fix: Restrict SELECT to app_owner role only
-- ============================================================

-- Drop the overly-permissive SELECT policy
DROP POLICY IF EXISTS "Admins can look up city partner contact" ON public.super_admin_applications;

-- Create a new restricted SELECT policy: only app_owner can read applications
CREATE POLICY "App owner can read super admin applications"
  ON public.super_admin_applications
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'app_owner'::app_role));

-- ============================================================
-- SECURITY FIX 2: profiles INSERT policy
-- Problem: anon role with WITH CHECK (true) allows unauthenticated
--          callers to create profiles for arbitrary user_id values
-- Fix: Restrict to authenticated role only AND require user_id = auth.uid()
-- ============================================================

-- Drop the permissive anon insert policy
DROP POLICY IF EXISTS "Anyone can insert profile during signup" ON public.profiles;

-- Create a secure insert policy: only authenticated users, only for their own user_id
CREATE POLICY "Authenticated users can insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- SECURITY FIX 3: pending_requests UPDATE policy
-- Problem: UPDATE uses only USING (user_id = auth.uid()) with no WITH CHECK,
--          allowing users to freely change role, institute_code, or status
-- Fix: Add WITH CHECK that prevents changes to protected fields
-- ============================================================

-- Drop the policy without WITH CHECK
DROP POLICY IF EXISTS "Users can update own pending request" ON public.pending_requests;

-- Recreate with WITH CHECK: only allow updates while request is still pending,
-- and the role and institute_code cannot be changed
CREATE POLICY "Users can update own pending request"
  ON public.pending_requests
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND status = 'pending'::user_status)
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'::user_status
    AND role = (SELECT role FROM public.pending_requests WHERE id = pending_requests.id LIMIT 1)
    AND institute_code = (SELECT institute_code FROM public.pending_requests WHERE id = pending_requests.id LIMIT 1)
  );

-- ============================================================
-- SECURITY FIX 4, 5 & 6: Storage object-level RLS policies
-- Problem: No RLS policies on storage.objects for any of the three
--          buckets (applicant-photos, homework-files, chat-files)
--          — any authenticated or anonymous user can upload, overwrite,
--          or delete files belonging to other users
-- Fix: Add per-bucket INSERT/SELECT/DELETE policies tied to user identity
-- ============================================================

-- ----- applicant-photos bucket -----
-- Only authenticated users can upload applicant photos
CREATE POLICY "Authenticated users can upload applicant photos"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'applicant-photos');

-- Anyone (public) can read applicant photos (bucket is public)
CREATE POLICY "Public can read applicant photos"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'applicant-photos');

-- Only app_owner can delete applicant photos
CREATE POLICY "App owner can delete applicant photos"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'applicant-photos' AND has_role(auth.uid(), 'app_owner'::app_role));

-- ----- homework-files bucket -----
-- Teachers and admins can upload homework files
CREATE POLICY "Teachers and admins can upload homework files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'homework-files'
    AND (has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

-- Authenticated users can read homework files
CREATE POLICY "Authenticated users can read homework files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'homework-files');

-- Teachers and admins can delete homework files
CREATE POLICY "Teachers and admins can delete homework files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'homework-files'
    AND (has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

-- ----- chat-files bucket -----
-- Authenticated users can upload chat files, scoped to their own folder (uid/)
CREATE POLICY "Authenticated users can upload chat files"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated users can read chat files
CREATE POLICY "Authenticated users can read chat files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-files');

-- Users can delete only their own chat files; admins/app_owner can delete any
CREATE POLICY "Users can delete own chat files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-files'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'app_owner'::app_role)
    )
  );
