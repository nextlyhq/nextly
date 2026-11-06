// @vitest-environment jsdom

/**
 * An image's focal point: nine points over its own picture, written as
 * `object-position` keywords.
 *
 * @module focal-point-field.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FocalFrame } from "./focal-frame";
import { FocalPointField } from "./focal-point-field";

afterEach(cleanup);

function mount(
  stored?: string,
  frame: { picture?: string; fit?: string; position?: string } = {
    fit: "cover",
  }
) {
  const onCommit = vi.fn(() => "applied" as const);
  render(
    <FocalFrame.Provider value={frame}>
      <span id="focal-label">Focal point</span>
      <FocalPointField
        id="focal"
        labelledBy="focal-label"
        stored={stored}
        actionName="Focal point"
        describedBy={undefined}
        onCommit={onCommit}
      />
    </FocalFrame.Provider>
  );
  return onCommit;
}

const checked = () =>
  screen
    .getAllByRole("radio")
    .filter(radio => radio.getAttribute("aria-checked") === "true")
    .map(radio => radio.getAttribute("aria-label"));

describe("FocalPointField", () => {
  it("draws nine points, each named by its place", () => {
    mount();
    expect(
      screen
        .getAllByRole("radio")
        .map(radio => radio.getAttribute("aria-label"))
    ).toEqual([
      "Top left",
      "Top",
      "Top right",
      "Left",
      "Center",
      "Right",
      "Bottom left",
      "Bottom",
      "Bottom right",
    ]);
  });

  it("reads a stored point in any order CSS allows", () => {
    mount("center top");
    expect(checked()).toEqual(["Top"]);
    cleanup();
    mount("top");
    expect(checked()).toEqual(["Top"]);
    cleanup();
    mount("bottom right");
    expect(checked()).toEqual(["Bottom right"]);
  });

  it("writes a point as keywords, across then down", () => {
    const onCommit = mount();
    fireEvent.click(screen.getByRole("radio", { name: "Bottom right" }));
    expect(onCommit).toHaveBeenCalledWith("right bottom");
    fireEvent.click(screen.getByRole("radio", { name: "Center" }));
    expect(onCommit).toHaveBeenLastCalledWith("center");
  });

  it("clears the point when the chosen one is pressed again", () => {
    const onCommit = mount("center top");
    fireEvent.click(screen.getByRole("radio", { name: "Top" }));
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("moves with the arrow keys, writing the point it moves to", () => {
    const onCommit = mount("center top");
    const top = screen.getByRole("radio", { name: "Top" });
    expect(top.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(top, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith("right top");
    fireEvent.keyDown(top, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith("center");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Center");
  });

  it("wraps an arrow at an edge to the opposite edge, as a radio group does", () => {
    const onCommit = mount("right top");
    const corner = screen.getByRole("radio", { name: "Top right" });
    fireEvent.keyDown(corner, { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith("left top");
    fireEvent.keyDown(corner, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith("right bottom");
  });

  it("says the default only while nothing is set", () => {
    mount();
    expect(screen.getByText("Center by default")).toBeDefined();
    cleanup();
    mount("center top");
    expect(screen.queryByText("Center by default")).toBeNull();
    expect(screen.getByText("Top", { selector: "b" })).toBeDefined();
  });

  it("says what the point does for the fit in force", () => {
    mount(undefined, { fit: "cover" });
    expect(screen.getByText("Kept in view")).toBeDefined();
    cleanup();
    mount(undefined, { fit: "contain" });
    expect(screen.getByText("Where it sits")).toBeDefined();
  });

  it("aims over the block's own picture, fitted as the block fits it", () => {
    mount(undefined, { picture: "/team.png", fit: "contain" });
    const backdrop = document.querySelector(
      ".nx-focal__picture"
    ) as HTMLImageElement | null;
    expect(backdrop?.getAttribute("src")).toBe("/team.png");
    expect(backdrop?.style.objectFit).toBe("contain");
    cleanup();
    mount(undefined, { fit: "cover" });
    expect(document.querySelector(".nx-focal__picture")).toBeNull();
    expect(document.querySelector(".nx-focal__swatch")).not.toBeNull();
  });

  it("previews the crop the chosen point gives", () => {
    // The preview is the square frame's, not the block's: without the point
    // it would show a centred crop the page does not.
    mount("right top", { picture: "/team.png", fit: "cover" });
    const backdrop = document.querySelector(
      ".nx-focal__picture"
    ) as HTMLImageElement | null;
    expect(backdrop?.style.objectPosition).toBe("right top");
  });

  it("previews a contextual point where the canvas resolves it", () => {
    // `inherit` or a variable means nothing in the inspector's own document;
    // the canvas has already resolved it for the picture it draws.
    mount("var(--image-focus)", {
      picture: "/team.png",
      fit: "cover",
      position: "100% 0%",
    });
    const backdrop = document.querySelector(
      ".nx-focal__picture"
    ) as HTMLImageElement | null;
    expect(backdrop?.style.objectPosition).toBe("100% 0%");
  });

  it("shows an exact point as written, and writes one as CSS", () => {
    const onCommit = mount("30% 70%");
    expect(checked()).toEqual([]);
    expect(screen.getByText("30% 70%", { selector: "b" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Focal point as CSS" }));
    const css = screen.getByRole("textbox", { name: "Focal point as CSS" });
    fireEvent.change(css, { target: { value: "20% 10%" } });
    fireEvent.blur(css);
    expect(onCommit).toHaveBeenCalledWith("20% 10%");
  });
});
