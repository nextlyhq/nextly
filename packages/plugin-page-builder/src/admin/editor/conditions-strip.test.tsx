// @vitest-environment jsdom

/**
 * Previewing as a visitor: the strip above the canvas while the author's
 * visitor view is on, what it says the conditions did, and why the view
 * can't be turned on where it can't.
 *
 * @module admin/editor/conditions-strip.test
 */
import type { AppliedConditions } from "@nextlyhq/builder/shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  conditionsCountWords,
  VisitorStrip,
  visitorStripWords,
  visitorUnavailable,
} from "./conditions-strip";

afterEach(cleanup);

/** What applying the conditions did: these blocks hidden, by name. */
function appliedHiding(...names: string[]): AppliedConditions {
  return {
    document: { formatVersion: 1, kind: "template", nodes: [] },
    unjudged: false,
    byEntry: false,
    shown: new Set(),
    hidden: names.map(name => ({
      id: name,
      name,
      reason: "hidden for this post: Category is not Guides",
      unchecked: false,
    })),
  };
}

describe("what the conditions did, in words", () => {
  it("counts the hidden blocks for the entry, and says when every one shows", () => {
    expect(conditionsCountWords(appliedHiding("a"), "post")).toBe(
      "1 block hidden for this post"
    );
    expect(conditionsCountWords(appliedHiding("a", "b"), "post")).toBe(
      "2 blocks hidden for this post"
    );
    expect(conditionsCountWords(appliedHiding(), "post")).toBe(
      "Every conditioned block shows for this post"
    );
    // Nothing applied, nothing said.
    expect(conditionsCountWords(undefined, "post")).toBe("");
  });

  it("says only the blocks checked show while a list's blocks go unchecked", () => {
    expect(
      conditionsCountWords({ ...appliedHiding(), unjudged: true }, "post")
    ).toBe("Every block checked shows for this post");
  });

  it("says a list's blocks are checked for each entry, claiming nothing of them", () => {
    // Only blocks inside a list's entries: each is checked, and marked, where
    // its entry is drawn.
    expect(
      conditionsCountWords({ ...appliedHiding(), byEntry: true }, "page")
    ).toBe("Conditions checked for each entry in the list");
    // Beside the page's own blocks, all shown: said of those, on the page.
    expect(
      conditionsCountWords(
        { ...appliedHiding(), byEntry: true, shown: new Set(["intro"]) },
        "page"
      )
    ).toBe("Every conditioned block shows on this page");
    expect(
      conditionsCountWords({ ...appliedHiding("a"), byEntry: true }, "page")
    ).toBe("1 block hidden for this page");
    // A placed component's block left unchecked beside them: the list's
    // checks claimed nothing of, the unchecked blocks said.
    expect(
      conditionsCountWords(
        {
          ...appliedHiding(),
          byEntry: true,
          unjudged: true,
          shown: new Set(["intro"]),
        },
        "page"
      )
    ).toBe(
      "Conditions checked for each entry in the list; some blocks aren’t checked"
    );
    // Only list blocks checked, and a placed component's left unchecked:
    // never "every block shows", which an entry's marker would contradict.
    expect(
      conditionsCountWords(
        { ...appliedHiding(), byEntry: true, unjudged: true },
        "page"
      )
    ).toBe(
      "Conditions checked for each entry in the list; some blocks aren’t checked"
    );
  });
});

describe("what the visitor strip says", () => {
  it("says what was hidden, that it is still checking, or that it couldn't check", () => {
    expect(
      visitorStripWords({ applied: appliedHiding("a"), noun: "post" })
    ).toBe("1 block hidden for this post");
    // Before the entry is read as a visitor reads it.
    expect(visitorStripWords({ applied: undefined, noun: "page" })).toBe(
      "Checking…"
    );
    expect(
      visitorStripWords({ applied: undefined, noun: "page", failed: true })
    ).toBe("Couldn’t check this page. Stop, then try again.");
  });
});

describe("the strip while previewing as a visitor", () => {
  it("says it, says what was hidden in a live region, and stops", () => {
    const onStop = vi.fn();
    render(
      <VisitorStrip said="1 block hidden for this page" onStop={onStop} />
    );
    expect(screen.getByText("Previewing as a visitor")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      "1 block hidden for this page"
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    // Nothing of the switch it replaces.
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Apply conditions")).toBeNull();
  });
});

describe("why Preview as visitor can't be turned on", () => {
  it("is available on a page or template with a conditioned block and an entry to check", () => {
    expect(visitorUnavailable("page", true, true)).toBeUndefined();
    // On a collection template, checked against the entry being previewed.
    expect(visitorUnavailable("template", true, true)).toBeUndefined();
  });

  it("says no block has conditions where none has", () => {
    expect(visitorUnavailable("page", false, true)).toBe(
      "No block on this page has conditions"
    );
    expect(visitorUnavailable("template", false, true)).toBe(
      "No block on this page has conditions"
    );
  });

  it("gives a component or a Layout's part the reason it has no entry to check", () => {
    // A Layout's header and footer are components too.
    const placed =
      "No entry to check here. The published page checks them where it’s placed.";
    expect(visitorUnavailable("component", true, false)).toBe(placed);
    expect(visitorUnavailable("component", false, false)).toBe(placed);
  });

  it("says it needs an entry where there is none to check against", () => {
    // A Single, or a template with no entry previewed yet.
    expect(visitorUnavailable("page", true, false)).toBe(
      "Needs an entry to check its conditions against."
    );
    expect(visitorUnavailable("template", true, false)).toBe(
      "Needs an entry to check its conditions against."
    );
  });
});
