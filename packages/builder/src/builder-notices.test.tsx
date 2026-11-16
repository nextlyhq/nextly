// @vitest-environment jsdom

/**
 * Notices, and the failure they exist for.
 *
 * The queue's own rules are cheap to assert and are asserted here. What is only
 * true in COMPOSITION is the case the surface was built for: a shared style's
 * write refused after the author has clicked another block, when the Style
 * tab, keyed by node, has unmounted the field that started it, and the report
 * has to survive it.
 *
 * The panel is driven through a real keyed remount rather than by calling
 * the sink directly. Raising a notice by hand would assert that a region
 * renders what it is given, which is not the property in doubt.
 *
 * @module builder-notices.test
 */
import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type NamedClass,
} from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  BuilderNoticeRegion,
  NoticeSinkProvider,
  useNoticeQueue,
} from "./builder-notices";
import type { EditorState } from "./editor-state";
import { SharedStylesPanel } from "./shared-styles-panel";
import { ShellActiveContext } from "./shell-active";
import { StyleInspectorPanel } from "./style-inspector-panel";

afterEach(cleanup);

const LIBRARY: NamedClass[] = [
  { id: "id-hero", slug: "hero", orderIndex: 0, styles: {} },
];

/** A shared style whose write the test answers, after the author has moved on. */
function deferredWrite(): {
  write: () => Promise<string | undefined>;
  refuse: (reason: string) => Promise<void>;
} {
  let settle: ((value: string | undefined) => void) | undefined;
  const pending = new Promise<string | undefined>(resolve => {
    settle = resolve;
  });
  return {
    write: () => pending,
    refuse: async reason => {
      await act(async () => {
        settle?.(reason);
        await pending;
      });
    },
  };
}

beforeAll(() => {
  registerBlocks(
    [
      {
        name: "acme/box",
        version: 1,
        description: "A box.",
        example: { props: {} },
        editor: { label: "Box" },
        props: {},
        supports: { effects: true },
        render: () => null,
      },
    ] as never,
    { source: "builder-notices-test" }
  );
});

afterAll(() => {
  clearBlocks();
});

const CARD = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: {},
};

/** Two blocks wearing Card, with either one selected. */
function editorOn(selectedId: string): EditorState {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: ["node-a", "node-b"].map(id => ({
      id,
      type: "acme/box",
      version: 1,
      props: {},
      classes: ["c-card"],
    })),
  } as unknown as BlockDocument;
  return {
    document,
    selectedId,
    selection: { ids: [selectedId], primary: selectedId },
    applyAll: vi.fn(() => document),
    apply: vi.fn(() => document),
    select: vi.fn(),
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState;
}

/**
 * The shell's arrangement in miniature: the region ABOVE the Style tab, keyed
 * by node as the inspector keys its sections, with Card as the target.
 *
 * The key is the mechanism under test: unkeyed, the field holding the refusal
 * would be reused across the change and never unmount, and the test would pass
 * against the broken code.
 */
function Harness({
  nodeId,
  write,
  shellActive = true,
}: {
  nodeId: string;
  write: () => Promise<string | undefined>;
  /**
   * Whether the shell around the panel is the one the author is using. The
   * region stays OUTSIDE this provider, mirroring the shell.
   */
  shellActive?: boolean;
}): React.ReactElement {
  const notices = useNoticeQueue();
  return (
    <>
      <BuilderNoticeRegion
        notices={notices.notices}
        onDismiss={notices.dismiss}
      />
      <ShellActiveContext.Provider value={shellActive}>
        <NoticeSinkProvider raise={notices.raise}>
          <StyleInspectorPanel
            key={nodeId}
            editor={editorOn(nodeId)}
            target={{
              kind: "shared",
              worn: [],
              style: {
                id: "c-card",
                name: "Card",
                slug: "card",
                className: ".card",
                locked: false,
                inCode: false,
                styles: {},
              },
              readOnly: undefined,
              write,
            }}
          />
        </NoticeSinkProvider>
      </ShellActiveContext.Provider>
    </>
  );
}

/** Change the shared style's opacity, which starts its write. */
function changeOpacity(): void {
  const field = screen.getByRole("textbox", { name: "Opacity" });
  fireEvent.change(field, { target: { value: "0.5" } });
  fireEvent.blur(field);
}

