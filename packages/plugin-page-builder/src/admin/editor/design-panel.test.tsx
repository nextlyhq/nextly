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
import * as ReactDOM from "react-dom";

import { DesignPanel, designViewOf, useDesignHeaderSlot } from "./design-panel";
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

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Shared styles" }), {
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
    const panel = (revision: number, settling = false) => (
      <StyleRevisionContext.Provider value={{ revision, settling }}>
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

  it("mounts the frame afresh too, while keeping it across a change of tab", () => {
    // The frame holds the variables an author is editing, for every tab.
    function Frame({ children }: { children: React.ReactNode }) {
      const [draft, setDraft] = React.useState("stored");
      return (
        <>
          <button type="button" onClick={() => setDraft("edited")}>
            {draft}
          </button>
          {children}
        </>
      );
    }
    const panel = (revision: number, current: string) => (
      <StyleRevisionContext.Provider value={{ revision, settling: false }}>
        <DesignPanel
          view={{ current, choose: vi.fn() }}
          frame={tabs => <Frame>{tabs}</Frame>}
          tabs={{
            variables: () => <p>variables content</p>,
            classes: () => null,
            fonts: () => <p>fonts content</p>,
          }}
        />
      </StyleRevisionContext.Provider>
    );
    const { rerender } = render(panel(0, "variables"));
    fireEvent.click(screen.getByRole("button", { name: "stored" }));
    rerender(panel(0, "fonts"));
    expect(screen.getByText("fonts content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "edited" })).toBeTruthy();

    rerender(panel(1, "fonts"));
    expect(screen.getByRole("button", { name: "stored" })).toBeTruthy();
  });

  it("holds the header's controls inert while a replay settles, as it holds the tab", () => {
    const panel = (settling: boolean) => (
      <StyleRevisionContext.Provider value={{ revision: 0, settling }}>
        <DesignPanel
          view={{ current: "fonts", choose: vi.fn() }}
          tabs={{
            variables: () => null,
            classes: () => null,
            fonts: () => null,
          }}
        />
      </StyleRevisionContext.Provider>
    );
    const { container, rerender } = render(panel(true));
    const actions = () =>
      container.querySelector(".nx-pb-design__actions") as HTMLElement;
    expect(actions().hasAttribute("inert")).toBe(true);
    rerender(panel(false));
    expect(actions().hasAttribute("inert")).toBe(false);
  });

  it("holds the tab inert while a replay settles, so nothing is edited against the old value", () => {
    const panel = (settling: boolean) => (
      <StyleRevisionContext.Provider value={{ revision: 0, settling }}>
        <DesignPanel
          view={{ current: "variables", choose: vi.fn() }}
          tabs={{
            variables: () => <button type="button">a control</button>,
            classes: () => null,
            fonts: () => null,
          }}
        />
      </StyleRevisionContext.Provider>
    );
    const { rerender } = render(panel(true));
    const holder = screen.getByText("a control").closest("[aria-busy]");
    expect(holder?.hasAttribute("inert")).toBe(true);
    rerender(panel(false));
    expect(screen.getByText("a control").closest("[inert]")).toBeNull();
  });
});

describe("the panel's header", () => {
  it("is titled Design, above the tabs Variables, Shared styles and Fonts", () => {
    renderPanel("variables");
    const heading = screen.getByRole("heading", { name: "Design" });
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs).toEqual(["Variables", "Shared styles", "Fonts"]);
    expect(
      heading.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("still opens Shared styles for the stored view it always had", () => {
    renderPanel("classes");
    expect(
      screen
        .getByRole("tab", { name: "Shared styles" })
        .getAttribute("aria-selected")
    ).toBe("true");
  });

  it("gives the open tab a place in the header for its own controls", async () => {
    function Controls(): React.JSX.Element | null {
      const slot = useDesignHeaderSlot();
      return slot === null
        ? null
        : ReactDOM.createPortal(
            <button type="button">Tab control</button>,
            slot
          );
    }
    render(
      <DesignPanel
        view={{ current: "variables", choose: vi.fn() }}
        tabs={{
          variables: () => <Controls />,
          classes: () => null,
          fonts: () => null,
        }}
      />
    );
    const control = await screen.findByRole("button", { name: "Tab control" });
    const header = screen.getByRole("heading", {
      name: "Design",
    }).parentElement;
    expect(header?.contains(control)).toBe(true);
  });
});
