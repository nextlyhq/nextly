// The guard that stops a dirty editor being navigated away from.
//
// It had never been mounted — present since the initial commit, exported
// through a barrel nothing imported — so nothing here is a regression test for
// behaviour that once worked. These pin the contract now that it is live, and
// the ones that matter most are the NEGATIVE cases: a guard that fires on a
// clean form is worse than no guard, because it gets removed.
import userEvent from "@testing-library/user-event";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  onTestFinished,
} from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";
import {
  clearDocumentViews,
  registerDocumentViews,
} from "@admin/lib/plugins/document-view-registry";

import {
  UnsavedChangesGuard,
  useLeaveWithoutWarning,
} from "../UnsavedChangesGuard";

/** Navigates to a NAMED destination, for tests that need two of them. */
function GoTo({ path, label }: { path: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.history.pushState(null, "", path)}
    >
      {label}
    </button>
  );
}

/** Navigates the way the admin's own router does — by pushing history. */
function GoElsewhere() {
  return (
    <button
      type="button"
      onClick={() =>
        window.history.pushState(null, "", "/admin/somewhere-else")
      }
    >
      go
    </button>
  );
}

/** A control that has already asked the question itself. */
function DeliberateLeave() {
  const leaveWithoutWarning = useLeaveWithoutWarning();
  return (
    <button
      type="button"
      onClick={() => {
        leaveWithoutWarning();
        window.history.pushState(null, "", "/admin/somewhere-else");
      }}
    >
      discard and go
    </button>
  );
}

const START = "/admin/collections/posts/1";

/*
 * Waits for a browser traversal. Added before this file's imports, so before
 * the guard's own listener, which is registered when its module loads: a held
 * Back is kept from every listener after the guard's, and a waiter added later
 * would wait for an event it can never receive.
 */
const popstateWaiter = vi.hoisted(() => {
  const waiter: { heard: (() => void) | undefined } = { heard: undefined };
  window.addEventListener("popstate", () => waiter.heard?.(), {
    capture: true,
  });
  return waiter;
});
afterEach(() => {
  popstateWaiter.heard = undefined;
});

/**
 * A browser traversal, awaited until `events` `popstate`s have fired: two for
 * a move the guard holds and undoes by traversing back, since the undoing one
 * can fire before a second wait could begin.
 */
async function traverse(step: () => void, events = 1): Promise<void> {
  await act(async () => {
    let left = events;
    const heard = new Promise<void>(resolve => {
      popstateWaiter.heard = () => {
        left -= 1;
        if (left > 0) return;
        popstateWaiter.heard = undefined;
        resolve();
      };
    });
    step();
    await heard;
  });
}

