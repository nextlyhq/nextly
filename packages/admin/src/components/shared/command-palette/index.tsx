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
  ShortcutProvider,
  useShortcuts,
} from "@nextlyhq/ui";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type JSX,
} from "react";

import { ROUTES } from "@admin/constants/routes";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";

import { openableSettingsHrefs, type PaletteRow } from "./palette-results";
import {
  adminPaletteMounted,
  isPaletteOpen,
  registerAdminPalette,
  setPaletteOpen,
  subscribePalette,
  takeReturnFocus,
} from "./palette-store";
import { usePaletteResults } from "./use-palette-results";
import { UserSearchResults } from "./UserSearchResults";

/**
 * The command palette: ⌘K (Ctrl+K off Apple), or the rail's Search button.
 *
 * Typing finds collections, Singles, pages (Settings, Builders, Account
 * settings and the pages plugins add to the menus) and actions ("New <type>",
 * the help links), each only where the reader may open it, and people by
 * name. Picking one opens it where the menus would.
 *
 * @accessibility
 * - Full keyboard navigation (Arrow keys, Enter, Escape, Home, End)
 * - Focus trap while open; focus returns to where it was on close
 *
 * @keyboard-shortcuts
 * - Cmd+K / Ctrl+K: toggle the palette, unless a workspace that owns the keys
 *   is open (the Page Builder's editor has its own)
 * - G then D / U / R / S: go to the dashboard, users, roles, settings
 */

/**
 * The palette a host app mounts itself, exported for embedding.
 *
 * The admin now mounts its own (`AdminCommandPalette`, from its root), so a
 * host that still mounts this one draws nothing while the admin's is there:
 * one dialog, one answer to ⌘K. Mounted where the admin isn't, it works as it
 * always did.
 *
 * It carries its own shortcut provider because it is routinely rendered
 * OUTSIDE the admin shell, as a sibling of the routed children, where no shell
 * provider is an ancestor and registering a shortcut would throw. Nesting is
 * free: providers share one manager per target.
 */
export function CommandPalette(): JSX.Element | null {
  const adminHasOne = useSyncExternalStore(
    subscribePalette,
    adminPaletteMounted,
    () => false
  );
  if (adminHasOne) return null;
  return (
    <ShortcutProvider>
      <PaletteDialog />
    </ShortcutProvider>
  );
}

/**
 * The admin's own palette, mounted once by its root inside the admin's
 * styling scope, so its dialog is portalled into the admin's portal root and
 * placed by the admin's styles in every host.
 */
export function AdminCommandPalette(): JSX.Element {
  useEffect(() => registerAdminPalette(), []);
  return <PaletteDialog />;
}

/**
 * Below every ordinary layer. The manager orders layers by priority before
 * depth and mount order, so a workspace that binds ⌘K for itself (the Page
 * Builder's editor) always answers it while it is mounted, however the two
 * happen to mount; everywhere else this one does. A modal's hold still sits
 * above it and keeps it shut.
 */
const PALETTE_KEY_PRIORITY = -1;

