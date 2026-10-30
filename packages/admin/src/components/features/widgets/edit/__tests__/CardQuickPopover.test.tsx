/**
 * The quick popover, drawn for core's own cards as the registry publishes them: it holds the
 * card's Collection, the settings its widget marks quick and its Size, and ends with More
 * settings. It opens from the card's title and from its menu's Settings, applies a change at
 * once with the popover still open, and closes on Escape with focus back where it was opened.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sizeBounds, type PublishedContentSource } from "nextly/config";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import {
  CORE_DECLARATIONS,
  CORE_WIDGETS,
} from "../../../../../../../nextly/src/domains/widgets/core-widgets";
import { CORE_WIDGET_ID } from "../../../../../../../nextly/src/domains/widgets/core-widgets/ids";
import { CardQuickPopover, CardTitleButton } from "../CardQuickSetting";
import type { CardSettingsWriteCallbacks } from "../useCardSettingsWrite";
import {
  useCardQuickSetting,
  useQuickPopoverOpening,
  type CellSettingsWrite,
} from "../useCardQuickSetting";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

const SOURCES: PublishedContentSource[] = [
  {
    collection: "posts",
    label: "Posts",
    lifecycle: true,
    titleField: "title",
    fields: [
      { name: "title", label: "Title", type: "string" },
      { name: "updatedAt", label: "Updated", type: "date" },
    ],
  },
  {
    collection: "pages",
    label: "Pages",
    lifecycle: false,
    titleField: "title",
    fields: [{ name: "title", label: "Title", type: "string" }],
  },
];
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ widgetSources: SOURCES }),
}));

/**
 * A core card as the registry publishes it to the admin, with its size filled in as every
 * published size is. A declaration's settings are published as a list, each named by its key;
 * written out here from the declaration's own record, since the registry's converter reads
 * nextly's server modules, which the admin's type check does not reach.
 */
function coreCard(id: string): DashboardWidget {
  const declared = CORE_DECLARATIONS.find(widget => widget.id === id);
  if (declared) {
    return {
      id: declared.id,
      title: declared.title,
      archetype: "custom",
      size: sizeBounds(declared.size),
      settings: Object.entries(
        (declared as { settings?: Record<string, object> }).settings ?? {}
      ).map(([name, setting]) => ({
        ...setting,
        name,
      })),
    } as unknown as DashboardWidget;
  }
  const definition = CORE_WIDGETS.find(widget => widget.id === id);
  if (!definition) throw new Error(`no core widget ${id}`);
  return {
    ...definition,
    size: sizeBounds(definition.size),
  } as unknown as DashboardWidget;
}

/** A write whose every change lands at once. */
function landingWrite() {
  const lands = (_value: unknown, callbacks: CardSettingsWriteCallbacks) =>
    callbacks.onLanded?.();
  const write = vi.fn(lands);
  const resize = vi.fn(lands);
  const settingsWrite: CellSettingsWrite = { write, resize, isWriting: false };
  return { settingsWrite, write, resize };
}

/** A card's title and menu button around its quick popover, as the grid's cell draws them. */
function Card({
  widget,
  config,
  settingsWrite,
  onMoreSettings,
}: {
  widget: DashboardWidget;
  config?: Record<string, unknown>;
  settingsWrite: CellSettingsWrite;
  onMoreSettings: () => void;
}) {
  const quick = useCardQuickSetting({
    placementId: "p1",
    widget,
    title: widget.title,
    config,
    size: widget.size.default,
    isEditing: false,
    isFetching: false,
    updatedAt: null,
    settingsWrite,
    staged: { config: vi.fn(), size: vi.fn(), isWriting: false },
  });
  const popover = useQuickPopoverOpening();
  const menuButton = useRef<HTMLButtonElement>(null);
  if (!quick.popover) return <p>Nothing quick</p>;
  return (
    <div>
      <h2>
        <CardQuickPopover
          model={quick.popover}
          cardTitle={widget.title}
          open={popover.open}
          onOpenChange={popover.onOpenChange}
          opensFrom="trigger"
          onMoreSettings={onMoreSettings}
          returnFocusTo={popover.returnFocusTo}
        >
          <CardTitleButton ref={popover.titleRef} label={widget.title} />
        </CardQuickPopover>
      </h2>
      {/* The card menu's Settings, as the cell wires it. */}
      <button
        ref={menuButton}
        type="button"
        onClick={() => popover.openFrom(menuButton.current)}
      >
        Menu Settings
      </button>
    </div>
  );
}

