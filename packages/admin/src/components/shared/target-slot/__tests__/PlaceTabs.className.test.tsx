/**
 * A place's tabs take a page's classes on the strip and the contributed tabs'
 * panels alone: the page's own content keeps its own layout, so a page that
 * insets its content can line the strip up with it without moving the
 * content.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

import { PlaceTabs } from "..";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

const TAB = "@acme/a/admin#InsetTab";
registerComponent(TAB, () => <p>plugin tab body</p>);

afterEach(() => {
  meta.contributions = undefined;
});

const CONTEXT = { userId: "u1", shownUserId: "u2" };

describe("PlaceTabs' classes", () => {
  it("puts the page's classes on the strip and a plugin's panel, never on the page's content", async () => {
    meta.contributions = {
      "user.detail": {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.inset",
            kind: "tab",
            label: "Acme",
            component: TAB,
          },
        ],
      },
    } as AdminContributionsMeta;
    render(
      <PlaceTabs
        place="user.detail"
        context={CONTEXT}
        contentLabel="Profile"
        className="page-inset"
      >
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    const strip = screen.getByRole("tablist");
    const root = strip.closest(".page-inset");
    expect(root).not.toBeNull();
    // The page's own content sits outside what the classes reach.
    expect(root?.contains(screen.getByTestId("page-content"))).toBe(false);
    expect(
      screen.getByTestId("page-content").closest(".page-inset")
    ).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Acme" }));
    expect(screen.getByText("plugin tab body").closest(".page-inset")).toBe(
      root
    );
  });

  it("draws the page's content as it is, classes unused, with no tab delivered", () => {
    const { container } = render(
      <PlaceTabs
        place="user.detail"
        context={CONTEXT}
        contentLabel="Profile"
        className="page-inset"
      >
        <div data-testid="page-content">content</div>
      </PlaceTabs>
    );

    expect(container.querySelector(".page-inset")).toBeNull();
    expect(container.firstElementChild).toBe(
      screen.getByTestId("page-content")
    );
  });
});
