import { describe, expect, it } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";
import type { PluginMetadata } from "@admin/types/branding";

import {
  DESKTOP_FROM,
  PHONE_BELOW,
  ownerName,
  ownsContent,
  tierFor,
} from "../workbench-model";

function record(over: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: "t1",
    name: "Welcome",
    slug: "welcome",
    kind: "template",
    subject: "Hi",
    htmlContent: "<p>Hi</p>",
    plainTextContent: null,
    preheader: null,
    layoutId: null,
    fromOverride: null,
    replyTo: null,
    variables: null,
    useLayout: true,
    isActive: true,
    providerId: null,
    attachments: null,
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    owner: { kind: "core" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    ...over,
  };
}

describe("tierFor", () => {
  it("names each arrangement from the workbench's own width", () => {
    expect(tierFor(390)).toBe("phone");
    expect(tierFor(PHONE_BELOW - 1)).toBe("phone");
    expect(tierFor(PHONE_BELOW)).toBe("tablet");
    expect(tierFor(768)).toBe("tablet");
    expect(tierFor(DESKTOP_FROM - 1)).toBe("tablet");
    expect(tierFor(DESKTOP_FROM)).toBe("desktop");
    expect(tierFor(1440)).toBe("desktop");
  });

  it("shows every region before the first measurement", () => {
    expect(tierFor(null)).toBe("desktop");
  });
});

describe("ownsContent", () => {
  it("leaves an owner's email to its owner until the site overrides it", () => {
    expect(ownsContent(record({ owner: { kind: "core" } }))).toBe(false);
    expect(
      ownsContent(
        record({ owner: { kind: "plugin", name: "shop", installed: true } })
      )
    ).toBe(false);
    expect(
      ownsContent(record({ owner: { kind: "core" }, overridden: true }))
    ).toBe(true);
  });

  it("gives the site its own emails, a gone plugin's, and new ones", () => {
    expect(ownsContent(record({ owner: { kind: "site" } }))).toBe(true);
    expect(
      ownsContent(
        record({ owner: { kind: "plugin", name: "shop", installed: false } })
      )
    ).toBe(true);
    expect(ownsContent(undefined)).toBe(true);
  });
});

describe("ownerName", () => {
  const shop = record({
    owner: { kind: "plugin", name: "@acme/plugin-shop", installed: true },
  });

  it("names the owner as the list groups it", () => {
    expect(ownerName(record({ owner: { kind: "core" } }), undefined)).toBe(
      "Nextly"
    );
    expect(ownerName(shop, undefined)).toBe("@acme/plugin-shop");
    expect(ownerName(record({ owner: { kind: "site" } }), undefined)).toBe(
      "This site"
    );
  });

  it("names a plugin as the admin names it everywhere else", () => {
    const plugins = [
      { name: "@acme/plugin-shop", appearance: { label: "Shop" } },
    ] as PluginMetadata[];
    expect(ownerName(shop, plugins)).toBe("Shop");
  });
});
