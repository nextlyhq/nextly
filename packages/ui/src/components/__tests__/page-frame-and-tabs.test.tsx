// @vitest-environment jsdom
/**
 * A page says what it is and the frame decides its width. A list runs full
 * width, a form is a 56rem column under the page's left edge, an editor runs
 * full width, and a workspace takes no gutter at all. A page with sections
 * shows them as link tabs under its header, each with its own address.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageFrame } from "../page-frame";
import { PageHeader, PageTab, PageTabs } from "../page-header";

afterEach(cleanup);

function frameOf(type: "list" | "form" | "editor" | "workspace") {
  render(
    <PageFrame type={type} data-testid="frame">
      <p>Body</p>
    </PageFrame>
  );
  return screen.getByTestId("frame");
}

describe("a page frame", () => {
  it("draws a form as a 56rem column aligned to the start", () => {
    const frame = frameOf("form");
    expect(frame.getAttribute("data-slot")).toBe("page-shell");
    expect(frame.getAttribute("data-align")).toBe("start");
    expect(frame.style.getPropertyValue("--nx-shell-measure")).toBe(
      "var(--nx-measure-form)"
    );
  });

  it("draws an editor full width within the gutter", () => {
    const frame = frameOf("editor");
    expect(frame.getAttribute("data-slot")).toBe("page-shell");
    expect(frame.style.getPropertyValue("--nx-shell-measure")).toBe("100%");
  });

  it("draws a list as a padded block, not a grid, inset by the gutter", () => {
    const frame = frameOf("list");
    expect(frame.getAttribute("data-slot")).toBe("page-frame");
    expect(frame.className).toContain("nx-page-pad");
    expect(frame.className).not.toContain("nx-page-shell");
  });

  it("draws a workspace with no shell, so it keeps no gutter", () => {
    const frame = frameOf("workspace");
    expect(frame.getAttribute("data-slot")).toBe("page-frame");
    expect(frame.className).not.toContain("nx-page-shell");
    expect(frame.className).not.toContain("nx-page-pad");
  });

  it("says which type it is", () => {
    expect(frameOf("form").getAttribute("data-page-type")).toBe("form");
  });
});

describe("a page header's tabs", () => {
  it("renders the sections as links in a labelled nav, marking the current one", () => {
    render(
      <PageHeader
        title="Contact form"
        tabs={
          <PageTabs label="Form sections">
            <PageTab href="/builder" current>
              Builder
            </PageTab>
            <PageTab href="/settings">Settings</PageTab>
          </PageTabs>
        }
      />
    );
    const nav = screen.getByRole("navigation", { name: "Form sections" });
    const current = screen.getByRole("link", { name: "Builder" });
    const other = screen.getByRole("link", { name: "Settings" });

    expect(nav.contains(current)).toBe(true);
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(other.getAttribute("aria-current")).toBeNull();
    // Links, not an ARIA tablist: each tab changes the address.
    expect(screen.queryByRole("tab")).toBeNull();
    // The tabs follow the title, inside the header.
    const header = screen.getByRole("banner");
    expect(header.contains(nav)).toBe(true);
  });

  it("renders the caller's own link element when asked", () => {
    render(
      <PageTabs label="Sections">
        <PageTab asChild current>
          <a href="/x" data-router-link="">
            Router link
          </a>
        </PageTab>
      </PageTabs>
    );
    const link = screen.getByRole("link", { name: "Router link" });
    expect(link.getAttribute("data-router-link")).toBe("");
    expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the current marker its own, whatever the caller passes", () => {
    // A stray attribute from a caller (here spread from elsewhere) must not
    // replace the marker `current` sets, or a tab drawn as current would not
    // be announced as the current page.
    const stray = { "aria-current": "step" } as const;
    render(
      <PageTabs label="Sections">
        <PageTab href="/builder" current {...stray}>
          Builder
        </PageTab>
      </PageTabs>
    );
    expect(
      screen.getByRole("link", { name: "Builder" }).getAttribute("aria-current")
    ).toBe("page");
  });

  it("keeps the marker its own when the wrapped link carries one", () => {
    // `Slot` lets a child's props win, so a router link's own aria-current
    // would otherwise decide how the tab is announced.
    render(
      <PageTabs label="Sections">
        <PageTab asChild current>
          <a href="/builder" aria-current="step">
            Builder
          </a>
        </PageTab>
        <PageTab asChild>
          <a href="/settings" aria-current="page">
            Settings
          </a>
        </PageTab>
      </PageTabs>
    );
    expect(
      screen.getByRole("link", { name: "Builder" }).getAttribute("aria-current")
    ).toBe("page");
    expect(
      screen
        .getByRole("link", { name: "Settings" })
        .getAttribute("aria-current")
    ).toBeNull();
  });

  it("renders a plain tab as a link with its destination", () => {
    render(
      <PageTabs label="Sections">
        <PageTab href="/settings">Settings</PageTab>
      </PageTabs>
    );
    // An anchor without an href is neither a link nor focusable.
    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href")
    ).toBe("/settings");
  });

  it("draws no tab row when the page has no sections", () => {
    render(<PageHeader title="Users" />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
