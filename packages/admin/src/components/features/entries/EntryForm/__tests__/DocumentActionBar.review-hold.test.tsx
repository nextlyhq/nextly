/**
 * Publish held by a workflow until the document is approved, as the bar draws it: greyed, yet
 * an enabled button, reached by keyboard and read with its reason, which is also on screen in
 * words; pressed, it opens "Choose what to publish…", which lists what holds it and who can
 * unblock it. A Publish refused for want of a permission stays a disabled control.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentActionBar.review-hold.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  CompactDocumentActionBar,
  DocumentActionBar,
  type ActionBinding,
} from "../DocumentActionBar";
import type { EditorDocumentAction } from "../document-actions";

const REASON = "Needs approval: In review, waiting for Editors";

const HELD_PUBLISH: EditorDocumentAction = {
  id: "publish",
  label: "Publish",
  placement: "primary",
  disabledReason: REASON,
  heldForReview: true,
};
const CHOOSE: EditorDocumentAction = {
  id: "publish-parts",
  label: "Choose what to publish…",
  placement: "publish-menu",
};

function bindings(
  publish: () => void,
  choose: () => void
): Record<string, ActionBinding | undefined> {
  return {
    publish: { onSelect: publish },
    "publish-parts": { onSelect: choose },
  };
}

describe("a Publish the workflow holds", () => {
  it("stays an enabled button, greyed, and is read with its reason", () => {
    render(
      <DocumentActionBar
        actions={[HELD_PUBLISH, CHOOSE]}
        bindings={bindings(vi.fn(), vi.fn())}
      />
    );
    const publish = screen.getByRole("button", { name: "Publish" });
    // An enabled button, since pressed it opens Choose what to publish…: never
    // marked unavailable, which would tell assistive technology it does nothing.
    expect(publish).toBeEnabled();
    expect(publish).not.toHaveAttribute("aria-disabled");
    expect(publish).toHaveAttribute("data-review-held", "true");
    publish.focus();
    expect(publish).toHaveFocus();
    expect(publish).toHaveAccessibleDescription(REASON);
    // The reason is words on the page, not only a tooltip.
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });

  it("opens Choose what to publish… when pressed, and never publishes", async () => {
    const publish = vi.fn();
    const choose = vi.fn();
    render(
      <DocumentActionBar
        actions={[HELD_PUBLISH, CHOOSE]}
        bindings={bindings(publish, choose)}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();

    // By keyboard too.
    screen.getByRole("button", { name: "Publish" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(choose).toHaveBeenCalledTimes(2);
    expect(publish).not.toHaveBeenCalled();
  });

  it("is held the same way beside a step, in the toolbar", async () => {
    const publish = vi.fn();
    const choose = vi.fn();
    render(
      <DocumentActionBar
        actions={[
          {
            id: "review-step:submit",
            label: "Submit for review",
            placement: "primary",
          },
          { ...HELD_PUBLISH, placement: "toolbar" },
          CHOOSE,
        ]}
        bindings={{
          ...bindings(publish, choose),
          "review-step:submit": { onSelect: vi.fn() },
        }}
      />
    );
    const held = screen.getByRole("button", { name: "Publish" });
    expect(held).not.toHaveAttribute("aria-disabled");
    expect(held).toHaveAttribute("data-review-held", "true");
    expect(held).toHaveAccessibleDescription(REASON);
    await userEvent.click(held);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("does nothing when pressed where Choose what to publish… is itself held", async () => {
    const publish = vi.fn();
    const choose = vi.fn();
    render(
      <DocumentActionBar
        actions={[
          HELD_PUBLISH,
          { ...CHOOSE, disabledReason: "You don't have permission." },
        ]}
        bindings={bindings(publish, choose)}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(choose).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("a Publish the workflow holds, on a full-window surface's compact bar", () => {
  it("is held the same way, and opens Choose what to publish… when pressed", async () => {
    const publish = vi.fn();
    const choose = vi.fn();
    render(
      <CompactDocumentActionBar
        actions={[HELD_PUBLISH, CHOOSE]}
        bindings={bindings(publish, choose)}
      />
    );
    const held = screen.getByRole("button", { name: "Publish" });
    expect(held).not.toHaveAttribute("aria-disabled");
    expect(held).toHaveAttribute("data-review-held", "true");
    expect(held).toHaveAccessibleDescription(REASON);
    await userEvent.click(held);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("a Publish refused for want of a permission", () => {
  it("stays a disabled control, its reason in the title", () => {
    render(
      <DocumentActionBar
        actions={[
          {
            id: "publish",
            label: "Publish",
            placement: "primary",
            disabledReason: "You don't have permission to publish this.",
          },
          CHOOSE,
        ]}
        bindings={bindings(vi.fn(), vi.fn())}
      />
    );
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute(
      "title",
      "You don't have permission to publish this."
    );
    expect(publish).not.toHaveAttribute("aria-disabled");
  });
});
