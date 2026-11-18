// @vitest-environment jsdom

/**
 * The Page checks list: its groups, each item saying what is wrong, why it
 * matters and what to do, the note that automatic checks don't replace an
 * accessibility review, a press on an item asking for its fix, and the
 * arrow keys between items.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import {
  pageCheckGroups,
  type PageCheck,
  type PageFinding,
} from "./page-checks";
import { PageChecksList } from "./page-checks-list";

afterEach(cleanup);

function finding(
  key: string,
  group: PageFinding["group"] = "accessibility"
): PageFinding {
  return {
    key,
    check: "probe",
    group,
    nodeId: key,
    block: `Block ${key}`,
    what: `Problem ${key}`,
    why: `Why ${key} matters.`,
    todo: `What to do about ${key}.`,
    fix: { tab: "content", id: "alt" },
  };
}

const CORE: Pick<PageCheck, "group">[] = [{ group: "accessibility" }];

function draw(
  findings: readonly PageFinding[],
  {
    checks = CORE,
    notRun = [],
    onFix = vi.fn(),
  }: {
    checks?: Pick<PageCheck, "group">[];
    notRun?: readonly string[];
    onFix?: (finding: PageFinding) => void;
  } = {}
) {
  const groups = pageCheckGroups(findings, checks);
  const view = render(
    <PageChecksList groups={groups} notRun={notRun} onFix={onFix} />
  );
  return { onFix, view };
}

describe("the list", () => {
  it("is called Page checks and says how many items need attention", () => {
    draw([finding("a"), finding("b", "publishing")]);
    expect(
      screen.getByRole("heading", { level: 2, name: "Page checks" })
    ).toBeDefined();
    expect(screen.getByText("2 items need attention")).toBeDefined();
  });

  it("groups its items as Accessibility, Content and data and Publishing", () => {
    draw([finding("a")]);
    expect(
      screen.getAllByRole("heading", { level: 3 }).map(each => each.textContent)
    ).toEqual(["Accessibility1", "Content and data0", "Publishing0"]);
  });

  it("adds Search where a check offers it", () => {
    draw([finding("s", "search")], {
      checks: [...CORE, { group: "search" }],
    });
    const search = screen.getByRole("region", { name: "Search" });
    expect(search.textContent).toContain("Problem s");
  });

  it("says nothing was found in a group with no items", () => {
    draw([finding("a")]);
    expect(
      screen.getByRole("region", { name: "Publishing" }).textContent
    ).toContain("Nothing found.");
  });

  it("shows a group's line under its name, as no item and with its items", () => {
    const groups = pageCheckGroups([finding("c", "content")], CORE, [
      { check: "page-data", group: "content", text: "Page data: 12 of 500" },
    ]);
    render(<PageChecksList groups={groups} notRun={[]} onFix={vi.fn()} />);
    const content = screen.getByRole("region", { name: "Content and data" });
    expect(content.textContent).toContain("Page data: 12 of 500");
    expect(content.textContent).toContain("Problem c");
    // Counted as one item, the line not among them.
    expect(screen.getByText("1 item needs attention")).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Accessibility" }).textContent
    ).not.toContain("Page data");
  });

  it("draws an item whose fix is in another editor as a link there", () => {
    const onFix = vi.fn();
    const linked: PageFinding = {
      ...finding("h", "content"),
      nodeId: undefined,
      block: undefined,
      fix: undefined,
      what: "Over the page data limit in Site header",
      opens: {
        href: "/admin/layouts/main",
        text: "Edit header & footer",
        name: "Edit the Main header & footer, in a new tab",
      },
    };
    draw([linked], { onFix });
    const link = screen.getByRole("link", {
      name: "Over the page data limit in Site header. Edit the Main header & footer, in a new tab",
    });
    expect(link.getAttribute("href")).toBe("/admin/layouts/main");
    expect(link.getAttribute("target")).toBe("_blank");
    fireEvent.click(link);
    expect(onFix).not.toHaveBeenCalled();
  });

  it("says, in each item, what is wrong, on which block, why it matters and what to do", () => {
    draw([finding("a")]);
    const item = screen.getByRole("button", { name: "Problem a: Block a" });
    expect(item.textContent).toContain("Why a matters.");
    expect(item.textContent).toContain("What to do about a.");
  });

  it("says automatic checks don't replace an accessibility review", () => {
    draw([]);
    expect(
      screen.getByText(
        "Automatic checks catch common problems. They don’t replace an accessibility review."
      )
    ).toBeDefined();
    expect(screen.getByText("Nothing needs attention")).toBeDefined();
  });

  it("says when a check couldn't run, so the list may be missing problems", () => {
    draw([], { notRun: ["broken"] });
    expect(
      screen.getByText(
        "1 check couldn’t run, so this list may be missing problems."
      )
    ).toBeDefined();
  });

  it("asks for an item's fix when it is pressed", () => {
    const { onFix } = draw([finding("a"), finding("b")]);
    fireEvent.click(screen.getByRole("button", { name: "Problem b: Block b" }));
    expect(onFix).toHaveBeenCalledWith(expect.objectContaining({ key: "b" }));
  });

  it("moves between items with the arrow keys, Home and End", () => {
    draw([finding("a"), finding("b"), finding("c", "content")]);
    const [a, b, c] = screen
      .getAllByRole("button")
      .filter(each => each.textContent?.startsWith("Problem"));
    a?.focus();
    fireEvent.keyDown(a as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(b);
    // Across groups, as one list.
    fireEvent.keyDown(b as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(c);
    fireEvent.keyDown(c as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(b);
  });

  it("drops an item fixed while it is open, without being opened again", () => {
    const { view } = draw([finding("a"), finding("b")]);
    view.rerender(
      <PageChecksList
        groups={pageCheckGroups([finding("b")], CORE)}
        notRun={[]}
        onFix={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Problem a: Block a" })).toBe(
      null
    );
    expect(screen.getByText("1 item needs attention")).toBeDefined();
  });
});
