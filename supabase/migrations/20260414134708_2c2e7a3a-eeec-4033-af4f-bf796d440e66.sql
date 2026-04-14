
-- mark_batch_read RPC: upsert the user's last_read_at for a batch
CREATE OR REPLACE FUNCTION public.mark_batch_read(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.batch_message_reads (user_id, batch_id, last_read_at)
  VALUES (auth.uid(), p_batch_id, NOW())
  ON CONFLICT (user_id, batch_id)
  DO UPDATE SET last_read_at = NOW();
END;
$$;
