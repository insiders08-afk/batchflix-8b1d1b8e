
-- Re-attach all critical triggers using DROP IF EXISTS + CREATE pattern

-- 1. DM message processing (updates conversation preview + unread counts)
DROP TRIGGER IF EXISTS trg_after_direct_message_insert ON public.direct_messages;
CREATE TRIGGER trg_after_direct_message_insert
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.after_direct_message_insert();

-- 2. DM push notifications
DROP TRIGGER IF EXISTS trg_notify_dm_push ON public.direct_messages;
CREATE TRIGGER trg_notify_dm_push
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dm_push();

-- 3. Announcement push notifications
DROP TRIGGER IF EXISTS trg_announcement_push ON public.announcements;
CREATE TRIGGER trg_announcement_push
  AFTER INSERT ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_announcement_push();

-- 4. Institute owner access sync
DROP TRIGGER IF EXISTS trg_sync_institute_owner ON public.institutes;
CREATE TRIGGER trg_sync_institute_owner
  AFTER UPDATE ON public.institutes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_institute_owner_access();

-- 5. Profile name propagation
DROP TRIGGER IF EXISTS trg_sync_profile_name ON public.profiles;
CREATE TRIGGER trg_sync_profile_name
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_name_to_tables();

-- 6. Auto-create admin user_role on profile insert
DROP TRIGGER IF EXISTS trg_ensure_admin_role ON public.profiles;
CREATE TRIGGER trg_ensure_admin_role
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_admin_user_role();

-- 7. updated_at auto-maintenance triggers
DROP TRIGGER IF EXISTS update_direct_conversations_updated_at ON public.direct_conversations;
CREATE TRIGGER update_direct_conversations_updated_at
  BEFORE UPDATE ON public.direct_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_batches_updated_at ON public.batches;
CREATE TRIGGER update_batches_updated_at
  BEFORE UPDATE ON public.batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_institutes_updated_at ON public.institutes;
CREATE TRIGGER update_institutes_updated_at
  BEFORE UPDATE ON public.institutes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pending_requests_updated_at ON public.pending_requests;
CREATE TRIGGER update_pending_requests_updated_at
  BEFORE UPDATE ON public.pending_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_fees_updated_at ON public.fees;
CREATE TRIGGER update_fees_updated_at
  BEFORE UPDATE ON public.fees
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_homeworks_updated_at ON public.homeworks;
CREATE TRIGGER update_homeworks_updated_at
  BEFORE UPDATE ON public.homeworks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
