// ──────────────────────────────────────────────────────────────
// BatchHub — Chat & DM Type Definitions
// ──────────────────────────────────────────────────────────────

export type DmType = "admin_teacher" | "admin_student" | "teacher_student";

export interface DirectConversation {
  id: string;
  institute_code: string;
  dm_type: DmType;
  admin_id: string;
  other_user_id: string;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
  last_message_at: string | null;
  admin_unread_count: number;
  other_user_unread_count: number;
  // Joined fields (populated client-side after fetch)
  other_user_name?: string;
  other_user_role?: string;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  institute_code: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  message: string;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  reply_to_id: string | null;
  reactions: Record<string, string[]>;
  is_deleted: boolean;
  is_edited: boolean;
  created_at: string;
  // Computed client-side
  isSelf?: boolean;
}

// Batch last message (from get_batch_last_messages RPC)
export interface BatchLastMessage {
  batch_id: string;
  last_message: string;
  last_message_at: string;
  sender_name: string;
}

// Helper to determine other user's role from dm_type
export function getOtherRoleFromDmType(dmType: DmType, isAdminSide: boolean): string {
  const roleMap: Record<DmType, [string, string]> = {
    admin_teacher: ["admin", "teacher"],
    admin_student: ["admin", "student"],
    teacher_student: ["teacher", "student"],
  };
  const [adminSideRole, otherSideRole] = roleMap[dmType];
  return isAdminSide ? otherSideRole : adminSideRole;
}
