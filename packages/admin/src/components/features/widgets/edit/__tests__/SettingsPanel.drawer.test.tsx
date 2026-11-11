/**
 * The settings drawer for core's own cards and a plugin's, drawn from their real declarations as
 * the registry publishes them: the preview first, then Content, Display and Size, each only
 * where the widget has something for it, nothing folded. A list's Number of entries is a choice
 * of 5, 10 or 20 that keeps a number stored before (7) until the reader picks another; the card's
 * width is a choice of its widths in percent that keeps one outside them the same way; a note's
 * text says what Markdown it takes and how many characters remain.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyWidgetSetting } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { CORE_DECLARATIONS } from "../../../../../../../nextly/src/domains/widgets/core-widgets";
import { sizeBounds } from "../../../../../../../nextly/src/domains/widgets/grid-size";
import type { PanelKept } from "../panel-values";
import { SettingsPanel } from "../SettingsPanel";

// One array for every render, as the workspace payload is: a new one each time would be new
// sources, and the drawer would take up its baseline again on every render.
const branding = vi.hoisted(() => ({
  widgetSources: [
    {
      collection: "posts",
      label: "Posts",
      lifecycle: true,
      fields: [{ name: "title", type: "string", label: "Title" }],
    },
  ],
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

/**
 * One of core's cards, by its id, with its settings and size as the registry publishes them to
 * the admin (`toDefinition`): each setting named by its key, the size with every end filled in.
 */
function core(id: string): DashboardWidget {
  const declaration = CORE_DECLARATIONS.find(widget => widget.id === id);
  if (declaration === undefined) throw new Error(`no core widget ${id}`);
  const declared: Readonly<Record<string, object>> = declaration.settings ?? {};
  const settings = Object.entries(declared).map(
    ([name, setting]) => ({ ...setting, name }) as AnyWidgetSetting
  );
  return {
    id: declaration.id,
    title: declaration.title,
    archetype: "custom",
    size: sizeBounds(declaration.size),
    ...(settings.length > 0 ? { settings } : {}),
  };
}

/** A plugin's list card, declared as Forms' New submissions is: its own Number of entries. */
const PLUGIN: DashboardWidget = {
  id: "acme/orders",
  title: "New orders",
  archetype: "custom",
  component: "acme#Orders",
  size: { default: { w: 6, h: 3 }, min: { w: 4, h: 2 }, max: { w: 12, h: 6 } },
  settings: [
    {
      name: "limit",
      type: "number",
      label: "Number of entries",
      defaultValue: 5,
      min: 1,
      max: 20,
    },
  ],
};

/** The drawer for `widget` at width `w`, its preview stood in for by what it is handed. */
function drawer(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  w = widget.size.default.w
) {
  const onDone = vi.fn((_kept: PanelKept, settled: { saved: () => void }) =>
    settled.saved()
  );
  const previewed = vi.fn((draft: PanelKept) => (
    <p data-testid="preview-stand-in">{`w ${String(draft.w)}`}</p>
  ));
  render(
    <SettingsPanel
      placementId="p1"
      open
      onOpenChange={() => {}}
      title={widget.title}
      settings={widget.settings ?? []}
      widget={widget}
      config={config}
      sizing={{ w, bounds: widget.size }}
      onDone={onDone}
      renderPreview={previewed}
    />
  );
  return { onDone, previewed };
}

/** The drawer's sections, by name, in the order drawn. */
function sections(): string[] {
  return screen
    .getAllByRole("region")
    .map(region => region.getAttribute("aria-labelledby") ?? "")
    .map(id => document.getElementById(id)?.textContent ?? "");
}

/** What a section holds, as text. */
function holds(name: string): string {
  return screen.getByRole("region", { name }).textContent ?? "";
}

