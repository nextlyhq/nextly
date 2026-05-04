"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@revnixhq/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Home, Settings, Shield, Users } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";

import { ActionCommands } from "./ActionCommands";
import { UserSearchResults } from "./UserSearchResults";

/**
 * Command Palette Component
 *
 * A keyboard-driven command palette for quick navigation and actions.
 * Opens with Cmd+K (Mac) or Ctrl+K (Windows/Linux) keyboard shortcut.
 *
 * @example
 * ```tsx
 * // In root layout
 * <CommandPalette />
 * ```
 *
 * @features
 * - Keyboard shortcut: Cmd+K / Ctrl+K
 * - Fuzzy search across navigation commands
 * - Next.js router integration for navigation
 * - Dark mode compatible
 * - WCAG 2.2 AA compliant
 *
 * @design-spec
 * - Dialog: 512px (max-w-lg), 12px  border border-primary/5 radius
 * - Input: 48px height (h-12)
 * - Items: 36px desktop (h-9), 44px mobile (h-11)
 * - Backdrop: bg-black/80 with backdrop blur
 * - Animation: 200ms duration
 *
 * @accessibility
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - Focus trap when dialog is open
 * - ARIA attributes for screen readers
 * - Focus returns to trigger element on close
 * - WCAG 2.2 AA color contrast verified
 *
 * @keyboard-shortcuts
 * - Cmd+K / Ctrl+K: Toggle command palette
 * - Escape: Close command palette
 * - Arrow Down: Move to next item
 * - Arrow Up: Move to previous item
 * - Enter: Select highlighted item
 * - Home: Jump to first item
 * - End: Jump to last item
 */

interface NavigationCommand {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  keywords: string[];
  shortcut?: string;
}

/**
 * Static navigation commands for quick access to primary routes.
 * Icons from lucide-react, keywords for improved fuzzy search.
 */
const navigationCommands: NavigationCommand[] = [
  {
    id: "nav-dashboard",
    label: "Dashboard",
    icon: Home,
    href: ROUTES.DASHBOARD,
    keywords: ["home", "overview", "stats", "analytics"],
    shortcut: "G D", // Gmail-style: Press G then D
  },
  {
    id: "nav-users",
    label: "Users",
    icon: Users,
    href: "/admin/users",
    keywords: ["people", "accounts", "members", "manage"],
    shortcut: "G U", // Gmail-style: Press G then U
  },
  {
    id: "nav-roles",
    label: "Roles & Permissions",
    icon: Shield,
    href: "/admin/roles",
    keywords: ["security", "access", "rbac", "permissions"],
    shortcut: "G R", // Gmail-style: Press G then R
  },
  {
    id: "nav-settings",
    label: "Settings",
    icon: Settings,
    href: "/admin/settings",
    keywords: ["config", "preferences", "configuration"],
    shortcut: "G S", // Gmail-style: Press G then S
  },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();

  /**
   * Handle command selection
   * Executes the provided callback (typically navigation) and closes the dialog
   * Memoized to prevent unnecessary re-renders in keyboard listener
   */
  const handleSelect = useCallback((callback: () => void) => {
    setOpen(false);
    try {
      callback();
    } catch (error) {
      console.error("Command execution failed:", error);
      // Re-open the palette on error so user can try again
      setOpen(true);
    }
  }, []);

  /**
   * Keyboard shortcut listeners:
   * 1. Cmd+K / Ctrl+K - Toggle command palette
   * 2. G then D/U/R/S - Gmail-style navigation shortcuts (when palette is closed)
   */
  useEffect(() => {
    // Sequential key timeout in milliseconds (1 second window for G+key shortcuts)
    const SEQUENTIAL_KEY_TIMEOUT = 1000;

    let lastKey = "";
    let lastKeyTime = 0;

    const down = (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K - Toggle command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(open => !open);
        return;
      }

      // Gmail-style shortcuts (G then D/U/R/S) - only when palette is closed
      if (!open) {
        // Ignore shortcuts if user is typing in an input field
        const activeElement = document.activeElement;
        const isTyping =
          activeElement?.tagName === "INPUT" ||
          activeElement?.tagName === "TEXTAREA" ||
          activeElement?.getAttribute("contenteditable") === "true";

        if (isTyping) return;

        const currentTime = Date.now();
        const timeSinceLastKey = currentTime - lastKeyTime;

        // If 'g' was pressed recently (within timeout window)
        if (lastKey === "g" && timeSinceLastKey < SEQUENTIAL_KEY_TIMEOUT) {
          switch (e.key.toLowerCase()) {
            case "d":
              e.preventDefault();
              handleSelect(() => router.push(ROUTES.DASHBOARD));
              lastKey = "";
              break;
            case "u":
              e.preventDefault();
              handleSelect(() => router.push("/admin/users"));
              lastKey = "";
              break;
            case "r":
              e.preventDefault();
              handleSelect(() => router.push("/admin/roles"));
              lastKey = "";
              break;
            case "s":
              e.preventDefault();
              handleSelect(() => router.push("/admin/settings"));
              lastKey = "";
              break;
            default:
              lastKey = "";
          }
        } else if (e.key?.toLowerCase() === "g") {
          // Store 'g' key press
          lastKey = "g";
          lastKeyTime = currentTime;
        } else {
          // Reset if any other key is pressed
          lastKey = "";
        }
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, handleSelect, router]);

  /**
   * Handle dialog open/close state changes
   * Resets search state when dialog closes to provide clean slate on next open
   */
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    // Clear search when dialog closes (prevents stale search on re-open)
    if (!newOpen) {
      setSearch("");
    }
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Navigation Commands */}
        <CommandGroup heading="Navigation">
          {navigationCommands.map(command => {
            const Icon = command.icon;
            return (
              <CommandItem
                key={command.id}
                value={command.label}
                keywords={command.keywords}
                onSelect={() => handleSelect(() => router.push(command.href))}
              >
                <Icon className="h-4 w-4" />
                <span>{command.label}</span>
                {command.shortcut && (
                  <CommandShortcut>{command.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        {/* Action Commands */}
        <ActionCommands onSelect={handleSelect} />

        {/* User Search Results - only show when searching */}
        {search && (
          <>
            <CommandSeparator />
            <UserSearchResults search={search} onSelect={handleSelect} />
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
