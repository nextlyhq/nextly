// @vitest-environment jsdom
/**
 * Where the palette is mounted and who answers ⌘K.
 *
 * The admin mounts its own palette; a host that still mounts the exported one
 * must not draw a second dialog. The rail's Search button opens it and gets
 * focus back on close. A workspace that binds ⌘K for itself (the Page
 * Builder's editor) answers it while mounted, whichever mounted first.
 */
import { ShortcutProvider, TooltipProvider, useShortcuts } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./use-palette-results", () => ({
  usePaletteResults: () => ({
    collections: [
      {
        id: "collection:posts",
        label: "Posts",
        value: "Posts posts",
        href: "/admin/collections/posts",
      },
    ],
    singles: [],
    pages: [],
    actions: [],
  }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => false }),
}));

import { AdminCommandPalette, CommandPalette } from "./index";
import { RailSearchButton } from "./PaletteSearchButton";
import { setPaletteOpen } from "./palette-store";

afterEach(() => {
  cleanup();
  act(() => setPaletteOpen(false));
});

function pressModK(): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

const dialogs = () => screen.queryAllByRole("dialog");

/** A workspace that binds ⌘K for itself, as the Page Builder's editor does. */
function Workspace({ onKey }: { onKey: () => void }): ReactElement {
  useShortcuts(
    [
      {
        keys: "mod+k",
        description: "Open the workspace's own search",
        run: () => onKey(),
      },
    ],
    { name: "workspace" }
  );
  return <div />;
}

describe("the admin's own palette", () => {
  it("opens on ⌘K as one dialog, with a host's own palette mounted beside it", () => {
    render(
      <ShortcutProvider>
        <AdminCommandPalette />
        {/* As a host app mounted it before the admin had its own. */}
        <CommandPalette />
      </ShortcutProvider>
    );
    pressModK();
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByText("Posts")).toBeTruthy();
  });

  it("leaves a host's own palette working where the admin's is not mounted", () => {
    render(<CommandPalette />);
    pressModK();
    expect(dialogs()).toHaveLength(1);
  });

  it("opens from the rail's Search button, and gives focus back to it on close", async () => {
    render(
      <ShortcutProvider>
        <TooltipProvider>
          <RailSearchButton />
        </TooltipProvider>
        <AdminCommandPalette />
      </ShortcutProvider>
    );
    const button = screen.getByRole("button", { name: "Search (⌘K)" });
    button.focus();
    fireEvent.click(button);
    expect(dialogs()).toHaveLength(1);
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(dialogs()).toHaveLength(0);
    // The dialog hands focus back after it has gone, on the next task.
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe("⌘K while a workspace binds it for itself", () => {
  it("reaches the workspace when the admin's palette mounted after it", () => {
    const onKey = vi.fn();
    render(
      <ShortcutProvider>
        <Workspace onKey={onKey} />
        <AdminCommandPalette />
      </ShortcutProvider>
    );
    pressModK();
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("reaches the workspace when the admin's palette mounted before it", () => {
    const onKey = vi.fn();
    render(
      <ShortcutProvider>
        <AdminCommandPalette />
        <Workspace onKey={onKey} />
      </ShortcutProvider>
    );
    pressModK();
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("opens the admin's palette again once the workspace is gone", () => {
    const onKey = vi.fn();
    const view = render(
      <ShortcutProvider>
        <Workspace onKey={onKey} />
        <AdminCommandPalette />
      </ShortcutProvider>
    );
    view.rerender(
      <ShortcutProvider>
        <AdminCommandPalette />
      </ShortcutProvider>
    );
    pressModK();
    expect(onKey).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);
  });
});
