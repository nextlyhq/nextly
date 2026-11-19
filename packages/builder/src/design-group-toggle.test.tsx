// @vitest-environment jsdom

/**
 * A Design group's fold button, as it is heard and as it is drawn.
 *
 * @module design-group-toggle.test
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GroupToggle } from "./design-group-toggle";
import { labelNotInName } from "./label-in-name.fixture";

afterEach(cleanup);

describe("a group's fold button", () => {
  it("is named by its heading and count, the words it draws in order", () => {
    render(<GroupToggle heading="Brand" count={1} open onToggle={() => {}} />);
    const toggle = screen.getByRole("button", { name: "Brand, 1" });
    // Drawn apart, so a speech-input user saying "Brand 1" reaches it; drawn
    // flush, the two read as the one word "Brand1", which its name lacks.
    expect(labelNotInName(toggle)).toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
