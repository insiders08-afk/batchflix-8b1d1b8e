import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Utility: generate a stable avatar color from a name string
// ──────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-rose-500",
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function getInitials(name: string): string {
  return (name || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ──────────────────────────────────────────────────────────────
// formatRelativeTime — WhatsApp-style time formatting
// ──────────────────────────────────────────────────────────────
export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return timeStr;
  if (isYesterday) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ──────────────────────────────────────────────────────────────
// ChatListItem — single row in any chat hub list
// ──────────────────────────────────────────────────────────────
interface ChatListItemProps {
  name: string;
  subtitle?: string;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount?: number;
  onClick?: () => void;
  loading?: boolean;
  isGroup?: boolean;
}

export function ChatListItem({
  name,
  subtitle,
  lastMessage,
  lastMessageAt,
  unreadCount = 0,
  onClick,
  isGroup = false,
}: ChatListItemProps) {
  const initials = getInitials(name);
  const bgColor = avatarColor(name);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 active:bg-muted transition-colors border-b border-border/30 last:border-b-0 text-left"
      style={{ minHeight: 72 }}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0",
          isGroup ? "gradient-hero" : bgColor
        )}
      >
        {initials}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm text-foreground truncate">{name}</span>
          {lastMessageAt && (
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              {formatRelativeTime(lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[13px] text-muted-foreground truncate">
            {lastMessage ?? (subtitle ?? "No messages yet")}
          </span>
          {unreadCount > 0 && (
            <span className="flex-shrink-0 bg-primary text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        {lastMessage && subtitle && (
          <span className="text-[11px] text-muted-foreground/60">{subtitle}</span>
        )}
      </div>
    </button>
  );
}
