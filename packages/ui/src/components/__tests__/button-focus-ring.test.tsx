// @vitest-environment jsdom
/**
 * The shared Button's keyboard focus ring: 2px of the ring token, offset 2px
 * across a gap of the page's background, on every variant.
 *
 * Flush (no offset), a 1px ring of the ring token vanished on the variant
 * whose fill IS the ring token: the black primary in light mode, the white
 * one in dark. With the gap, the ring is judged against the page, where the
 * token pairing "focus ring on page" holds its contrast (see
 * `styles/contrast/pairings.ts`), whatever the fill.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button, BUTTON_VARIANT_MAP } from "../button";

afterEach(cleanup);

const VARIANTS = Object.keys(
  BUTTON_VARIANT_MAP.variant
) as (keyof typeof BUTTON_VARIANT_MAP.variant)[];

function classesOf(variant: (typeof VARIANTS)[number]): string[] {
  render(<Button variant={variant}>Save</Button>);
  return screen.getByRole("button", { name: "Save" }).className.split(/\s+/);
}

describe("the shared Button's focus ring", () => {
  it.each(VARIANTS)(
    "is 2px, offset 2px over the page's background, on %s",
    variant => {
      const classes = classesOf(variant);
      expect(classes).toEqual(
        expect.arrayContaining([
          "focus-visible:ring-2",
          "focus-visible:ring-ring",
          "focus-visible:ring-offset-2",
          "focus-visible:ring-offset-background",
        ])
      );
      // The flush 1px ring it replaces, which a black primary swallowed.
      expect(classes).not.toContain("focus-visible:ring-1");
      expect(classes).not.toContain("focus-visible:ring-offset-0");
    }
  );

  it("separates the ring with the page's background, not the white offset token", () => {
    // `--nx-focus-ring-offset` is white in both modes: in dark mode the gap
    // would be white beside a white ring, and the ring would read as a blob.
    const classes = classesOf("primary");
    expect(classes.some(each => each.includes("focus-ring-offset"))).toBe(
      false
    );
  });
});
