/**
 * `nextly/auth` no longer offers the role checks and legacy guards that were
 * deprecated for a release, and still offers what stayed.
 *
 * The role checks compared role ids with role names, so they never matched; a
 * signed-in user's access is asked through `nextly.access.check`, a key's
 * through `nextly.access.checkApiKey`, and super-admin authority through
 * `isSuperAdmin`. The session `AuthContext` type went with them, but a type
 * leaves nothing at runtime to look for, so this file does not cover it.
 */
import { describe, expect, it } from "vitest";

import * as auth from "../index";

/** The functions removed from `nextly/auth`. */
const REMOVED = [
  "hasRole",
  "hasAnyRole",
  "hasAllRoles",
  "requireRole",
  "requireAnyRole",
  "requireAllRoles",
  "checkPermission",
  "authenticateApiKey",
  "checkCollectionAccess",
] as const;

describe("nextly/auth", () => {
  it.each(REMOVED)("no longer exports %s", name => {
    expect(Object.keys(auth)).not.toContain(name);
  });

  it("still exports what was not deprecated", () => {
    // POPULATION CONTROL: the namespace is the real module, so the absences
    // above are about these names and not an empty import.
    expect(Object.keys(auth)).toEqual(
      expect.arrayContaining([
        "getSession",
        "isSuperAdmin",
        "requireAuth",
        "createErrorResponse",
        "createJsonErrorResponse",
        "isErrorResponse",
      ])
    );
  });
});
