/**
 * The preview-links routes: mint, list, revoke one, revoke all.
 *
 * What is worth pinning is which method each path reaches, and that nothing
 * near the destructive one falls into it. `/preview-links/revoke` with no
 * document ends every link on the site, so a path one segment longer, or a
 * link whose id happens to read "revoke", must never be answered as it.
 */
import { describe, expect, it } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("preview-links routes", () => {
  it("mints on a POST to the collection", () => {
    expect(parseRestRoute(["preview-links"], "POST")).toMatchObject({
      service: "previewLinks",
      method: "mintPreviewLink",
    });
  });

  it("lists on a GET to the collection, and nothing deeper", () => {
    expect(parseRestRoute(["preview-links"], "GET")).toMatchObject({
      service: "previewLinks",
      method: "listPreviewLinks",
    });
    expect(parseRestRoute(["preview-links", "abc"], "GET")).toEqual({});
  });

  it("revokes one link by the id in its path", () => {
    const parsed = parseRestRoute(
      ["preview-links", "0123abcd", "revoke"],
      "POST"
    );
    expect(parsed).toMatchObject({
      service: "previewLinks",
      method: "revokePreviewLink",
    });
    expect(parsed.routeParams?.linkId).toBe("0123abcd");
  });

  it("revokes all on a POST to /revoke", () => {
    expect(parseRestRoute(["preview-links", "revoke"], "POST")).toMatchObject({
      service: "previewLinks",
      method: "revokePreviewLinks",
    });
  });

  it("answers nothing deeper than the known paths", () => {
    for (const path of [
      ["preview-links", "revoke", "anything"],
      ["preview-links", "0123abcd", "revoke", "anything"],
      ["preview-links", "0123abcd", "other"],
      ["preview-links", "revoke", "revoke"],
    ]) {
      expect(parseRestRoute(path, "POST"), path.join("/")).toEqual({});
    }
  });

  it("answers no other method", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(parseRestRoute(["preview-links"], method)).toEqual({});
      expect(parseRestRoute(["preview-links", "revoke"], method)).toEqual({});
    }
  });
});
