// @vitest-environment jsdom
/**
 * Settings: the page's own tab for everyone, the Site tab only for a role that
 * may manage the site, Enter that never saves the page, a breakpoint edit
 * that is not dropped silently, and a default Layout that says how its save
 * went.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteSettingsRead } from "../../library-contract";

let siteRead: SiteSettingsRead | undefined;
let siteError: Error | null = null;
let siteFetching = false;
const refetch = vi.fn();
const writes: Array<{ path: string }> = [];
let writeAnswer: () => Promise<unknown> = async () => ({});

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRoute: () => ({
    data: siteRead,
    pending: false,
    error: siteError,
    fetching: siteFetching,
    refetch,
  }),
  writePluginRoute: async (write: { path: string }) => {
    writes.push(write);
    return writeAnswer();
  },
}));

// The section's own behaviour is the builder's to test; here it only says
// when editing starts, as the real one does.
vi.mock("@nextlyhq/builder/shell", () => ({
  BreakpointManager: ({
    status,
    onEditingChange,
    onSavingChange,
  }: {
    status?: string;
    onEditingChange?: (editing: boolean) => void;
    onSavingChange?: (saving: boolean) => void;
  }) => (
    <>
      <output aria-label="Breakpoints status">{status}</output>
      <button type="button" onClick={() => onEditingChange?.(true)}>
        Edit breakpoints
      </button>
      <button type="button" onClick={() => onSavingChange?.(true)}>
        Start saving
      </button>
      <input aria-label="Breakpoint name" defaultValue="Tablet" />
    </>
  ),
}));

const { SettingsDialog } = await import("./settings-dialog");

// What Radix's Select reaches for and jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const LAYOUT_LABEL = "Pages without a Layout of their own use";

/** Choose a Layout in the default Layout's select, as an author does. */
async function chooseLayout(title: string): Promise<void> {
  await userEvent.click(screen.getByRole("combobox", { name: LAYOUT_LABEL }));
  await userEvent.click(await screen.findByRole("option", { name: title }));
}

const MANAGER: SiteSettingsRead = {
  mayManageSite: true,
  mayChooseDefaultLayout: true,
  defaultLayout: "main",
  breakpoints: null,
  layouts: [
    { id: "main", title: "Main" },
    { id: "bare", title: "No header or footer" },
  ],
};

/** Renders the dialog again with the current read, as a refetch would. */
let reshow: () => void = () => {};

function show(onOpenChange = vi.fn()) {
  // Built afresh each time: React skips a child whose element is unchanged,
  // so re-rendering the same tree would never ask the dialog again.
  const element = (): ReactElement => (
    <form data-testid="page-form" onSubmit={event => event.preventDefault()}>
      <SettingsDialog
        open
        onOpenChange={onOpenChange}
        returnFocus={() => null}
        pageFields={<input aria-label="Title" defaultValue="About us" />}
        share={{ title: "Who we are", description: "We build tools." }}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
        }}
      />
    </form>
  );
  const { rerender } = render(element());
  reshow = () => rerender(element());
  return onOpenChange;
}

beforeEach(() => {
  siteRead = MANAGER;
  siteError = null;
  siteFetching = false;
  writes.length = 0;
  writeAnswer = async () => ({});
  refetch.mockClear();
});
afterEach(cleanup);

