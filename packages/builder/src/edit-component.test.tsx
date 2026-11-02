// @vitest-environment jsdom

/**
 * "Edit component" in the editor: offered for one selected placement by a host
 * that answers it, run by the shared verb, drawn in the placement's inspector,
 * and the banner over a component's own view.
 *
 * The properties a plausible implementation gets wrong: offering the verb on
 * an ordinary block or to an author the host withheld it from, handing the
 * host the node id where it wants the component's, and a banner that calls a
 * count of documents a count of pages.
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
          true
        )
      )
    ).toContain("edit-component");
  });

  it("is not offered for an ordinary block, several blocks, or without a host", () => {
    expect(
      ids(toolbarActions(page, "h", ["h"], undefined, true, undefined, true))
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
    result.current.result.actions.editComponent();
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
  it("names the component, says the reach as documents, and goes back", () => {
    const back = vi.fn();
    render(
      <ComponentBanner
        name="Hero"
        reach={{ count: 3, complete: false }}
        onBack={back}
      />
    );
    const banner = screen.getByRole("region", { name: "Editing a component" });
    expect(banner.textContent).toContain("Hero");
    expect(banner.textContent).toContain(
      "Changes reach at least the 3 documents that place it."
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("offers no Back without somewhere to go, and says nothing of an unknown reach", () => {
    render(<ComponentBanner name="Hero" reach={undefined} />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(reachSentence({ count: 1, complete: true })).toBe(
      "Changes reach the 1 document that place it."
    );
    expect(reachSentence({ count: 0, complete: false })).toBeUndefined();
    expect(reachSentence({ count: 0, complete: true })).toBe(
      "Nothing places it yet."
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
