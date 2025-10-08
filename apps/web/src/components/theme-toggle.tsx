"use client";

import { Button } from "./ui/button";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  return (
    <Button
      size="icon"
      variant="text"
      className="h-7"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      aria-pressed={isLight}
      aria-label={isLight ? "Switch to dark mode" : "Switch to light mode"}
    >
      {isLight ? (
        <Moon className="!size-[1.1rem]" />
      ) : (
        <Sun className="!size-[1.1rem]" />
      )}
    </Button>
  );
}
