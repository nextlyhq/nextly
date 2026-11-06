/**
 * The admin's toaster takes its bottom offset from a shared custom property,
 * with Sonner's own distances as the fallback, so whatever owns the corner
 * (the media library's upload tray) can lift toasts above itself and the
 * toasts return to their corner when it lets go.
 *
 * Read from the toaster's own element, where Sonner writes the offsets it is
 * given: what the page renders, rather than the props the wrapper passes.
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TOAST_OFFSET_BOTTOM_PROPERTY } from "@admin/constants/ui";

import { Toaster, toast } from "../toaster";

afterEach(() => {
  act(() => {
    toast.dismiss();
  });
});

describe("the admin toaster", () => {
  it("places its bottom edge by the shared property, falling back to Sonner's distances", async () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast("Saved");
    });

    const toaster = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        "[data-sonner-toaster]"
      );
      expect(element).not.toBeNull();
      return element!;
    });
    expect(toaster.style.getPropertyValue("--offset-bottom")).toBe(
      `var(${TOAST_OFFSET_BOTTOM_PROPERTY}, 24px)`
    );
    expect(toaster.style.getPropertyValue("--mobile-offset-bottom")).toBe(
      `var(${TOAST_OFFSET_BOTTOM_PROPERTY}, 16px)`
    );
    // POSITIVE CONTROL: the other sides keep Sonner's default, so the reading
    // above is of the offset this wrapper sets, not of one Sonner always writes.
    expect(toaster.style.getPropertyValue("--offset-right")).toBe("24px");
  });
});
