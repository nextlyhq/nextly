/**
 * The focus point is one dot on the whole image.
 *
 * A person picks "Set focus point", then clicks, drags or uses the arrow keys,
 * and Done saves the point as whole percentages of the image. The point is
 * measured against the IMAGE, not the frame around it: an image narrower or
 * shorter than its frame sits inside bands of backdrop, and measuring against
 * the frame put the dot somewhere other than where the person clicked. Every
 * test here lays the image out inside a larger frame, so a measurement taken
 * from the frame gives a different number from the one asserted.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { MediaFocalPoint } from "../MediaFocalPoint";

function box(left: number, top: number, width: number, height: number) {
  return () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Renders the control and lays it out: a 400 by 400 frame, with the image's
 * own box inside it wherever the case puts it.
 */
function renderLaidOut(
  imageBox: () => DOMRect,
  props: Partial<ComponentProps<typeof MediaFocalPoint>> = {}
) {
  const onSave = vi.fn(() => Promise.resolve());
  render(
    <MediaFocalPoint
      src="/uploads/photo.jpg"
      alt="A photo"
      focalX={50}
      focalY={50}
      onSave={onSave}
      {...props}
    />
  );
  const image = screen.getByRole("img", { name: "A photo" });
  image.getBoundingClientRect = imageBox;
  const frame = image.closest("[data-focal-frame]");
  if (!(frame instanceof HTMLElement)) throw new Error("no focal frame");
  frame.getBoundingClientRect = box(0, 0, 400, 400);
  return { onSave, image, frame };
}

describe("setting the focus point", () => {
  it("saves where a tall image was clicked, measured on the image inside its frame", async () => {
    // A tall image centred in a square frame: bands of backdrop left and right.
    const { onSave, frame } = renderLaidOut(box(100, 0, 200, 400));
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    fireEvent.pointerDown(frame, { clientX: 150, clientY: 100, button: 0 });
    fireEvent.pointerUp(frame, { clientX: 150, clientY: 100, button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // On the image: 50 of its 200px across, 100 of its 400px down. Measured on
    // the frame it would have been 37.5% across.
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 25, focalY: 25 })
    );
  });

  it("saves where a wide image was dragged to, measured on the image inside its frame", async () => {
    // A wide image centred in a square frame: bands above and below.
    const { onSave, frame } = renderLaidOut(box(0, 100, 400, 200));
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    fireEvent.pointerDown(frame, { clientX: 40, clientY: 120, button: 0 });
    fireEvent.pointerMove(frame, { clientX: 300, clientY: 150, buttons: 1 });
    fireEvent.pointerUp(frame, { clientX: 300, clientY: 150, button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 75, focalY: 25 })
    );
  });

  it("keeps a click on the backdrop beside the image at the image's edge", async () => {
    const { onSave, frame } = renderLaidOut(box(100, 0, 200, 400));
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    // Left of the image, in the band of backdrop.
    fireEvent.pointerDown(frame, { clientX: 20, clientY: 200, button: 0 });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 0, focalY: 50 })
    );
  });

  it("moves the dot with the arrow keys, ten at a time with Shift", async () => {
    const { onSave } = renderLaidOut(box(0, 100, 400, 200), {
      focalX: 30,
      focalY: 40,
    });
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    const dot = screen.getByRole("slider", { name: "Focus point" });
    fireEvent.keyDown(dot, { key: "ArrowRight" });
    fireEvent.keyDown(dot, { key: "ArrowRight" });
    fireEvent.keyDown(dot, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(dot, { key: "ArrowUp" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 32, focalY: 49 })
    );
  });

  it("puts the point back in the middle with Centre", async () => {
    const { onSave } = renderLaidOut(box(0, 0, 400, 400), {
      focalX: 10,
      focalY: 90,
    });
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    fireEvent.click(screen.getByRole("button", { name: "Centre" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ focalX: 50, focalY: 50 })
    );
  });

  it("leaves the stored point alone when Escape cancels", () => {
    const { onSave, frame } = renderLaidOut(box(0, 0, 400, 400));
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));
    fireEvent.pointerDown(frame, { clientX: 10, clientY: 10, button: 0 });

    const dot = screen.getByRole("slider", { name: "Focus point" });
    fireEvent.keyDown(dot, { key: "Escape" });

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Set focus point" })
    ).toBeInTheDocument();
  });

  it("shows one dot on one image, and no ring, crosshair, coordinates, ratio strip or regeneration message", () => {
    renderLaidOut(box(0, 0, 400, 400), { focalX: 20, focalY: 70 });
    fireEvent.click(screen.getByRole("button", { name: "Set focus point" }));

    // POSITIVE CONTROL: the dot is drawn, so a count of one is not absence.
    expect(document.querySelectorAll("[data-focal-dot]")).toHaveLength(1);
    // The old picker drew the image again at three crop ratios.
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.queryByText(/\(\s*\d+\s*,\s*\d+\s*\)/)).toBeNull();
    expect(screen.queryByText(/1:1|16:9|4:3/)).toBeNull();
    expect(screen.queryByText(/regenerat/i)).toBeNull();
    expect(document.querySelectorAll("[data-focal-crosshair]")).toHaveLength(0);
  });

  it("offers no way to set the point to a reader", () => {
    renderLaidOut(box(0, 0, 400, 400), { readOnly: true });
    // POSITIVE CONTROL: the image itself is still shown.
    expect(screen.getByRole("img", { name: "A photo" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Set focus point" })
    ).toBeNull();
  });
});
