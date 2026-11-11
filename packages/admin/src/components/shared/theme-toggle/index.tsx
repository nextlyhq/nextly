"use client";

import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@nextlyhq/ui";
import type React from "react";

import { Moon, Sun, Laptop } from "@admin/components/icons";
import { useTheme } from "@admin/context/providers/ThemeProvider";

const OPTIONS = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
  { value: "system" as const, label: "System", icon: Laptop },
];

type ThemeValue = (typeof OPTIONS)[number]["value"];

const isThemeValue = (value: string): value is ThemeValue =>
  OPTIONS.some(option => option.value === value);

/**
 * The admin's appearance (light, dark or the device's), as a choice inside the
 * person's menu. A radio group rather than plain items, so the current choice
 * is announced as checked. Selecting one applies and persists it at once
 * through the admin's theme provider.
 */
export function ThemeChoice(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <DropdownMenuLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        Theme
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={theme}
        onValueChange={value => {
          if (isThemeValue(value)) setTheme(value);
        }}
      >
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <DropdownMenuRadioItem
            key={value}
            value={value}
            className="cursor-pointer text-sm"
          >
            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
            {label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}
