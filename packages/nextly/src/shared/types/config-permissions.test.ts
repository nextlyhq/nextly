import { describe, expect, it } from "vitest";

import { sanitizeConfig } from "./config";

describe("sanitizeConfig — custom permissions (D36)", () => {
  it("passes through app-declared permissions", () => {
    const out = sanitizeConfig({
      permissions: [
        { action: "export", resource: "reports", label: "Export Reports" },
      ],
    });
    expect(out.permissions).toEqual([
      { action: "export", resource: "reports", label: "Export Reports" },
    ]);
  });

  it("leaves permissions undefined when omitted", () => {
    const out = sanitizeConfig({});
    expect(out.permissions ?? []).toEqual([]);
  });
});
