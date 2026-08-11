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
  useShortcuts,
} from "@nextlyhq/ui";
import { useCallback, useState } from "react";

import { Home, Settings, Shield, Users } from "@admin/components/icons";
import { ROUTES } from "@admin/constants/routes";
import { navigateTo } from "@admin/lib/navigation";

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
 * - Admin SPA router integration for navigation
 * - Dark mode compatible
 * - WCAG 2.2 AA compliant
 *
 * @design-spec
 * - Dialog: 512px (max-w-lg), 12px  border border-border radius
 * - Input: 48px height (h-12)
 * - Items: 36px desktop (h-9), 44px mobile (h-11)
 * - Backdrop: the --nx-overlay scrim with backdrop blur
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
   * Keyboard shortcuts, registered with the application's one keydown owner.
   *
   * The `g <key>` navigation used to be hand-rolled here, holding the previous key and a
   * timestamp in the closure and comparing against a one-second window. The manager models a
   * sequence directly, with the same one-second default, so the state and the comparison go away
   * — along with the `document` listener that carried them.
   */
  useShortcuts(
    [
      {
        keys: "mod+k",
        description: "Open the command palette",
        run: () => setOpen(previous => !previous),
        // The palette has to be reachable from wherever the user is, including mid-sentence in a
        // field, which is why this one is exempt from the typing rule and the `g` sequences below
        // are not.
        whenTyping: true,
      },
      {
        keys: "g d",
        description: "Go to the dashboard",
        run: () => handleSelect(() => navigateTo(ROUTES.DASHBOARD)),
        when: () => !open,
      },
      {
        keys: "g u",
        description: "Go to users",
        run: () => handleSelect(() => navigateTo("/admin/users")),
        when: () => !open,
      },
      {
        keys: "g r",
        description: "Go to roles",
        run: () => handleSelect(() => navigateTo("/admin/roles")),
        when: () => !open,
      },
      {
        keys: "g s",
        description: "Go to settings",
        run: () => handleSelect(() => navigateTo("/admin/settings")),
        when: () => !open,
      },
    ],
    { name: "command-palette" }
  );

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
                // Navigation commands move within the admin SPA, so they go
                // through its router and keep the loaded app state.
                onSelect={() => handleSelect(() => navigateTo(command.href))}
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
