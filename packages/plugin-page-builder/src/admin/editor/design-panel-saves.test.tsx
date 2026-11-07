// @vitest-environment jsdom
/**
 * How often the Design panel writes the Site Style, with the real studio, the
 * real write and the real history between the fields and the Single.
 *
 * An edit is written once the author pauses, or at once when they are done
 * with it: its editor closes, the tab changes, the panel goes away or the page
 * is saved. A burst of edits is one write and one step of undo, and nothing
 * typed is lost on the way.
 *
 * @module admin/editor/design-panel-saves.test
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/** What the editor's history says out loud when a replay fails. */
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/ui", async importOriginal => {
  const actual = await importOriginal<typeof import("@nextlyhq/ui")>();
  return { ...actual, toast: { ...actual.toast, error: toastError } };
});

/**
 * The writes the editor tracked with the entry form's storing gate, which
 * lives as long as the form does, whether or not the editor is open.
 */
const tracked = vi.hoisted(() => ({
  writes: [] as { label: string; write: Promise<unknown> }[],
}));

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: () => true,
}));

const refetch = vi.fn(() => Promise.resolve({ isError: false }));
/** The stored document, one object as a query holds it between reads. */
const stored = vi.hoisted(() => ({ data: { tokens: null } as unknown }));
vi.mock("../site-style-read", () => ({
  useStoredSiteStyle: () => ({
    data: stored.data,
    isPending: false,
    error: null,
    refetch,
  }),
}));

/**
 * What the Single was asked to store, in order. The stubbed read gives no
 * version, so each write is the section alone, written as a server that
 * issues none takes it, which the expectations state.
 */
const writes: Record<string, unknown>[] = [];
/**
 * Whether the Single refuses the next writes, and what it says; whether each
 * write was sent to outlive the page; and a gate a write waits on, for a test
 * that needs one still in flight.
 */
const single = vi.hoisted(() => ({
  refuse: undefined as string | undefined,
  keepalive: [] as boolean[],
  gate: undefined as Promise<void> | undefined,
}));
/** What runs before the page's Save and Publish, as the form registers it. */
const beforeAction = vi.hoisted(() => ({
  run: undefined as undefined | (() => unknown),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => undefined,
  useUpdateSingleDocument: (
    _slug: string,
    _locale: string | undefined,
    options?: { keepalive?: () => boolean }
  ) => ({
    mutateAsync: async (data: Record<string, unknown>) => {
      writes.push(data);
      single.keepalive.push(options?.keepalive?.() === true);
      await single.gate;
      if (single.refuse !== undefined) throw new Error("Validation failed.");
      return { id: "1" };
    },
    isPending: false,
  }),
  validationIssues: () =>
    single.refuse === undefined
      ? []
      : [{ path: "tokens", code: "CUSTOM", message: single.refuse }],
  useBeforeDocumentAction: (handler: () => unknown) => {
    beforeAction.run = handler;
  },
  useTrackedWrite: () => (label: string, write: Promise<unknown>) => {
    tracked.writes.push({ label, write });
  },
}));

import {
  SiteStyleHistoryContext,
  SiteStylePreviewContext,
  useSiteStyle,
} from "../site-style-client";

import { DesignPanel } from "./design-panel";
import {
  StyleRevisionContext,
  useSiteStyleHistory,
} from "./site-style-history";
import { TokensStudio, VariablesTab } from "./site-style-studios";

/** A step as the editor's history is handed it. */
type EditorStep = {
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
};

