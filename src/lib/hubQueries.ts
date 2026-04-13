import { supabase } from "@/integrations/supabase/client";

export interface HubBatch {
  id: string;
  name: string;
  course: string;
  teacher_id?: string | null;
  teacher_name: string | null;
  updated_at: string | null;
}

export interface HubUserProfile {
  user_id: string;
  full_name: string;
  role?: string;
  role_based_code?: string | null;
}

// ── Admin Hub ──────────────────────────────────────────────
export interface AdminHubData {
  batches: HubBatch[];
  teachers: HubUserProfile[];
  students: HubUserProfile[];
}

export const fetchAdminHubData = (instituteCode: string) => async (): Promise<AdminHubData> => {
  const [batchRes, teacherRes, studentRes] = await Promise.all([
    supabase.from("batches").select("id, name, course, teacher_name, updated_at")
      .eq("institute_code", instituteCode).eq("is_active", true)
      .order("updated_at", { ascending: false }),
    supabase.from("profiles").select("user_id, full_name, role")
      .eq("institute_code", instituteCode).eq("role", "teacher").order("full_name"),
    supabase.from("profiles").select("user_id, full_name, role")
      .eq("institute_code", instituteCode).eq("role", "student").order("full_name"),
  ]);
  return {
    batches: batchRes.data || [],
    teachers: teacherRes.data || [],
    students: studentRes.data || [],
  };
};

// ── Teacher Hub ────────────────────────────────────────────
export interface TeacherHubData {
  batches: HubBatch[];
  adminProfile: HubUserProfile | null;
}

export const fetchTeacherHubData = (instituteCode: string, userId: string) => async (): Promise<TeacherHubData> => {
  const [batchRes, adminRes] = await Promise.all([
    supabase.from("batches").select("id, name, course, teacher_name, updated_at")
      .eq("institute_code", instituteCode).eq("teacher_id", userId).eq("is_active", true)
      .order("updated_at", { ascending: false }),
    supabase.from("profiles").select("user_id, full_name")
      .eq("institute_code", instituteCode).eq("role", "admin").limit(1).single(),
  ]);
  return {
    batches: batchRes.data || [],
    adminProfile: adminRes.data || null,
  };
};

// ── Student Hub ────────────────────────────────────────────
export interface StudentHubData {
  batches: HubBatch[];
  adminProfile: HubUserProfile | null;
}

export const fetchStudentHubData = (instituteCode: string, userId: string) => async (): Promise<StudentHubData> => {
  const [enrollRes, adminRes] = await Promise.all([
    supabase.from("students_batches").select("batch_id").eq("student_id", userId),
    supabase.from("profiles").select("user_id, full_name")
      .eq("institute_code", instituteCode).eq("role", "admin").limit(1).single(),
  ]);

  let batches: HubBatch[] = [];
  if (enrollRes.data && enrollRes.data.length > 0) {
    const batchIds = enrollRes.data.map((e) => e.batch_id);
    const { data: batchData } = await supabase
      .from("batches")
      .select("id, name, course, teacher_id, teacher_name, updated_at")
      .in("id", batchIds)
      .eq("is_active", true)
      .order("updated_at", { ascending: false });
    batches = batchData || [];
  }

  return {
    batches,
    adminProfile: adminRes.data || null,
  };
};

// ── Shared constants ───────────────────────────────────────
export const HUB_STALE_TIME = 5 * 60 * 1000;  // 5 minutes
export const HUB_GC_TIME = 10 * 60 * 1000;     // 10 minutes
