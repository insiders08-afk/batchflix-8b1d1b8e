-- Remove duplicate triggers on direct_messages table
DROP TRIGGER IF EXISTS trg_after_dm_insert ON public.direct_messages;
DROP TRIGGER IF EXISTS trg_notify_dm_push ON public.direct_messages;