describe("the drawer for each kind of card", () => {
  it("draws Count's preview, then Content, Display and Size, nothing folded", () => {
    drawer(core("core/count"), { collection: "posts" });
    const dialog = screen.getByRole("dialog", { name: "Count" });
    expect(dialog).toHaveAccessibleDescription("Widget settings");
    // The preview leads, above every section.
    const preview = screen.getByTestId("preview-stand-in");
    const first = screen.getAllByRole("region")[0];
    expect(
      preview.compareDocumentPosition(first as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(sections()).toEqual(["Content", "Display", "Size"]);
    expect(holds("Content")).toMatch(/Collection.*Filter/s);
    expect(holds("Display")).toMatch(/Title/);
    // Nothing folded: no section is a disclosure to open.
    expect(
      screen
        .getAllByRole("region")
        .every(region => region.querySelector("h3 [aria-expanded]") === null)
    ).toBe(true);
  });

  it("draws Recent entries' Number of entries and Row spacing under Display, as choices", () => {
    drawer(core("core/recent-entries"), { collection: "posts" });
    expect(sections()).toEqual(["Content", "Display", "Size"]);
    expect(holds("Content")).toMatch(/Collection.*Filter.*Sort/s);
    const display = screen.getByRole("region", { name: "Display" });
    const entries = within(display).getByRole("radiogroup", {
      name: "Number of entries",
    });
    expect(
      within(entries)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["5", "10", "20"]);
    expect(within(entries).getByRole("radio", { name: "5" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    const spacing = within(display).getByRole("radiogroup", {
      name: "Row spacing",
    });
    expect(
      within(spacing)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["Comfortable", "Compact"]);
  });

  it("draws Team with its title and width alone", () => {
    drawer(core("core/team"), undefined);
    expect(sections()).toEqual(["Display", "Size"]);
  });

  it("draws the Note's text with what Markdown it takes and the characters left", () => {
    drawer(core("core/note"), { text: "Ship it" });
    expect(sections()).toEqual(["Display", "Size"]);
    const text = screen.getByRole("textbox", { name: "Text" });
    expect(text).toHaveAccessibleDescription(
      expect.stringContaining("1,993 characters left")
    );
    expect(text).toHaveAccessibleDescription(
      expect.stringContaining("Supports Markdown: **bold**, _italic_")
    );
  });

  it("draws a plugin's own Number of entries as the same choice", () => {
    drawer(PLUGIN, undefined);
    expect(sections()).toEqual(["Display", "Size"]);
    expect(
      screen.getByRole("radiogroup", { name: "Number of entries" })
    ).toBeInTheDocument();
  });
});

describe("a Number of entries saved before as none of 5, 10 or 20", () => {
  it("is offered and chosen as stored, and saved unchanged until the reader picks another", async () => {
    const user = userEvent.setup();
    const { onDone } = drawer(core("core/recent-entries"), {
      collection: "posts",
      limit: 7,
    });
    const entries = screen.getByRole("radiogroup", {
      name: "Number of entries",
    });
    expect(
      within(entries)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["5", "7", "10", "20"]);
    expect(within(entries).getByRole("radio", { name: "7" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await user.type(screen.getByLabelText("Title"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone.mock.calls.at(-1)?.[0].config).toMatchObject({ limit: 7 });
  });

  it("offers a widget's own default that is none of them, as the card uses it, with nothing stored", () => {
    drawer(
      {
        ...PLUGIN,
        settings: [
          {
            name: "limit",
            type: "number",
            label: "Rows",
            defaultValue: 3,
          },
        ],
      },
      undefined
    );
    const entries = screen.getByRole("radiogroup", { name: "Rows" });
    expect(
      within(entries)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["3", "5", "10", "20"]);
    expect(within(entries).getByRole("radio", { name: "3" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("stays offered when the card's settings arrive again behind the open drawer", async () => {
    // 🔴 The form's own defaults are replaced when the card's stored settings are read again
    // while the drawer is open; the card's own 3 must not leave the choices with them.
    const user = userEvent.setup();
    const rows: DashboardWidget = {
      ...PLUGIN,
      settings: [
        { name: "limit", type: "number", label: "Rows", defaultValue: 3 },
      ],
    };
    const draw = (config: Record<string, unknown>) => (
      <SettingsPanel
        placementId="p1"
        open
        onOpenChange={() => {}}
        title={rows.title}
        settings={rows.settings ?? []}
        widget={rows}
        config={config}
        sizing={{ w: 6, bounds: rows.size }}
        onDone={() => {}}
      />
    );
    const view = render(draw({}));
    await user.click(screen.getByRole("radio", { name: "5" }));
    // The same stored settings, read again: a new object holding the same values.
    view.rerender(draw({}));
    const entries = screen.getByRole("radiogroup", { name: "Rows" });
    expect(
      within(entries)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["3", "5", "10", "20"]);
    expect(within(entries).getByRole("radio", { name: "5" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("is replaced by the reader's own choice, stored as a number", async () => {
    const user = userEvent.setup();
    const { onDone } = drawer(core("core/recent-entries"), {
      collection: "posts",
      limit: 7,
    });
    await user.click(screen.getByRole("radio", { name: "10" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone.mock.calls.at(-1)?.[0].config).toMatchObject({ limit: 10 });
  });
});

describe("the Size section's Width", () => {
  it("offers the widget's widths in percent, the drawn one chosen, and no Height", () => {
    drawer(PLUGIN, undefined, 6);
    const widths = screen.getByRole("radiogroup", { name: "Width" });
    expect(
      within(widths)
        .getAllByRole("radio")
        .map(radio => radio.textContent)
    ).toEqual(["33%", "50%", "66%", "75%", "100%"]);
    expect(
      within(widths).getByRole("radio", { name: "50% width" })
    ).toHaveAttribute("aria-checked", "true");
    expect(holds("Size")).toContain(
      "From 33% to 100%. Height follows the content."
    );
  });

  it("keeps a width outside the choices as drawn, until the reader picks another", async () => {
    const user = userEvent.setup();
    const { onDone } = drawer(PLUGIN, undefined, 5);
    const widths = screen.getByRole("radiogroup", { name: "Width" });
    expect(
      within(widths).getByRole("radio", { name: "42% width" })
    ).toHaveAttribute("aria-checked", "true");
    await user.type(screen.getByLabelText("Title"), "Mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone.mock.calls.at(-1)?.[0]).toMatchObject({ w: 5 });
  });

  it("hands the preview the width chosen, and keeps it on Save", async () => {
    const user = userEvent.setup();
    const { onDone, previewed } = drawer(PLUGIN, undefined, 6);
    await user.click(screen.getByRole("radio", { name: "100% width" }));
    expect(previewed.mock.calls.at(-1)?.[0]).toMatchObject({ w: 12 });
    expect(screen.getByTestId("preview-stand-in")).toHaveTextContent("w 12");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onDone.mock.calls.at(-1)?.[0]).toMatchObject({ w: 12 });
  });
});
