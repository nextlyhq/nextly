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

import { FontChoicesContext } from "@nextlyhq/builder/shell";

import {
  DesignFonts,
  DesignGroup,
  DesignPanel,
  ReportStylesMatches,
  SITE_FONTS_GROUP,
  designViewOf,
  useDesignBrowse,
  useDesignHeaderSlot,
} from "./design-panel";
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
        colours: tab("colours"),
        type: tab("type"),
        spacing: tab("spacing"),
        styles: tab("styles"),
      }}
    />
  );
  return { mounted, choose };
}

describe("DesignPanel", () => {
  it("opens on the tab the shell remembers, and mounts only that one", () => {
    const { mounted } = renderPanel("type");

    expect(
      screen.getByRole("tab", { name: "Type" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(screen.getByText("type content")).toBeTruthy();
    expect(mounted).toEqual(["type"]);
  });

  it("opens on Colours when no tab, or one it does not name, is stored", () => {
    expect(designViewOf(null)).toBe("colours");
    expect(designViewOf("history")).toBe("colours");
    // A name an earlier panel stored is one it does not name: there is no
    // table of old names.
    expect(designViewOf("variables")).toBe("colours");
    expect(designViewOf("classes")).toBe("colours");
    expect(designViewOf("fonts")).toBe("colours");
    renderPanel("history");
    expect(screen.getByText("colours content")).toBeTruthy();
  });

  it("hands a chosen tab to the shell to remember", () => {
    const { choose } = renderPanel("colours");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Styles" }), {
      button: 0,
    });

    expect(choose).toHaveBeenCalledWith("styles");
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
          view={{ current: "colours", choose: vi.fn() }}
          tabs={{
            colours: () => <Studio />,
            type: () => null,
            spacing: () => null,
            styles: () => null,
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
            colours: () => <p>colours content</p>,
            type: () => <p>type content</p>,
            spacing: () => null,
            styles: () => null,
          }}
        />
      </StyleRevisionContext.Provider>
    );
    const { rerender } = render(panel(0, "colours"));
    fireEvent.click(screen.getByRole("button", { name: "stored" }));
    rerender(panel(0, "type"));
    expect(screen.getByText("type content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "edited" })).toBeTruthy();

    rerender(panel(1, "type"));
    expect(screen.getByRole("button", { name: "stored" })).toBeTruthy();
  });

  it("holds the header's controls inert while a replay settles, as it holds the tab", () => {
    const panel = (settling: boolean) => (
      <StyleRevisionContext.Provider value={{ revision: 0, settling }}>
        <DesignPanel
          view={{ current: "type", choose: vi.fn() }}
          tabs={{
            colours: () => null,
            type: () => null,
            spacing: () => null,
            styles: () => null,
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
          view={{ current: "colours", choose: vi.fn() }}
          tabs={{
            colours: () => <button type="button">a control</button>,
            type: () => null,
            spacing: () => null,
            styles: () => null,
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
  it("is titled Design, above the tabs Colours, Type, Spacing and Styles", () => {
    renderPanel("colours");
    const heading = screen.getByRole("heading", { name: "Design" });
    const tabs = screen.getAllByRole("tab").map(tab => tab.textContent);
    expect(tabs).toEqual(["Colours", "Type", "Spacing", "Styles"]);
    expect(
      heading.compareDocumentPosition(screen.getByRole("tablist")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
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
        view={{ current: "colours", choose: vi.fn() }}
        tabs={{
          colours: () => <Controls />,
          type: () => null,
          spacing: () => null,
          styles: () => null,
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

describe("the Design panel's search and folds", () => {
  /** A store as the author's preferences keep it, in memory. */
  function memoryStore(): {
    read: () => string | null;
    write: (v: string) => void;
    held: () => string | null;
  } {
    let value: string | null = null;
    return {
      read: () => value,
      write: next => {
        value = next;
      },
      held: () => value,
    };
  }

  /** A tab that reports a count per tab and lists one foldable group. */
  function Reporting(): React.JSX.Element {
    const { search, folds, reportMatches } = useDesignBrowse();
    React.useEffect(() => {
      const needle = search.trim();
      reportMatches({
        colours: needle === "" ? 0 : 3,
        type: needle === "" ? 0 : 1,
        spacing: 0,
      });
    }, [search, reportMatches]);
    const folded =
      search.trim() === "" && folds?.folded.has("colours") === true;
    return (
      <div>
        <button
          type="button"
          aria-expanded={!folded}
          onClick={() => folds?.onFold("colours", !folded)}
        >
          Colours group
        </button>
        {folded ? null : <p>colour rows</p>}
      </div>
    );
  }

  function renderBrowsing(store = memoryStore()) {
    const tabs = {
      colours: () => <Reporting />,
      type: () => null,
      spacing: () => null,
      styles: () => null,
    };
    const view = render(
      <DesignPanel
        view={{ current: "colours", choose: vi.fn() }}
        tabs={tabs}
        foldStore={store}
      />
    );
    return { store, view, tabs };
  }

  const tabText = (name: string) =>
    screen.getByRole("tab", { name: new RegExp(`^${name}`) }).textContent;

  it("is one search across the tabs, with each tab's matches beside its name", () => {
    renderBrowsing();
    const search = screen.getByRole("searchbox", { name: "Search Design" });
    // No counts while nothing is searched.
    expect(tabText("Colours")).toBe("Colours");
    fireEvent.change(search, { target: { value: "brand" } });
    expect(tabText("Colours")).toBe("Colours, 3 matches");
    expect(tabText("Type")).toBe("Type, 1 match");
    expect(tabText("Spacing")).toBe("Spacing, 0 matches");
    // A tab that reports nothing shows no count.
    expect(tabText("Styles")).toBe("Styles");
    fireEvent.change(search, { target: { value: "" } });
    expect(tabText("Colours")).toBe("Colours");
  });

  it("opens a folded group while a search is on, and folds it again once cleared", () => {
    renderBrowsing();
    fireEvent.click(screen.getByRole("button", { name: "Colours group" }));
    expect(screen.queryByText("colour rows")).toBeNull();
    const search = screen.getByRole("searchbox", { name: "Search Design" });
    fireEvent.change(search, { target: { value: "brand" } });
    expect(screen.getByText("colour rows")).toBeTruthy();
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByText("colour rows")).toBeNull();
  });

  it("keeps a folded group folded for the author across a reload, and opens every group on a fresh store", () => {
    const { store, view } = renderBrowsing();
    fireEvent.click(screen.getByRole("button", { name: "Colours group" }));
    expect(store.held()).toBe('["colours"]');
    view.unmount();
    // The same author's store, read again as a reload reads it.
    renderBrowsing(store);
    expect(screen.queryByText("colour rows")).toBeNull();
    cleanup();
    // A fresh profile: nothing stored, every group open.
    renderBrowsing();
    expect(screen.getByText("colour rows")).toBeTruthy();
  });

  it("reads the author's folds when their store arrives after the panel opened, and builds on them", () => {
    const tabs = {
      colours: () => <Reporting />,
      type: () => null,
      spacing: () => null,
      styles: () => null,
    };
    const view = { current: "colours", choose: vi.fn() };
    const { rerender } = render(<DesignPanel view={view} tabs={tabs} />);
    expect(screen.getByText("colour rows")).toBeTruthy();
    // The author becomes known: their store holds a folded group.
    const store = memoryStore();
    store.write('["colours","fonts"]');
    rerender(<DesignPanel view={view} tabs={tabs} foldStore={store} />);
    expect(screen.queryByText("colour rows")).toBeNull();
    // A toggle keeps what the store already held.
    fireEvent.click(screen.getByRole("button", { name: "Colours group" }));
    expect(store.held()).toBe('["fonts"]');
  });

  it("counts the Styles tab's matches beside its name, whichever tab is open", () => {
    const library = [
      {
        id: "c-card",
        slug: "card",
        label: "Card",
        orderIndex: 0,
        styles: {},
      },
    ];
    render(
      <DesignPanel
        view={{ current: "colours", choose: vi.fn() }}
        tabs={{
          colours: () => <p>colour rows</p>,
          type: () => null,
          spacing: () => null,
          styles: () => null,
        }}
        frame={tabs => (
          <>
            <ReportStylesMatches
              library={library}
              suppliedClassIds={undefined}
              styleContext={undefined}
            />
            {tabs}
          </>
        )}
      />
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Design" }), {
      target: { value: "card" },
    });
    expect(tabText("Styles")).toBe("Styles, 1 match");
  });
});

describe("Manage fonts… from a Font control in Design", () => {
  /** What a Font control's footer does: the way to the site's fonts. */
  function ManageFonts(): React.JSX.Element {
    const fonts = React.useContext(FontChoicesContext);
    return (
      <button type="button" onClick={() => fonts?.onManageFonts?.()}>
        Manage fonts…
      </button>
    );
  }

  it("opens the Type tab and the site's Fonts group, even folded", () => {
    let folded = "";
    const store = {
      read: () => folded || null,
      write: (next: string) => {
        folded = next;
      },
    };
    const choose = vi.fn();
    render(
      <DesignPanel
        view={{ current: "type", choose }}
        foldStore={store}
        frame={designTabs => (
          <DesignFonts
            faces={[]}
            fromCode={[]}
            onManageFonts={() => choose("type")}
          >
            {designTabs}
          </DesignFonts>
        )}
        tabs={{
          colours: () => null,
          type: () => (
            <>
              <DesignGroup id={SITE_FONTS_GROUP} heading="Fonts" count={1}>
                <p>font rows</p>
              </DesignGroup>
              <ManageFonts />
            </>
          ),
          spacing: () => null,
          styles: () => null,
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^Fonts/ }));
    expect(screen.queryByText("font rows")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Manage fonts…" }));
    expect(choose).toHaveBeenCalledWith("type");
    expect(screen.getByText("font rows")).toBeTruthy();
  });
});
