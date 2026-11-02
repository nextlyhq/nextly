// @vitest-environment jsdom
/**
 * The Design panel's tabs, from the view the shell keeps.
 *
 * What these pin is that the tab on screen is the one the shell remembers,
 * that a stored view this panel no longer names still opens a tab, that
 * choosing a tab goes back to the shell to be remembered, and that only the
 * open tab's content is mounted — each tab reads the site's style, and a
 * hidden one has no reason to.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as React from "react";

import { DesignPanel, designViewOf } from "./design-panel";
import { StyleRevisionContext } from "./site-style-history";

afterEach(cleanup);

function renderPanel(current: string | null, choose = vi.fn()) {
  const mounted: string[] = [];
  const tab = (name: string) => () => {
    mounted.push(name);
    return <p>{name} content</p>;
  };
  render(
    <DesignPanel
      view={{ current, choose }}
      tabs={{
        variables: tab("variables"),
        classes: tab("classes"),
        fonts: tab("fonts"),
      }}
    />
  );
  return { mounted, choose };
}

describe("DesignPanel", () => {
  it("opens on the tab the shell remembers, and mounts only that one", () => {
    const { mounted } = renderPanel("fonts");

    expect(
      screen.getByRole("tab", { name: "Fonts" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByText("fonts content")).toBeTruthy();
    expect(mounted).toEqual(["fonts"]);
  });

  it("opens on Variables when no tab, or one it does not name, is stored", () => {
    expect(designViewOf(null)).toBe("variables");
    expect(designViewOf("history")).toBe("variables");
    renderPanel("history");
    expect(screen.getByText("variables content")).toBeTruthy();
  });

  it("hands a chosen tab to the shell to remember", () => {
    const { choose } = renderPanel("variables");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Classes" }), {
      button: 0,
    });

    expect(choose).toHaveBeenCalledWith("classes");
  });
});

describe("a style change undone behind the open tab", () => {
  it("mounts the tab afresh, so it reads the section again", () => {
    // The tab holds its own copy while open; one kept across an undo would
    // write the undone value back on its next edit.
    function Studio(): React.JSX.Element {
      const [draft, setDraft] = React.useState("stored");
      return (
        <button type="button" onClick={() => setDraft("edited")}>
          {draft}
        </button>
      );
    }
    const panel = (revision: number) => (
      <StyleRevisionContext.Provider value={revision}>
        <DesignPanel
          view={{ current: "variables", choose: vi.fn() }}
          tabs={{
            variables: () => <Studio />,
            classes: () => null,
            fonts: () => null,
          }}
        />
      </StyleRevisionContext.Provider>
    );
    const { rerender } = render(panel(0));
    fireEvent.click(screen.getByRole("button", { name: "stored" }));
    expect(screen.getByRole("button", { name: "edited" })).toBeTruthy();

    rerender(panel(0));
    expect(screen.getByRole("button", { name: "edited" })).toBeTruthy();

    rerender(panel(1));
    expect(screen.getByRole("button", { name: "stored" })).toBeTruthy();
  });
});
