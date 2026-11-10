/**
 * The count a contributed tab shows beside its label (`setBadge`): drawn for
 * sight and said in words with the label, so a screen reader hears what it
 * means; past 99 drawn as "99+" while the words keep the true number; the
 * warning colour only for something to act on; nothing drawn for a count a
 * plugin got wrong; and taken back with `null`, or when the tab is no longer
 * delivered, so a tab that comes back brings no stale count with it.
 */
import { act, render, screen } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

import { PlaceTabs, type PlaceTabBadge, type PlaceTabProps } from "..";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

/** The tab's `setBadge`, as the strip last handed it. */
let setBadge: PlaceTabProps["setBadge"] | undefined;

const TAB = "@acme/a/admin#CountedTab";
registerComponent(TAB, ((props: PlaceTabProps) => {
  setBadge = props.setBadge;
  return <p>counted tab body</p>;
}) as never);

const delivered = {
  "user.detail": {
    tab: [
      {
        plugin: "@acme/a",
        id: "acme-a.counted",
        kind: "tab",
        label: "Checks",
        component: TAB,
      },
    ],
  },
} as AdminContributionsMeta;

function page(): ReactElement {
  return (
    <PlaceTabs
      place="user.detail"
      context={{ userId: "u1", shownUserId: "u2" }}
      contentLabel="Profile"
    >
      <p>profile</p>
    </PlaceTabs>
  );
}

const tab = () => screen.getByRole("tab", { name: /^Checks/ });
const pill = () => tab().querySelector("[data-tab-badge]");
const show = (badge: PlaceTabBadge | null) => act(() => setBadge?.(badge));

beforeEach(() => {
  meta.contributions = delivered;
  setBadge = undefined;
});
afterEach(() => {
  meta.contributions = undefined;
});

describe("a contributed tab's count", () => {
  it("is drawn beside the label and said in words with it, the closed tab setting it", () => {
    render(page());
    expect(tab()).toHaveAttribute("aria-selected", "false");
    show({ count: 3, label: "3 things to fix" });

    expect(pill()).toHaveTextContent(/^3$/);
    expect(pill()).toHaveAttribute("aria-hidden", "true");
    expect(tab()).toHaveAccessibleName("Checks (3 things to fix)");
  });

  it("draws 99+ past 99, the words keeping the true number", () => {
    render(page());
    show({ count: 140, label: "140 things to fix" });

    expect(pill()).toHaveTextContent(/^99\+$/);
    expect(tab()).toHaveAccessibleName("Checks (140 things to fix)");
  });

  it("takes the warning colour only above zero, and the muted one by default", () => {
    render(page());
    show({ count: 2, label: "2 to fix", tone: "attention" });
    expect(pill()).toHaveAttribute("data-tab-badge", "attention");

    show({ count: 0, label: "Nothing to fix", tone: "attention" });
    expect(pill()).toHaveAttribute("data-tab-badge", "neutral");

    show({ count: 5, label: "5 links" });
    expect(pill()).toHaveAttribute("data-tab-badge", "neutral");
  });

  it("draws nothing for a count that is not a whole number from zero", () => {
    render(page());
    for (const count of [-1, 1.5, Number.NaN]) {
      show({ count, label: "broken" });
      expect(pill()).toBeNull();
      expect(tab()).toHaveAccessibleName("Checks");
    }
  });

  it("is taken back with null", () => {
    render(page());
    show({ count: 4, label: "4 to fix" });
    show(null);

    expect(pill()).toBeNull();
    expect(tab()).toHaveAccessibleName("Checks");
  });

  it("goes with its tab, so a tab delivered again brings no stale count", () => {
    const { rerender } = render(page());
    show({ count: 4, label: "4 to fix" });

    meta.contributions = undefined;
    rerender(page());
    expect(screen.queryByRole("tablist")).toBeNull();

    meta.contributions = delivered;
    rerender(page());
    expect(pill()).toBeNull();
    expect(tab()).toHaveAccessibleName("Checks");
  });
});
