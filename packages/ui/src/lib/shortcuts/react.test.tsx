// @vitest-environment jsdom
/**
 * Precedence has to follow the component tree, because that is the structure a developer already
 * reasons about. These tests pin that the tree — not mount order, not render frequency, not a
 * coordinated set of numbers — decides who owns a key.
 */
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ShortcutProvider,
  ShortcutScope,
  type UseShortcutsOptions,
  useActiveShortcuts,
  useShortcutManager,
  useShortcuts,
} from "./react";
import { resetDevWarnings } from "../dev-warn";
import type { ShortcutBinding, ShortcutManager } from "./manager";

/** Registers one shortcut and renders nothing. */
function Bind({
  keys,
  run,
  options,
  extra,
}: {
  keys: string;
  run: () => void;
  options: UseShortcutsOptions;
  extra?: Partial<ShortcutBinding>;
}): null {
  useShortcuts([{ keys, description: `test ${keys}`, run, ...extra }], options);
  return null;
}

// This package does not unmount between tests, and every surviving provider keeps its own
// listener on `document`. Without this, a keystroke dispatched by one test would still be
// handled by every earlier test's tree, and precedence assertions would be measuring a stack
// nobody built.
afterEach(cleanup);

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    })
  );
}

describe("ShortcutProvider", () => {
  it("installs one listener that reaches a shortcut anywhere beneath it", () => {
    const run = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <Bind keys="mod+s" run={run} options={{ name: "shell" }} />
      </ShortcutProvider>
    );
    press("s", { ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("removes the exact listener it added when it unmounts", () => {
    // Observing this through a shortcut that stops firing would prove nothing: unmounting also
    // disposes the layer, so the handler would go quiet even with the listener still attached.
    // The leak is only visible at the target itself.
    //
    // The identity check is the point. Removing a listener means removing THAT function; a
    // cleanup that rebuilt the closure would call `removeEventListener` on a stranger, leave the
    // original attached, and look completely correct in a call-count assertion.
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const { unmount } = render(
      <ShortcutProvider isApple={false} target={target}>
        <Bind keys="Escape" run={vi.fn()} options={{ name: "shell" }} />
      </ShortcutProvider>
    );
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    const [, added] = target.addEventListener.mock.calls[0] as [
      string,
      EventListener,
    ];

    unmount();
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", added);
  });
});

describe("precedence from the tree", () => {
  it("gives a nested scope the key over the shell that contains it", () => {
    const shell = vi.fn();
    const canvas = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={shell} options={{ name: "shell" }} />
        <ShortcutScope>
          <Bind keys="Escape" run={canvas} options={{ name: "canvas" }} />
        </ShortcutScope>
      </ShortcutProvider>
    );
    press("Escape");
    expect(canvas).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
  });

  it("does not depend on which component mounted first", () => {
    // The same two layers, written in the opposite order. Mount order is what the old
    // arrangement of independent listeners was accidentally governed by; if it still decided
    // anything, this pair of tests would disagree.
    const shell = vi.fn();
    const canvas = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <ShortcutScope>
          <Bind keys="Escape" run={canvas} options={{ name: "canvas" }} />
        </ShortcutScope>
        <Bind keys="Escape" run={shell} options={{ name: "shell" }} />
      </ShortcutProvider>
    );
    press("Escape");
    expect(canvas).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
  });
});

describe("priority outranks depth", () => {
  // Depth alone cannot express a modal: the HOST decides how deeply its own shortcuts are
  // scoped, so any depth a modal picks can be tied by a host scope at the same level or beaten
  // by one nested further — and a matching binding runs before a lower blocker is consulted.
  it("a prioritised blocker stops a binding nested deeper than itself", () => {
    const hostRan = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <ShortcutScope>
          <Bind
            keys="f6"
            run={() => {}}
            options={{ name: "modal", blocking: true, priority: 1 }}
          />
        </ShortcutScope>
        {/* Deeper than the modal, and registered after it. Without priority this wins. */}
        <ShortcutScope>
          <ShortcutScope>
            <Bind keys="mod+b" run={hostRan} options={{ name: "host" }} />
          </ShortcutScope>
        </ShortcutScope>
      </ShortcutProvider>
    );

    press("b", { ctrlKey: true });

    expect(hostRan).not.toHaveBeenCalled();
  });

  it("leaves ordinary layers ordered by depth when nobody sets it", () => {
    // The positive control for the test above: without a priority the deeper host binding DOES
    // run, so the assertion there is about priority rather than about the fixture.
    const hostRan = vi.fn();
    render(
      <ShortcutProvider isApple={false}>
        <ShortcutScope>
          <Bind
            keys="f6"
            run={() => {}}
            options={{ name: "modal", blocking: true }}
          />
        </ShortcutScope>
        <ShortcutScope>
          <ShortcutScope>
            <Bind keys="mod+b" run={hostRan} options={{ name: "host" }} />
          </ShortcutScope>
        </ShortcutScope>
      </ShortcutProvider>
    );

    press("b", { ctrlKey: true });

    expect(hostRan).toHaveBeenCalledTimes(1);
  });
});