/** The Design panel inside the editor's style history, as the editor mounts it. */
function Editor({ steps }: { steps: EditorStep[] }): React.JSX.Element {
  const style = useSiteStyleHistory();
  const { connect } = style;
  React.useEffect(() => {
    connect(step => {
      steps.push(step);
      return () => {
        steps.splice(steps.indexOf(step), 1);
      };
    });
    return () => connect(null);
  }, [connect, steps]);
  const [current, choose] = React.useState<string | null>("variables");
  return (
    <SiteStyleHistoryContext.Provider value={style.history}>
      <SiteStylePreviewContext.Provider value={style.preview}>
        <Canvas />
        <StyleRevisionContext.Provider value={style.replay}>
          <DesignPanel
            view={{ current, choose }}
            frame={tabs => (
              <TokensStudio
                merged={{
                  tokens: [
                    {
                      name: "color.brand",
                      kind: "color",
                      values: { light: "#1d2b6b" },
                    },
                  ],
                }}
                supplied={undefined}
                pending={false}
              >
                {tabs}
              </TokensStudio>
            )}
            tabs={{
              variables: () => <VariablesTab />,
              classes: () => <p>Shared styles content</p>,
              fonts: () => <p>Fonts content</p>,
            }}
          />
        </StyleRevisionContext.Provider>
      </SiteStylePreviewContext.Provider>
    </SiteStyleHistoryContext.Provider>
  );
}

/** What the canvas draws Brand's light value as, read as the canvas reads. */
function Canvas(): React.JSX.Element {
  const { siteStyle } = useSiteStyle();
  const brand = siteStyle.tokens?.tokens.find(
    token => token.name === "color.brand"
  );
  // How many sections are drawn over the read, beside what is drawn.
  const previewing = React.useContext(SiteStylePreviewContext).size;
  return (
    <output data-testid="canvas" data-previewing={previewing}>
      {brand?.values.light ?? "none"}
    </output>
  );
}

const canvas = (): string | null => screen.getByTestId("canvas").textContent;
const previewing = (): string | null =>
  screen.getByTestId("canvas").getAttribute("data-previewing");

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

beforeEach(() => {
  stored.data = { tokens: null };
  writes.length = 0;
  single.refuse = undefined;
  single.keepalive = [];
  single.gate = undefined;
  toastError.mockClear();
  tracked.writes = [];
  beforeAction.run = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Open Brand's editor and answer its Light field. */
function openBrand(): HTMLElement {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: /^Brand/ }));
  });
  return screen.getByLabelText("Light");
}

/** Type a value and press Enter, which commits the field. */
function enter(field: HTMLElement, value: string): void {
  act(() => {
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: "Enter" });
  });
}

/** Let what was released answer. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** The Light value of Brand in the last write. */
function lastBrand(): unknown {
  const tokens = writes.at(-1)?.tokens as
    | { tokens: { name: string; values: { light: string } }[] }
    | undefined;
  return tokens?.tokens.find(token => token.name === "color.brand")?.values
    .light;
}

