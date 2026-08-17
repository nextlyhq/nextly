// @vitest-environment jsdom
/**
 * The trigger's pull-up and the list's rail are ONE decision, and this pins
 * them together.
 *
 * `TabsTrigger` draws a 2px bottom border and carries `-mb-0.5`, which exists so
 * that border lands on the rail rather than below it. The rail was absent from
 * `TabsList` while the pull-up stayed, so the border landed on whatever followed
 * the strip in the document — and above a rounded panel that is the corner
 * curve, a straight bar crossing an arc.
 *
 * Neither half is safe to remove alone: a rail with no pull-up leaves a 2px gap
 * under the active tab, and a pull-up with no rail is the defect above. So the
 * assertion is the PAIR, not either class on its own.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

function tokensOf(el: Element | null): string[] {
  return [...(el?.classList ?? [])];
}

function renderTabs() {
  const { container } = render(
    <Tabs defaultValue="one">
      <TabsList>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  return {
    list: container.querySelector("[data-slot='tabs-list']"),
    trigger: container.querySelector("[role='tab']"),
  };
}

describe("tabs rail", () => {
  it("draws a rail under the strip for the indicator to sit on", () => {
    const { list } = renderTabs();
    expect(list).not.toBeNull();
    expect(tokensOf(list)).toContain("border-b");
  });

  /**
   * The rail's colour comes from a token, so a retheme moves it. A literal here
   * would make the one line under every tab strip unthemeable.
   */
  it("takes the rail's colour from a token", () => {
    const { list } = renderTabs();
    expect(tokensOf(list)).toContain("border-border");
  });

  /**
   * The pull-up is only correct while a rail exists to pull onto. If someone
   * removes the rail, this fails and names the reason rather than leaving the
   * trigger silently overlapping the next element.
   */
  it("keeps the trigger's pull-up paired with the rail", () => {
    const { list, trigger } = renderTabs();
    const triggerTokens = tokensOf(trigger);

    expect(triggerTokens).toContain("border-b-2");

    if (triggerTokens.includes("-mb-0.5")) {
      expect(
        tokensOf(list),
        "TabsTrigger pulls itself up by -mb-0.5 to land its 2px border on the " +
          "list's rail. TabsList is not drawing one, so that border lands on " +
          "whatever follows the strip instead."
      ).toContain("border-b");
    }
  });

  it("keeps the strip square, so the rail stays flush with the tab edges", () => {
    const { list } = renderTabs();
    expect(tokensOf(list)).toContain("rounded-none");
  });
});