describe("a blocking scope", () => {
  // The measured defect: pressing Escape during a drag cancelled the drag AND navigated out of
  // the editor, because the shell's binding and the canvas's binding were separate listeners
  // and both ran.

  function Editor({ dragging }: { dragging: boolean }) {
    const navigateAway = Editor.navigateAway;
    const cancelDrag = Editor.cancelDrag;
    const save = Editor.save;
    return (
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={navigateAway} options={{ name: "shell" }} />
        <Bind keys="mod+s" run={save} options={{ name: "shell-save" }} />
        <ShortcutScope>
          <Bind
            keys="Escape"
            run={cancelDrag}
            options={{ name: "drag", enabled: dragging, blocking: true }}
          />
        </ShortcutScope>
      </ShortcutProvider>
    );
  }
  Editor.navigateAway = vi.fn();
  Editor.cancelDrag = vi.fn();
  Editor.save = vi.fn();

  it("cancels the drag without also navigating away", () => {
    Editor.navigateAway.mockClear();
    Editor.cancelDrag.mockClear();
    render(<Editor dragging />);
    press("Escape");
    expect(Editor.cancelDrag).toHaveBeenCalledTimes(1);
    expect(Editor.navigateAway).not.toHaveBeenCalled();
  });

  it("holds every other shortcut for the duration of the drag", () => {
    Editor.save.mockClear();
    render(<Editor dragging />);
    press("s", { ctrlKey: true });
    expect(Editor.save).not.toHaveBeenCalled();
  });

  it("returns the keyboard to the shell once the drag ends", () => {
    // The positive control for both tests above, and the property that matters most in practice:
    // a blocking layer that forgot to stand down would leave the editor permanently deaf.
    Editor.save.mockClear();
    Editor.navigateAway.mockClear();
    render(<Editor dragging={false} />);
    press("s", { ctrlKey: true });
    press("Escape");
    expect(Editor.save).toHaveBeenCalledTimes(1);
    expect(Editor.navigateAway).toHaveBeenCalledTimes(1);
  });
});

