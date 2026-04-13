
-- Drop the restrictive policies that enforce uid-based folder paths
DROP POLICY IF EXISTS "Authenticated users can upload chat files" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own chat files" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own chat files" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own chat files" ON storage.objects;

-- Recreate with permissive bucket-level policies for authenticated users
CREATE POLICY "Authenticated users can upload chat files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-files');

CREATE POLICY "Authenticated users can update chat files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'chat-files')
WITH CHECK (bucket_id = 'chat-files');

CREATE POLICY "Authenticated users can delete chat files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'chat-files');
