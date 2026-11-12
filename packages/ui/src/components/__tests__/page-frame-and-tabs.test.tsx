// @vitest-environment jsdom
/**
 * A page says what it is and the frame decides its width. A list runs full
 * width, a form is a 56rem column under the page's left edge, an editor runs
 * full width, and a workspace takes no gutter at all. A page with sections
 * shows them as link tabs under its header, each with its own address.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageFrame, PageFrameListener } from "../page-frame";
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

  it("draws an editor edge to edge, with no gutter: its panel meets the window's edge", () => {
    const frame = frameOf("editor");
    expect(frame.getAttribute("data-slot")).toBe("page-frame");
    expect(frame.className).not.toContain("nx-page-pad");
    expect(frame.className).not.toContain("nx-page-shell");
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

describe("a page frame listener", () => {
  it("hears the type of a frame drawn inside it, and that it is gone", () => {
    const onFrame = vi.fn();
    const { rerender } = render(
      <PageFrameListener onFrame={onFrame}>
        <div>
          <PageFrame type="form">
            <p>Body</p>
          </PageFrame>
        </div>
      </PageFrameListener>
    );
    expect(onFrame).toHaveBeenLastCalledWith("form");

    rerender(
      <PageFrameListener onFrame={onFrame}>
        <div>
          <p>Body</p>
        </div>
      </PageFrameListener>
    );
    expect(onFrame).toHaveBeenLastCalledWith(null);
  });

  it("hears only the outermost frame, which is the page's own", () => {
    const onFrame = vi.fn();
    render(
      <PageFrameListener onFrame={onFrame}>
        <PageFrame type="workspace">
          <PageFrame type="list">
            <p>Body</p>
          </PageFrame>
        </PageFrame>
      </PageFrameListener>
    );
    // The inner frame mounts first; were it heard, "list" would be among the
    // calls.
    expect(onFrame.mock.calls).toEqual([["workspace"]]);
  });

  it("hears nothing from content that draws no frame", () => {
    const onFrame = vi.fn();
    render(
      <PageFrameListener onFrame={onFrame}>
        <p>Body</p>
      </PageFrameListener>
    );
    expect(onFrame).not.toHaveBeenCalled();
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("is not heard by a frame outside it", () => {
    // A host draws its own frame around the listener, and that frame must not
    // count as the content's.
    const onFrame = vi.fn();
    render(
      <PageFrame type="workspace">
        <PageFrameListener onFrame={onFrame}>
          <p>Body</p>
        </PageFrameListener>
      </PageFrame>
    );
    expect(onFrame).not.toHaveBeenCalled();
  });
});
