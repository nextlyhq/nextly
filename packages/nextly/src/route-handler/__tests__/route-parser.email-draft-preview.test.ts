/**
 * The draft-preview route, as the MOUNTED admin reaches it.
 *
 * The admin calls `POST /email-templates/preview` for every keystroke in the
 * template editor, and a generated app mounts only the `createDynamicHandlers`
 * catch-all under `/admin/api`. So the standalone route module existing is not
 * enough: if this parser does not know the path, the segment is read as a
 * template id, no POST operation matches it, and the editor's preview answers
 * not-found for every consumer that did not hand-mount an extra route.
 *
 * Tested at the parser because that is where the two spellings diverge. Every
 * other test of this feature mocks below the transport and cannot see it.
 */
import { describe, it, expect } from "vitest";

import { parseRestRoute } from "../route-parser";

describe("the draft preview is reachable through the catch-all", () => {
  it("parses POST /email-templates/preview as a draft render", () => {
    expect(
      parseRestRoute(["email-templates", "preview"], "POST")
    ).toMatchObject({
      service: "emailTemplates",
      method: "previewDraft",
    });
  });

  it("does not read `preview` as a template id", () => {
    const parsed = parseRestRoute(["email-templates", "preview"], "POST");
    // `templateId: "preview"` is the exact shape of the bug: the id-addressed
    // preview would then look up a row whose id is the literal word.
    expect(parsed?.routeParams?.templateId).toBeUndefined();
  });

  /*
   * The id-addressed preview reads a STORED row and must keep working; the
   * draft route renders unsaved fields. Two routes, two methods — asserted
   * together so a future edit cannot collapse them into one.
   */
  it("still parses the id-addressed preview separately", () => {
    expect(
      parseRestRoute(["email-templates", "abc-123", "preview"], "POST")
    ).toMatchObject({
      service: "emailTemplates",
      method: "previewTemplate",
      routeParams: { templateId: "abc-123" },
    });
  });

  it("offers the draft render only over POST", () => {
    for (const method of ["GET", "PATCH", "PUT", "DELETE"]) {
      expect(
        parseRestRoute(["email-templates", "preview"], method)
      ).not.toMatchObject({ method: "previewDraft" });
    }
  });
});
