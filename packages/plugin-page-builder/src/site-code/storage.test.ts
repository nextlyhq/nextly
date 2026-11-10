/**
 * The site code Single takes writes from its route alone: every write without
 * the route's marker is refused, on both phases before a write is stored, so
 * no system write, admin form or restore stores code the route did not judge.
 *
 * @module site-code/storage.test
 */
import { describe, expect, it } from "vitest";

import {
  SITE_CODE_SLUG,
  SITE_CODE_WRITE_CONTEXT,
  SITE_CODE_WRITE_REFUSAL,
  siteCodeSingle,
} from "./storage";

/** Each pre-write hook the Single runs, by phase. */
function guards(): Array<[string, (hook: unknown) => unknown]> {
  const hooks = siteCodeSingle().hooks as Record<
    string,
    Array<(hook: unknown) => unknown> | undefined
  >;
  return ["beforeValidate", "beforeChange"].map(phase => {
    const guard = hooks[phase]?.[0];
    if (guard === undefined) throw new Error(`no ${phase} guard`);
    return [phase, guard];
  });
}

describe("the site code Single", () => {
  it("is hidden and versioned", () => {
    const single = siteCodeSingle();
    expect(single.slug).toBe(SITE_CODE_SLUG);
    expect(single.admin?.hidden).toBe(true);
    expect(single.versions).toBe(true);
  });

  it.each(guards())("refuses an unmarked write on %s", (_phase, guard) => {
    expect(() => guard({ context: {} })).toThrow(SITE_CODE_WRITE_REFUSAL);
    expect(() => guard({})).toThrow(SITE_CODE_WRITE_REFUSAL);
    // A marker that is merely truthy is not the route's.
    expect(() =>
      guard({ context: { "pageBuilder.siteCodeWrite": "yes" } })
    ).toThrow(SITE_CODE_WRITE_REFUSAL);
  });

  it.each(guards())(
    "lets the route's marked write through on %s",
    (_phase, guard) => {
      expect(() =>
        guard({ context: { ...SITE_CODE_WRITE_CONTEXT } })
      ).not.toThrow();
    }
  );
});
