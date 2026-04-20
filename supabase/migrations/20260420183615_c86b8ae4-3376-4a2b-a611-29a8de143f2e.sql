-- B8: Update trigger_announcement_push to send a per-batch / per-institute notification tag
-- so multiple announcement pushes stack on the device instead of collapsing into one.
CREATE OR REPLACE FUNCTION public.trigger_announcement_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url             TEXT;
  v_payload         JSONB;
  v_internal_secret TEXT;
  v_anon_key        TEXT;
  v_tag             TEXT;
BEGIN
  IF NEW.notify_push IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_anon_key := 'sb_publishable_cT6N9wH8r6vDZa5SglgGuA_cpFzMJ8h';

  BEGIN
    SELECT decrypted_secret INTO v_internal_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_internal_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_internal_secret := NULL;
  END;

  v_url := 'https://zakmujlzcobyiojmqlyd.supabase.co';

  -- B8: per-batch tag when scoped, else per-institute. Devices stack notifications
  -- with distinct tags so 5 announcements remain visible instead of collapsing to 1.
  IF NEW.batch_id IS NOT NULL THEN
    v_tag := 'bh-ann-' || NEW.batch_id::text;
  ELSE
    v_tag := 'bh-ann-' || NEW.institute_code || '-' || NEW.id::text;
  END IF;

  v_payload := jsonb_build_object(
    'institute_code', NEW.institute_code,
    'title',          NEW.title,
    'body',           NEW.content,
    'url',            '/student/announcements',
    'tag',            v_tag
  );

  IF NEW.batch_id IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('batch_id', NEW.batch_id);
  END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/send-push-notifications',
    body    := v_payload,
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
          'Authorization', 'Bearer ' || v_anon_key,
          'apikey',        v_anon_key
        )
    END,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[push_trigger] %', SQLERRM;
  RETURN NEW;
END;
$function$;