function draw(id: string, config?: Record<string, unknown>) {
  const widget = coreCard(id);
  const { settingsWrite, write, resize } = landingWrite();
  const onMoreSettings = vi.fn();
  render(
    <Card
      widget={widget}
      {...(config ? { config } : {})}
      settingsWrite={settingsWrite}
      onMoreSettings={onMoreSettings}
    />
  );
  return { widget, write, resize, onMoreSettings };
}

/** The popover's controls by their visible labels, in order, then its last button. */
function contents(popover: HTMLElement) {
  const labels = Array.from(popover.querySelectorAll("label")).map(
    label => label.textContent
  );
  const buttons = within(popover).queryAllByRole("button");
  return { labels, last: buttons.at(-1)?.textContent };
}

async function openFromTitle(title: string, user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: title }));
  return {
    user,
    popover: await screen.findByRole("dialog", {
      name: `Quick settings for ${title}`,
    }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("the quick popover of core's cards", () => {
  it.each([
    [CORE_WIDGET_ID.count, "Count", ["Collection", "Width", "Height"]],
    [
      CORE_WIDGET_ID.overTime,
      "Over time",
      ["Collection", "Date range", "Width", "Height"],
    ],
    [
      CORE_WIDGET_ID.recentEntries,
      "Recent entries",
      ["Collection", "Width", "Height"],
    ],
    [CORE_WIDGET_ID.note, "Note", ["Width", "Height"]],
  ])(
    "for %s holds its Collection, its quick setting and its Size, then More settings",
    async (id, title, expected) => {
      draw(id);
      const { popover } = await openFromTitle(title);
      const { labels, last } = contents(popover);
      expect(labels).toEqual(expected);
      expect(last).toBe("More settings");
    }
  );

  it("offers the collections the card can be asked of, by their labels", async () => {
    draw(CORE_WIDGET_ID.count, { collection: "posts" });
    const { user, popover } = await openFromTitle("Count");
    await user.click(
      within(popover).getByRole("combobox", { name: "Collection" })
    );
    const options = screen.getAllByRole("option").map(o => o.textContent);
    expect(options).toEqual(["Posts", "Pages"]);
  });
});

describe("a change in the quick popover", () => {
  it("is written at once, while the popover stays open", async () => {
    const { write } = draw(CORE_WIDGET_ID.overTime, {
      collection: "posts",
    });
    const { user, popover } = await openFromTitle("Over time");
    await user.click(
      within(popover).getByRole("combobox", { name: "Date range" })
    );
    await user.click(screen.getByRole("option", { name: "Last 7 days" }));

    // Written on the change itself, not held for the popover to close.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]).toEqual({
      collection: "posts",
      dateRange: "7d",
    });
    expect(
      screen.getByRole("dialog", { name: "Quick settings for Over time" })
    ).toBeInTheDocument();
  });

  it("resizes the card at once from its Size", async () => {
    const { resize } = draw(CORE_WIDGET_ID.note);
    const { user, popover } = await openFromTitle("Note");
    await user.click(within(popover).getByRole("combobox", { name: "Width" }));
    await user.click(
      screen.getByRole("option", { name: "Full width, 12 columns" })
    );
    expect(resize.mock.calls[0]?.[0]).toEqual({
      w: 12,
      h: 3,
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("opening and closing the quick popover", () => {
  it("moves focus into it, and back to the title on Escape", async () => {
    draw(CORE_WIDGET_ID.count, { collection: "posts" });
    const { user, popover } = await openFromTitle("Count");
    await waitFor(() =>
      expect(popover).toContainElement(document.activeElement as HTMLElement)
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Count" })).toHaveFocus();
  });

  it("opened from the menu, gives focus back to the menu's button on Escape", async () => {
    draw(CORE_WIDGET_ID.count, { collection: "posts" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Menu Settings" }));
    const popover = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(popover).toContainElement(document.activeElement as HTMLElement)
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Menu Settings" })).toHaveFocus();
  });

  it("closes for More settings, which opens the sheet, and leaves focus to it", async () => {
    const { onMoreSettings } = draw(CORE_WIDGET_ID.count);
    const { user, popover } = await openFromTitle("Count");
    await user.click(
      within(popover).getByRole("button", { name: "More settings" })
    );
    expect(onMoreSettings).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Count" })).not.toHaveFocus();
  });

  it("names the title by the title alone, and says it opens a popup", () => {
    draw(CORE_WIDGET_ID.count);
    const title = screen.getByRole("button", { name: "Count" });
    expect(title).toHaveAttribute("aria-haspopup", "dialog");
    expect(title).toHaveAttribute("aria-expanded", "false");
  });
});
