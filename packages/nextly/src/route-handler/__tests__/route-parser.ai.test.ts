/**
 * The AI routes: the status, read-only, its handler owning its auth.
 *
 * @module route-handler/__tests__/route-parser.ai.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("parsing the AI routes", () => {
  it("routes GET /ai/status to the status handler", () => {
    expect(parseRestRoute(["ai", "status"], "GET")).toMatchObject({
      service: "ai",
      method: "getAIStatus",
    });
  });

  it.each([
    [["ai"], "GET"],
    [["ai", "status"], "POST"],
    [["ai", "status", "x"], "GET"],
    [["ai", "run"], "POST"],
  ] as const)("does not route %j %s to an AI handler", (path, verb) => {
    expect(parseRestRoute([...path], verb).service).not.toBe("ai");
  });
});
