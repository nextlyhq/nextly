/**
 * Side panel sections plugins declare at the `collection.edit` place: drawn
 * where the server placed them among the panel's own sections, a built-in
 * one they replace left out, and no heading left behind where the section's
 * component draws nothing for this document.
 *
 * The property separating this from a plausible broken panel is the ORDER:
 * a panel that appended placed sections after Details, as it does a
 * `views[slug].panelSections` section, would draw every section and still
 * put "Design" last.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  registerComponent,
  unregisterComponent,
  type DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";
import type { PanelOrderEntry } from "@admin/lib/plugins/document-surfaces";

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

const DESIGN = "test/designs#Design";
const NOTHING = "test/designs#Nothing";

function Design(props: DocumentPanelSectionProps) {
  return <p>Design of {props.entryId}</p>;
}

function Nothing() {
  return null;
}

beforeEach(() => {
  registerComponent(DESIGN, Design as never);
  registerComponent(NOTHING, Nothing as never);
});

afterEach(() => {
  unregisterComponent(DESIGN);
  unregisterComponent(NOTHING);
});

const sectionProps: DocumentPanelSectionProps = {
  collectionSlug: "posts",
  entryId: "p1",
  documentLock: { readOnly: false, actionsDisabled: false },
  mayWrite: () => true,
  documentChanged: vi.fn(),
};

function panel(order: PanelOrderEntry[]) {
  return render(
    <DocumentPanel
      mode="edit"
      entry={{ id: "p1", createdAt: "2026-10-01T09:00:00Z" }}
      hasStatus={false}
      pluginSectionProps={sectionProps}
      panelOrder={order}
    />
  );
}

const section = (
  id: string,
  title: string,
  component: string
): PanelOrderEntry => ({
  kind: "section",
  id,
  plugin: "@acme/designs",
  title,
  component,
});

/** The panel's sections, by the headings that name them, in order. */
function sectionTitles(): string[] {
  return screen
    .getAllByRole("region", { hidden: true })
    .map(region => region.getAttribute("data-panel-section") ?? "");
}

describe("a side panel section placed at collection.edit", () => {
  it("is drawn where it was placed, before the panel's own sections", () => {
    panel([
      section("acme-designs.design", "Design", DESIGN),
      { kind: "builtIn", name: "language" },
      { kind: "builtIn", name: "details" },
    ]);
    expect(sectionTitles()).toEqual(["Design", "Details"]);
    const design = screen.getByRole("region", { name: "Design" });
    expect(
      within(design).getByRole("heading", { name: "Design" })
    ).toBeVisible();
    expect(within(design).getByText("Design of p1")).toBeVisible();
  });

  it("leaves out a built-in section the server's order does not hold", () => {
    // A contribution that replaces Details arrives in Details' place, and
    // Details is not in the list.
    panel([section("acme-designs.design", "Design", DESIGN)]);
    expect(sectionTitles()).toEqual(["Design"]);
  });

  it("leaves no heading behind when its component draws nothing", () => {
    panel([
      section("acme-designs.nothing", "Nothing here", NOTHING),
      { kind: "builtIn", name: "details" },
    ]);
    const empty = screen.getByRole("region", {
      name: "Nothing here",
      hidden: true,
    });
    // The body is empty, and the section carries the rule that hides it
    // while it is: the stylesheet, not jsdom, applies `:has()`.
    const body = empty.querySelector("[data-panel-section-body]");
    expect(body).not.toBeNull();
    expect(body?.childElementCount).toBe(0);
    expect(empty.className).toContain(
      "has-[>[data-panel-section-body]:empty]:hidden"
    );
  });

  it("draws the built-in sections in their usual order when nothing places them", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "p1" }}
        hasStatus={false}
        pluginSectionProps={sectionProps}
      />
    );
    expect(sectionTitles()).toEqual(["Details"]);
  });
});
