import { describe, expect, it } from "vitest";

import type { BrandFont, BrandSettings } from "@admin/services/emailBrandApi";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import {
  absoluteLogoUrl,
  changeOf,
  emailSafeFontFor,
  emailsByLayout,
  namesLine,
  normalizeHex,
  previewChangeOf,
  siteStyleOf,
  suggestedColours,
} from "../design-model";

const SAVED: BrandSettings = {
  logoUrl: null,
  logoWidth: 120,
  accentColor: "#18181b",
  backgroundColor: "#f4f4f5",
  contentColor: "#ffffff",
  fontFamily: "system",
  footerText: null,
  footerLinks: [],
};

const FONTS: BrandFont[] = [
  { key: "system", label: "System", stack: "-apple-system, sans-serif" },
  { key: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { key: "georgia", label: "Georgia", stack: "Georgia, serif" },
  { key: "courier", label: "Courier New", stack: "'Courier New', monospace" },
];

function record(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t",
    name: "T",
    slug: "t",
    kind: "template",
    subject: "",
    htmlContent: "",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    useLayout: true,
    isActive: true,
    owner: { kind: "site" },
    ...over,
  } as EmailTemplateRecord;
}

describe("colours", () => {
  it.each([
    ["#2F6B4F", "#2f6b4f"],
    ["2f6b4f", "#2f6b4f"],
    ["#abc", "#aabbcc"],
    [" #ABC ", "#aabbcc"],
    ["green", null],
    ["#12345", null],
  ])("reads %s as %s", (typed, hex) => {
    expect(normalizeHex(typed)).toBe(hex);
  });
});

describe("what a save changes", () => {
  it("is only the settings that differ from the saved ones", () => {
    const draft = { ...SAVED, accentColor: "#2f6b4f", logoWidth: 120 };
    expect(changeOf(SAVED, draft)).toEqual({ accentColor: "#2f6b4f" });
    expect(changeOf(SAVED, SAVED)).toEqual({});
  });

  it("previews only the links that are complete", () => {
    const change = changeOf(SAVED, {
      ...SAVED,
      footerLinks: [
        { label: "Privacy", url: "https://acme.test/privacy" },
        { label: "Half", url: "" },
      ],
    });
    expect(previewChangeOf(change)).toEqual({
      footerLinks: [{ label: "Privacy", url: "https://acme.test/privacy" }],
    });
    expect(previewChangeOf({})).toBeUndefined();
  });
});

describe("a logo from the media library", () => {
  it("is made absolute against the site, as an email client needs", () => {
    expect(absoluteLogoUrl("/uploads/logo.png", "https://shop.test")).toBe(
      "https://shop.test/uploads/logo.png"
    );
    expect(
      absoluteLogoUrl("https://cdn.test/logo.png", "https://shop.test")
    ).toBe("https://cdn.test/logo.png");
  });

  it("is refused when it isn't a web address", () => {
    expect(
      absoluteLogoUrl("data:image/png;base64,AAAA", "https://shop.test")
    ).toBeNull();
  });
});

describe("the emails each layout wraps", () => {
  it("follows a send's choice: the layout named, else the default", () => {
    const fallback = record({
      id: "default",
      kind: "layout",
      slug: "default-layout",
    });
    const plain = record({ id: "plain", kind: "layout", slug: "plain" });
    const partial = record({ id: "footer", kind: "partial", slug: "footer" });
    const onDefault = record({ id: "a", layoutId: null });
    const onPlain = record({ id: "b", layoutId: "plain" });
    const onPartial = record({ id: "c", layoutId: "footer" });
    const bare = record({ id: "d", useLayout: false });

    const used = emailsByLayout([
      fallback,
      plain,
      partial,
      onDefault,
      onPlain,
      onPartial,
      bare,
    ]);

    expect(used.get("default")?.map(e => e.id)).toEqual(["a", "c"]);
    expect(used.get("plain")?.map(e => e.id)).toEqual(["b"]);
    expect(used.has("footer")).toBe(false);
  });
});

describe("Match my site", () => {
  const stored = {
    tokens: [
      {
        name: "color.brand",
        kind: "color",
        values: { light: "#2F6B4F", dark: "#7fd1a8" },
      },
      {
        name: "color.surface",
        kind: "color",
        values: { light: "#f6f3ee", dark: "#151b2b" },
      },
      {
        name: "color.card",
        kind: "color",
        values: { light: "#ffffff", dark: "#0b0f19" },
      },
      { name: "space.4", kind: "dimension", values: { light: "16px" } },
      {
        name: "font.body",
        kind: "fontFamily",
        values: { light: "Fraunces, serif" },
      },
    ],
  };

  it("offers the light-theme colours, under the names the site emits", () => {
    expect(siteStyleOf(stored)).toEqual({
      colours: [
        { name: "--site-color-brand", value: "#2f6b4f" },
        { name: "--site-color-surface", value: "#f6f3ee" },
        { name: "--site-color-card", value: "#ffffff" },
      ],
      font: "Fraunces, serif",
    });
  });

  it("reads a token set stored as JSON text, and its own prefix", () => {
    const style = siteStyleOf(JSON.stringify({ ...stored, prefix: "--nw-" }));
    expect(style?.colours[0].name).toBe("--nw-color-brand");
  });

  it("offers nothing where the site has no colours", () => {
    expect(siteStyleOf({ tokens: [] })).toBeNull();
    expect(siteStyleOf(null)).toBeNull();
    expect(siteStyleOf("not json")).toBeNull();
  });

  it("suggests a different colour for each part, by name", () => {
    const style = siteStyleOf(stored);
    const picks = suggestedColours(style?.colours ?? []);
    expect(picks.accentColor?.name).toBe("--site-color-brand");
    expect(picks.backgroundColor?.name).toBe("--site-color-surface");
    expect(picks.contentColor?.name).toBe("--site-color-card");
  });

  it("uses the site's font where email clients have it, else the closest", () => {
    expect(emailSafeFontFor("Georgia, serif", FONTS)).toMatchObject({
      same: true,
      font: { key: "georgia" },
    });
    expect(emailSafeFontFor("Fraunces, serif", FONTS)).toMatchObject({
      same: false,
      family: "Fraunces",
      font: { key: "georgia" },
    });
    expect(emailSafeFontFor("'Inter', sans-serif", FONTS)).toMatchObject({
      same: false,
      font: { key: "arial" },
    });
    expect(emailSafeFontFor("JetBrains Mono, monospace", FONTS)?.font.key).toBe(
      "courier"
    );
  });
});

describe("names", () => {
  it("shows the first few, then how many more", () => {
    expect(namesLine(["A", "B"])).toBe("A, B");
    expect(namesLine(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});
