/**
 * While a drawer's footer is drawn, the toaster's bottom offset clears it; once it is gone, the
 * offset is taken away and toasts go back to their corner. The footer here mounts after the
 * render that opens its drawer, as a drawer's content does.
 */

import { act, render } from "@testing-library/react";
import { useCallback, useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

import { useToastAboveFooter } from "../useToastAboveFooter";

/** A drawer whose footer, `height` px tall, is drawn a commit after `open` turns on. */
function Drawer({ open, height }: { open: boolean; height: number }) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(open), [open]);
  useToastAboveFooter(footer);
  const footerRef = useCallback(
    (element: HTMLDivElement | null) => {
      // jsdom lays nothing out; the footer's height is given here.
      if (element !== null)
        Object.defineProperty(element, "offsetHeight", {
          configurable: true,
          value: height,
        });
      setFooter(element);
    },
    [height]
  );
  if (!mounted) return null;
  return <div ref={footerRef} />;
}

const offset = () =>
  document.documentElement.style.getPropertyValue(TOAST_OFFSET_BOTTOM_PROPERTY);

afterEach(() => {
  document.documentElement.style.removeProperty(TOAST_OFFSET_BOTTOM_PROPERTY);
});

describe("useToastAboveFooter", () => {
  it("sets the toaster's offset to the footer's height and a gap while it is drawn, and clears it once it is gone", () => {
    const { rerender, unmount } = render(<Drawer open={false} height={57} />);
    expect(offset()).toBe("");

    act(() => rerender(<Drawer open height={57} />));
    expect(offset()).toBe("69px");

    act(() => rerender(<Drawer open={false} height={57} />));
    expect(offset()).toBe("");

    act(() => rerender(<Drawer open height={57} />));
    unmount();
    expect(offset()).toBe("");
  });
});
