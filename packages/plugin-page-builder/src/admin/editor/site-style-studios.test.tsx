// @vitest-environment jsdom
/**
 * The Variables studio's wiring: the permission that decides whether the
 * site's variables can be changed, and the Design panel header its controls
 * are drawn into.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const can = vi.hoisted(() => ({ update: true }));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: (permission: string) =>
    permission === "update-site-style" ? can.update : false,
}));

vi.mock("../site-style-client", () => ({
  useSaveSiteStyle: () => ({
    save: vi.fn(() => Promise.resolve({ saved: true, issues: [] })),
  }),
}));

import { DesignPanel } from "./design-panel";
import { TokensStudio } from "./site-style-studios";

afterEach(cleanup);

beforeAll(() => {
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

function renderStudio(): void {
  render(
    <DesignPanel
      view={{ current: "variables", choose: vi.fn() }}
      tabs={{
        variables: () => (
          <TokensStudio
            merged={{
              tokens: [
                {
                  name: "color.brand",
                  kind: "color",
                  values: { light: "#1d2b6b" },
                },
              ],
            }}
            supplied={undefined}
            pending={false}
          />
        ),
        classes: () => null,
        fonts: () => null,
      }}
    />
  );
}

describe("the Variables studio", () => {
  it("is read-only for a role that may not update the site style", () => {
    can.update = false;
    renderStudio();
    expect(
      screen.getByText("You can view the site’s variables but not change them.")
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add colour" })).toBeNull();
  });

  it("can be changed by a role that may", () => {
    can.update = true;
    renderStudio();
    expect(screen.queryByText(/can view the site/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add colour" })).toBeTruthy();
  });

  it("draws its preview switch and menu into the Design panel's header", async () => {
    can.update = true;
    renderStudio();
    const header = screen.getByRole("heading", { name: "Design" })
      .parentElement as HTMLElement;
    expect(
      await within(header).findByRole("group", { name: "Preview" })
    ).toBeTruthy();
    expect(
      within(header).getByRole("button", { name: "Import or export" })
    ).toBeTruthy();
  });
});