describe("re-rendering", () => {
  it("runs the newest handler rather than the one captured at mount", () => {
    // Bindings close over render state. A registration that kept its first closure would act on
    // values the user changed several renders ago, which is the classic stale-closure bug and
    // invisible until the wrong thing is saved.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={first} options={{ name: "shell" }} />
      </ShortcutProvider>
    );
    rerender(
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={second} options={{ name: "shell" }} />
      </ShortcutProvider>
    );
    press("Escape");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("does not let one component's render rate change who owns a key", () => {
    // Equal-depth precedence goes to the more recent registration. If new bindings re-registered
    // the layer instead of updating it in place, whichever component rendered most often would
    // drift to the top — precedence following render frequency, which nobody would ever debug.
    //
    // Re-rendering the WHOLE tree would not show this: both layers would re-register in the same
    // order and their relative position would survive. Only one component re-rendering does.
    const busy = vi.fn();
    const settled = vi.fn();

    function Busy(): null {
      const [renders, setRenders] = React.useState(0);
      React.useEffect(() => {
        if (renders < 3) setRenders(renders + 1);
      }, [renders]);
      useShortcuts([{ keys: "Escape", description: "busy", run: busy }], {
        name: "busy",
      });
      return null;
    }

    render(
      <ShortcutProvider isApple={false}>
        <Busy />
        <Bind keys="Escape" run={settled} options={{ name: "settled" }} />
      </ShortcutProvider>
    );

    press("Escape");
    expect(settled).toHaveBeenCalledTimes(1);
    expect(busy).not.toHaveBeenCalled();
  });

  it("removes a layer when its component unmounts", () => {
    const dialog = vi.fn();
    const shell = vi.fn();
    const tree = (open: boolean) => (
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={shell} options={{ name: "shell" }} />
        {open ? (
          <ShortcutScope>
            <Bind keys="Escape" run={dialog} options={{ name: "dialog" }} />
          </ShortcutScope>
        ) : null}
      </ShortcutProvider>
    );
    const { rerender } = render(tree(true));
    press("Escape");
    expect(dialog).toHaveBeenCalledTimes(1);

    rerender(tree(false));
    press("Escape");
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(shell).toHaveBeenCalledTimes(1);
  });
});

describe("misuse", () => {
  it("says so when a shortcut is registered outside a provider", () => {
    // Silence here would be the worst outcome: the shortcut simply never fires, and there is
    // nothing in the DOM to inspect that would explain why.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() =>
        render(
          <Bind keys="Escape" run={vi.fn()} options={{ name: "orphan" }} />
        )
      ).toThrow(/ShortcutProvider/);
    } finally {
      error.mockRestore();
    }
  });
});

