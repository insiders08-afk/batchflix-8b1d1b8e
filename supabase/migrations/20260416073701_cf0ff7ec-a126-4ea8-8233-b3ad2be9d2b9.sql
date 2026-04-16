
-- Optimize RLS policies on high-traffic tables by using (select auth.uid()) sub-select
-- This caches the auth.uid() result per-query instead of evaluating per-row

-- direct_messages: SELECT policy
DROP POLICY IF EXISTS "Conversation participants can read messages" ON public.direct_messages;
CREATE POLICY "Conversation participants can read messages"
ON public.direct_messages FOR SELECT TO authenticated
USING (
  institute_code = get_my_institute_code()
  AND EXISTS (
    SELECT 1 FROM direct_conversations dc
    WHERE dc.id = direct_messages.conversation_id
      AND (dc.admin_id = (select auth.uid()) OR dc.other_user_id = (select auth.uid()))
  )
);

-- direct_messages: INSERT policy
DROP POLICY IF EXISTS "Participants can send messages" ON public.direct_messages;
CREATE POLICY "Participants can send messages"
ON public.direct_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = (select auth.uid())
  AND institute_code = get_my_institute_code()
  AND EXISTS (
    SELECT 1 FROM direct_conversations dc
    WHERE dc.id = direct_messages.conversation_id
      AND (dc.admin_id = (select auth.uid()) OR dc.other_user_id = (select auth.uid()))
  )
);

-- direct_messages: UPDATE policy
DROP POLICY IF EXISTS "Participants can update messages" ON public.direct_messages;
CREATE POLICY "Participants can update messages"
ON public.direct_messages FOR UPDATE TO authenticated
USING (
  institute_code = get_my_institute_code()
  AND EXISTS (
    SELECT 1 FROM direct_conversations dc
    WHERE dc.id = direct_messages.conversation_id
      AND (dc.admin_id = (select auth.uid()) OR dc.other_user_id = (select auth.uid()))
  )
);

-- batch_messages: INSERT policy
DROP POLICY IF EXISTS "Institute members can send messages" ON public.batch_messages;
CREATE POLICY "Institute members can send messages"
ON public.batch_messages FOR INSERT TO authenticated
WITH CHECK (sender_id = (select auth.uid()) AND institute_code = get_my_institute_code());

-- batch_message_reads: INSERT policy
DROP POLICY IF EXISTS "Users can insert own read status" ON public.batch_message_reads;
CREATE POLICY "Users can insert own read status"
ON public.batch_message_reads FOR INSERT TO authenticated
WITH CHECK (user_id = (select auth.uid()));

-- batch_message_reads: UPDATE policy
DROP POLICY IF EXISTS "Users can update own read status" ON public.batch_message_reads;
CREATE POLICY "Users can update own read status"
ON public.batch_message_reads FOR UPDATE TO authenticated
USING (user_id = (select auth.uid()));

-- batch_message_reads: SELECT policy
DROP POLICY IF EXISTS "Users can view own read status" ON public.batch_message_reads;
CREATE POLICY "Users can view own read status"
ON public.batch_message_reads FOR SELECT TO authenticated
USING (user_id = (select auth.uid()));

-- direct_conversations: SELECT policy
DROP POLICY IF EXISTS "Participants can view own conversations" ON public.direct_conversations;
CREATE POLICY "Participants can view own conversations"
ON public.direct_conversations FOR SELECT TO authenticated
USING (
  institute_code = get_my_institute_code()
  AND (admin_id = (select auth.uid()) OR other_user_id = (select auth.uid()))
);

-- direct_conversations: UPDATE policy
DROP POLICY IF EXISTS "Participants can update own conversations" ON public.direct_conversations;
CREATE POLICY "Participants can update own conversations"
ON public.direct_conversations FOR UPDATE TO authenticated
USING (
  institute_code = get_my_institute_code()
  AND (admin_id = (select auth.uid()) OR other_user_id = (select auth.uid()))
)
WITH CHECK (
  institute_code = get_my_institute_code()
  AND (admin_id = (select auth.uid()) OR other_user_id = (select auth.uid()))
);
