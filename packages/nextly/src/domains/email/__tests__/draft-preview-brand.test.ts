/**
 * Brand settings a draft preview may carry: checked by the rules a save is,
 * so a preview never renders a setting no save would accept.
 */
import { describe, expect, it } from "vitest";

import { draftPreviewSchema } from "../draft-preview-request";

const draft = {
  template: {
    subject: "Hi",
    htmlContent: "<p>Hi</p>",
    useLayout: true,
    kind: "template",
  },
  data: {},
};

describe("a draft preview's brand settings", () => {
  it("are optional, so every existing caller is unchanged", () => {
    const parsed = draftPreviewSchema.parse(draft);
    expect(parsed.brand).toBeUndefined();
  });

  it("accept any of the settings, or null for a starting value", () => {
    const parsed = draftPreviewSchema.parse({
      ...draft,
      brand: {
        accentColor: "#2F6B4F",
        logoUrl: "https://cdn.example.com/logo.png",
        logoWidth: 140,
        fontFamily: "georgia",
        footerText: null,
        footerLinks: [{ label: "Privacy", url: "https://acme.test/privacy" }],
      },
    });
    expect(parsed.brand).toMatchObject({
      logoUrl: "https://cdn.example.com/logo.png",
      footerText: null,
    });
  });

  it.each([
    ["a colour that is not hex", { accentColor: "green" }],
    ["a relative logo address", { logoUrl: "/uploads/logo.png" }],
    ["a logo address that is not http", { logoUrl: "javascript:alert(1)" }],
    ["a logo width out of range", { logoWidth: 4000 }],
    ["a font not on the email-safe list", { fontFamily: "fraunces" }],
    ["a setting that does not exist", { headerColor: "#000000" }],
  ])("refuse %s", (_, brand) => {
    const result = draftPreviewSchema.safeParse({ ...draft, brand });
    expect(result.success).toBe(false);
  });
});
