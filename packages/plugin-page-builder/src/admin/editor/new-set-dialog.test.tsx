// @vitest-environment jsdom
/**
 * "+ New header & footer": the name and the three starts, the set made as
 * asked, then opened in the builder with the way back; a refusal said in the
 * dialog with what was typed kept; and no copy offered where there is no
 * site default to copy.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  writePluginRoute: vi.fn(async () => ({
    item: { id: "new-set", title: "Landing" },
  })),
}));
vi.mock("@nextlyhq/plugin-sdk/admin", () => sdk);

const opened = vi.hoisted(() => ({ openDocument: vi.fn() }));
vi.mock("./edit-component", async importOriginal => ({
  ...(await importOriginal<typeof import("./edit-component")>()),
  openDocument: opened.openDocument,
}));

Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const { NewSetDialog } = await import("./new-set-dialog");

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(
    null,
    "",
    "/admin/collections/pages/home/builder"
  );
});

function show(defaultTitle: string | null = "Main") {
  render(
    <NewSetDialog
      open
      onOpenChange={vi.fn()}
      facts={{ collection: "layouts", defaultTitle, here: "Home" }}
    />
  );
  return screen.getByRole("dialog", { name: "New header & footer" });
}

describe("a new header & footer set", () => {
  it("offers the three starts, a copy of the site default first", () => {
    const dialog = show();
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map(radio => radio.closest("div")?.textContent)
    ).toEqual([
      expect.stringContaining("A copy of Main"),
      expect.stringContaining("The starter header and footer"),
      expect.stringContaining("Empty"),
    ]);
    expect(within(dialog).getAllByRole("radio")[0]).toHaveProperty(
      "ariaChecked",
      "true"
    );
  });

  it("offers no copy where the site has no default to copy", () => {
    const dialog = show(null);
    expect(within(dialog).queryByText(/A copy of/)).toBeNull();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
  });

  it.each([
    ["A copy of Main", "copy-default"],
    ["The starter header and footer", "starter"],
    ["Empty", "empty"],
  ])(
    "makes it from %s and opens it in the builder, with the way back",
    async (label, start) => {
      const dialog = show();
      await userEvent.type(
        within(dialog).getByRole("textbox", { name: "Name" }),
        " Landing "
      );
      await userEvent.click(
        within(dialog).getByRole("radio", { name: new RegExp(label) })
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Create" })
      );
      expect(sdk.writePluginRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/layouts/new",
          method: "POST",
          body: { title: "Landing", start },
        })
      );
      const address = opened.openDocument.mock.calls[0]?.[0] as string;
      expect(address.split("?")[0]).toBe(
        "/admin/collections/layouts/new-set/in-builder"
      );
      const back = new URLSearchParams(address.split("?")[1]);
      expect(back.get("return")).toBe("/admin/collections/pages/home/builder");
      expect(back.get("from")).toBe("Home");
    }
  );

  it("keeps the set it made when the author stays on the page, offering to open it again", async () => {
    const dialog = show();
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Landing"
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create" })
    );
    // The page did not leave: the admin's unsaved-work question was answered
    // "Stay". The set exists, so the dialog opens it rather than making another.
    const again = await within(dialog).findByRole("button", {
      name: "Open Landing",
    });
    expect(again).toHaveProperty("disabled", false);
    expect(within(dialog).queryByRole("button", { name: "Create" })).toBeNull();
    await userEvent.click(again);
    expect(opened.openDocument).toHaveBeenCalledTimes(2);
    expect(opened.openDocument.mock.calls[1]?.[0]).toBe(
      opened.openDocument.mock.calls[0]?.[0]
    );
    expect(sdk.writePluginRoute).toHaveBeenCalledTimes(1);
  });

  it("asks for a name before anything is made", async () => {
    const dialog = show();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create" })
    );
    expect(within(dialog).getByRole("alert").textContent).toBe(
      "Give the header & footer set a name."
    );
    expect(sdk.writePluginRoute).not.toHaveBeenCalled();
  });

  it("says a refusal in the dialog, keeping what was typed", async () => {
    sdk.writePluginRoute.mockRejectedValueOnce(
      new Error("You don't have permission to create header & footer sets.")
    );
    const dialog = show();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.type(name, "Landing");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create" })
    );
    expect(await within(dialog).findByRole("alert")).toHaveProperty(
      "textContent",
      "You don't have permission to create header & footer sets."
    );
    expect(name).toHaveProperty("value", "Landing");
    expect(opened.openDocument).not.toHaveBeenCalled();
  });
});
