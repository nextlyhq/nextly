/**
 * The document panel's frame in each of its modes: docked beside the fields,
 * floating over them with a close button and Escape, and a sheet from the
 * bottom of a phone's screen.
 */
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { DocumentPanelMode } from "../document-panel-mode";
import {
  DOCUMENT_PANEL_TOGGLE_ATTRIBUTE,
  DocumentSidePanel,
} from "../DocumentSidePanel";

/** A panel with its toggle, as the bar and the editor draw them together. */
function Harness({
  mode,
  initiallyShown = true,
}: {
  mode: DocumentPanelMode;
  initiallyShown?: boolean;
}) {
  const [shown, setShown] = useState(initiallyShown);
  return (
    <>
      <button
        type="button"
        onClick={() => setShown(s => !s)}
        {...{ [DOCUMENT_PANEL_TOGGLE_ATTRIBUTE]: "" }}
      >
        Toggle
      </button>
      <DocumentSidePanel
        mode={mode}
        shown={shown}
        onClose={() => setShown(false)}
      >
        <p>Sections</p>
      </DocumentSidePanel>
    </>
  );
}

describe("the document panel, docked", () => {
  it("is a column beside the fields, with no close button of its own", () => {
    render(<Harness mode="docked" />);
    const panel = screen.getByRole("complementary", {
      name: "Document panel",
    });
    expect(panel).toHaveAttribute("data-document-panel", "docked");
    expect(panel).toHaveTextContent("Sections");
    // The bar's toggle folds it.
    expect(
      screen.queryByRole("button", { name: "Close document panel" })
    ).not.toBeInTheDocument();
  });

  it("is not drawn while folded", () => {
    render(<Harness mode="docked" initiallyShown={false} />);
    expect(screen.queryByText("Sections")).not.toBeInTheDocument();
  });
});

describe("the document panel, floating", () => {
  it("floats over the fields' right edge, out of the flow, under the bar", () => {
    render(<Harness mode="floating" />);
    const panel = screen.getByRole("complementary", {
      name: "Document panel",
    });
    expect(panel).toHaveAttribute("data-document-panel", "floating");
    // Its column is lifted out of the row, so the fields keep their width.
    expect(panel.parentElement?.className).toMatch(/(^|\s)absolute(\s|$)/);
    expect(panel.className).toContain(
      "top-[var(--document-bar-height,3.25rem)]"
    );
  });

  it("takes focus when it opens, and gives it back to the toggle when its close button closes it", async () => {
    const user = userEvent.setup();
    render(<Harness mode="floating" initiallyShown={false} />);
    await user.click(screen.getByRole("button", { name: "Toggle" }));
    const panel = screen.getByRole("complementary", {
      name: "Document panel",
    });
    expect(panel).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Close document panel" })
    );
    expect(screen.queryByText("Sections")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle" })).toHaveFocus();
  });

  it("closes on Escape inside it, and the editor's own Escape does not also run", async () => {
    const user = userEvent.setup();
    // The editor's shortcuts listen on the document and skip a handled key.
    const editorEscape = vi.fn();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) editorEscape();
    };
    document.addEventListener("keydown", listener);
    try {
      render(<Harness mode="floating" />);
      screen.getByRole("complementary", { name: "Document panel" }).focus();
      await user.keyboard("{Escape}");
      expect(screen.queryByText("Sections")).not.toBeInTheDocument();
      expect(editorEscape).not.toHaveBeenCalled();
      // The control: Escape outside the panel is still the editor's.
      await user.keyboard("{Escape}");
      expect(editorEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("keydown", listener);
    }
  });
});

describe("the document panel, as a sheet", () => {
  it("opens as a dialog from the bottom, headed Document, with a close button", async () => {
    const user = userEvent.setup();
    render(<Harness mode="sheet" />);
    const sheet = screen.getByRole("dialog", { name: "Document" });
    expect(sheet).toHaveAttribute("data-document-panel", "sheet");
    expect(sheet).toHaveTextContent("Sections");
    await user.click(
      screen.getByRole("button", { name: "Close document panel" })
    );
    expect(
      screen.queryByRole("dialog", { name: "Document" })
    ).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness mode="sheet" />);
    expect(screen.getByRole("dialog", { name: "Document" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Document" })
    ).not.toBeInTheDocument();
  });
});
