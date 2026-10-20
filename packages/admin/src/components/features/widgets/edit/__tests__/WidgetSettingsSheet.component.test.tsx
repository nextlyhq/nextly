/**
 * The settings sheet with content settings, drawn: a stale stored value opens
 * at its default with one line saying so, Reset keeps a placed collection, a
 * Collection setting offers only what the server sent, and changing it sends
 * the settings over it back to their defaults.
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

function open(config: Record<string, unknown>) {
  const onSave = vi.fn();
  render(
    <WidgetSettingsSheet
      open
      onOpenChange={() => {}}
      title="Recent posts"
      settings={settings}
      config={config}
      onSave={onSave}
    />
  );
  return onSave;
}

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

  it("resets every setting to its default but keeps the placed collection", async () => {
    const onSave = open({ collection: "posts", by: "title", items: 9 });
    await userEvent.click(
      screen.getByRole("button", { name: "Reset to defaults" })
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toEqual({ collection: "posts" });
  });
});
