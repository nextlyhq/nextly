// @vitest-environment jsdom
/**
 * The shared Button's keyboard focus ring: a 2px outline of the ring token,
 * offset 2px from the button, on every variant; and inside a parent that
 * clips, an outline drawn within the button's edge with an inset stripe of the
 * page's background, so the clip can't cut it away.
 *
 * Flush (no offset), a 1px ring of the ring token vanished on the variant
 * whose fill IS the ring token: the black primary in light mode, the white
 * one in dark. Offset, the ring is judged against the surface around the
 * button, where the token pairing "focus ring on page" holds (see
 * `styles/contrast/pairings.ts`). The offset is an outline's real gap, so it
 * shows the card or page under it rather than painting a colour of its own.
 *
 * jsdom draws nothing, so these read the classes the Button carries; whether
 * the ring is seen is judged on screen, focused by keyboard, in every
 * variant and in a segmented control.
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
    "is a 2px outline of the ring token, offset 2px, on %s",
    variant => {
      const classes = classesOf(variant);
      expect(classes).toEqual(
        expect.arrayContaining([
          "focus-visible:outline-2",
          "focus-visible:outline-offset-2",
          "focus-visible:outline-ring",
        ])
      );
      // The flush 1px ring it replaces, which a black primary swallowed,
      // and no painted gap, which would show the wrong surface on a card.
      expect(classes).not.toContain("focus-visible:ring-1");
      expect(classes).not.toContain("focus-visible:ring-offset-0");
      expect(classes.some(each => each.includes("ring-offset-"))).toBe(false);
      expect(classes).not.toContain("focus-visible:outline-none");
    }
  );

  it("draws within the button's edge where its parent clips", () => {
    // A segmented control's row clips its options: an outline outside the
    // button would be cut away there. Inside it, the outline moves in, with
    // a stripe of the page's background within it for a fill that matches
    // the ring.
    render(
      <div className="flex overflow-hidden">
        <Button variant="default">On</Button>
        <Button variant="ghost">Off</Button>
      </div>
    );
    for (const name of ["On", "Off"]) {
      const classes = screen
        .getByRole("button", { name })
        .className.split(/\s+/);
      expect(classes).toEqual(
        expect.arrayContaining([
          "[.overflow-hidden>&]:focus-visible:outline-offset-[-2px]",
          "[.overflow-hidden>&]:focus-visible:shadow-[inset_0_0_0_4px_var(--color-background)]",
        ])
      );
    }
  });
});
