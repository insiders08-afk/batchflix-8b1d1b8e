
-- Drop all potentially existing triggers first
DROP TRIGGER IF EXISTS trg_after_direct_message_insert ON public.direct_messages;
DROP TRIGGER IF EXISTS trg_notify_dm_push ON public.direct_messages;
DROP TRIGGER IF EXISTS trg_announcement_push ON public.announcements;
DROP TRIGGER IF EXISTS trg_sync_institute_owner_access ON public.institutes;
DROP TRIGGER IF EXISTS trg_ensure_admin_user_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_sync_profile_name ON public.profiles;
DROP TRIGGER IF EXISTS trg_updated_at_institutes ON public.institutes;
DROP TRIGGER IF EXISTS trg_updated_at_batches ON public.batches;
DROP TRIGGER IF EXISTS trg_updated_at_direct_conversations ON public.direct_conversations;
DROP TRIGGER IF EXISTS trg_updated_at_fees ON public.fees;
DROP TRIGGER IF EXISTS trg_updated_at_homeworks ON public.homeworks;
DROP TRIGGER IF EXISTS trg_updated_at_pending_requests ON public.pending_requests;
DROP TRIGGER IF EXISTS trg_updated_at_batch_teacher_requests ON public.batch_teacher_requests;

-- 1. DM message processing
CREATE TRIGGER trg_after_direct_message_insert
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.after_direct_message_insert();

-- 2. DM push notifications
CREATE TRIGGER trg_notify_dm_push
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_dm_push();

-- 3. Announcement push notifications
CREATE TRIGGER trg_announcement_push
  AFTER INSERT ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_announcement_push();

-- 4. Institute owner access sync
CREATE TRIGGER trg_sync_institute_owner_access
  AFTER INSERT OR UPDATE ON public.institutes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_institute_owner_access();

-- 5. Admin role auto-creation
CREATE TRIGGER trg_ensure_admin_user_role
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_admin_user_role();

-- 6. Profile name sync
CREATE TRIGGER trg_sync_profile_name
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_name_to_tables();

-- 7. Updated_at triggers
CREATE TRIGGER trg_updated_at_institutes
  BEFORE UPDATE ON public.institutes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_batches
  BEFORE UPDATE ON public.batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_direct_conversations
  BEFORE UPDATE ON public.direct_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_fees
  BEFORE UPDATE ON public.fees
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_homeworks
  BEFORE UPDATE ON public.homeworks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_pending_requests
  BEFORE UPDATE ON public.pending_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_updated_at_batch_teacher_requests
  BEFORE UPDATE ON public.batch_teacher_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
