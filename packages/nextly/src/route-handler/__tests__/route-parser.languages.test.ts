/**
 * The languages route: `/api/languages` alone. A trailing segment is another path, so a typo
 * neither lists nor changes the site's languages.
 *
 * @module route-handler/__tests__/route-parser.languages.test
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("parsing the languages route", () => {
  it.each([
    ["GET", "getLanguages"],
    ["POST", "changeLanguages"],
  ] as const)("/api/languages %s → %s", (verb, method) => {
    expect(parseRestRoute(["languages"], verb)).toMatchObject({
      service: "languages",
      method,
    });
  });

  it.each([
    [["languages", "unknown"], "GET"],
    [["languages", "unknown"], "POST"],
    [["languages", "fr", "default"], "POST"],
  ] as const)("does not route %j %s to the languages handler", (path, verb) => {
    expect(parseRestRoute([...path], verb)).toEqual({});
  });
});
