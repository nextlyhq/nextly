// @vitest-environment jsdom
/**
 * The checkbox's pointer target: the box is drawn at 16px, and a 24px layer
 * centred on it (`before:`) takes the pointer, the minimum WCAG 2.5.8 asks of
 * a target, without drawing the box any larger.
 *
 * jsdom lays nothing out, so this reads the classes the box carries; the
 * layer's size and position are those classes' whole effect.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "../checkbox";

afterEach(cleanup);

describe("checkbox hit area", () => {
  it("takes the pointer over 24px while the box stays 16px", () => {
    render(<Checkbox aria-label="Select row" />);
    const tokens = [
      ...screen.getByRole("checkbox", { name: "Select row" }).classList,
    ];

    // POSITIVE CONTROL: the drawn box is the 16px one.
    expect(tokens).toEqual(expect.arrayContaining(["h-4", "w-4", "relative"]));
    // The layer: 24px, drawn, and centred on the box.
    expect(tokens).toEqual(
      expect.arrayContaining([
        "before:absolute",
        "before:h-6",
        "before:w-6",
        "before:content-['']",
        "before:left-1/2",
        "before:top-1/2",
        "before:-translate-x-1/2",
        "before:-translate-y-1/2",
      ])
    );
  });
});
