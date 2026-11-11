/**
 * While a drawer is open, the toaster's bottom offset clears the drawer's footer; closed, the
 * offset is taken away and toasts go back to their corner.
 */

import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

import { useToastAboveFooter } from "./use-toast-above-footer";

/** A drawer's footer, `height` px tall, lifting toasts while `open`. */
function Drawer({ open, height }: { open: boolean; height: number }) {
  const footer = useRef<HTMLDivElement>(null);
  useToastAboveFooter(footer, open);
  return (
    <div
      ref={element => {
        footer.current = element;
        // jsdom lays nothing out; the footer's height is given here.
        if (element !== null)
          Object.defineProperty(element, "offsetHeight", {
            configurable: true,
            value: height,
          });
      }}
    />
  );
}

const offset = () =>
  document.documentElement.style.getPropertyValue(TOAST_OFFSET_BOTTOM_PROPERTY);

afterEach(() => {
  document.documentElement.style.removeProperty(TOAST_OFFSET_BOTTOM_PROPERTY);
});

describe("useToastAboveFooter", () => {
  it("sets the toaster's offset to the footer's height and a gap while open, and clears it on close", () => {
    const { rerender, unmount } = render(<Drawer open={false} height={57} />);
    expect(offset()).toBe("");

    rerender(<Drawer open height={57} />);
    expect(offset()).toBe("69px");

    rerender(<Drawer open={false} height={57} />);
    expect(offset()).toBe("");

    rerender(<Drawer open height={57} />);
    unmount();
    expect(offset()).toBe("");
  });
});
