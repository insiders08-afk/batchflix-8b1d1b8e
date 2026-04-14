
-- 1. batch_message_reads table for tracking batch group chat unread counts
CREATE TABLE IF NOT EXISTS public.batch_message_reads (
  batch_id UUID NOT NULL,
  user_id UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, user_id)
);

ALTER TABLE public.batch_message_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own read status"
  ON public.batch_message_reads FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own read status"
  ON public.batch_message_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own read status"
  ON public.batch_message_reads FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- 2. RPC to get batch unread counts for a user
CREATE OR REPLACE FUNCTION public.get_batch_unread_counts(p_user_id UUID, p_institute_code TEXT)
RETURNS TABLE(batch_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bm.batch_id, COUNT(*)::BIGINT
  FROM public.batch_messages bm
  LEFT JOIN public.batch_message_reads bmr
    ON bmr.batch_id = bm.batch_id AND bmr.user_id = p_user_id
  WHERE bm.institute_code = p_institute_code
    AND bm.created_at > COALESCE(bmr.last_read_at, '1970-01-01'::timestamptz)
    AND bm.sender_id <> p_user_id
    AND COALESCE(bm.is_deleted, false) = false
  GROUP BY bm.batch_id;
$$;

-- 3. Trigger to update last_message_preview on soft delete
CREATE OR REPLACE FUNCTION public.on_direct_message_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    UPDATE public.direct_conversations
    SET last_message_preview = (
      SELECT CASE
        WHEN dm.is_deleted THEN 'This message was deleted'
        WHEN dm.file_url IS NOT NULL AND dm.message = '' THEN '📎 ' || COALESCE(dm.file_name, 'File')
        ELSE LEFT(dm.message, 100)
      END
      FROM public.direct_messages dm
      WHERE dm.conversation_id = NEW.conversation_id
      ORDER BY dm.created_at DESC LIMIT 1
    ),
    updated_at = NOW()
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_dm_soft_delete ON public.direct_messages;
CREATE TRIGGER trg_dm_soft_delete
  AFTER UPDATE ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.on_direct_message_soft_delete();
