/**
 * The unreachable list covers every branch that answers before the fallback.
 *
 * A root route is consulted only where the built-in router declines, and the
 * verb wrappers take some requests before that point is ever reached. A route
 * declared under one of those registers, advertises itself in `/api/admin-meta`
 * and answers nothing, which is the exact failure `root-mount-reach` exists to
 * refuse at boot.
 *
 * The list was written with two entries and a note saying a third would have to
 * be added. Three more already existed, and nothing failed, because a hand-kept
 * list has no way to notice what it is missing. So it is read out of the verb
 * wrappers instead: every early-return branch there keys on `params[0]`, and
 * each of those first segments must have an entry.
 *
 * A new branch in that region therefore fails HERE rather than shipping a route
 * that quietly never answers. If a future `params[0]` check is not an early
 * return, this still fails, and that is the safe direction: someone has to look
 * at it and say which it is.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rootMountUnreachableReason } from "./root-mount-reach";

const HANDLER_SOURCE = readFileSync(
  fileURLToPath(new URL("../../routeHandler.ts", import.meta.url)),
  "utf8"
);

/**
 * The first segments the verb wrappers claim before calling the fallback.
 *
 * Scoped to the wrapper region, which the file marks with its own section
 * header. Ahead of it, `handleServiceRequest` tests `params[0]` for services it
 * dispatches directly, and those are reached AFTER the root pass has declined,
 * so reading the whole file would report core routes as unreachable prefixes.
 */
function interceptedSegments(): string[] {
  const start = HANDLER_SOURCE.indexOf("// CRUD Handler Wrappers");
  expect(
    start,
    "the CRUD wrapper section moved or was renamed"
  ).toBeGreaterThan(-1);
  const region = HANDLER_SOURCE.slice(start);
  return [
    ...new Set(
      [...region.matchAll(/params\[0\] === "([^"]+)"/g)].map(
        m => m[1] as string
      )
    ),
  ];
}

describe("root mount reachability", () => {
  it("finds the wrapper branches, so an empty scan cannot pass vacuously", () => {
    // The control. A region that matched nothing would agree with any list at
    // all, and report the strongest possible green about a file it never read.
    const segments = interceptedSegments();
    expect(segments.length).toBeGreaterThan(2);
    expect(segments).toContain("admin-meta");
  });

  it("refuses a root route on every segment the wrappers answer first", () => {
    const unlisted = interceptedSegments().filter(
      segment => rootMountUnreachableReason(`/${segment}/anything`) === null
    );

    expect(unlisted).toEqual([]);
  });

  it("refuses the namespaced prefix, which no wrapper branch mentions", () => {
    // `/plugins` is taken by the earlier plugin pass rather than by a wrapper,
    // so the scan above cannot see it and it has to be asserted directly.
    expect(rootMountUnreachableReason("/plugins/@acme/x/y")).not.toBeNull();
  });

  it("still allows a path nothing answers before the fallback", () => {
    // The other control. A check that refused everything would pass every
    // assertion above while making the whole root mount unusable.
    expect(rootMountUnreachableReason("/forms/contact/submit")).toBeNull();
    expect(rootMountUnreachableReason("/collections/posts")).toBeNull();
  });
});
