"use client";

import { CommandGroup, CommandItem, CommandShortcut } from "@revnixhq/ui";
import { useRouter } from "next/navigation";

import {
  FileText,
  Settings,
  ShieldPlus,
  UserPlus,
} from "@admin/components/icons";
import type { ActionCommand } from "@admin/types/ui/command-palette";

/**
 * Action Commands Component
 *
 * Static action commands for quick access to create/edit workflows.
 * Integrated into the CommandPalette for keyboard-driven actions.
 *
 * @example
 * ```tsx
 * <ActionCommands onSelect={handleSelect} />
 * ```
 *
 * @features
 * - Static action commands (Create User, Create Role, etc.)
 * - Keyboard shortcuts for power users
 * - lucide-react icons for visual scanning
 * - Next.js router navigation
 * - Fuzzy search via keywords
 *
 * @design-spec
 * - Icons: 16×16px (h-4 w-4)
 * - Items: 36px desktop (h-9), 44px mobile (h-11)
 * - Shortcuts: Right-aligned, text-xs
 * - Spacing: mr-2 for icons, gap-2 for content
 *
 * @accessibility
 * - ARIA: Each item has role="option"
 * - Keyboard: Arrow keys, Enter, Escape
 * - Screen readers: Icons have aria-hidden, labels announced
 */

/**
 * Static action commands for quick workflows.
 * Icons from lucide-react, keywords for improved fuzzy search.
 *
 * @pattern
 * Commands should **navigate to forms**, NOT execute destructive actions.
 * This follows industry best practices (GitHub, Linear, Vercel) where
 * command palettes are for navigation, not data mutation.
 *
 * @future-enhancements
 * - Create Content (when content management is added)
 * - Create Collection (when collections are added)
 * - Import Users (bulk operations)
 * - Export Data (reporting)
 */
const actionCommands: ActionCommand[] = [
  {
    id: "action-create-user",
    label: "Create User",
    icon: UserPlus,
    href: "/admin/users/create",
    keywords: ["new", "add", "user", "account", "member", "people"],
  },
  {
    id: "action-create-role",
    label: "Create Role",
    icon: ShieldPlus,
    href: "/admin/roles/create",
    keywords: ["new", "add", "role", "permission", "access", "security"],
  },
  {
    id: "action-create-content",
    label: "Create Content",
    icon: FileText,
    href: "/admin/content/create",
    keywords: ["new", "add", "post", "article", "page", "content"],
    disabled: true, // Route not yet implemented
  },
  {
    id: "action-settings",
    label: "Open Settings",
    icon: Settings,
    href: "/admin/settings",
    keywords: ["config", "preferences", "configuration", "options"],
  },
];

export interface ActionCommandsProps {
  /**
   * Callback fired when a command is selected.
   * Parent component should close the dialog and execute navigation.
   *
   * @param callback - Function to execute (navigation)
   */
  onSelect: (callback: () => void) => void;
}

/**
 * ActionCommands Component
 *
 * Renders a CommandGroup with static action commands.
 * Used within CommandPalette for keyboard-driven workflows.
 *
 * @param onSelect - Callback to handle command selection
 */
export function ActionCommands({ onSelect }: ActionCommandsProps) {
  const router = useRouter();

  return (
    <CommandGroup heading="Actions">
      {actionCommands.map(command => {
        const Icon = command.icon;
        return (
          <CommandItem
            key={command.id}
            value={command.label}
            keywords={command.keywords}
            disabled={command.disabled}
            onSelect={() => onSelect(() => router.push(command.href))}
          >
            <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
            <span>{command.label}</span>
            {command.shortcut && (
              <CommandShortcut>{command.shortcut}</CommandShortcut>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
