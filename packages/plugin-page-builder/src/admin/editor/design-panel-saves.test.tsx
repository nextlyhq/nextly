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

/** What the editor last reported about unsaved work, by key. */
const unsavedWork = vi.hoisted(() => new Map<string, boolean>());

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

/** What the Single was asked to store, in order. */
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
  // The report the entry form's unsaved-changes guard reads, the one that
  // asks the browser's "Leave site?" on closing or reloading the tab.
  useReportUnsavedWork: (key: string, unsaved: boolean) => {
    unsavedWork.set(key, unsaved);
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
  unsavedWork.clear();
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

  it("makes Save wait for a write released earlier that has not answered", async () => {
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#00000c");
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    // Released when the editor closed, and still on its way.
    expect(writes).toHaveLength(1);
    let saved = false;
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = Promise.resolve(beforeAction.run?.()).then(() => {
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
  it("refuses Save when the held edit it writes is refused, and says why", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000012");
    let refusal: unknown;
    await act(async () => {
      try {
        await beforeAction.run?.();
      } catch (error) {
        refusal = error;
      }
    });
    // Throwing is how a before-action refuses Save and Publish, with its
    // message: the page is not stored with a style that was not.
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe(
      "The page was not saved because a design change was refused: That colour cannot be stored."
    );
    expect(writes).toHaveLength(1);
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(
      "That colour cannot be stored."
    );
  });

  it("refuses Save for a write released earlier that is refused while Save waits", async () => {
    single.refuse = "That colour cannot be stored.";
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000013");
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = Promise.resolve(beforeAction.run?.());
    });
    open();
    await act(async () => {
      await expect(saving).rejects.toThrow(/design change was refused/);
    });
  });
  /** Run Save's before-action and answer with what it threw, if anything. */
  async function save(): Promise<unknown> {
    let refusal: unknown;
    await act(async () => {
      try {
        await beforeAction.run?.();
      } catch (error) {
        refusal = error;
      }
    });
    return refusal;
  }

  it("refuses Save for a held edit refused after the pause, before Save", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    enter(openBrand(), "#000014");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(writes).toHaveLength(1);
    const refusal = await save();
    expect((refusal as Error | undefined)?.message).toBe(
      "The page was not saved because a design change was refused: That colour cannot be stored."
    );
  });

  it("lets Save go ahead once a later edit of the section is stored", async () => {
    single.refuse = "That colour cannot be stored.";
    render(<Editor steps={[]} />);
    const field = openBrand();
    enter(field, "#000015");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    single.refuse = undefined;
    enter(field, "#000016");
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
    enter(openBrand(), "#000017");
    // Undone while it waits: written first, refused, and taken back.
    await act(async () => {
      await steps[0]?.undo();
    });
    await settle();
    expect(writes).toHaveLength(1);
    expect(await save()).toBeUndefined();
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

  it("tells the form there is unsaved work while a style write is held or on its way", async () => {
    let open: () => void = () => {};
    single.gate = new Promise(resolve => {
      open = resolve;
    });
    render(<Editor steps={[]} />);
    const pending = () => [...unsavedWork.values()].some(Boolean);
    expect(pending()).toBe(false);
    const field = openBrand();
    enter(field, "#000019");
    // Held for the pause.
    expect(pending()).toBe(true);
    act(() => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    await settle();
    // Released and on its way.
    expect(writes).toHaveLength(1);
    expect(pending()).toBe(true);
    open();
    await settle();
    expect(pending()).toBe(false);
  });
});
