// @vitest-environment jsdom

/**
 * The switch that applies visibility conditions on the canvas: in a
 * template's Previewing strip, and in the strip a component or a Layout gets,
 * where there is no entry to check against.
 *
 * @module admin/editor/conditions-strip.test
 */
import type { AppliedConditions } from "@nextlyhq/builder/shell";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  conditionsCountWords,
  PageConditionsStrip,
  PlacedConditionsStrip,
  TemplateConditionsPart,
  type TemplateConditions,
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

function conditions(
  extra: Partial<TemplateConditions> = {}
): TemplateConditions {
  return {
    on: false,
    toggle: () => undefined,
    available: true,
    applied: undefined,
    noun: "post",
    ...extra,
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
    ).toBe("Checked for each entry its list shows");
    // Beside the page's own blocks, all shown: said only of those checked.
    expect(
      conditionsCountWords(
        { ...appliedHiding(), byEntry: true, shown: new Set(["intro"]) },
        "page"
      )
    ).toBe("Every block checked shows for this page");
    expect(
      conditionsCountWords({ ...appliedHiding("a"), byEntry: true }, "page")
    ).toBe("1 block hidden for this page");
  });
});

describe("the switch in a template's Previewing strip", () => {
  it("is a switch that toggles, with its count in a live region", () => {
    const toggle = vi.fn();
    const { rerender } = render(
      <TemplateConditionsPart conditions={conditions({ toggle })} />
    );
    const button = screen.getByRole("switch", { name: "Apply conditions" });
    expect(button.getAttribute("aria-checked")).toBe("false");
    // Present and empty while off, so the first change is announced.
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);

    rerender(
      <TemplateConditionsPart
        conditions={conditions({ on: true, applied: appliedHiding("a") })}
      />
    );
    expect(
      screen
        .getByRole("switch", { name: "Apply conditions" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      "1 block hidden for this post"
    );
  });

  it("is disabled and off while no entry is previewed", () => {
    render(
      <TemplateConditionsPart
        conditions={conditions({ on: true, available: false })}
      />
    );
    const button = screen.getByRole("switch", { name: "Apply conditions" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-checked")).toBe("false");
  });
});

describe("the strip a component or a Layout gets", () => {
  it("names what is edited and holds the switch disabled, described by why", () => {
    render(
      <PlacedConditionsStrip kind="Component" name="Members’ worksheet" />
    );
    expect(screen.getByText("Component")).toBeTruthy();
    expect(screen.getByText("Members’ worksheet")).toBeTruthy();
    const button = screen.getByRole("switch", { name: "Apply conditions" });
    expect(button.hasAttribute("disabled")).toBe(true);
    const why = document.getElementById(
      button.getAttribute("aria-describedby") ?? ""
    );
    expect(why?.textContent).toBe(
      "No entry to check here. The published page checks them where it’s placed."
    );
  });
});

describe("the strip a page gets", () => {
  it("says when the page couldn't be read, and how to try again", () => {
    render(
      <PageConditionsStrip
        conditions={conditions({ on: true, failed: true, noun: "page" })}
      />
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Couldn’t check this page. Turn the switch off and on to try again."
    );
  });

  it("holds the switch and its count, and no entry to name", () => {
    render(
      <PageConditionsStrip
        conditions={conditions({
          on: true,
          applied: appliedHiding("a"),
          noun: "page",
        })}
      />
    );
    const button = screen.getByRole("switch", { name: "Apply conditions" });
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe(
      "1 block hidden for this page"
    );
    // The page is its own: no chip naming an entry, nothing to choose.
    expect(screen.queryByText("Previewing")).toBeNull();
    expect(screen.queryByRole("button", { name: /Previewing/ })).toBeNull();
  });
});
