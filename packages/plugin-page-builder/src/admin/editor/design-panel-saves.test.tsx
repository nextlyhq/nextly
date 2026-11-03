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

vi.mock("@nextlyhq/plugin-sdk/client", () => ({
  useCan: () => true,
}));

const refetch = vi.fn(() => Promise.resolve({ isError: false }));
/** The stored document, one object as a query holds it between reads. */
const stored = vi.hoisted(() => ({ data: { tokens: null } }));
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
/** Whether the Single refuses the next writes, and what it says. */
const single = vi.hoisted(() => ({ refuse: undefined as string | undefined }));
/** What runs before the page's Save and Publish, as the form registers it. */
const beforeAction = vi.hoisted(() => ({
  run: undefined as undefined | (() => unknown),
}));

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useUploadMedia: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePluginClientConfig: () => undefined,
  useUpdateSingleDocument: () => ({
    mutateAsync: async (data: Record<string, unknown>) => {
      writes.push(data);
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
  return <output data-testid="canvas">{brand?.values.light ?? "none"}</output>;
}

const canvas = (): string | null => screen.getByTestId("canvas").textContent;

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
});
