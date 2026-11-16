/**
 * What is remembered as not to be tried again: for a minute, and only so
 * many at once, the oldest forgotten first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NOT_AGAIN_FOR_MS,
  REMEMBERED_AT_MOST,
  notAgainForAWhile,
  notTriedAgainYet,
  resetCopyTurnsForTests,
} from "../copies/copy-turns";

beforeEach(() => resetCopyTurnsForTests());
afterEach(() => vi.useRealTimers());

describe("copies not to be tried again", () => {
  it("are remembered for a minute, then tried again", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    notAgainForAWhile("copy:a.jpg.w640.webp");
    expect(notTriedAgainYet("copy:a.jpg.w640.webp")).toBe(true);
    expect(notTriedAgainYet("copy:a.jpg.w320.webp")).toBe(false);
    vi.setSystemTime(Date.now() + NOT_AGAIN_FOR_MS - 1);
    expect(notTriedAgainYet("copy:a.jpg.w640.webp")).toBe(true);
    vi.setSystemTime(Date.now() + 2);
    expect(notTriedAgainYet("copy:a.jpg.w640.webp")).toBe(false);
  });

  it("are only so many at once, the oldest forgotten first", () => {
    for (let n = 0; n <= REMEMBERED_AT_MOST; n++) notAgainForAWhile(`k${n}`);
    expect(notTriedAgainYet("k0")).toBe(false);
    expect(notTriedAgainYet("k1")).toBe(true);
    expect(notTriedAgainYet(`k${REMEMBERED_AT_MOST}`)).toBe(true);
  });

  it("count one remembered again as the newest", () => {
    for (let n = 0; n < REMEMBERED_AT_MOST; n++) notAgainForAWhile(`k${n}`);
    notAgainForAWhile("k0");
    notAgainForAWhile("one more");
    expect(notTriedAgainYet("k0")).toBe(true);
    expect(notTriedAgainYet("k1")).toBe(false);
  });
});