describe("the Design panel's writes", () => {
  it("writes ten edits made without a pause once, as one step of undo", async () => {
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    const field = openBrand();
    for (let n = 0; n < 10; n += 1) {
      enter(field, `#00000${n.toString(16)}`);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
    }
    expect(writes).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
    expect(lastBrand()).toBe("#000009");
    expect(steps).toHaveLength(1);
  });

  it("waits while the author is still typing in a field", async () => {
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000001");
    for (let n = 0; n < 5; n += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      act(() => {
        fireEvent.input(field, { target: { value: `#00000${String(n)}` } });
      });
    }
    expect(writes).toEqual([]);
  });

  it("writes at once when the variable's editor closes", async () => {
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000001");
    // Held while the editor is open.
    expect(writes).toEqual([]);
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(lastBrand()).toBe("#000001");
  });

  it("writes at once when the author changes tab", async () => {
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000002");
    expect(writes).toEqual([]);
    act(() => {
      // Hidden from the tree while the modal editor is open, and still there.
      fireEvent.mouseDown(
        screen.getByRole("tab", { name: "Fonts", hidden: true }),
        { button: 0 }
      );
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(lastBrand()).toBe("#000002");
  });

  it("writes at once when the editor goes away", async () => {
    const { unmount } = render(<Editor steps={[]} />);
    enter(openBrand(), "#000003");
    expect(writes).toEqual([]);
    unmount();
    await settle();
    expect(writes).toHaveLength(1);
    expect(lastBrand()).toBe("#000003");
  });

  it("writes at once, and is waited for, before the page is saved", async () => {
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000004");
    expect(writes).toEqual([]);
    expect(beforeAction.run).toBeTypeOf("function");
    await act(async () => {
      await beforeAction.run?.();
    });
    expect(writes).toHaveLength(1);
    expect(lastBrand()).toBe("#000004");
  });

  it("draws an edit at once, while its write waits for the pause", async () => {
    const steps: EditorStep[] = [];
    const { rerender } = render(<Editor steps={steps} />);
    expect(canvas()).toBe("none");
    enter(openBrand(), "#000006");
    expect(writes).toEqual([]);
    expect(canvas()).toBe("#000006");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
    // Stored, and still drawn until the read moves on.
    expect(canvas()).toBe("#000006");
    // Then the read is what is drawn, whatever it holds.
    stored.data = { tokens: null };
    rerender(<Editor steps={steps} />);
    expect(canvas()).toBe("none");
  });

  it("stops drawing an edit whose write is refused", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000007");
    expect(canvas()).toBe("#000007");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(canvas()).toBe("none");
  });

  it("still says why, when the write made after the pause is refused", async () => {
    single.refuse = "That colour cannot be stored.";
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    enter(openBrand(), "#000005");
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(
      "That colour cannot be stored."
    );
    expect(steps).toEqual([]);
  });
  it("writes at once when the page is hidden, sent so it outlives the page", async () => {
    let visibility: DocumentVisibilityState = "visible";
    const spied = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility);
    try {
      render(<Editor steps={[]} />);
      enter(openBrand(), "#00000b");
      expect(writes).toEqual([]);
      visibility = "hidden";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
      expect(writes).toHaveLength(1);
      expect(lastBrand()).toBe("#00000b");
      expect(single.keepalive).toEqual([true]);
    } finally {
      spied.mockRestore();
    }
  });

  it("writes nothing and keeps no step for an edit changed back within the pause", async () => {
    const brand = {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b" },
    };
    stored.data = { tokens: { tokens: [brand] } };
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    const field = openBrand();
    enter(field, "#00000d");
    expect(steps).toHaveLength(1);
    enter(field, "#1d2b6b");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toEqual([]);
    // Withdrawn, which gives the redo it cut off back to the author.
    expect(steps).toEqual([]);
  });

  it("draws the original value again when a held edit is undone", async () => {
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    enter(openBrand(), "#00000e");
    expect(canvas()).toBe("#00000e");
    await act(async () => {
      await steps[0]?.undo();
    });
    await settle();
    // Written, then taken back; the read has not moved on, and the canvas
    // shows what the section holds again.
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({ tokens: null });
    expect(canvas()).toBe("none");
  });
  it("sends a write released while the page is visible so it outlives the page", async () => {
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000010");
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(single.keepalive).toEqual([true]);
  });

  it("draws the section's stored value when a held edit is undone, then the read alone", async () => {
    stored.data = {
      tokens: {
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
        ],
      },
    };
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    expect(canvas()).toBe("#1d2b6b");
    enter(openBrand(), "#000011");
    expect(canvas()).toBe("#000011");
    await act(async () => {
      await steps[0]?.undo();
    });
    await settle();
    expect(writes).toHaveLength(2);
    expect(canvas()).toBe("#1d2b6b");
    // Stored where the read already holds it, so nothing is drawn over it.
    expect(previewing()).toBe("0");
  });
  it("undoes a held edit whose write is refused quietly, back to the original", async () => {
    stored.data = {
      tokens: {
        tokens: [
          { name: "color.brand", kind: "color", values: { light: "#1d2b6b" } },
        ],
      },
    };
    single.refuse = "That colour cannot be stored.";
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    enter(openBrand(), "#000018");
    let undone: boolean | undefined;
    await act(async () => {
      undone = await steps[0]?.undo();
    });
    await settle();
    // The change was refused, so nothing stands to be undone: the undo is
    // done, with no message saying it could not be.
    expect(undone).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    expect(canvas()).toBe("#1d2b6b");
  });

  /**
   * What Save would come to now: its before-action run, then the entry form's
   * storing gate over the tracked writes, by the gate's contract (pinned in
   * the admin's `DocumentActionsHost.before-and-tracked.test`): it waits for
   * every tracked write, and refuses while any change's latest attempt
   * failed. Answers the refusal, or `undefined` when the page would be saved.
   */
  async function save(): Promise<string | undefined> {
    let refusal: string | undefined;
    await act(async () => {
      await beforeAction.run?.();
      for (let pass = 0; pass < 5; pass += 1) {
        const seen = tracked.writes.length;
        await Promise.allSettled(tracked.writes.map(entry => entry.write));
        if (tracked.writes.length === seen) break;
      }
      const latest = new Map(
        tracked.writes.map(entry => [entry.label, entry.write])
      );
      for (const [label, write] of latest) {
        try {
          await write;
        } catch (error) {
          refusal ??= `${label} wasn't saved, so this page wasn't either: ${(error as Error).message}`;
        }
      }
    });
    return refusal;
  }

  const REFUSED =
    "A change to the site's variables wasn't saved, so this page wasn't either: That colour cannot be stored.";

  it("makes Save wait for a write released earlier that has not answered", async () => {
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000020");
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    expect(writes).toHaveLength(1);
    let saved = false;
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = save().then(() => {
        saved = true;
      });
    });
    await settle();
    expect(saved).toBe(false);
    open();
    await act(async () => {
      await saving;
    });
    expect(saved).toBe(true);
  });

  it("refuses Save when the held edit it writes is refused, and says why", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000021");
    expect(await save()).toBe(REFUSED);
    expect(writes).toHaveLength(1);
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(
      "That colour cannot be stored."
    );
  });

  it("refuses Save for a held edit refused after the pause, before Save", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000022");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
    expect(await save()).toBe(REFUSED);
  });

  it("lets Save go ahead once a later edit of the section is stored", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000023");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    single.refuse = undefined;
    enter(field, "#000024");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(2);
    expect(await save()).toBeUndefined();
  });

  it("lets Save go ahead once the refused edit is undone", async () => {
    single.refuse = "That colour cannot be stored.";
    const steps: EditorStep[] = [];
    render(<Editor steps={steps} />);
    enter(openBrand(), "#000025");
    // Undone while it waits: written first, refused, and taken back.
    await act(async () => {
      await steps[0]?.undo();
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(await save()).toBeUndefined();
  });

  it("makes Save wait, once the editor has closed, for an edit it left held", async () => {
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    const { unmount } = render(<Editor steps={[]} />);
    enter(openBrand(), "#000026");
    expect(writes).toEqual([]);
    // Leaving the builder: the editor goes, and with it its before-action;
    // the form, and its storing gate, stay.
    unmount();
    beforeAction.run = undefined;
    let saved = false;
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = save().then(() => {
        saved = true;
      });
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(saved).toBe(false);
    open();
    await act(async () => {
      await saving;
    });
    expect(saved).toBe(true);
  });

  it("refuses Save, once the editor has closed, for an edit it left that is refused", async () => {
    single.refuse = "That colour cannot be stored.";
    const { unmount } = render(<Editor steps={[]} />);
    enter(openBrand(), "#000027");
    unmount();
    beforeAction.run = undefined;
    expect(await save()).toBe(REFUSED);
  });

  it("tracks a held edit with the form from when it is held until it answers", async () => {
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    render(<Editor steps={[]} />);
    expect(tracked.writes).toEqual([]);
    enter(openBrand(), "#000028");
    // One change, tracked under the section's name while it is held: the
    // form counts it as unsaved work from here, and its gate waits for it.
    expect(tracked.writes.map(entry => entry.label)).toEqual([
      "A change to the site's variables",
    ]);
    let answered = false;
    void tracked.writes[0]?.write.then(() => {
      answered = true;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(answered).toBe(false);
    open();
    await settle();
    expect(answered).toBe(true);
  });
});
