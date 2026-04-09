import { useLocation, useNavigate } from "react-router-dom";
import { Home, CalendarCheck, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

type NavRole = "admin" | "teacher" | "student";

interface BottomNavProps {
  role: NavRole;
  /** Total unread DM count shown on the Chat tab badge */
  chatUnreadCount?: number;
}

const TABS = [
  {
    id: "home",
    icon: Home,
    label: "Home",
    getPath: (role: NavRole) => `/${role}`,
  },
  {
    id: "attendance",
    icon: CalendarCheck,
    label: "Attendance",
    getPath: (role: NavRole) => `/${role}/attendance`,
  },
  {
    id: "chat",
    icon: MessageSquare,
    label: "Chat",
    getPath: (role: NavRole) => `/${role}/chat`,
  },
];

// Paths where BottomNav should be hidden (full-screen views)
const HIDDEN_PATHS = ["/batch/", "/dm/"];

export default function BottomNav({ role, chatUnreadCount = 0 }: BottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();

  // Hide on batch workspace and DM conversation screens
  const shouldHide = HIDDEN_PATHS.some((prefix) => location.pathname.startsWith(prefix));
  if (shouldHide) return null;

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 lg:hidden",
        "bg-card/95 backdrop-blur-md border-t border-border/50",
        "flex items-stretch"
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => {
        const path = tab.getPath(role);
        const isActive =
          tab.id === "home"
            ? location.pathname === path
            : location.pathname.startsWith(path);

        return (
          <button
            key={tab.id}
            id={`bottom-nav-${tab.id}`}
            onClick={() => navigate(path)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 transition-colors relative",
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <div className="relative">
              <motion.div
                animate={isActive ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <tab.icon
                  className={cn("w-5 h-5 transition-all", isActive ? "fill-primary/20" : "")}
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </motion.div>

              {/* Unread badge on Chat tab */}
              <AnimatePresence>
                {tab.id === "chat" && chatUnreadCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 shadow-lg"
                  >
                    {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            <span className={cn("text-[10px] font-medium transition-all", isActive ? "text-primary" : "")}>
              {tab.label}
            </span>

            {/* Active indicator dot */}
            {isActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-primary rounded-full"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
}
