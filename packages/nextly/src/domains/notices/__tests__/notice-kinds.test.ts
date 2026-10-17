/**
 * Registering a kind: one documented way, and the refusals that keep two
 * features from claiming one key.
 *
 * @module domains/notices/__tests__/notice-kinds.test
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  clearNoticeKindsForTests,
  defineNoticeKind,
  registeredNoticeKind,
  registerNoticeKind,
} from "../notice-kinds";

afterEach(() => clearNoticeKindsForTests());

const kind = (key: string, subjectType = "release") => ({
  key,
  subjectType,
  data: z.object({}),
  render: () => ({ title: key }),
});

describe("notice kinds", () => {
  it.each([
    "stopped",
    "Releases.stopped",
    "releases.",
    ".stopped",
    "releases stopped",
  ])("refuses the key %j, which is not <feature>.<name> in lowercase", key => {
    expect(() => defineNoticeKind(kind(key))).toThrow();
  });

  it("refuses a key or subject type longer than its stored column", () => {
    // Stored in 64-character columns on MySQL; refused on every dialect so
    // one cannot store what another truncates.
    const long = `test.${"k".repeat(60)}`;
    expect(() =>
      defineNoticeKind({
        key: long,
        subjectType: "thing",
        data: z.object({}),
        render: () => ({ title: "x" }),
      })
    ).toThrow();
    expect(() =>
      defineNoticeKind({
        key: "test.ok",
        subjectType: "s".repeat(65),
        data: z.object({}),
        render: () => ({ title: "x" }),
      })
    ).toThrow();
  });

  it("accepts a namespaced key, and finds the kind by it", () => {
    const stopped = defineNoticeKind(kind("releases.stopped"));
    registerNoticeKind(stopped);
    expect(registeredNoticeKind("releases.stopped")).toBe(stopped);
  });

  it("replaces a kind registered again under its key, as a reload does", () => {
    registerNoticeKind(defineNoticeKind(kind("releases.stopped")));
    const reloaded = defineNoticeKind(kind("releases.stopped"));
    registerNoticeKind(reloaded);
    expect(registeredNoticeKind("releases.stopped")).toBe(reloaded);
  });

  it("refuses a second feature claiming a key about a different subject", () => {
    registerNoticeKind(defineNoticeKind(kind("releases.stopped")));
    expect(() =>
      registerNoticeKind(defineNoticeKind(kind("releases.stopped", "entry")))
    ).toThrow();
  });
});
