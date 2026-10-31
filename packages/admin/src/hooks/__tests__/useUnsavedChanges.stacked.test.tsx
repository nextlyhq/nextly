/**
 * Two guards on one page, as a dashboard's own guard and an open settings panel's are, each
 * replacing `history.pushState` while it is on. Each change of a guard's state takes its
 * interceptor down and puts another up, in whatever order the page's state changes, so the
 * guards do not come and go as a stack: the one put up first can change while a later one sits
 * above it. Whatever that order, a guard that is on holds a leave while it has unsaved changes,
 * and one that has gone holds nothing.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUnsavedChanges } from "../useUnsavedChanges";

const DASHBOARD = "/admin";
const ELSEWHERE = "/admin/media";

const { pushState, replaceState } = History.prototype;

function guard(dirty: boolean) {
  return renderHook(
    ({ isDirty }: { isDirty: boolean }) => useUnsavedChanges({ isDirty }),
    { initialProps: { isDirty: dirty } }
  );
}

/** A move within the admin, the way its router makes one. */
function navigate(path: string) {
  act(() => window.history.pushState(null, "", path));
}

beforeEach(() => {
  replaceState.call(window.history, null, "", DASHBOARD);
});

afterEach(() => {
  window.history.pushState = pushState;
  window.history.replaceState = replaceState;
  replaceState.call(window.history, null, "", "/");
});

describe("two guards whose changes do not come and go as a stack", () => {
  it("holds nothing once both have nothing unsaved, after the first changed under the second", () => {
    const first = guard(true);
    const second = guard(true);
    // The first changes while the second sits above it, then the second goes.
    first.rerender({ isDirty: false });
    second.unmount();
    navigate(ELSEWHERE);
    expect(window.location.pathname).toBe(ELSEWHERE);
    expect(first.result.current.showDialog).toBe(false);
    first.unmount();
  });

  it("still holds a leave for the second's unsaved changes after the first changed under it", () => {
    const first = guard(true);
    const second = guard(true);
    first.rerender({ isDirty: false });
    navigate(ELSEWHERE);
    expect(window.location.pathname).toBe(DASHBOARD);
    expect(second.result.current.showDialog).toBe(true);
    second.unmount();
    first.unmount();
  });

  it("leaves the page's own write in place once every guard has gone", () => {
    // The control: a stack that does come and go in order puts back what it found.
    const first = guard(true);
    const second = guard(false);
    second.unmount();
    first.unmount();
    expect(window.history.pushState).toBe(pushState);
  });
});
