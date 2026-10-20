/**
 * The settings sheet with content settings, drawn: a stale stored value opens
 * at its default with one line saying so, Reset leaves the card's Collection
 * as it is, each control offers only what the server sent and the read
 * accepts, a filter row keeps a half-built condition, and changing the
 * collection sends the settings over it back to their defaults.
 *
 * The branding context stands in for the workspace payload's `widgetSources`;
 * everything else is the real sheet.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnyWidgetSetting, PublishedContentSource } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WidgetSettingsSheet } from "../WidgetSettingsSheet";

const mockBranding = vi.hoisted(() => ({
  value: {} as { widgetSources?: PublishedContentSource[] },
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding.value,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));

const sources: PublishedContentSource[] = [
  {
    collection: "posts",
    label: "Posts",
    fields: [
      { name: "title", type: "string", label: "Title" },
      { name: "updatedAt", type: "date", label: "Updated" },
      { name: "headline", type: "string", label: "Headline", groupable: false },
    ],
  },
  {
    collection: "pages",
    label: "Pages",
    fields: [{ name: "title", type: "string", label: "Title" }],
  },
];

const settings: AnyWidgetSetting[] = [
  { name: "collection", type: "collection", label: "Collection" },
  { name: "by", type: "groupBy", of: "collection", label: "Group by" },
  { name: "items", type: "number", label: "Number of items", defaultValue: 5 },
];

function open(
  config: Record<string, unknown>,
  declared: AnyWidgetSetting[] = settings
) {
  const onSave = vi.fn();
  render(
    <WidgetSettingsSheet
      open
      onOpenChange={() => {}}
      title="Recent posts"
      settings={declared}
      config={config}
      onSave={onSave}
    />
  );
  return onSave;
}

const withFilter: AnyWidgetSetting[] = [
  { name: "collection", type: "collection", label: "Collection" },
  { name: "where", type: "filter", of: "collection", label: "Filter" },
];

/** What the last Save handed on. */
const saved = (onSave: ReturnType<typeof vi.fn>) =>
  onSave.mock.calls.at(-1)?.[0] as Record<string, unknown>;

beforeEach(() => {
  mockBranding.value = { widgetSources: sources };
});

describe("the settings sheet with content settings", () => {
  it("opens a value naming a field no longer offered at its default, and says so", async () => {
    const onSave = open({ collection: "posts", by: "secret" });
    expect(
      screen.getByText("Group by was reset: secret is no longer available")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    // The stale value is not saved back: the card follows its default.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("by");
  });

  it("says nothing while the sources have not arrived", () => {
    mockBranding.value = {};
    open({ collection: "posts", by: "secret" });
    expect(screen.queryByText(/is no longer available/)).toBeNull();
  });

  it("offers only the collections the server sent, and resets what depends on one when it changes", async () => {
    const onSave = open({ collection: "posts", by: "title" });
    await userEvent.click(screen.getByRole("combobox", { name: /Collection/ }));
    const offered = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(offered).toEqual(["Posts", "Pages"]);
    await userEvent.click(screen.getByRole("option", { name: "Pages" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Group by named a field of Posts; with Pages chosen it goes back to its
    // default rather than naming a field of the other collection.
    expect(onSave.mock.calls[0]?.[0]).toEqual({ collection: "pages" });
  });

  it("offers Group by only the fields the read will group by", async () => {
    open({ collection: "posts" });
    await userEvent.click(screen.getByRole("combobox", { name: /Group by/ }));
    const offered = screen
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(offered).toContain("Title");
    expect(offered).not.toContain("Headline");
  });

  it("keeps a chosen field while its value is entered, and saves the condition once complete", async () => {
    const onSave = open({ collection: "posts" }, withFilter);
    await userEvent.click(
      screen.getByRole("combobox", { name: "Condition field" })
    );
    await userEvent.click(screen.getByRole("option", { name: "Title" }));
    // The row has a field and no value yet, which writes nothing; the field
    // must still be the one chosen.
    expect(
      screen.getByRole("combobox", { name: "Condition field" }).textContent
    ).toContain("Title");
    await userEvent.type(
      screen.getByRole("textbox", { name: "Condition value" }),
      "Hello"
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const where = saved(onSave).where as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(where)).toEqual(["title"]);
    expect(Object.values(where.title ?? {})).toEqual(["Hello"]);
  });

  it("says when a stored filter cannot be shown, rather than drawing an empty row, and clears it", async () => {
    const onSave = open(
      { collection: "posts", where: { title: { in: ["a", "b"] } } },
      withFilter
    );
    expect(
      screen.getByText("This card has a filter that can't be shown here.")
    ).toBeTruthy();
    expect(
      screen.queryByRole("combobox", { name: "Condition field" })
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(saved(onSave)).toEqual({ collection: "posts" });
  });

  it("opens with sources that arrived while it was closed, and saves what its notice says", async () => {
    mockBranding.value = {};
    const onSave = vi.fn();
    const sheet = (isOpen: boolean) => (
      <WidgetSettingsSheet
        open={isOpen}
        onOpenChange={() => {}}
        title="Recent posts"
        settings={settings}
        config={{ collection: "posts", by: "secret" }}
        onSave={onSave}
      />
    );
    const { rerender } = render(sheet(false));
    mockBranding.value = { widgetSources: sources };
    rerender(sheet(false));
    rerender(sheet(true));
    expect(
      screen.getByText("Group by was reset: secret is no longer available")
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(saved(onSave)).not.toHaveProperty("by");
  });

  it("leaves the card's Collection as it is on Reset, even one changed in this sheet", async () => {
    const onSave = open({ collection: "posts", items: 9 });
    await userEvent.click(screen.getByRole("combobox", { name: /Collection/ }));
    await userEvent.click(screen.getByRole("option", { name: "Pages" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(saved(onSave)).toEqual({ collection: "pages" });
  });

  it("resets every setting to its default but keeps the card's collection", async () => {
    const onSave = open({ collection: "posts", by: "title", items: 9 });
    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toEqual({ collection: "posts" });
  });
});
