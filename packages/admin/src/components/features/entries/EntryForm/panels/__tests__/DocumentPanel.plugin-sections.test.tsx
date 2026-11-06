/**
 * Sections a plugin adds to the document panel: drawn after Details, under a
 * heading the panel draws as it does its own, and handed the document's id,
 * its collection, what holds it, and how to say the section changed it.
 *
 * The property separating this from a plausible broken panel is that the
 * section is the panel's own `section` landmark, after Details, with the
 * plugin's component inside it and given these props — not a component drawn
 * somewhere on the page with a heading of its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  registerComponent,
  unregisterComponent,
  type DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";

import { DocumentPanel } from "../DocumentPanel";

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const USAGE = "test/layouts#Usage";
const seen: DocumentPanelSectionProps[] = [];

function Usage(props: DocumentPanelSectionProps) {
  seen.push(props);
  return <p>Used by 3 pages</p>;
}

beforeEach(() => {
  seen.length = 0;
  registerComponent(USAGE, Usage as never);
});

afterEach(() => {
  unregisterComponent(USAGE);
});

const sectionProps: DocumentPanelSectionProps = {
  collectionSlug: "layouts",
  entryId: "l1",
  documentLock: { readOnly: true, actionsDisabled: true },
  mayWrite: () => false,
  documentChanged: vi.fn(),
};

function panel(mode: "edit" | "create" = "edit") {
  return render(
    <DocumentPanel
      place={{ place: "collection.edit", context: null }}
      mode={mode}
      entry={{ id: "l1", createdAt: "2026-10-01T09:00:00Z" }}
      hasStatus={false}
      pluginSections={[
        { plugin: "@acme/layouts", title: "Used by", component: USAGE },
      ]}
      pluginSectionProps={sectionProps}
    />
  );
}

/** The panel's sections, by the headings that name them, in order. */
function sectionTitles(): string[] {
  return screen
    .getAllByRole("region")
    .map(region => region.getAttribute("data-panel-section") ?? "");
}

describe("a plugin's document panel section", () => {
  it("is drawn after Details, as one of the panel's own sections", () => {
    panel();
    expect(sectionTitles()).toEqual(["Details", "Used by"]);
    const section = screen.getByRole("region", { name: "Used by" });
    // The panel draws the heading, in the style its own sections use.
    expect(
      within(section).getByRole("heading", { name: "Used by" })
    ).toBeVisible();
    expect(within(section).getByText("Used by 3 pages")).toBeVisible();
  });

  it("is handed the document, what holds it, and how to say it changed", () => {
    panel();
    expect(seen.at(-1)).toEqual(sectionProps);
  });

  it("is not drawn while the document is being created", () => {
    panel("create");
    expect(screen.queryByRole("region", { name: "Used by" })).toBeNull();
    expect(seen).toEqual([]);
  });
});
