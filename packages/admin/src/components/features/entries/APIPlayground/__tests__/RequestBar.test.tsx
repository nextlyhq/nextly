/**
 * `theme.css` states that hardcoding a corner opts an element out of the
 * `--radius` knob, and that square needs a stated reason. The request bar is a
 * grouping container and had neither, which is why its rounded Send button read
 * as a mistake rather than as a choice.
 *
 * The assertions name the tier rather than a pixel value, because the tier is
 * what the contract is written in -- a test pinning `8px` would pass while the
 * element was detached from the knob it is supposed to follow.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { METHOD_SEMANTICS, RequestBar } from "../RequestBar";

const props = {
  method: "GET" as const,
  url: "http://localhost/admin/api/collections/posts/entries",
  action: <div data-testid="action" />,
  isLoading: false,
  copied: false,
  onSend: vi.fn(),
  onCancel: vi.fn(),
  onCopy: vi.fn(),
  onOpen: vi.fn(),
};

describe("RequestBar", () => {
  it("rounds its container to the container tier", () => {
    const { container } = render(<RequestBar {...props} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("rounded-lg");
  });

  it("clips its children to that curve", () => {
    // theme.css: a rounded box whose child paints a background to its edge must
    // clip it, or the child's fill paints square across the curve.
    const { container } = render(<RequestBar {...props} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain("overflow-hidden");
  });

  it("shows the whole URL as selectable text", () => {
    render(<RequestBar {...props} />);
    expect(screen.getByText(props.url)).toBeInTheDocument();
  });

  it("gives every method a pill and a tone", () => {
    // A verb missing from the map renders unstyled rather than throwing, so the
    // gap would show up as one method looking wrong and no test failing.
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      expect(METHOD_SEMANTICS[method].pill).toBeTruthy();
      expect(METHOD_SEMANTICS[method].pill).toMatch(/bg-/);
      expect(METHOD_SEMANTICS[method].pill).toMatch(/text-/);
      expect(METHOD_SEMANTICS[method].tone).toMatch(/text-/);
    }
  });

  it("dresses both views of a verb in the same role", () => {
    // The two views are one entry now, so they cannot be edited apart -- but
    // they can still be edited WRONG, and half an entry is exactly the state
    // the merge into one record exists to make visible. A verb that destroys a
    // row must not read as destructive in the menu and as a warning on the bar.
    const ROLE: Record<string, string | null> = {
      GET: null, // a read is not an event, so it takes no role colour
      POST: "success",
      PATCH: "warning",
      DELETE: "destructive",
    };

    for (const [method, role] of Object.entries(ROLE)) {
      const { tone, pill } =
        METHOD_SEMANTICS[method as keyof typeof METHOD_SEMANTICS];
      if (role === null) {
        expect(`${tone} ${pill}`).not.toMatch(/success|warning|destructive/);
        continue;
      }
      expect(tone).toContain(role);
      expect(pill).toContain(role);
    }
  });

  it("names a colour only through a token", () => {
    // The tones must survive a retheme; a literal here would not.
    const literal = Object.values(METHOD_SEMANTICS)
      .flatMap(({ tone, pill }) => [tone, pill])
      .filter(cls => /#[0-9a-f]{3,8}|rgb\(|oklch\(/i.test(cls));
    expect(literal).toEqual([]);
  });
});
