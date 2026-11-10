// @vitest-environment jsdom
/**
 * What `core/icon` says to assistive technology, in each of the three ways it
 * is used, and what it draws for an icon the host cannot.
 *
 * The three are told apart by the markup a screen reader reads: a decorative
 * icon hidden, a labelled one an image with that name, a linked one a link
 * with a name. A render that drew the right picture with the wrong roles
 * would pass a visual check and fail an author's visitors.
 *
 * @module icon.test
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createStandaloneContext, type PageContext } from "../context";
import { resolveLucideIcon } from "../icons/lucide";

import { iconSpokenName, renderIcon, type IconProps } from "./icon";

async function draw(
  props: IconProps,
  // `null` for a host with no icon resolver at all.
  resolveIcon: PageContext["resolveIcon"] | null = resolveLucideIcon
) {
  const ctx = createStandaloneContext(
    resolveIcon === null ? {} : { resolveIcon }
  );
  const { container } = render(
    await renderIcon({
      props,
      className: "nx-pb-node1",
      ctx,
      partClass: () => "",
    } as never)
  );
  return container;
}

describe("core/icon", () => {
  it("hides a decorative icon, the one with no label", async () => {
    const svg = (await draw({ icon: "lucide:star", label: "" })).querySelector(
      "svg"
    );
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.hasAttribute("role")).toBe(false);
    expect(svg?.getAttribute("focusable")).toBe("false");
    // The block's class is on the element it draws.
    expect(svg?.getAttribute("class")).toBe("nx-pb-node1");
    // The set's own drawing, sized by the text and drawn in its colour.
    expect(svg?.innerHTML).toContain("<path");
    expect(svg?.getAttribute("width")).toBe("1em");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
  });

  it("names a labelled icon as an image", async () => {
    const svg = (
      await draw({ icon: "lucide:truck", label: "Free delivery" })
    ).querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Free delivery");
    expect(svg?.hasAttribute("aria-hidden")).toBe(false);
  });

  it("names a linked icon's link, by its label or else by the icon's name", async () => {
    const labelled = (
      await draw({ icon: "lucide:truck", label: "Delivery", href: "/delivery" })
    ).querySelector("a");
    expect(labelled?.getAttribute("href")).toBe("/delivery");
    expect(labelled?.getAttribute("aria-label")).toBe("Delivery");
    expect(labelled?.className).toBe("nx-pb-node1");
    // The icon inside a named link is not read a second time.
    expect(labelled?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true"
    );

    const unlabelled = (
      await draw({ icon: "lucide:circle-arrow-up", href: "/top" })
    ).querySelector("a");
    expect(unlabelled?.getAttribute("aria-label")).toBe("Circle arrow up");
  });

  it("draws nothing, still as one element, for an icon the host does not draw", async () => {
    for (const container of [
      await draw({ icon: "lucide:not-an-icon" }),
      // A host with no icon resolver at all.
      await draw({ icon: "lucide:star" }, null),
      // A resolver that fails: the page draws without the icon rather than failing.
      await draw({ icon: "lucide:star" }, () =>
        Promise.reject(new Error("the set did not load"))
      ),
    ]) {
      expect(container.querySelector("svg")).toBeNull();
      const placeholder = container.firstElementChild;
      expect(placeholder?.tagName).toBe("SPAN");
      expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
      expect(placeholder?.className).toBe("nx-pb-node1");
    }
  });

  it("reads no entry's address for an icon it cannot draw", async () => {
    // A linked entry's address is a read from the page's budget; an icon that
    // draws nothing has no use for it.
    const resolveEntryPath = vi.fn(async () => "/about");
    const ctx = createStandaloneContext({
      resolveIcon: resolveLucideIcon,
      resolveEntryPath,
    });
    const { container } = render(
      await renderIcon({
        props: {
          icon: "lucide:not-an-icon",
          entryCollection: "pages",
          entryId: "p1",
        },
        className: "nx-pb-node1",
        ctx,
        partClass: () => "",
      } as never)
    );
    expect(container.querySelector("svg, a")).toBeNull();
    expect(resolveEntryPath).not.toHaveBeenCalled();
    // The control: a drawn icon linked the same way does read it.
    render(
      await renderIcon({
        props: { icon: "lucide:star", entryCollection: "pages", entryId: "p1" },
        className: "nx-pb-node1",
        ctx,
        partClass: () => "",
      } as never)
    );
    // Drawn outside a page, so its read is claimed unnamed.
    expect(resolveEntryPath).toHaveBeenCalledWith("pages", "p1", undefined);
  });

  it("draws a filled icon with no stroke, so a page's stroke cannot outline it", async () => {
    const filled = {
      id: "acme:dot",
      name: "dot",
      body: '<circle cx="12" cy="12" r="6"/>',
      viewBox: "0 0 24 24",
      stroked: false,
    };
    const svg = (
      await draw({ icon: "acme:dot" }, async () => filled)
    ).querySelector("svg");
    expect(svg?.getAttribute("fill")).toBe("currentColor");
    expect(svg?.getAttribute("stroke")).toBe("none");
  });

  it("says an icon's name as words", () => {
    expect(iconSpokenName("circle-arrow-out-up-right")).toBe(
      "Circle arrow out up right"
    );
  });
});
