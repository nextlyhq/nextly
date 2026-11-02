"use client";

import { CommandGroup, CommandItem, CommandShortcut } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Plus, Settings, ShieldPlus, UserPlus } from "@admin/components/icons";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useCreatableCollections } from "@admin/hooks/useCreatableCollections";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { navigateTo } from "@admin/lib/navigation";
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
 * Creating an entry is one command per collection, `CreateEntryCommands`
 * below, drawn from what the reader may create in.
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
export function ActionCommands({ onSelect }: ActionCommandsProps): JSX.Element {
  return (
    <CommandGroup heading="Actions">
      <CreateEntryCommands onSelect={onSelect} />
      {actionCommands.map(command => {
        const Icon = command.icon;
        return (
          <CommandItem
            key={command.id}
            value={command.label}
            keywords={command.keywords}
            disabled={command.disabled}
            // Action commands are in-app destinations, so selection routes
            // through the admin SPA router instead of a full page load.
            onSelect={() => onSelect(() => navigateTo(command.href))}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
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

/**
 * "Create <type>" for each collection the reader may create in, matched on its
 * labels and its slug. Running one opens a new entry of that type; the type
 * becomes recent for the dashboard's New button only once the entry is created
 * (`useCreateEntry`).
 */
function CreateEntryCommands({ onSelect }: ActionCommandsProps): JSX.Element {
  const { collections } = useCreatableCollections();
  return (
    <>
      {collections.map(collection => {
        const label = `Create ${collectionSingularLabel(collection)}`;
        return (
          <CommandItem
            key={collection.name}
            // The list's identity for the command: two types may share a
            // label, so the slug, which is unique, ends it. The label leads,
            // and is a keyword too, so a search still finds it by name.
            value={`${label} ${collection.name}`}
            keywords={[
              label,
              collection.name,
              collection.label ?? "",
              collection.labels?.plural ?? "",
              "new",
              "add",
              "entry",
            ].filter(Boolean)}
            onSelect={() =>
              onSelect(() => {
                navigateTo(
                  buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
                    slug: collection.name,
                  })
                );
              })
            }
            data-testid={`command-create-${collection.name}`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>{label}</span>
          </CommandItem>
        );
      })}
    </>
  );
}