describe("the Settings dialog", () => {
  it("shows the page's fields and an approximate share preview", () => {
    show();
    expect(screen.getByRole("tab", { name: "This page" })).toBeTruthy();
    expect(screen.getByLabelText("Title")).toBeTruthy();
    const preview = screen.getByRole("figure", { name: "Share preview" });
    expect(preview.textContent).toContain("Who we are");
    expect(
      screen.getByText("Approximate: your site's metadata may differ.")
    ).toBeTruthy();
  });

  it("offers no Site tab to a role that may not manage the site", () => {
    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    show();
    expect(screen.queryByRole("tab", { name: "Site" })).toBeNull();
  });

  it("never lets Enter in a Site field submit the page, but lets an IME accept", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    const input = screen.getByLabelText("Breakpoint name");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    input.dispatchEvent(composing);
    expect(composing.defaultPrevented).toBe(false);
  });

  it("leaves Enter in the page's own fields to them", () => {
    show();
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    screen.getByLabelText("Title").dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
  });

  it("says the Site tab applies at once", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText("Changes here apply to the live site immediately.")
    ).toBeTruthy();
  });

  it("asks before closing over a breakpoint edit, and keeps editing on Keep editing", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    const ask = await screen.findByRole("alertdialog");
    expect(ask.textContent).toContain("Discard your breakpoint changes?");
    expect(onOpenChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Discard", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard" })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("changes the default Layout at once, and says Saved", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    expect(writes).toEqual([
      expect.objectContaining({ path: "/layouts/bare/make-default" }),
    ]);
    expect(refetch).toHaveBeenCalled();
  });

  it("says Not saved with Retry when the change is refused, and Retry tries again", async () => {
    writeAnswer = () =>
      Promise.reject(new Error("This Layout is not published."));
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Not saved");
    writeAnswer = async () => ({});
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Saved");
    expect(writes).toHaveLength(2);
  });

  it("shows the default read-only, naming it, without the Layout rights", async () => {
    siteRead = {
      ...MANAGER,
      mayChooseDefaultLayout: false,
      layouts: [{ id: "main", title: "Main" }],
    };
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    const select = screen.getByRole("combobox", { name: LAYOUT_LABEL });
    expect(select.hasAttribute("disabled")).toBe(true);
    await waitFor(() =>
      expect(
        screen.getByText(/needs the rights to update and publish Layouts/)
      ).toBeTruthy()
    );
  });

  it("asks before a tab switch drops a breakpoint edit", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(screen.getByRole("tab", { name: "This page" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    // Still on Site until the author says to discard (the question hides
    // the dialog behind it from the accessibility tree while it is open).
    expect(
      screen
        .getByRole("tab", { name: "Site", hidden: true })
        .getAttribute("aria-selected")
    ).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen
        .getByRole("tab", { name: "This page" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });

  it("neither closes nor switches while a breakpoint save is in flight", async () => {
    const onOpenChange = show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Edit breakpoints" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Start saving" }));
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await userEvent.click(screen.getByRole("tab", { name: "This page" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Site" }).getAttribute("aria-selected")
    ).toBe("true");
  });

  it("says the Site tab could not load, with Retry, rather than hiding it", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(
      screen.getByText("The site's settings could not be loaded.")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the chosen default shown after Saved, until the read catches up", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    expect(
      screen.getByRole("combobox", { name: LAYOUT_LABEL }).textContent
    ).toContain("No header or footer");
  });

  it("follows the read once it confirms the choice, so a later change shows", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    await chooseLayout("No header or footer");
    await screen.findByText("Saved");
    siteRead = { ...MANAGER, defaultLayout: "bare" };
    reshow();
    // Someone else then puts it back: the held choice must not hide that.
    siteRead = { ...MANAGER, defaultLayout: "main" };
    reshow();
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: LAYOUT_LABEL }).textContent
      ).toContain("Main")
    );
  });

  it("holds the breakpoints back while a reopened read is refreshing", async () => {
    // A cached read shows at once on reopen; editing it as a draft before the
    // refresh lands would save over a newer set.
    siteFetching = true;
    show();
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "loading"
    );
    siteFetching = false;
    reshow();
    expect(screen.getByLabelText("Breakpoints status").textContent).toBe(
      "ready"
    );
  });

  it("goes back to This page when the Site tab goes away", async () => {
    siteRead = undefined;
    siteError = new Error("Network down");
    const dialog = (
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        returnFocus={() => null}
        pageFields={<input aria-label="Title" />}
        share={{ title: "Who we are" }}
        breakpoints={{
          value: { viewport: [], container: [] },
          onSave: vi.fn(),
          status: "ready",
        }}
      />
    );
    const { rerender } = render(dialog);
    await userEvent.click(screen.getByRole("tab", { name: "Site" }));
    // The retry answers: not this caller's to manage.
    siteRead = { ...MANAGER, mayManageSite: false, layouts: [] };
    siteError = null;
    // A fresh element, so the dialog renders again with the new answer.
    rerender(cloneElement(dialog));
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "This page" })
          .getAttribute("aria-selected")
      ).toBe("true")
    );
    expect(screen.queryByRole("tab", { name: "Site" })).toBeNull();
  });
});
