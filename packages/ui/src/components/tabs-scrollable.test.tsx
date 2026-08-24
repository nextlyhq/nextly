// @vitest-environment jsdom
/**
 * A tab strip too wide for its container has to scroll sideways, and the list
 * itself must NOT be what scrolls.
 *
 * Two independent reasons, and the second is why the obvious remedy is also
 * wrong:
 *
 *  - Per the CSS overflow rules `visible` computes to `auto` when the other
 *    axis is neither `visible` nor `clip`, so `overflow-x` alone always makes
 *    the element a VERTICAL scroll container too.
 *  - `TabsTrigger` carries `-mb-0.5` so its 2px underline lands ON the list's
 *    rail rather than below it, and `tabs-rail.test.tsx` pins that pair
 *    together. The pull-up puts content past the content-box edge, which the
 *    new scroll container reports as vertical overflow — so adding
 *    `overflow-y-hidden` would clip the 2px the underline is made of, silencing
 *    a scrollbar by deleting the feature that test exists to protect.
 *
 * Moving the scroll container to a WRAPPER keeps the rail intact, and
 * `w-max min-w-full` makes that rail span the full scroll width rather than
 * stopping where the triggers do.
 *
 * jsdom computes no scroll geometry, so these assert the STRUCTURE that
 * produces the behaviour. The geometry itself was measured in a browser.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "./tabs";

function renderList(scrollable: boolean) {
  const { container } = render(
    <Tabs defaultValue="one">
      <TabsList scrollable={scrollable}>
        <TabsTrigger value="one">One</TabsTrigger>
        <TabsTrigger value="two">Two</TabsTrigger>
      </TabsList>
    </Tabs>
  );
  return {
    list: container.querySelector<HTMLElement>("[data-slot='tabs-list']"),
    scroller: container.querySelector<HTMLElement>(
      "[data-slot='tabs-list-scroller']"
    ),
  };
}

describe("scrollable TabsList", () => {
  it("puts the scroll container OUTSIDE the rail", () => {
    const { list, scroller } = renderList(true);

    expect(scroller).not.toBeNull();
    expect(scroller?.className).toContain("overflow-x-auto");
    expect(list?.parentElement).toBe(scroller);
  });

  it("leaves the list itself with no overflow of its own", () => {
    const { list } = renderList(true);

    // The list carrying `overflow-x` is the defect: it becomes a scroll
    // container on BOTH axes, and the trigger's pull-up is then reported as
    // vertical overflow.
    expect(list?.className).not.toContain("overflow-x");
    expect(list?.className).not.toContain("overflow-y");
  });

  it("never clips the axis the trigger's pull-up lives on", () => {
    const { list, scroller } = renderList(true);

    // `overflow-y-hidden` is the tempting fix and it removes the underline.
    expect(list?.className).not.toContain("overflow-y-hidden");
    expect(scroller?.className).not.toContain("overflow-y-hidden");
  });

  it("makes the rail span the full scroll width", () => {
    const { list } = renderList(true);

    // Without `min-w-full` the rail stops where the triggers do, leaving the
    // underline short of the content beside it; without `w-max` it cannot grow
    // past the container and there is nothing to scroll.
    expect(list?.className).toContain("w-max");
    expect(list?.className).toContain("min-w-full");
  });

  it("keeps the rail and the pull-up that tabs-rail.test.tsx pairs", () => {
    const { list } = renderList(true);

    // The scrollable variant must not cost the strip its rail. Asserted here as
    // well as in that file because this is the variant most likely to drop it.
    expect(list?.className).toContain("border-b");
  });

  it("adds no wrapper when not scrollable, so the default DOM is unchanged", () => {
    const { list, scroller } = renderList(false);

    expect(scroller).toBeNull();
    expect(list?.className).not.toContain("w-max");
    expect(list?.className).not.toContain("min-w-full");
  });

  it("defaults to not scrollable", () => {
    const { container } = render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
        </TabsList>
      </Tabs>
    );

    expect(
      container.querySelector("[data-slot='tabs-list-scroller']")
    ).toBeNull();
  });
});
