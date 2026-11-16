// @vitest-environment jsdom

/**
 * "Edit component" in the editor: offered for one selected placement by a host
 * that answers it, run by the shared verb, drawn in the placement's inspector,
 * and the banner over a component's own view.
 *
 * The properties a plausible implementation gets wrong: offering the verb on
 * an ordinary block or to an author the host withheld it from, handing the
 * host the node id where it wants the component's, and a banner that says
 * "at least" of an exact count, or offers more than one way back.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { ShortcutProvider } from "@nextlyhq/ui";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { blockActionRunners } from "./builder-commands";
import { ComponentBanner, reachSentence } from "./component-banner";
import { InspectorPanel } from "./inspector-panel";
import { useEditorState } from "./editor-state";
import { useBlockKeyboardActions } from "./keyboard-actions";
import { toolbarActions } from "./toolbar-actions";

afterEach(() => cleanup());

const placed: BlockNode = {
  id: "placed",
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "hero" },
};
const heading: BlockNode = {
  id: "h",
  type: "acme/heading",
  version: 1,
  props: {},
};
const page: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [heading, placed],
};

const ids = (offered: ReturnType<typeof toolbarActions>) =>
  offered.map(action => action.id);

describe("the toolbar's Edit component", () => {
  it("is offered for one selected placement, by a host that answers it", () => {
    expect(
      ids(
        toolbarActions(
          page,
          "placed",
          ["placed"],
          undefined,
          true,
          undefined,
          undefined,
          true
        )
      )
    ).toContain("edit-component");
  });

  it("is not offered for a placement naming no component", () => {
    const empty: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ ...placed, id: "blank", props: {} }],
    };
    expect(
      ids(
        toolbarActions(
          empty,
          "blank",
          ["blank"],
          undefined,
          true,
          undefined,
          undefined,
          true
        )
      )
    ).not.toContain("edit-component");
  });

  it("is not offered for an ordinary block, several blocks, or without a host", () => {
    expect(
      ids(
        toolbarActions(
          page,
          "h",
          ["h"],
          undefined,
          true,
          undefined,
          undefined,
          true
        )
      )
    ).not.toContain("edit-component");
    expect(
      ids(
        toolbarActions(
          page,
          "placed",
          ["placed", "h"],
          undefined,
          true,
          undefined,
          undefined,
          true
        )
      )
    ).not.toContain("edit-component");
    expect(
      ids(
        toolbarActions(
          page,
          "placed",
          ["placed"],
          undefined,
          true,
          undefined,
          undefined,
          false
        )
      )
    ).not.toContain("edit-component");
  });
});

describe("the Edit component verb", () => {
  function verbsFor(onEditComponent?: (a: string, b: string) => void) {
    return renderHook(
      () => {
        const editor = useEditorState({ initialDocument: page });
        const result = useBlockKeyboardActions({
          editor,
          enabled: false,
          onSaveAsPattern: () => {},
          ...(onEditComponent === undefined ? {} : { onEditComponent }),
        });
        return { editor, result };
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <ShortcutProvider>{children}</ShortcutProvider>
        ),
      }
    );
  }

  it("hands the host the placed component's id and the placement's", () => {
    const opened = vi.fn();
    const { result, rerender } = verbsFor(opened);
    result.current.editor.select("placed");
    rerender();
    blockActionRunners(result.current.result.actions)["edit-component"]();
    expect(opened).toHaveBeenCalledWith("hero", "placed");
    expect(ids(result.current.result.selectionActions)).toContain(
      "edit-component"
    );
  });

  it("does nothing for an ordinary block", () => {
    const opened = vi.fn();
    const { result, rerender } = verbsFor(opened);
    result.current.editor.select("h");
    rerender();
    // Present, so the call below runs the verb rather than nothing.
    expect(result.current.result.actions.editComponent).toBeTypeOf("function");
    result.current.result.actions.editComponent?.();
    expect(opened).not.toHaveBeenCalled();
  });
});

describe("a host built before the verb", () => {
  it("still runs the shared map, where Edit component does nothing", () => {
    const runners = blockActionRunners({
      move: () => {},
      delete: () => {},
      duplicate: () => {},
      selectParent: () => {},
      saveAsPattern: () => {},
    });
    expect(() => runners["edit-component"]()).not.toThrow();
  });
});

describe("the banner over a component's own view", () => {
  it("names the component, says the pages a change reaches, and goes back to where it names", () => {
    const back = vi.fn();
    render(
      <ComponentBanner
        name="Hero"
        pages={{ count: 3, complete: false }}
        back={{ to: "Home", onBack: back }}
      />
    );
    const banner = screen.getByRole("region", { name: "Editing a component" });
    expect(banner.textContent).toContain("Hero");
    expect(banner.textContent).toContain("Changes reach at least 3 pages");
    // ONE way back, named for where it goes.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to Home" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("says when every page changes in the band's own tooltip, not a pill", () => {
    render(<ComponentBanner name="Hero" pages={undefined} />);
    const banner = screen.getByRole("region", { name: "Editing a component" });
    expect(banner.getAttribute("title")).toBe(
      "Every page that uses it updates when you save."
    );
    // Read to a screen reader too, which a tooltip alone is not.
    expect(banner.getAttribute("aria-describedby")).not.toBeNull();
  });

  it("takes the builder's tokens, so the component hue holds over the admin in dark", () => {
    render(<ComponentBanner name="Hero" pages={undefined} />);
    const banner = screen.getByRole("region", { name: "Editing a component" });
    expect(banner.classList.contains("nx-builder-tokens")).toBe(true);
  });

  it("offers no Back without somewhere to go, and says nothing of an unknown count", () => {
    render(<ComponentBanner name="Hero" pages={undefined} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(reachSentence({ count: 1, complete: true })).toBe(
      "Changes reach 1 page"
    );
    expect(reachSentence({ count: 4, complete: true })).toBe(
      "Changes reach 4 pages"
    );
    // "at least" only when the count is a floor.
    expect(reachSentence({ count: 1, complete: false })).toBe(
      "Changes reach at least 1 page"
    );
    expect(reachSentence({ count: 0, complete: false })).toBeUndefined();
    expect(reachSentence({ count: 0, complete: true })).toBe(
      "Not on any page yet"
    );
  });
});

describe("the placement inspector's Edit component", () => {
  const definition: BlockDocument = {
    formatVersion: 1,
    kind: "component",
    nodes: [heading],
  };
  const library = {
    definitions: new Map([["hero", definition]]),
    components: [{ id: "hero", title: "Hero" }] as never,
  };

  function Host({ offered }: { offered: boolean }) {
    const editor = useEditorState({ initialDocument: page });
    React.useEffect(() => editor.select("placed"), []);
    const run = vi.fn();
    ran.current = run;
    return (
      <InspectorPanel
        editor={editor}
        componentLibrary={library}
        verbs={{
          actions: offered
            ? [{ id: "edit-component", label: "Edit component", enabled: true }]
            : [],
          run,
        }}
      />
    );
  }
  const ran: { current: ReturnType<typeof vi.fn> | undefined } = {
    current: undefined,
  };

  it("runs the shared verb, where the host offers it", () => {
    render(<Host offered />);
    fireEvent.click(screen.getByRole("button", { name: "Edit component" }));
    expect(ran.current).toHaveBeenCalledWith("edit-component");
  });

  it("is not drawn where the host withholds it", () => {
    render(<Host offered={false} />);
    expect(screen.queryByRole("button", { name: "Edit component" })).toBeNull();
  });
});