describe("UnsavedChangesGuard", () => {
  beforeEach(() => {
    window.history.pushState(null, "", START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a clean editor leave without a word", async () => {
    // The case that decides whether this guard survives contact with users.
    render(
      <UnsavedChangesGuard isDirty={false}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("stops a dirty editor and asks", async () => {
    render(
      <UnsavedChangesGuard isDirty>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    // Blocked: the URL must not have moved, or the work is already gone and
    // the dialog is asking about something that already happened.
    expect(window.location.pathname).toBe(START);
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("keeps the editor in place when the author chooses to stay", async () => {
    render(
      <UnsavedChangesGuard isDirty>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(window.location.pathname).toBe(START);
  });

  it("says so when the author refuses to leave", async () => {
    // The counterpart to `onDiscard`. A caller that recorded an intent
    // alongside the navigation — "switch language AND fill it from this one" —
    // has to learn the navigation did not happen, or the intent outlives the
    // refusal and fires when that destination is reached by some other route.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe(START);
  });

  it("says so when the author dismisses the question rather than answering it", async () => {
    // Escape is a refusal too. Wiring only the button would leave the intent
    // alive for anyone who closes the dialog the other way — which is the more
    // common gesture, not the rarer one.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await screen.findByRole("button", { name: /keep editing/i });
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not report a refusal when the author confirmed", async () => {
    // The separating case: `onCancel` must not fire on the path that DID
    // navigate, or the intent is dropped exactly when it should be honoured.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /discard/i })
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("still reports a refusal on the SECOND prompt, after a confirmed one", async () => {
    // The guard stays mounted across a confirmed navigation — approving a
    // dirty `?translate=` change keeps the same editor on screen — so whatever
    // records "this close was confirmed" has to be spent by that close and not
    // outlive it.
    //
    // It is easy to get wrong because the dialog is CONTROLLED: Radix reports
    // the close the author caused but never reports the reopen, so a flag
    // cleared on open is never cleared at all. The second "Keep Editing" then
    // takes the confirmed path — no `cancelLeave`, no `onCancel`, and the
    // dialog left on screen with no way out.
    const onCancel = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onCancel={onCancel}>
        {/* Two DIFFERENT destinations. Pushing the same path twice is not a
            second navigation, so the guard would never ask again and the test
            would pass without exercising anything. */}
        <GoTo path="/admin/first" label="first" />
        <GoTo path="/admin/second" label="second" />
      </UnsavedChangesGuard>
    );

    await userEvent.click(screen.getByRole("button", { name: "first" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /discard/i })
    );
    expect(onCancel).not.toHaveBeenCalled();

    // Two deliberate windows sit between the attempts, and the second click has
    // to clear BOTH or it is being ignored rather than answered:
    //   - `confirmLeave` suppresses re-interception for 100ms, so the
    //     navigation it just released is not caught by its own guard;
    //   - the interceptor will not re-show the dialog within 500ms of the last
    //     one (`lastDialogShownAt`), which stops a burst of pushes producing a
    //     stack of prompts.
    await new Promise(resolve => setTimeout(resolve, 600));

    // Same mounted guard, a second attempt, refused this time.
    await userEvent.click(screen.getByRole("button", { name: "second" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("completes the navigation the author confirmed", async () => {
    const onDiscard = vi.fn();
    render(
      <UnsavedChangesGuard isDirty onDiscard={onDiscard}>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /discard/i })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(onDiscard).toHaveBeenCalled();
  });

  it("does not ask again when the action already did", async () => {
    // "Discard changes" IS the answer to this dialog's question. Asking it
    // again reads as a warning rather than as the confirmation just given.
    render(
      <UnsavedChangesGuard isDirty>
        <DeliberateLeave />
      </UnsavedChangesGuard>
    );
    await userEvent.click(
      screen.getByRole("button", { name: "discard and go" })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("treats a change of QUERY as leaving, because here it is", async () => {
    // The editor addresses its content language as `?locale=`, and switching
    // language refetches the document and discards unsaved edits exactly as
    // leaving the page would. Comparing paths alone read that as "same place,
    // let it through", and the work went without anything asking.
    function SwitchLanguage() {
      return (
        <button
          type="button"
          onClick={() =>
            window.history.pushState(null, "", `${START}?locale=de`)
          }
        >
          switch
        </button>
      );
    }
    render(
      <UnsavedChangesGuard isDirty>
        <SwitchLanguage />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "switch" }));
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("lets a hash through, because it moves within the page rather than off it", async () => {
    function JumpToSection() {
      return (
        <button
          type="button"
          onClick={() => window.history.pushState(null, "", `${START}#fields`)}
        >
          jump
        </button>
      );
    }
    render(
      <UnsavedChangesGuard isDirty>
        <JumpToSection />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "jump" }));
    expect(window.location.hash).toBe("#fields");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("withholds nothing while disabled, so a submit in flight can navigate", async () => {
    render(
      <UnsavedChangesGuard isDirty disabled>
        <GoElsewhere />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    expect(window.location.pathname).toBe("/admin/somewhere-else");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("moving between a document and its own views", () => {
  // A view is an address the admin registered, not any third segment: the
  // registry answers which paths are views, as it does for the router.
  beforeEach(() => {
    registerDocumentViews([
      { fieldType: "blocks", path: "builder", component: "@acme/pb#View" },
    ]);
  });
  afterEach(() => {
    clearDocumentViews();
  });

  // The document's own fields: two of the type the view is offered on.
  const pageFields = [
    { name: "hero", type: "blocks" },
    { name: "body", type: "blocks" },
  ];

  /** Starts dirty at `from`, moves to `to`, and says whether it was asked. */
  async function moveDirty(
    from: string,
    to: string,
    fields: readonly object[] = pageFields
  ): Promise<boolean> {
    window.history.pushState(null, "", from);
    render(
      <UnsavedChangesGuard isDirty fields={fields}>
        <GoTo path={to} label="move" />
      </UnsavedChangesGuard>
    );
    await userEvent.click(screen.getByRole("button", { name: "move" }));
    return screen.queryByRole("alertdialog") !== null;
  }

  it.each([
    [
      "an entry into its view",
      "/admin/collections/pages/1",
      "/admin/collections/pages/1/builder?field=body",
    ],
    [
      "a view back to its entry",
      "/admin/collections/pages/1/builder",
      "/admin/collections/pages/1",
    ],
    [
      "a Single into its view",
      "/admin/singles/home",
      "/admin/singles/home/builder",
    ],
    [
      "one field of a view to another",
      "/admin/collections/pages/1/builder?field=hero",
      "/admin/collections/pages/1/builder?field=body",
    ],
    // History opens beside the document, with the form still mounted.
    [
      "an entry into its history beside it",
      "/admin/collections/pages/1",
      "/admin/collections/pages/1?history=1",
    ],
    [
      "one version of the history to another",
      "/admin/collections/pages/1?history=1&version=2",
      "/admin/collections/pages/1?history=1&version=3",
    ],
    [
      "a Single into a version in its history",
      "/admin/singles/home",
      "/admin/singles/home?history=1&version=4",
    ],
  ])("stays, without asking, from %s", async (_case, from, to) => {
    // The same page answers both addresses and keeps the same form mounted,
    // so nothing unsaved is left behind.
    expect(await moveDirty(from, to)).toBe(false);
    expect(`${window.location.pathname}${window.location.search}`).toBe(to);
  });

  it.each([
    [
      "another entry's view",
      "/admin/collections/pages/1",
      "/admin/collections/pages/2/builder",
    ],
    [
      "another collection's view",
      "/admin/collections/pages/1",
      "/admin/collections/posts/1/builder",
    ],
    [
      "the document's history, which is another page",
      "/admin/collections/pages/1",
      "/admin/collections/pages/1/versions",
    ],
    [
      "a view in another language",
      "/admin/collections/pages/1/builder",
      "/admin/collections/pages/1/builder?locale=de",
    ],
    [
      // Nothing answers it, so the page that does unmounts the form.
      "a mistyped view",
      "/admin/collections/pages/1",
      "/admin/collections/pages/1/buidler",
    ],
  ])("still asks before moving to %s", async (_case, from, to) => {
    expect(await moveDirty(from, to)).toBe(true);
    expect(window.location.pathname).toBe(from.split("?")[0]);
  });

  it("still asks before moving to a view offered on a field type the document lacks", async () => {
    // Registered, but this document has no top-level field of its type, so the
    // page answers not found there and the form unmounts. The control is the
    // first "stays" case: the same move on a document that has the field.
    expect(
      await moveDirty(
        "/admin/collections/pages/1",
        "/admin/collections/pages/1/builder",
        [{ name: "title", type: "text" }]
      )
    ).toBe(true);
    expect(window.location.pathname).toBe("/admin/collections/pages/1");
  });

  /**
   * Arrives at `to` by way of `from`, dirty, then presses Back, and says
   * whether it was asked.
   */
  async function backDirty(from: string, to: string): Promise<boolean> {
    window.history.pushState(null, "", from);
    window.history.pushState(null, "", to);
    render(
      <UnsavedChangesGuard isDirty fields={pageFields}>
        <span />
      </UnsavedChangesGuard>
    );
    await traverse(() => window.history.back());
    return screen.queryByRole("alertdialog") !== null;
  }

  it("stays, without asking, on Back from a view to its own document", async () => {
    expect(
      await backDirty(
        "/admin/collections/pages/1",
        "/admin/collections/pages/1/builder"
      )
    ).toBe(false);
    expect(window.location.pathname).toBe("/admin/collections/pages/1");
  });

  it("still asks on Back to another document", async () => {
    // The control: an exemption that let every Back through passes the case
    // above.
    expect(
      await backDirty(
        "/admin/collections/pages/2",
        "/admin/collections/pages/1/builder"
      )
    ).toBe(true);
  });
});

describe("Back and Forward with unsaved changes", () => {
  const BEFORE = "/admin/collections/posts";
  const AFTER = "/admin/collections/posts/2";

  /**
   * The admin's router, as far as this guard meets it: it hears `popstate`
   * in the ordinary bubbling phase, having been mounted long before any page.
   */
  function routerHears(): string[] {
    const heard: string[] = [];
    const listener = () => heard.push(window.location.pathname);
    window.addEventListener("popstate", listener);
    onTestFinished(() => window.removeEventListener("popstate", listener));
    return heard;
  }

  function dirtyEditorAfter(...visited: string[]) {
    for (const path of visited) window.history.pushState(null, "", path);
    window.history.pushState(null, "", START);
    render(
      <UnsavedChangesGuard isDirty>
        <span />
      </UnsavedChangesGuard>
    );
  }

  it("holds Back on the editor while it asks, out of the router's hearing", async () => {
    const heard = routerHears();
    dirtyEditorAfter(BEFORE);
    await traverse(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    // Still on the editor, and the router drew nothing: the work is there to
    // be asked about.
    expect(window.location.pathname).toBe(START);
    expect(heard).toEqual([]);
  });

  it("holds Back before a router that was listening first can draw the next page", async () => {
    // 🔴 The browser defect. In Chromium a `popstate` on `window` reaches its
    // listeners in the order they were added, the capture flag
    // notwithstanding, and the host's router (Next.js's) is added when the
    // app mounts, long before any page. During `popstate` React renders
    // synchronously, so the router drew the page Back was going to and
    // unmounted this one -- its guard's listener with it -- before the guard
    // was ever asked. Modelled here by a listener added before the guard
    // mounts that unmounts the guarded page at once.
    window.history.pushState(null, "", BEFORE);
    window.history.pushState(null, "", START);
    const heard: string[] = [];
    let view: ReturnType<typeof render> | undefined;
    const router = () => {
      heard.push(window.location.pathname);
      view?.unmount();
    };
    window.addEventListener("popstate", router, { capture: true });
    onTestFinished(() =>
      window.removeEventListener("popstate", router, { capture: true })
    );
    view = render(
      <UnsavedChangesGuard isDirty>
        <span />
      </UnsavedChangesGuard>
    );

    await traverse(() => window.history.back());

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(window.location.pathname).toBe(START);
    expect(heard).toEqual([]);
  });

  it("leaves to where Back was going when the author confirms", async () => {
    // 🔴 The separating case. Confirming once told the router to re-read an
    // address that had already been put back, so the author confirmed
    // leaving, lost their changes, and stayed on the editor.
    const heard = routerHears();
    dirtyEditorAfter(BEFORE);
    await traverse(() => window.history.back());
    await traverse(() =>
      screen.getByRole("button", { name: /discard/i }).click()
    );
    expect(window.location.pathname).toBe(BEFORE);
    expect(heard).toEqual([BEFORE]);
  });

  it("stays on the editor, with nothing moved, when the author keeps editing", async () => {
    const heard = routerHears();
    dirtyEditorAfter(BEFORE);
    await traverse(() => window.history.back());
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(window.location.pathname).toBe(START);
    expect(heard).toEqual([]);
  });

  it("withholds a traversal from other listeners only while it is held", async () => {
    // Any other `popstate` listener -- analytics, a plugin -- hears it as the
    // router does. The guard keeps ONE event from it: the Back it is asking
    // about, while the prompt shows. Nothing held, or answered, it hears all.
    const heard = routerHears();

    // Clean: nothing to hold, so the Back is heard.
    window.history.pushState(null, "", BEFORE);
    window.history.pushState(null, "", START);
    const clean = render(
      <UnsavedChangesGuard isDirty={false}>
        <span />
      </UnsavedChangesGuard>
    );
    await traverse(() => window.history.back());
    expect(heard).toEqual([BEFORE]);
    clean.unmount();

    // Dirty, across a hash only: the page stays, so nothing is held. The
    // history is laid down before the dirty guard mounts, which would
    // otherwise ask about these writes too.
    window.history.pushState(null, "", START);
    window.history.pushState(null, "", `${START}#fields`);
    render(
      <UnsavedChangesGuard isDirty>
        <span />
      </UnsavedChangesGuard>
    );
    await traverse(() => window.history.back());
    expect(heard).toEqual([BEFORE, START]);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // Dirty, off the page: held, and that one event is withheld...
    await traverse(() => window.history.back());
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(heard).toEqual([BEFORE, START]);

    // ...and the leave the author confirms is heard like any other.
    await traverse(() =>
      screen.getByRole("button", { name: /discard/i }).click()
    );
    expect(heard).toEqual([BEFORE, START, BEFORE]);
  });

  it("leaves to where Forward was going, not one step further", async () => {
    // Forward from the editor to AFTER, and AFTER is not the last entry: a
    // put-back by stepping forward once more lands past where the author
    // was going.
    window.history.pushState(null, "", BEFORE);
    window.history.pushState(null, "", START);
    window.history.pushState(null, "", AFTER);
    window.history.pushState(null, "", "/admin/collections/posts/3");
    await traverse(() => window.history.go(-2));
    expect(window.location.pathname).toBe(START);
    const heard = routerHears();
    render(
      <UnsavedChangesGuard isDirty>
        <span />
      </UnsavedChangesGuard>
    );
    await traverse(() => window.history.forward());
    expect(window.location.pathname).toBe(START);
    await traverse(() =>
      screen.getByRole("button", { name: /discard/i }).click()
    );
    expect(window.location.pathname).toBe(AFTER);
    expect(heard).toEqual([AFTER]);
  });
});

describe("Back and Forward where the browser reports history positions", () => {
  const BEFORE = "/admin/collections/posts";
  const AFTER = "/admin/collections/posts/2";
  const LATER = "/admin/collections/posts/3";

  /*
   * jsdom has no Navigation API, so a stand-in counts the current entry's
   * position the way the browser would: a push moves one on, a replace stays,
   * and a traversal moves by its own distance.
   */
  let index = 0;
  const writes = {
    push: History.prototype.pushState,
    replace: History.prototype.replaceState,
    go: History.prototype.go,
    back: History.prototype.back,
    forward: History.prototype.forward,
  };
  beforeEach(() => {
    index = 0;
    // A guard that unmounted restores its writes onto the history OBJECT, and
    // an own property there would hide the counting ones on its prototype.
    Reflect.deleteProperty(window.history, "pushState");
    Reflect.deleteProperty(window.history, "replaceState");
    History.prototype.pushState = function (...args) {
      index += 1;
      return writes.push.apply(this, args);
    };
    History.prototype.replaceState = function (...args) {
      return writes.replace.apply(this, args);
    };
    History.prototype.go = function (delta?: number) {
      index += delta ?? 0;
      return writes.go.call(this, delta);
    };
    History.prototype.back = function () {
      this.go(-1);
    };
    History.prototype.forward = function () {
      this.go(1);
    };
    Object.defineProperty(window, "navigation", {
      configurable: true,
      value: {
        get currentEntry() {
          return { index };
        },
      },
    });
  });
  afterEach(() => {
    History.prototype.pushState = writes.push;
    History.prototype.replaceState = writes.replace;
    History.prototype.go = writes.go;
    History.prototype.back = writes.back;
    History.prototype.forward = writes.forward;
    Reflect.deleteProperty(window, "navigation");
  });

  /**
   * BEFORE, START, AFTER, LATER, standing on START, with a dirty editor.
   * Answers how to take the editor away, so the steps after are not held.
   */
  async function onStartWithEntriesAhead(): Promise<() => void> {
    window.history.pushState(null, "", BEFORE);
    window.history.pushState(null, "", START);
    window.history.pushState(null, "", AFTER);
    window.history.pushState(null, "", LATER);
    await traverse(() => window.history.go(-2));
    expect(window.location.pathname).toBe(START);
    const view = render(
      <UnsavedChangesGuard isDirty>
        <span />
      </UnsavedChangesGuard>
    );
    return view.unmount;
  }

  it("leaves Back going back after a held Forward the author stays from", async () => {
    // 🔴 The separating case. Putting the address back with a new entry made
    // the destination the entry BEHIND the editor, so Back went forward, and
    // every entry ahead of it was gone.
    const leaveEditor = await onStartWithEntriesAhead();
    await traverse(() => window.history.forward());
    // Held: the page is back on the editor, however the guard got it there.
    await waitFor(() => expect(window.location.pathname).toBe(START));
    await userEvent.click(
      await screen.findByRole("button", { name: /keep editing/i })
    );
    expect(window.location.pathname).toBe(START);

    leaveEditor();
    await traverse(() => window.history.back());
    expect(window.location.pathname).toBe(BEFORE);
  });

  it("keeps the entries ahead when the author confirms a held Forward", async () => {
    const leaveEditor = await onStartWithEntriesAhead();
    await traverse(() => window.history.forward());
    await waitFor(() => expect(window.location.pathname).toBe(START));
    await traverse(() =>
      screen.getByRole("button", { name: /discard/i }).click()
    );
    expect(window.location.pathname).toBe(AFTER);

    leaveEditor();
    await traverse(() => window.history.forward());
    expect(window.location.pathname).toBe(LATER);
  });
});

describe("useLeaveWithoutWarning outside a guard", () => {
  it("is a no-op rather than a crash", async () => {
    // An embedded editor renders in a modal, with no guard above it.
    render(<DeliberateLeave />);
    await userEvent.click(
      screen.getByRole("button", { name: "discard and go" })
    );
    expect(window.location.pathname).toBe("/admin/somewhere-else");
  });
});
