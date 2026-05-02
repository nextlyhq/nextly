"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@revnixhq/ui";

import { Moon, Sun, Laptop } from "@admin/components/icons";
import { useTheme } from "@admin/context/providers/ThemeProvider";

/**
 * Theme Toggle Component
 *
 * Toggles between light, dark, and system mode using next-themes.
 * Uses DropdownMenu for proper menu management.
 */
export function ThemeToggle(): React.ReactElement {
  const { setTheme, resolvedTheme } = useTheme();

  // Use resolvedTheme to properly detect dark mode even with "system" theme
  const isDark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-[15px] right-[40px] h-9 w-9 rounded-none transition-colors hover:bg-accent"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Sun className="h-[1.2rem] w-[1.2rem]" />
          ) : (
            <Moon className="h-[1.2rem] w-[1.2rem]" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className="cursor-pointer rounded-none"
        >
          <Sun className="mr-2 h-4 w-4" />
          <span>Light</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className="cursor-pointer rounded-none"
        >
          <Moon className="mr-2 h-4 w-4" />
          <span>Dark</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className="cursor-pointer rounded-none"
        >
          <Laptop className="mr-2 h-4 w-4" />
          <span>System</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
