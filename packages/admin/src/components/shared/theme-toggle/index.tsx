"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";

import { Check, Moon, Sun, Laptop } from "@admin/components/icons";
import { useTheme } from "@admin/context/providers/ThemeProvider";

const OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Laptop },
];

/**
 * Theme Toggle
 *
 * Top-bar control to switch between light, dark, and system appearance. Selecting an option
 * applies and persists it immediately via next-themes. The trigger shows the active mode's
 * icon and matches the sibling header icon buttons.
 */
export function ThemeToggle(): React.ReactElement {
  const { theme, setTheme, resolvedTheme } = useTheme();

  // The trigger reflects the chosen mode: the device icon for "system", otherwise the
  // resolved light/dark icon.
  const TriggerIcon =
    theme === "system" ? Laptop : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center justify-center h-11 w-11 rounded-none transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 hover-subtle-row group"
          aria-label="Toggle theme"
          title="Theme"
        >
          <TriggerIcon className="h-5 w-5 text-primary/50 group-hover:text-primary transition-colors" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className="cursor-pointer rounded-none"
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {theme === value && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
