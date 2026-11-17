// @vitest-environment jsdom

/**
 * A background's position: the nine points, read from CSS's own default for
 * a background (its top left, not the middle an image's object position
 * starts at), and Custom for any other value.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BackgroundPositionField } from "./background-fields";
import { FocalFrame } from "./focal-frame";

afterEach(cleanup);

function renderPosition(stored?: string) {
  render(
    <>
      <span id="label">Position</span>
      <BackgroundPositionField
        id="bg-position"
        labelledBy="label"
        stored={stored}
        actionName="Position"
        describedBy={undefined}
        onCommit={() => "applied"}
      />
    </>
  );
}

describe("a background's position", () => {
  it("reads the top left, where CSS places a background, when nothing is set", () => {
    renderPosition();
    expect(
      screen.getByText("Top left by default", { selector: "b" })
    ).toBeDefined();
    // The one tab stop is that point.
    expect(screen.getByRole("radio", { name: "Top left" }).tabIndex).toBe(0);
    expect(screen.getByRole("radio", { name: "Center" }).tabIndex).toBe(-1);
  });

  it("reads a value the nine points can't make as Custom", () => {
    renderPosition("30% 70%");
    expect(
      screen.getByText("Custom: 30% 70%", { selector: "b" })
    ).toBeDefined();
  });

  it("previews no picture, whatever image frame surrounds it", () => {
    // An Image block's own picture is no background's.
    render(
      <FocalFrame.Provider value={{ picture: "/photo.jpg", fit: "cover" }}>
        <span id="label">Position</span>
        <BackgroundPositionField
          id="bg-position"
          labelledBy="label"
          stored={undefined}
          actionName="Position"
          describedBy={undefined}
          onCommit={() => "applied"}
        />
      </FocalFrame.Provider>
    );
    expect(document.querySelector("img")).toBeNull();
  });
});
