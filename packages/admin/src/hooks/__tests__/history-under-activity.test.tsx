/**
 * Next.js keeps a visited route mounted but hidden under Cache Components,
 * through React's Activity: hiding a page runs its effects' cleanups, and
 * showing it runs its effects again. The admin patches `history` twice, the
 * router for the whole admin and the unsaved-changes guard over it while a form
 * is dirty. A hidden admin must leave the browser's own `history` methods to
 * the page showing in its place, however often it is hidden and shown again.
 *
 * Driven through the real hooks inside React's own Activity, so a cleanup that
 * puts back the wrong method fails here, not only in a browser with Cache
 * Components on.
 */
import { render } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRouter } from "../useRouter";
import { useUnsavedChanges } from "../useUnsavedChanges";

vi.mock("../useHydration", () => ({ useHydration: () => true }));

// The browser's own methods, before any admin code patched them.
// eslint-disable-next-line @typescript-eslint/unbound-method
const { pushState, replaceState } = window.history;

function Form({ dirty }: { dirty: boolean }) {
  useUnsavedChanges({ isDirty: dirty });
  return null;
}

function Admin({ dirty }: { dirty: boolean }) {
  useRouter();
  return <Form dirty={dirty} />;
}

function page(mode: "visible" | "hidden", dirty: boolean) {
  return (
    <Activity mode={mode}>
      <Admin dirty={dirty} />
    </Activity>
  );
}

function expectBrowserHistory() {
  expect(window.history.pushState).toBe(pushState);
  expect(window.history.replaceState).toBe(replaceState);
}

afterEach(() => {
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  window.history.replaceState(null, "", "/");
});

describe("the admin's history patches under Activity", () => {
  it("leave the browser's methods while a page with a form made dirty after it opened is hidden", () => {
    window.history.replaceState(null, "", "/admin/collections/posts/1");
    const { rerender, unmount } = render(page("visible", false));
    // The guard patches over the router's patch, as when the reader edits.
    rerender(page("visible", true));
    for (let shown = 0; shown < 2; shown += 1) {
      rerender(page("hidden", true));
      expectBrowserHistory();
      rerender(page("visible", true));
    }
    unmount();
    expectBrowserHistory();
  });

  it("leave the browser's methods while a page dirty from the start is hidden", () => {
    window.history.replaceState(null, "", "/admin/collections/posts/1");
    const { rerender, unmount } = render(page("visible", true));
    for (let shown = 0; shown < 2; shown += 1) {
      rerender(page("hidden", true));
      expectBrowserHistory();
      rerender(page("visible", true));
    }
    unmount();
    expectBrowserHistory();
  });
});