describe("a refusal that arrives after the author has moved on", () => {
  it("is still reported, from a surface the selection did not unmount", async () => {
    const { write, refuse } = deferredWrite();
    const view = render(<Harness nodeId="node-a" write={write} />);

    changeOpacity();

    // The author clicks another block while the write is still on the network.
    // This is the unmount: the field holding the refusal is now gone.
    view.rerender(<Harness nodeId="node-b" write={write} />);

    await refuse("Card could not be saved.");

    expect(screen.getByText("Card could not be saved.")).toBeTruthy();
  });

  it("does not ALSO report inline when the field is still there", async () => {
    // One refusal, one place to read it. A control that can speak for itself
    // does, and the region stays quiet.
    const { write, refuse } = deferredWrite();
    render(<Harness nodeId="node-a" write={write} />);

    changeOpacity();
    await refuse("Card could not be saved.");

    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/);
    // The region stays mounted so it can announce later reports, and is EMPTY.
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("a refusal that arrives after the shell stopped being readable", () => {
  it("goes to the queue, not to the control still mounted behind the notice", async () => {
    /*
     * Below its minimum width the shell puts its subtree behind `hidden` and
     * `inert`, and neither unmounts anything — so the field is still mounted
     * and removed from paint and from the accessibility tree. Speaking inline
     * puts the refusal where nobody can read it. The shell goes inactive AFTER
     * the write starts, which is the whole point.
     */
    const { write, refuse } = deferredWrite();
    const view = render(<Harness nodeId="node-a" write={write} />);

    changeOpacity();

    view.rerender(
      <Harness nodeId="node-a" write={write} shellActive={false} />
    );

    await refuse("Card could not be saved.");

    expect(screen.getByRole("status").textContent).toMatch(
      /could not be saved/
    );
    // And NOT inline: the two surfaces are exclusive by design.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the queue", () => {
  function Queue(): React.ReactElement {
    const notices = useNoticeQueue();
    return (
      <>
        <button onClick={() => notices.raise("Same news")} type="button">
          raise
        </button>
        <button onClick={() => notices.raise("Other news")} type="button">
          raise other
        </button>
        <BuilderNoticeRegion
          notices={notices.notices}
          onDismiss={notices.dismiss}
        />
      </>
    );
  }

  /*
   * Where the region SITS is asserted in `builder-shell.test`, not here. Two
   * things decide it — that it resolves `--nx-builder-*` from a token scope,
   * and that it stays OUTSIDE the subtree the shell makes `hidden` and `inert`
   * — and both are properties of the shell's structure rather than of this
   * file's harness. Asserting them here would have been asserting the harness.
   */

  it("does not re-announce every notice when one is added", () => {
    // `role="status"` is atomic by default, so a second notice makes a screen
    // reader read the first one again.
    render(<Queue />);
    fireEvent.click(screen.getByRole("button", { name: "raise" }));
    expect(screen.getByRole("status").getAttribute("aria-atomic")).toBe(
      "false"
    );
  });

  it("keeps the live region MOUNTED while it is empty", () => {
    /*
     * A polite live region has to exist before its content changes. One
     * inserted already carrying its message is not reliably announced — unlike
     * `role="alert"` — so a screen-reader user could miss the only report that
     * a class was not created. Empty it holds no rows.
     */
    render(<Queue />);
    const region = screen.getByRole("status");
    expect(region).toBeTruthy();
    expect(region.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("does not stack one sentence twice", () => {
    render(<Queue />);
    const raise = screen.getByRole("button", { name: "raise" });
    fireEvent.click(raise);
    fireEvent.click(raise);
    expect(screen.getAllByText("Same news")).toHaveLength(1);
  });

  it("dismisses the one addressed, and keeps the rest", () => {
    render(<Queue />);
    fireEvent.click(screen.getByRole("button", { name: "raise" }));
    fireEvent.click(screen.getByRole("button", { name: "raise other" }));
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);

    // The FIRST dismiss button belongs to "Same news", so the survivor names
    // which notice went — a count alone would pass if the wrong one were
    // removed.
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("Same news")).toBeNull();
    expect(screen.getByText("Other news")).toBeTruthy();
  });

  it("reports a repeat the author had already dismissed", () => {
    // Identity is a counter rather than the sentence: the same failure can
    // happen twice, and an author who cleared the first is owed the second.
    render(<Queue />);
    const raise = screen.getByRole("button", { name: "raise" });
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.click(raise);
    expect(screen.getByText("Same news")).toBeTruthy();
  });
});

describe("a rename refused after the panel is gone", () => {
  type Outcome = { ok: true } | { ok: false; reason: string };
  type Rename = (
    classId: string,
    name: { label: string; slug: string }
  ) => Promise<Outcome>;

  /**
   * The Shared styles tab in the shell's arrangement: the region above, and
   * the panel mounted only while its own rail item is the open one.
   *
   * `BuilderShell` keys its content by the open panel, so switching away
   * unmounts the whole tab — which is a coarser unmount than the class
   * selector's per-node key and reaches the same dead `setState`.
   */
  function Manager({
    open,
    onRename,
    currentRenameAttempt = () => 1,
  }: {
    open: boolean;
    onRename: Rename;
    currentRenameAttempt?: (classId: string) => number;
  }): React.ReactElement {
    const notices = useNoticeQueue();
    return (
      <>
        <BuilderNoticeRegion
          notices={notices.notices}
          onDismiss={notices.dismiss}
        />
        <NoticeSinkProvider raise={notices.raise}>
          {open ? (
            <SharedStylesPanel
              library={LIBRARY}
              pageBlocks={{ counts: new Map(), complete: true }}
              onRename={onRename}
              currentRenameAttempt={currentRenameAttempt}
            />
          ) : null}
        </NoticeSinkProvider>
      </>
    );
  }

  /** Open hero's details and commit a new name in them. */
  async function renameTo(value: string): Promise<void> {
    fireEvent.click(screen.getByRole("button", { name: /^hero, \.nx-c-hero/ }));
    const details = await screen.findByRole("dialog", { name: "hero" });
    const field = within(details).getByLabelText("Name");
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: "Enter" });
  }

  it("is still reported, from the surface the switch did not unmount", async () => {
    let settle: ((v: Outcome) => void) | undefined;
    const pending = new Promise<Outcome>(resolve => {
      settle = resolve;
    });
    const onRename = vi.fn<Rename>(() => pending);

    const view = render(<Manager onRename={onRename} open />);
    await renameTo("promo");
    expect(onRename).toHaveBeenCalled();

    // The author switches panels while the write is still on the network.
    view.rerender(<Manager onRename={onRename} open={false} />);

    await act(async () => {
      settle?.({ ok: false, reason: "The site style is locked." });
      await pending;
    });

    expect(screen.getByText("The site style is locked.")).toBeTruthy();
  });

  it("does not raise a refusal the author has already renamed past", async () => {
    /*
     * A late answer to the FIRST rename, arriving after a second one began,
     * describes a name the author has already replaced. The identity is the
     * host's, so it survives the panel being unmounted in between; asserted
     * through the notice region, where a refusal goes once the panel is gone.
     */
    let settleFirst: ((v: Outcome) => void) | undefined;
    const first = new Promise<Outcome>(resolve => {
      settleFirst = resolve;
    });
    const answers = vi
      .fn<Rename>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ ok: true });
    const attempts = new Map<string, number>();
    const onRename = vi.fn<Rename>((classId, name) => {
      attempts.set(classId, (attempts.get(classId) ?? 0) + 1);
      return answers(classId, name);
    });
    const currentRenameAttempt = (classId: string): number =>
      attempts.get(classId) ?? 0;

    const view = render(
      <Manager
        currentRenameAttempt={currentRenameAttempt}
        onRename={onRename}
        open
      />
    );
    await renameTo("promo");

    // Away and back: the panel is destroyed and built again.
    view.rerender(
      <Manager
        currentRenameAttempt={currentRenameAttempt}
        onRename={onRename}
        open={false}
      />
    );
    view.rerender(
      <Manager
        currentRenameAttempt={currentRenameAttempt}
        onRename={onRename}
        open
      />
    );

    // A second rename, which is the one the author is now waiting on.
    await renameTo("banner");
    expect(onRename).toHaveBeenCalledTimes(2);

    await act(async () => {
      settleFirst?.({ ok: false, reason: "The first one was refused." });
      await first;
    });

    expect(screen.queryByText("The first one was refused.")).toBeNull();
  });

  it("stays in the details while the panel is still open", async () => {
    // One refusal, one place to read it — the details can speak for themselves.
    const onRename = vi.fn<Rename>(async () => ({
      ok: false,
      reason: "The site style is locked.",
    }));
    render(<Manager onRename={onRename} open />);
    await renameTo("promo");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("alert").textContent).toMatch(
      /site style is locked/
    );
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
