-- A2: Index attendance_audit for performant LastMarkedBanner queries + add cleanup function
CREATE INDEX IF NOT EXISTS idx_attendance_audit_batch_date_changed
  ON public.attendance_audit (batch_id, date, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_changed_at
  ON public.attendance_audit (changed_at);

-- A2: Purge function to delete audit rows older than 90 days. Safe to call from a cron / manually.
CREATE OR REPLACE FUNCTION public.purge_old_attendance_audit(p_days int DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count bigint;
BEGIN
  WITH deleted AS (
    DELETE FROM public.attendance_audit
    WHERE changed_at < now() - (p_days || ' days')::interval
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;

-- A6: Push subscriptions — replace with composite uniqueness so multiple devices coexist.
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_key,
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_endpoint_key;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);

-- A8: notify_dm_push trigger — read service-role key from Vault (push_internal_secret already exists),
-- and pass it via the x-internal-secret header that send-push-notifications already accepts.
CREATE OR REPLACE FUNCTION public.notify_dm_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_admin_id        UUID;
  v_other_user_id   UUID;
  v_recipient_id    UUID;
  v_preview         TEXT;
  v_internal_secret TEXT;
  v_anon_key        TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpha211amx6Y29ieWlvam1xbHlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNTU4ODAsImV4cCI6MjA4OTgzMTg4MH0.QauAK42oKBs9jdKOYWbM3w_t9wSOuwzsDu2cpV87nDc';
BEGIN
  SELECT admin_id, other_user_id INTO v_admin_id, v_other_user_id
  FROM direct_conversations WHERE id = NEW.conversation_id;

  IF NEW.sender_id = v_admin_id THEN
    v_recipient_id := v_other_user_id;
  ELSE
    v_recipient_id := v_admin_id;
  END IF;

  v_preview := CASE
    WHEN NEW.file_url IS NOT NULL AND NEW.message = '' THEN '📎 ' || COALESCE(NEW.file_name, 'File')
    ELSE LEFT(NEW.message, 100)
  END;

  BEGIN
    SELECT decrypted_secret INTO v_internal_secret
    FROM vault.decrypted_secrets WHERE name = 'push_internal_secret' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_internal_secret := NULL;
  END;

  BEGIN
    PERFORM net.http_post(
      url     := 'https://zakmujlzcobyiojmqlyd.supabase.co/functions/v1/send-push-notifications',
      headers := CASE
        WHEN v_internal_secret IS NOT NULL THEN
          jsonb_build_object(
            'Content-Type',      'application/json',
            'Authorization',     'Bearer ' || v_anon_key,
            'apikey',            v_anon_key,
            'x-internal-secret', v_internal_secret
          )
        ELSE
          jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization','Bearer ' || v_anon_key,
            'apikey',       v_anon_key
          )
      END,
      body := jsonb_build_object(
        'type',             'dm',
        'institute_code',   NEW.institute_code,
        'target_user_ids',  jsonb_build_array(v_recipient_id::text),
        'title',            NEW.sender_name,
        'body',             v_preview,
        'url',              '/dm/' || NEW.conversation_id::text,
        'tag',              'bh-dm-' || NEW.conversation_id::text
      )::text,
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'DM push notification failed (non-fatal): %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- A10: stale-replay guard — also block INSERT-via-replay if the row was deleted online recently.
-- We use a small "tombstone" table to record deletions and refuse to resurrect them via stale offline replays.
CREATE TABLE IF NOT EXISTS public.attendance_tombstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  student_id uuid NOT NULL,
  date date NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid
);

CREATE INDEX IF NOT EXISTS idx_attendance_tombstones_lookup
  ON public.attendance_tombstones (batch_id, student_id, date, deleted_at DESC);

ALTER TABLE public.attendance_tombstones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Institute teachers/admins read tombstones"
  ON public.attendance_tombstones FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.batch_id = attendance_tombstones.batch_id
      AND a.institute_code = public.get_my_institute_code()
  ) OR EXISTS (
    SELECT 1 FROM public.batches b
    WHERE b.id = attendance_tombstones.batch_id
      AND b.institute_code = public.get_my_institute_code()
  ));

-- Trigger: when an attendance row is deleted, write a tombstone.
CREATE OR REPLACE FUNCTION public.attendance_after_delete_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.attendance_tombstones (batch_id, student_id, date, deleted_by)
  VALUES (OLD.batch_id, OLD.student_id, OLD.date, auth.uid());
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_after_delete_tombstone ON public.attendance;
CREATE TRIGGER trg_attendance_after_delete_tombstone
  AFTER DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.attendance_after_delete_tombstone();

-- A10: harden attendance_before_write — refuse INSERT if a newer tombstone exists.
CREATE OR REPLACE FUNCTION public.attendance_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tomb_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Stale-replay guard: if an admin deleted this row online AFTER the offline write was captured,
    -- refuse to resurrect it.
    IF NEW.marked_at_client_ts IS NOT NULL THEN
      SELECT MAX(deleted_at) INTO v_tomb_at
      FROM public.attendance_tombstones
      WHERE batch_id = NEW.batch_id AND student_id = NEW.student_id AND date = NEW.date;

      IF v_tomb_at IS NOT NULL AND v_tomb_at > NEW.marked_at_client_ts THEN
        RETURN NULL; -- silently drop the stale replay
      END IF;
    END IF;

    NEW.updated_at := now();
    IF NEW.updated_by IS NULL THEN NEW.updated_by := auth.uid(); END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path: stale-replay guard
  IF NEW.marked_at_client_ts IS NOT NULL
     AND OLD.marked_at_client_ts IS NOT NULL
     AND NEW.marked_at_client_ts < OLD.marked_at_client_ts THEN
    RETURN OLD;
  END IF;

  NEW.updated_at := now();
  IF NEW.updated_by IS NULL THEN NEW.updated_by := auth.uid(); END IF;
  RETURN NEW;
END;
$function$;
