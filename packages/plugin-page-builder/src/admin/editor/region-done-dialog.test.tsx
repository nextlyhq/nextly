// @vitest-environment jsdom

/**
 * The questions header editing asks: Done's four answers, three for someone
 * who may not publish components, "Keep editing" taking the first focus; a
 * publish's question, which names how far it reaches; and the top bar's
 * Save and Publish for the header.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RegionDoneDialog,
  RegionPublishDialog,
  RegionSaveAndPublish,
} from "./region-done-dialog";

afterEach(cleanup);

const ELEVEN = { count: 11, complete: true };

function answers(): string[] {
  return screen
    .getByRole("alertdialog")
    .querySelectorAll("button")
    .values()
    .map(button => button.textContent ?? "")
    .toArray();
}

describe("Done's question", () => {
  it("offers all four answers to someone who may publish", () => {
    const onAnswer = vi.fn();
    render(
      <RegionDoneDialog
        open
        area="header"
        reach={ELEVEN}
        busy={false}
        mayPublish
        draftable
        onAnswer={onAnswer}
      />
    );

    expect(
      screen.getByRole("alertdialog", { name: "Publish your header changes?" })
    ).toBeTruthy();
    expect(answers().sort()).toEqual(
      ["Discard", "Keep editing", "Publish to 11 pages", "Save as draft"].sort()
    );
    // Nothing goes live, is saved or is thrown away by a key pressed unread.
    expect(document.activeElement?.textContent).toBe("Keep editing");

    fireEvent.click(
      screen.getByRole("button", { name: "Publish to 11 pages" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onAnswer.mock.calls.map(call => call[0])).toEqual([
      "publish",
      "save",
      "discard",
    ]);
  });

  it("offers no publish to someone who may not publish components", () => {
    render(
      <RegionDoneDialog
        open
        area="header"
        reach={ELEVEN}
        busy={false}
        mayPublish={false}
        draftable
        onAnswer={vi.fn()}
      />
    );

    expect(answers().sort()).toEqual(
      ["Discard", "Keep editing", "Save as draft"].sort()
    );
  });

  it("answers Keep editing when closed with Escape", () => {
    const onAnswer = vi.fn();
    render(
      <RegionDoneDialog
        open
        area="footer"
        reach={ELEVEN}
        busy={false}
        mayPublish
        draftable
        onAnswer={onAnswer}
      />
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(onAnswer).toHaveBeenCalledWith("keep");
  });
});

describe("a publish's question", () => {
  it("names how far the header reaches, and publishes on yes", () => {
    const onPublish = vi.fn();
    render(
      <RegionPublishDialog
        open
        area="header"
        reach={ELEVEN}
        busy={false}
        onPublish={onPublish}
        onCancel={vi.fn()}
      />
    );

    expect(
      screen.getByRole("alertdialog", {
        name: "Publish the header to 11 pages?",
      })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish header" }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});

describe("the top bar while the header is edited", () => {
  function bar(
    overrides: Partial<Parameters<typeof RegionSaveAndPublish>[0]["bar"]> = {}
  ) {
    return {
      area: "header" as const,
      saveLabel: "Save header",
      publishLabel: "Publish header",
      mayPublish: true,
      draftable: true,
      dirty: true,
      busy: false,
      save: vi.fn(),
      publish: vi.fn(),
      ...overrides,
    };
  }

  it("saves and publishes the header", () => {
    const shown = bar();
    render(<RegionSaveAndPublish bar={shown} />);
    fireEvent.click(screen.getByRole("button", { name: "Save header" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish header" }));

    expect(shown.save).toHaveBeenCalledTimes(1);
    expect(shown.publish).toHaveBeenCalledTimes(1);
  });

  it("saves nothing while there is nothing to save, and offers no publish without the right", () => {
    const shown = bar({ dirty: false, mayPublish: false });
    render(<RegionSaveAndPublish bar={shown} />);
    const save = screen.getByRole("button", { name: "Save header" });
    fireEvent.click(save);

    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(shown.save).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Publish header" })).toBeNull();
  });
});
