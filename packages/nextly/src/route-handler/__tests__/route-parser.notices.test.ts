/**
 * The notices routes: three, each to its own handler, and none carrying a
 * person — the handler takes them from the session.
 *
 * @module route-handler/__tests__/route-parser.notices.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("parsing the notices routes", () => {
  it.each([
    [["notices"], "GET", "getNotices"],
    [["notices", "count"], "GET", "getNoticeCount"],
    [["notices", "read"], "POST", "markNoticesRead"],
  ] as const)("%j %s → %s", (path, verb, method) => {
    expect(parseRestRoute([...path], verb)).toMatchObject({
      service: "notices",
      method,
    });
  });

  it.each([
    [["notices"], "POST"],
    [["notices", "read"], "GET"],
    [["notices", "someone"], "GET"],
    // A trailing segment is another path: it must not mark anything read.
    [["notices", "read", "anything"], "POST"],
    [["notices", "count", "x"], "GET"],
  ] as const)("does not route %j %s to a notices handler", (path, verb) => {
    expect(parseRestRoute([...path], verb).service).not.toBe("notices");
  });
});
