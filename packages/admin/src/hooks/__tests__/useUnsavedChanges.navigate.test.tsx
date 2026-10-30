/**
 * A Back or Forward that would leave unsaved changes is cancelled before it
 * moves, through the Navigation API's `navigate` event, wherever the browser
 * lets the page cancel it.
 *
 * Cancelling is what holds Back on a page rendered with Cache Components, where
 * Next's App Router hears `popstate` before the admin's guard does and hides
 * the page before the guard is asked. A Back the browser does not let the page
 * cancel (no use of the page since it last cancelled one) still moves, and the
 * `popstate` path asks about it as before; so does every Back in a browser with
 * no Navigation API.
 *
 * jsdom has no Navigation API, so `window.navigation` is a stand-in that holds
 * the current entry's position and dispatches the events a browser would.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUnsavedChanges } from "../useUnsavedChanges";

const EDITOR = "/admin/collections/posts/1";
const LIST = "/admin/collections/posts";

const { pushState, replaceState } = History.prototype;

/** The stand-in Navigation API: the current entry's position, and events. */
class StandInNavigation extends EventTarget {
  currentEntry = { index: 1 };
}

let navigation: StandInNavigation | undefined;

function installNavigation(): StandInNavigation {
  navigation = new StandInNavigation();
  Object.defineProperty(window, "navigation", {
    value: navigation,
    configurable: true,
  });
  return navigation;
}

/** A traversal to `url`, at history position `index`, as a browser reports it. */
function traverse(
  url: string,
  {
    cancelable = true,
    index = 0,
    type = "traverse",
  }: { cancelable?: boolean; index?: number; type?: string } = {}
): Event {
  const event = new Event("navigate", { cancelable });
  Object.assign(event, {
    navigationType: type,
    destination: { url: new URL(url, window.location.origin).href, index },
  });
  act(() => {
    navigation?.dispatchEvent(event);
  });
  return event;
}

/** A Back that went through: the address moved, then `popstate`, as a browser does. */
function backMoved(to: string): void {
  replaceState.call(window.history, null, "", to);
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
}

function guard(dirty = true) {
  return renderHook(
    ({ isDirty }: { isDirty: boolean }) => useUnsavedChanges({ isDirty }),
    { initialProps: { isDirty: dirty } }
  );
}

beforeEach(() => {
  replaceState.call(window.history, null, "", EDITOR);
  installNavigation();
});

afterEach(() => {
  Reflect.deleteProperty(window, "navigation");
  navigation = undefined;
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  replaceState.call(window.history, null, "", "/");
  vi.restoreAllMocks();
});

describe("a Back that would leave unsaved changes", () => {
  it("is cancelled before it moves, and asked about", () => {
    const { result, unmount } = guard();
    const event = traverse(LIST);
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.showDialog).toBe(true);
    expect(window.location.pathname).toBe(EDITOR);
    unmount();
  });

  it("is left alone when nothing is unsaved", () => {
    const { result, unmount } = guard(false);
    const event = traverse(LIST);
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it("is asked about on popstate where the browser will not let it be cancelled", () => {
    const { result, unmount } = guard();
    // No use of the page since the last cancel: the browser makes it moving.
    const event = traverse(LIST, { cancelable: false });
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.showDialog).toBe(false);

    backMoved(LIST);
    expect(result.current.showDialog).toBe(true);
    // Put back where the reader was, behind the question.
    expect(window.location.pathname).toBe(EDITOR);
    unmount();
  });

  it("goes ahead once when the reader confirms, and is not asked again", () => {
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const { result, unmount } = guard();
    traverse(LIST, { index: 0 });
    expect(result.current.showDialog).toBe(true);

    act(() => result.current.confirmLeave());
    // The same move again, one entry back.
    expect(go).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(result.current.showDialog).toBe(false);

    // That traversal arriving: neither cancelled nor asked about again.
    const release = traverse(LIST, { index: 0 });
    expect(release.defaultPrevented).toBe(false);
    backMoved(LIST);
    expect(result.current.showDialog).toBe(false);
    expect(window.location.pathname).toBe(LIST);
    expect(go).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("is asked about again after Keep Editing", () => {
    const { result, unmount } = guard();
    traverse(LIST);
    act(() => result.current.cancelLeave());
    expect(result.current.showDialog).toBe(false);

    const again = traverse(LIST);
    expect(again.defaultPrevented).toBe(true);
    expect(result.current.showDialog).toBe(true);
    unmount();
  });
});

describe("a move the guard leaves alone", () => {
  it("within the document: a hash, or one of its own query keys", () => {
    const { result, unmount } = guard();
    for (const within of [`${EDITOR}#body`, `${EDITOR}?field=content`]) {
      expect(traverse(within).defaultPrevented).toBe(false);
    }
    expect(result.current.showDialog).toBe(false);
    unmount();
  });

  it("that is not a traversal: a push is the history write's to judge", () => {
    const { result, unmount } = guard();
    expect(traverse(LIST, { type: "push" }).defaultPrevented).toBe(false);
    expect(result.current.showDialog).toBe(false);
    unmount();
  });
});

describe("a browser with no Navigation API", () => {
  it("asks about a Back on popstate, as before", () => {
    Reflect.deleteProperty(window, "navigation");
    navigation = undefined;
    const { result, unmount } = guard();
    backMoved(LIST);
    expect(result.current.showDialog).toBe(true);
    expect(window.location.pathname).toBe(EDITOR);
    unmount();
  });
});
