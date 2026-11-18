/**
 * A place's tabs as data, for a page that draws them in its own row beside
 * tabs of its own: the same tabs, in the order delivered, each handed the
 * page's props and the place's context, with its count said in its name,
 * and none while the page does not know its ids.
 */
import { act, render, screen } from "@testing-library/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@nextlyhq/ui";
import type { AdminContributionsMeta } from "nextly/config";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

import { usePlaceTabs, type PlaceTabProps } from "..";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

/** What each tab was last handed. */
const handed: Record<string, PlaceTabProps & { shared?: string }> = {};

const FIRST = "@acme/a/admin#FirstTab";
const SECOND = "@acme/b/admin#SecondTab";
registerComponent(FIRST, ((props: PlaceTabProps & { shared?: string }) => {
  handed.first = props;
  return <p>first body</p>;
}) as never);
registerComponent(SECOND, ((props: PlaceTabProps & { shared?: string }) => {
  handed.second = props;
  return <p>second body</p>;
}) as never);

const delivered = {
  "user.detail": {
    tab: [
      {
        plugin: "@acme/a",
        id: "acme-a.first",
        kind: "tab",
        label: "First",
        component: FIRST,
      },
      {
        plugin: "@acme/b",
        id: "acme-b.second",
        kind: "tab",
        label: "Second",
        component: SECOND,
      },
    ],
  },
} as AdminContributionsMeta;

/** A page drawing its own tab first, then the place's, in one row. */
function OwnRow({ known = true }: { known?: boolean }): JSX.Element {
  const tabs = usePlaceTabs({
    place: "user.detail",
    context: known ? { userId: "u1", shownUserId: "u2" } : null,
    tabProps: { shared: "from the page" },
  });
  return (
    <Tabs defaultValue="own">
      <TabsList>
        <TabsTrigger value="own">Own</TabsTrigger>
        {/* A tab that left the row draws no trigger. */}
        {tabs
          .filter(tab => tab.leftOut !== true)
          .map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              {...(tab.accessibleName === undefined
                ? {}
                : { "aria-label": tab.accessibleName })}
            >
              {tab.trigger}
            </TabsTrigger>
          ))}
      </TabsList>
      <TabsContent value="own">own body</TabsContent>
      {tabs.map(tab => (
        <TabsContent key={tab.id} value={tab.id} forceMount hidden>
          {tab.panel}
        </TabsContent>
      ))}
    </Tabs>
  );
}

beforeEach(() => {
  meta.contributions = delivered;
});
afterEach(() => {
  meta.contributions = undefined;
  delete handed.first;
  delete handed.second;
});

describe("a place's tabs drawn in a page's own row", () => {
  it("follows the page's own tab, in the order delivered", () => {
    render(<OwnRow />);
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Own",
      "First",
      "Second",
    ]);
  });

  it("hands each tab the page's props and the place's context", async () => {
    render(<OwnRow />);
    expect(
      await screen.findByText("second body", {}, { timeout: 2000 })
    ).toBeTruthy();
    expect(handed.first?.shared).toBe("from the page");
    expect(handed.second?.context).toEqual({ userId: "u1", shownUserId: "u2" });
  });

  it("says a tab's count in its name", async () => {
    render(<OwnRow />);
    await screen.findByText("first body", {}, { timeout: 2000 });
    act(() => handed.first?.setBadge({ count: 2, label: "2 to fix" }));
    expect(screen.getByRole("tab", { name: "First (2 to fix)" })).toBeTruthy();
  });

  it("leaves a tab out of the row while it says it does not apply, its panel kept, until it comes back", async () => {
    render(<OwnRow />);
    await screen.findByText("first body", {}, { timeout: 2000 });
    act(() => handed.first?.setLeftOut?.(true));
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Own",
      "Second",
    ]);
    // Mounted, hidden, so it can bring itself back.
    expect(screen.getByText("first body")).toBeTruthy();
    act(() => handed.first?.setLeftOut?.(false));
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Own",
      "First",
      "Second",
    ]);
  });

  it("draws none while the page does not know its ids", () => {
    render(<OwnRow known={false} />);
    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "Own",
    ]);
  });
});
