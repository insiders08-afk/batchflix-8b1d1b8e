import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface ThemeToggleProps {
  showLabel?: boolean;
  variant?: "ghost" | "outline" | "default";
  className?: string;
}

export function ThemeToggle({ showLabel = false, variant = "ghost", className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant={variant} size={showLabel ? "default" : "icon"} className={className} disabled>
        <Sun className="w-4 h-4" />
        {showLabel && <span className="ml-2 text-sm">Light</span>}
      </Button>
    );
  }

  const isDark = theme === "dark";

  return (
    <Button
      variant={variant}
      size={showLabel ? "default" : "icon"}
      className={className}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      {showLabel && <span className="ml-2 text-sm">{isDark ? "Light Mode" : "Dark Mode"}</span>}
    </Button>
  );
}
