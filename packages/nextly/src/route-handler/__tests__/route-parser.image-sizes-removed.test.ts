/**
 * The image-size endpoints are gone.
 *
 * An upload no longer cuts sizes, so a route that lists, edits or regenerates
 * them would describe something nothing makes. A request to one is answered as
 * an unknown route is: the parser matches nothing, and the caller turns the
 * empty object into a 404.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("image-size routes", () => {
  it.each([
    ["GET", ["image-sizes"]],
    ["POST", ["image-sizes"]],
    ["GET", ["image-sizes", "sz_1"]],
    ["PATCH", ["image-sizes", "sz_1"]],
    ["DELETE", ["image-sizes", "sz_1"]],
    ["GET", ["image-sizes", "regeneration-status"]],
    ["POST", ["image-sizes", "regenerate"]],
  ] as const)("does not route %s /%s", (method, path) => {
    expect(parseRestRoute([...path], method)).toEqual({});
  });

  it("still routes the settings beside them", () => {
    // The positive control: the parser is reachable and a settings route still
    // matches, so the refusals above are the routes being absent rather than
    // the suite asking the wrong question.
    expect(parseRestRoute(["general-settings"], "GET")).toMatchObject({
      service: "generalSettings",
      method: "getGeneralSettings",
    });
  });
});
