/**
 * The document's id is offered to copy at every width: in the Document panel
 * where that panel is on screen and expanded, and on the line under the title
 * everywhere else. A copy the browser refuses says so, with the id to copy by hand.
 */
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryMetaStrip } from "../EntryMetaStrip";

const { toast } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const ID = "548e813c-8266-40c3-bd9c-ca1816f8";

function clipboard(
  value: { writeText: (text: string) => Promise<void> } | undefined
) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("EntryMetaStrip — document id", () => {
  it("steps aside while the docked panel, which carries the id, is on screen", () => {
    render(<EntryMetaStrip panelCarriesId documentId={ID} />);
    expect(
      screen.queryByRole("button", { name: "Copy ID to clipboard" })
    ).not.toBeInTheDocument();
  });

  it("offers the id wherever the docked panel is not on screen", () => {
    // Folded, floating or a sheet: the panel opens there only when asked
    // for, so this line is where the id is offered.
    render(<EntryMetaStrip panelCarriesId={false} documentId={ID} />);
    expect(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    ).toBeInTheDocument();
  });

  it("copies the whole id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    render(<EntryMetaStrip panelCarriesId={false} documentId={ID} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    );

    expect(writeText).toHaveBeenCalledWith(ID);
    expect(
      await screen.findByRole("button", { name: "ID copied" })
    ).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("says a refused copy failed, with the id to copy by hand", async () => {
    clipboard({
      writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
    });
    render(<EntryMetaStrip panelCarriesId={false} documentId={ID} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    );

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy the ID", {
        description: ID,
      })
    );
    expect(
      screen.queryByRole("button", { name: "ID copied" })
    ).not.toBeInTheDocument();
  });

  it("says the same where the page has no clipboard at all", async () => {
    // An origin that is neither secure nor local has no `navigator.clipboard`.
    clipboard(undefined);
    render(<EntryMetaStrip panelCarriesId={false} documentId={ID} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    );

    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't copy the ID", {
        description: ID,
      })
    );
  });
});
