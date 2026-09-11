/**
 * DocumentLockBanner — one strip, spoken to both sides of a claim.
 *
 * Every negative assertion carries its positive control in the same render: the
 * strip itself is queried first, so "the button is absent" can never pass
 * because nothing rendered at all.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DocumentLockNotice } from "../document-lock-affordances";
import { DocumentLockBanner } from "../DocumentLockBanner";

function strip() {
  return screen.getByTestId("document-lock-banner");
}

const HELD: DocumentLockNotice = {
  tone: "held",
  message: "Bob is editing this document. You can read it, or take over.",
  takeOverLabel: "Take over",
  accessRequest: { kind: "offer", label: "Request edit access" },
};

function show(notice: DocumentLockNotice) {
  const onTakeOver = vi.fn();
  const onRequestAccess = vi.fn();
  render(
    <DocumentLockBanner
      notice={notice}
      onTakeOver={onTakeOver}
      onRequestAccess={onRequestAccess}
    />
  );
  return { onTakeOver, onRequestAccess };
}

describe("what a locked-out editor is offered", () => {
  it("offers the polite option beside the one that displaces a colleague", async () => {
    const { onRequestAccess, onTakeOver } = show(HELD);

    expect(strip()).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Request edit access" })
    );

    expect(onRequestAccess).toHaveBeenCalledTimes(1);
    // 🔴 And nothing else. The two intents sit next to each other and are
    // opposites: one leaves word, the other takes the document out from under
    // somebody mid-sentence.
    expect(onTakeOver).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Take over" })).toBeVisible();
  });

  it("replaces the button with a sentence once the ask is on record", () => {
    show({
      ...HELD,
      accessRequest: {
        kind: "sent",
        message: "We have let Bob know you are waiting.",
      },
    });

    expect(strip()).toBeInTheDocument();
    expect(
      screen.getByText("We have let Bob know you are waiting.")
    ).toBeVisible();
    // 🔴 REPLACES, and is not a disabled button. A control still on screen
    // having stopped doing anything is what a broken one looks like, and a
    // disabled button announces itself as unavailable rather than as done.
    //
    // Asserted as the WHOLE set of buttons, not as the absence of one label. A
    // render that kept the control but lost its text leaves a nameless button
    // in the strip, which "no button called Request edit access" reports as a
    // clean replacement -- the exact shape the ask is being replaced to avoid.
    expect(screen.getAllByRole("button").map(b => b.textContent)).toEqual([
      "Take over",
    ]);
  });

  it("shows no ask where the notice offers none", () => {
    show({ ...HELD, accessRequest: null });

    expect(strip()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Request edit access" })
    ).toBeNull();
  });
});

describe("what the HOLDER is told", () => {
  const AWAITED: DocumentLockNotice = {
    tone: "awaited",
    message: "Someone is waiting to edit this document.",
    takeOverLabel: null,
    accessRequest: null,
  };

  it("says it in the polite region, and asks the holder for nothing", () => {
    show(AWAITED);

    const el = strip();
    // 🔴 `status`, never `alert` or `alertdialog`. There is no APG basis for a
    // dialog here -- that pattern is for urgent interruptions a person must
    // answer -- and WCAG 2.2.4 asks that an interruption be postponable. A
    // request moves nothing, so there is nothing to answer.
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveTextContent("Someone is waiting to edit this document.");
    // Not one button: nothing here is a step in a handover.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders nothing at all when there is nothing to say", () => {
    render(
      <DocumentLockBanner
        notice={null}
        onTakeOver={vi.fn()}
        onRequestAccess={vi.fn()}
      />
    );

    // The control for every "the strip says X" above: a banner that always
    // rendered would sit permanently over every document its author opens.
    expect(screen.queryByTestId("document-lock-banner")).toBeNull();
  });
});
