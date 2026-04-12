
-- Add teacher_student to dm_type enum
ALTER TYPE public.dm_type ADD VALUE IF NOT EXISTS 'teacher_student';
