import { describe, expect, it } from "vitest";

import { projectFields } from "../project-fields";

describe("projectFields", () => {
  it("copies only the allowlisted keys", () => {
    const doc = {
      form: "f1",
      submittedAt: "2026-07-30T00:00:00Z",
      status: "new",
      data: { answer: "42" },
      ipAddress: "203.0.113.7",
    };
    expect(projectFields(doc, ["form", "submittedAt", "status"])).toEqual({
      form: "f1",
      submittedAt: "2026-07-30T00:00:00Z",
      status: "new",
    });
  });

  it("never includes unlisted keys, so PII cannot leak", () => {
    const doc = {
      form: "f1",
      data: { message: "my secret answer" },
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    };
    const projected = projectFields(doc, ["form"]);
    expect(projected).toEqual({ form: "f1" });
    // The free-form answers, IP, and user-agent must be absent entirely.
    expect(JSON.stringify(projected)).not.toMatch(
      /secret|ipAddress|userAgent|203\.0\.113\.7|Mozilla/i
    );
  });

  it("skips allowlisted keys that are absent rather than emitting undefined", () => {
    const projected = projectFields({ form: "f1" }, ["form", "status"]);
    expect(projected).toEqual({ form: "f1" });
    expect("status" in projected).toBe(false);
  });

  it("returns an empty object when no allowlist is provided", () => {
    expect(projectFields({ a: 1 }, undefined)).toEqual({});
    expect(projectFields({ a: 1 }, [])).toEqual({});
  });
});
