-- IMP-02: Add indexes on fees table for performance at scale
CREATE INDEX IF NOT EXISTS idx_fees_due_date_paid ON public.fees (due_date, paid) WHERE paid = false;
CREATE INDEX IF NOT EXISTS idx_fees_student_institute ON public.fees (student_id, institute_code);
CREATE INDEX IF NOT EXISTS idx_fees_institute_created ON public.fees (institute_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fees_batch ON public.fees (batch_id) WHERE batch_id IS NOT NULL;