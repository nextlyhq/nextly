/**
 * Which of the roles screen's four faces a role gets: super-admin and Public
 * from the server's marker, never from a slug, every other built-in role as
 * a preset, and any other role as editable.
 */
import { describe, expect, it } from "vitest";

import { roleScreenMode } from "./role-screen-mode";

describe("roleScreenMode", () => {
  it("reads super-admin and Public from the server's marker", () => {
    expect(roleScreenMode({ builtIn: "super-admin", isSystemRole: true })).toBe(
      "super-admin"
    );
    expect(roleScreenMode({ builtIn: "public", isSystemRole: true })).toBe(
      "public"
    );
  });

  it("does not take a role for Public or super-admin by its slug", () => {
    expect(roleScreenMode({ slug: "public", isSystemRole: false })).toBe(
      "editable"
    );
    expect(roleScreenMode({ slug: "super-admin", isSystemRole: true })).toBe(
      "preset"
    );
  });

  it("reads every other built-in role as a preset", () => {
    expect(roleScreenMode({ isSystemRole: true })).toBe("preset");
  });

  it("reads a role someone made, and a role not yet made, as editable", () => {
    expect(roleScreenMode({ isSystemRole: false })).toBe("editable");
    expect(roleScreenMode(null)).toBe("editable");
  });
});