function PaletteDialog(): JSX.Element {
  const open = useSyncExternalStore(
    subscribePalette,
    isPaletteOpen,
    () => false
  );
  const [search, setSearch] = useState("");

  const handleOpenChange = useCallback((next: boolean) => {
    setPaletteOpen(next);
    // A clean slate on the next open.
    if (!next) setSearch("");
  }, []);

  /**
   * Closes the palette, then runs what was picked. Re-opened if it throws,
   * so the person can try again.
   */
  const handleSelect = useCallback(
    (run: () => void) => {
      handleOpenChange(false);
      try {
        run();
      } catch (error) {
        console.error("Command execution failed:", error);
        setPaletteOpen(true);
      }
    },
    [handleOpenChange]
  );

  useShortcuts(
    [
      {
        keys: "mod+k",
        description: "Open the command palette",
        run: () => handleOpenChange(!isPaletteOpen()),
        // Reachable from wherever the person is, mid-sentence in a field too.
        whenTyping: true,
      },
    ],
    { name: "command-palette", priority: PALETTE_KEY_PRIORITY }
  );

  // The go-to sequences lead only where the palette's own Settings rows
  // would: a reader who may not open Users, Roles or Settings is not sent to
  // a refusal by two keystrokes.
  const { hasPermission } = useCurrentUserPermissions();
  const mayGoTo = (href: string) =>
    openableSettingsHrefs(hasPermission).has(href);

  useShortcuts(
    [
      {
        keys: "g d",
        description: "Go to the dashboard",
        run: () => handleSelect(() => navigateTo(ROUTES.DASHBOARD)),
        when: () => !open,
      },
      {
        keys: "g u",
        description: "Go to users",
        run: () => handleSelect(() => navigateTo(ROUTES.USERS)),
        when: () => !open && mayGoTo(ROUTES.USERS),
      },
      {
        keys: "g r",
        description: "Go to roles",
        run: () => handleSelect(() => navigateTo(ROUTES.SECURITY_ROLES)),
        when: () => !open && mayGoTo(ROUTES.SECURITY_ROLES),
      },
      {
        keys: "g s",
        description: "Go to settings",
        run: () => handleSelect(() => navigateTo(ROUTES.SETTINGS)),
        when: () => !open && mayGoTo(ROUTES.SETTINGS),
      },
    ],
    { name: "command-palette-go-to" }
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      // Read after the dialog's name ("Command palette", the kit's default),
      // so a screen reader hears what the palette offers before the field.
      description="Go to a collection, a Single, a page or a person, or run an action, and press Enter to choose it."
      contentProps={{
        // Focus goes back to what had it when the palette opened (the
        // Search button, a field), not to the top of the page.
        onCloseAutoFocus: event => {
          const back = takeReturnFocus();
          if (!back) return;
          event.preventDefault();
          back.focus();
        },
      }}
    >
      <CommandInput
        placeholder="Search or jump to…"
        value={search}
        onValueChange={setSearch}
      />
      {/* Drawn only while open, so what it reads is fetched only then. */}
      <PaletteResultsList search={search} onSelect={handleSelect} />
    </CommandDialog>
  );
}

function PaletteResultsList({
  search,
  onSelect,
}: {
  search: string;
  onSelect: (run: () => void) => void;
}): JSX.Element {
  const results = usePaletteResults();
  const { hasPermission } = useCurrentUserPermissions();
  const pick = (row: PaletteRow) =>
    onSelect(() => {
      if (row.external) {
        window.open(row.href, "_blank", "noopener,noreferrer");
      } else {
        // Within the admin, through its router, keeping the loaded app state.
        navigateTo(row.href);
      }
    });
  // Entries found by title get their own heading first, once the admin can
  // search titles; recently visited items fill the empty box.
  const groups: { heading: string; rows: PaletteRow[] }[] = [
    { heading: "Collections", rows: results.collections },
    { heading: "Singles", rows: results.singles },
    { heading: "Pages", rows: results.pages },
    { heading: "Actions", rows: results.actions },
  ];
  const drawn = groups.filter(group => group.rows.length > 0);
  return (
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      {drawn.map((group, index) => (
        <PaletteGroup
          key={group.heading}
          heading={group.heading}
          rows={group.rows}
          separated={index > 0}
          onPick={pick}
        />
      ))}
      {/* People, by name, for a reader who may list them. */}
      {search && hasPermission("read-users") && (
        <>
          <CommandSeparator />
          <UserSearchResults search={search} onSelect={onSelect} />
        </>
      )}
    </CommandList>
  );
}

function PaletteGroup({
  heading,
  rows,
  separated,
  onPick,
}: {
  heading: string;
  rows: PaletteRow[];
  separated: boolean;
  onPick: (row: PaletteRow) => void;
}): JSX.Element {
  return (
    <>
      {separated && <CommandSeparator />}
      <CommandGroup heading={heading}>
        {rows.map(row => (
          <CommandItem
            key={row.id}
            value={row.value}
            keywords={row.keywords}
            onSelect={() => onPick(row)}
          >
            <span className="truncate">{row.label}</span>
            {row.hint && <CommandShortcut>{row.hint}</CommandShortcut>}
            {row.external && (
              <span className="sr-only">(opens in a new tab)</span>
            )}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}
