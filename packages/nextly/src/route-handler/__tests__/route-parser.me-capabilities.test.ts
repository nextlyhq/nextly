/**
 * The capabilities route: one path, and only that path. A longer path is
 * another route, so it must not be answered as this one with its tail
 * ignored, which would also shadow any route later added beneath it.
 *
 * @module route-handler/__tests__/route-parser.me-capabilities.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("parsing the capabilities route", () => {
  it("routes GET /me/capabilities to its handler", () => {
    expect(parseRestRoute(["me", "capabilities"], "GET")).toMatchObject({
      service: "users",
      method: "getCurrentUserCapabilities",
    });
  });

  it.each([
    [["me", "capabilities", "anything"], "GET"],
    [["me", "capabilities", "posts", "read"], "GET"],
    [["me", "capabilities"], "POST"],
  ] as const)("does not route %j %s to it", (path, verb) => {
    expect(parseRestRoute([...path], verb).method).not.toBe(
      "getCurrentUserCapabilities"
    );
  });
});