describe("a provider nested inside another", () => {
  it("runs a binding once, not once per provider", () => {
    // Two providers on the same target is the very bug this module exists to remove: two
    // listeners on one node, where stopPropagation cannot suppress a sibling, so both run their
    // binding for the same key.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run }], {
        name: "inner",
      });
      return null;
    }

    const view = render(
      <ShortcutProvider isApple={false}>
        <ShortcutProvider isApple={false}>
          <Keys />
        </ShortcutProvider>
      </ShortcutProvider>
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    view.unmount();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("says nothing when the inner provider agrees with the outer one", () => {
    // A component that owns keys and can be rendered standalone has to bring a provider with it,
    // or it throws wherever no shell wrapped it. That composition costs nothing — the target's
    // manager is reused — so warning about it trains people to ignore the warning that matters.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();

    const view = render(
      <ShortcutProvider isApple={false}>
        <ShortcutProvider isApple={false}>
          <Bind keys="Escape" run={vi.fn()} options={{ name: "inner" }} />
        </ShortcutProvider>
      </ShortcutProvider>
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    view.unmount();

    expect(said).toBe("");
  });

  it("reports options that disagree between DETACHED providers too", () => {
    // The per-target registry is a WeakMap keyed by the target, and `null` is not a key — so two
    // nested providers that attach nothing have no entry to compare against. They still share a
    // manager, and the inner one's options are still ignored, so the case that loses something
    // has to be caught through the parent instead.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();

    const view = render(
      <ShortcutProvider isApple={false} target={null}>
        <ShortcutProvider isApple target={null}>
          <span />
        </ShortcutProvider>
      </ShortcutProvider>
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    view.unmount();

    expect(said).toContain("different options");
  });

  it("says nothing when two detached providers agree", () => {
    // The control: a self-contained component nesting inside a host that also attaches nothing is
    // the supported composition, and must stay silent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();

    const view = render(
      <ShortcutProvider isApple={false} target={null}>
        <ShortcutProvider isApple={false} target={null}>
          <Bind keys="Escape" run={vi.fn()} options={{ name: "inner" }} />
        </ShortcutProvider>
      </ShortcutProvider>
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    view.unmount();

    expect(said).toBe("");
  });

  it("still reports options that disagree", () => {
    // The control, and the case that genuinely loses something: the inner options ARE ignored,
    // so someone would otherwise be left wondering why they had no effect.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();

    const view = render(
      <ShortcutProvider isApple={false}>
        <ShortcutProvider isApple>
          <span />
        </ShortcutProvider>
      </ShortcutProvider>
    );
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    view.unmount();

    expect(said).toContain("different options");
  });
});

describe("a nested provider that attaches a second listener", () => {
  it("runs an allowed-default binding once, not twice", () => {
    // The stricter version of the test above. When the binding preventDefaults, a second
    // listener is harmless by accident: the manager stands down on an already-claimed event. A
    // binding that asks NOT to preventDefault removes that accident, and a second listener then
    // runs the callback a second time for one keystroke.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts(
        [
          {
            keys: "mod+k",
            description: "Open",
            run,
            preventDefault: false,
          },
        ],
        { name: "inner" }
      );
      return null;
    }

    const view = render(
      <ShortcutProvider isApple={false}>
        <ShortcutProvider isApple={false}>
          <Keys />
        </ShortcutProvider>
      </ShortcutProvider>
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    view.unmount();

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("two providers naming the same target differently", () => {
  it("still installs one listener when both pass document explicitly", () => {
    // `undefined` and an explicit `document` name the same node, so comparing the PROPS called
    // these two providers different while both attached a listener to it.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts(
        [{ keys: "mod+k", description: "Open", run, preventDefault: false }],
        { name: "inner" }
      );
      return null;
    }

    const view = render(
      <ShortcutProvider isApple={false} target={document}>
        <Keys />
        <ShortcutProvider isApple={false} target={document}>
          <Keys />
        </ShortcutProvider>
      </ShortcutProvider>
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    view.unmount();

    // One binding runs, not one per provider. Bindings on BOTH sides of the boundary is what
    // makes this observable: with two managers each holding one of them, both listeners match
    // and precedence between them means nothing, because neither can see the other's layers.
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("providers that are siblings rather than nested", () => {
  it("shares one listener between two independent subtrees", () => {
    // Neither has a shortcut ancestor, so a context check sees nothing and both would attach.
    // Ownership is a property of the TARGET, not of the React tree.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts(
        [{ keys: "mod+k", description: "Open", run, preventDefault: false }],
        { name: "keys" }
      );
      return null;
    }

    const first = render(
      <ShortcutProvider isApple={false}>
        <Keys />
      </ShortcutProvider>
    );
    const second = render(
      <ShortcutProvider isApple={false}>
        <Keys />
      </ShortcutProvider>
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    first.unmount();
    second.unmount();

    // Two layers, one manager, one listener: the deeper-registered layer wins and runs once.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps listening while any provider remains, and stops when the last leaves", () => {
    // The reference count is the part that makes sharing safe: the first provider to unmount
    // must not remove the listener the second is still relying on.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+j", description: "Go", run }], { name: "k" });
      return null;
    }

    const first = render(<ShortcutProvider isApple={false} />);
    const second = render(
      <ShortcutProvider isApple={false}>
        <Keys />
      </ShortcutProvider>
    );
    first.unmount();

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(run).toHaveBeenCalledTimes(1);

    second.unmount();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "j",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("under Strict Mode", () => {
  it("still has a listener after React replays the effect", () => {
    // Strict Mode runs setup, cleanup, setup in development. A cleanup that removed the shared
    // registry entry left the replayed setup with nothing to find, so nothing reattached and
    // every shortcut was dead for the rest of the mount — in development only, which is the
    // worst place for it to hide.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run }], {
        name: "shell",
      });
      return null;
    }

    const view = render(
      <React.StrictMode>
        <ShortcutProvider isApple={false}>
          <Keys />
        </ShortcutProvider>
      </React.StrictMode>
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    view.unmount();

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a provider mounting after the last one left", () => {
  it("uses its own options rather than the departed provider's", () => {
    // The owner kept for Strict Mode is a shell once its providers have gone. Adopting its
    // manager would silently give the new provider someone else's platform, so `mod` would mean
    // Control for a provider that asked for Command.
    const run = vi.fn();

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run }], {
        name: "shell",
      });
      return null;
    }

    const first = render(
      <ShortcutProvider isApple={false}>
        <Keys />
      </ShortcutProvider>
    );
    first.unmount();

    const second = render(
      <ShortcutProvider isApple={true}>
        <Keys />
      </ShortcutProvider>
    );
    // Command, because THIS provider said so.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    second.unmount();

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a provider that leaves a target its sibling still uses", () => {
  it("does not carry the shared manager to the new target", () => {
    // The provider that created the owner may move to another document while a sibling is still
    // using its manager. Registering one manager for two targets would let either tree's
    // shortcuts fire on either document.
    const onDocument = vi.fn();
    const onFrame = vi.fn();

    function Keys({ run }: { run: () => void }): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run }], {
        name: "keys",
      });
      return null;
    }

    const frame = document.createElement("iframe");
    document.body.append(frame);
    const inner = frame.contentDocument;
    if (!inner) throw new Error("iframe document unavailable");

    // The provider that MOVES has to be the one that created the owner, because the manager it
    // would wrongly carry away is its own — the sibling merely adopted it. Rendering these the
    // other way round exercises nothing.
    const moving = render(
      <ShortcutProvider isApple={false}>
        <Keys run={onFrame} />
      </ShortcutProvider>
    );
    const staying = render(
      <ShortcutProvider isApple={false}>
        <Keys run={onDocument} />
      </ShortcutProvider>
    );
    // The second provider moves to the iframe's document, taking its own bindings with it.
    moving.rerender(
      <ShortcutProvider isApple={false} target={inner}>
        <Keys run={onFrame} />
      </ShortcutProvider>
    );

    // Dispatched on the IFRAME, which is the direction that shows the aliasing: one manager
    // attached to both documents would run the binding belonging to the tree that stayed behind.
    const view = inner.defaultView ?? window;
    inner.body.dispatchEvent(
      new view.KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );

    staying.unmount();
    moving.unmount();
    frame.remove();

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onDocument).not.toHaveBeenCalled();
  });
});

describe("sibling providers mounted in one render", () => {
  it("keeps both subtrees' shortcuts working", () => {
    // Both render before either effect runs, so the entry the first reserved still has no
    // providers. Treating that as a shell let the second replace it, and the first subtree's
    // bindings stayed on a manager that was never attached.
    const first = vi.fn();
    const second = vi.fn();

    function Keys({
      keys,
      run,
    }: {
      keys: string;
      run: () => void;
    }): React.JSX.Element | null {
      useShortcuts([{ keys, description: "x", run }], { name: keys });
      return null;
    }

    const view = render(
      <>
        <ShortcutProvider isApple={false}>
          <Keys keys="mod+k" run={first} />
        </ShortcutProvider>
        <ShortcutProvider isApple={false}>
          <Keys keys="mod+j" run={second} />
        </ShortcutProvider>
      </>
    );

    for (const key of ["k", "j"]) {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    view.unmount();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("the first interactive frame", () => {
  it("is already listening when a child effect dispatches a key", () => {
    // Layers register in layout effects; the listener was installed in a PASSIVE one. A child's
    // effects run before its parent's, so a keystroke dispatched from a child effect arrived
    // while the provider was mounted and its layers registered, but nothing was listening yet.
    const run = vi.fn();

    function DispatchOnMount(): null {
      React.useEffect(() => {
        press("Escape");
      }, []);
      return null;
    }

    render(
      <ShortcutProvider isApple={false}>
        <Bind keys="Escape" run={run} options={{ name: "shell" }} />
        <DispatchOnMount />
      </ShortcutProvider>
    );

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("a component that both registers shortcuts and lists them", () => {
  it("settles instead of re-rendering without end", () => {
    // `useShortcuts` updates its layer after EVERY render, because the bindings close over
    // render-scoped values. Notifying subscribers unconditionally therefore invalidated the
    // snapshot `useActiveShortcuts` reads, which re-rendered the component, which updated the
    // layer again — until React stopped it with "Maximum update depth exceeded". A shortcuts
    // help dialog that binds Escape is exactly this shape.
    let renders = 0;

    function HelpPanel(): React.JSX.Element {
      renders++;
      useShortcuts([{ keys: "Escape", description: "Close", run: () => {} }], {
        name: "help",
      });
      return <span>{useActiveShortcuts().length}</span>;
    }

    const view = render(
      <ShortcutProvider>
        <HelpPanel />
      </ShortcutProvider>
    );

    // The control: it settles having actually SEEN its own binding, so this is not passing
    // because the panel rendered once and read an empty stack.
    expect(view.container.textContent).toBe("1");
    expect(renders).toBeLessThan(10);
  });
});

describe("providers that attach nothing", () => {
  it("shares one manager between nested detached providers", () => {
    // Two explicit `null` targets describe the SAME event stream: the one the host drives through
    // `handle()`. An inner provider building its own manager means the host never sees the
    // bindings beneath it.
    const run = vi.fn();
    const managerRef: { current: ShortcutManager | null } = { current: null };

    function Capture(): React.JSX.Element | null {
      managerRef.current = useShortcutManager();
      return null;
    }

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run }], {
        name: "inner",
      });
      return null;
    }

    const view = render(
      <ShortcutProvider isApple={false} target={null}>
        <Capture />
        <ShortcutProvider isApple={false} target={null}>
          <Keys />
        </ShortcutProvider>
      </ShortcutProvider>
    );

    // Driven through the OUTER manager, as a host in this mode would.
    managerRef.current?.handle(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        cancelable: true,
      })
    );
    view.unmount();

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("options that cannot both be honoured", () => {
  it("says so rather than silently using the first provider's", () => {
    // Managers are shared per target, so the second provider's options are ignored. The symptom
    // is `mod` meaning the wrong key with nothing to point at, so the situation is reported.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resetDevWarnings();

    const first = render(<ShortcutProvider isApple={false} />);
    const second = render(<ShortcutProvider isApple={true} />);
    const said = warn.mock.calls.map(c => String(c[0])).join(" ");
    warn.mockRestore();
    first.unmount();
    second.unmount();

    expect(said).toContain("different options");
  });
});

describe("a help panel mounted with the shortcuts it lists", () => {
  it("shows them, rather than the empty list it would read first", () => {
    // The panel mounts alongside the components that register, so a one-time read runs before
    // their effects and returns nothing — with no later render to correct it.
    function Panel(): React.JSX.Element {
      const active = useActiveShortcuts();
      return (
        <ul data-testid="panel">
          {active.map(a => (
            <li key={a.keys}>{a.keys}</li>
          ))}
        </ul>
      );
    }

    function Keys(): React.JSX.Element | null {
      useShortcuts([{ keys: "mod+k", description: "Open", run: vi.fn() }], {
        name: "shell",
      });
      return null;
    }

    const view = render(
      <ShortcutProvider isApple={false} target={null}>
        <Panel />
        <Keys />
      </ShortcutProvider>
    );
    const panel = view.getByTestId("panel");
    view.unmount();

    expect(panel.textContent).toContain("mod+k");
  });
});
