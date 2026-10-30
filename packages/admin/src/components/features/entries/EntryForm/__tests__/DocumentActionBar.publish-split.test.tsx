/**
 * The primary action's arrow: the other ways to publish, drawn beside the
 * act they vary, reachable by keyboard, and held with their reasons.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentActionBar.publish-split.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { DocumentActionBar, type ActionBinding } from "../DocumentActionBar";
import type { DocumentAction } from "../document-actions";

const PRIMARY: DocumentAction = {
  id: "publish",
  label: "Publish",
  placement: "primary",
};
const SCHEDULE: DocumentAction = {
  id: "schedule-publish",
  label: "Schedule publish…",
  placement: "publish-menu",
};
const ADD: DocumentAction = {
  id: "add-to-release",
  label: "Add to release…",
  placement: "publish-menu",
};
const VIEW_API: DocumentAction = {
  id: "view-api",
  label: "View API response",
  placement: "menu",
  group: "document",
};

function bindings(
  over: Record<string, ActionBinding | undefined> = {}
): Record<string, ActionBinding | undefined> {
  return {
    publish: { onSelect: vi.fn() },
    "schedule-publish": { onSelect: vi.fn() },
    "add-to-release": { onSelect: vi.fn() },
    "view-api": { onSelect: vi.fn() },
    ...over,
  };
}

const arrow = () =>
  screen.queryByRole("button", { name: "More ways to publish" });

describe("the Publish split", () => {
  it("offers Schedule publish… and Add to release… on the primary's arrow, in that order", async () => {
    render(
      <DocumentActionBar
        actions={[PRIMARY, VIEW_API, SCHEDULE, ADD]}
        bindings={bindings()}
      />
    );
    await userEvent.click(arrow() as HTMLElement);
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["Schedule publish…", "Add to release…"]);
  });

  it("keeps them out of More, which keeps its own rows", async () => {
    render(
      <DocumentActionBar
        actions={[PRIMARY, VIEW_API, SCHEDULE, ADD]}
        bindings={bindings()}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["View API response"]);
  });

  it("joins the arrow to the primary as one control", () => {
    render(
      <DocumentActionBar actions={[PRIMARY, SCHEDULE]} bindings={bindings()} />
    );
    const split = screen
      .getByRole("button", { name: "Publish" })
      .closest("[data-publish-split]");
    expect(split).not.toBeNull();
    expect(
      within(split as HTMLElement).getByRole("button", {
        name: "More ways to publish",
      })
    ).toBeTruthy();
  });

  it("draws no arrow when there is no other way to publish", () => {
    render(<DocumentActionBar actions={[PRIMARY]} bindings={bindings()} />);
    expect(arrow()).toBeNull();
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("runs the chosen way", async () => {
    const schedule = vi.fn();
    render(
      <DocumentActionBar
        actions={[PRIMARY, SCHEDULE, ADD]}
        bindings={bindings({ "schedule-publish": { onSelect: schedule } })}
      />
    );
    await userEvent.click(arrow() as HTMLElement);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Schedule publish…" })
    );
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("holds a way the person may not use, saying why on the row", async () => {
    const schedule = vi.fn();
    const reason = "You do not have permission to schedule releases.";
    render(
      <DocumentActionBar
        actions={[PRIMARY, { ...SCHEDULE, disabledReason: reason }, ADD]}
        bindings={bindings({ "schedule-publish": { onSelect: schedule } })}
      />
    );
    await userEvent.click(arrow() as HTMLElement);
    const item = await screen.findByRole("menuitem", {
      name: /schedule publish/i,
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    // Visible text, not only a tooltip: a disabled row takes no focus.
    expect(within(item).getByText(reason)).toBeTruthy();
    await userEvent.click(item);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("puts them at the top of More when no primary action is drawn", async () => {
    render(
      <DocumentActionBar
        actions={[VIEW_API, SCHEDULE, ADD]}
        bindings={bindings()}
      />
    );
    expect(arrow()).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map(item => item.textContent)
    ).toEqual(["Schedule publish…", "Add to release…", "View API response"]);
  });
});

describe("the arrow by keyboard", () => {
  it("opens with Enter, moves with the arrows, runs with Enter", async () => {
    const add = vi.fn();
    render(
      <DocumentActionBar
        actions={[PRIMARY, SCHEDULE, ADD]}
        bindings={bindings({ "add-to-release": { onSelect: add } })}
      />
    );
    const trigger = arrow() as HTMLElement;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const first = await screen.findByRole("menuitem", {
      name: "Schedule publish…",
    });
    expect(document.activeElement).toBe(first);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Add to release…");
    await userEvent.keyboard("{Enter}");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape, back on the arrow", async () => {
    render(
      <DocumentActionBar actions={[PRIMARY, SCHEDULE]} bindings={bindings()} />
    );
    const trigger = arrow() as HTMLElement;
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
