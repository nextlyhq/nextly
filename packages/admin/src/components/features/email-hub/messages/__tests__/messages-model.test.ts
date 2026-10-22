import { describe, expect, it } from "vitest";

import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import {
  groupByOwner,
  isDeletable,
  matchesQuery,
  stateOf,
  type MessagesQuery,
} from "../messages-model";

function email(overrides: Partial<EmailTemplateRecord>): EmailTemplateRecord {
  return {
    id: overrides.slug ?? "id",
    name: "An email",
    slug: "an-email",
    kind: "template",
    subject: "Hello",
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
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    owner: { kind: "site" },
    description: null,
    overridden: false,
    ownerChanged: false,
    setInCode: false,
    ...overrides,
  };
}

const ANY: MessagesQuery = { search: "", owner: "all", state: "all" };

describe("stateOf", () => {
  it("names each state an owner's email can be in", () => {
    const core = { owner: { kind: "core" } } as const;
    expect(stateOf(email({ ...core }))).toBe("default");
    expect(stateOf(email({ ...core, overridden: true }))).toBe("customised");
    expect(
      stateOf(email({ ...core, overridden: true, ownerChanged: true }))
    ).toBe("update");
  });

  it("keeps an owner's update visible on an email kept as before", () => {
    // Kept-as-before is said beside the state, never instead of it.
    const both = email({
      owner: { kind: "core" },
      overridden: true,
      ownerChanged: true,
      keptOnOldEngine: true,
    });
    expect(stateOf(both)).toBe("update");
    expect(matchesQuery(both, { ...ANY, state: "update" })).toBe(true);
    expect(matchesQuery(both, { ...ANY, state: "kept" })).toBe(true);
  });

  it("calls the site's own email its own", () => {
    expect(stateOf(email({ owner: { kind: "site" } }))).toBe("own");
  });
});

describe("groupByOwner", () => {
  it("puts core first, then plugins by name, then the site's own", () => {
    const groups = groupByOwner([
      email({ slug: "s", owner: { kind: "site" } }),
      email({
        slug: "shop",
        owner: { kind: "plugin", name: "shop", installed: true },
      }),
      email({ slug: "c", owner: { kind: "core" } }),
      email({
        slug: "accounts",
        owner: { kind: "plugin", name: "accounts", installed: true },
      }),
    ]);
    expect(groups.map(g => g.group.label)).toEqual([
      "Nextly",
      "accounts",
      "shop",
      "This site",
    ]);
  });

  it("orders each group's emails by name", () => {
    const [group] = groupByOwner([
      email({ slug: "b", name: "Welcome", owner: { kind: "core" } }),
      email({ slug: "a", name: "Password reset", owner: { kind: "core" } }),
    ]);
    expect(group.rows.map(r => r.name)).toEqual(["Password reset", "Welcome"]);
  });
});

describe("matchesQuery", () => {
  it("searches name, slug, subject and what sends it", () => {
    const record = email({
      name: "Order shipped",
      slug: "order-shipped",
      subject: "On its way",
      description: "Sent when an order leaves the warehouse",
    });
    for (const term of ["shipped", "ORDER-SHIP", "its way", "warehouse"]) {
      expect(matchesQuery(record, { ...ANY, search: term }), term).toBe(true);
    }
    expect(matchesQuery(record, { ...ANY, search: "refund" })).toBe(false);
  });

  it("filters by owner", () => {
    const record = email({
      owner: { kind: "plugin", name: "accounts", installed: true },
    });
    expect(matchesQuery(record, { ...ANY, owner: "plugin:accounts" })).toBe(
      true
    );
    expect(matchesQuery(record, { ...ANY, owner: "core" })).toBe(false);
  });

  it("filters by state, with Off matching any email that is off", () => {
    const off = email({ owner: { kind: "core" }, isActive: false });
    expect(matchesQuery(off, { ...ANY, state: "off" })).toBe(true);
    expect(matchesQuery(off, { ...ANY, state: "default" })).toBe(true);
    expect(matchesQuery(email({}), { ...ANY, state: "off" })).toBe(false);
    expect(
      matchesQuery(email({ owner: { kind: "core" } }), {
        ...ANY,
        state: "customised",
      })
    ).toBe(false);
  });
});

describe("isDeletable", () => {
  it("follows the server: an owner's email is reset, never deleted", () => {
    expect(isDeletable(email({ owner: { kind: "core" } }))).toBe(false);
    expect(
      isDeletable(
        email({ owner: { kind: "plugin", name: "shop", installed: true } })
      )
    ).toBe(false);
    expect(isDeletable(email({ slug: "default-layout", kind: "layout" }))).toBe(
      false
    );
  });

  it("lets the site delete its own, and a removed plugin's", () => {
    expect(isDeletable(email({ owner: { kind: "site" } }))).toBe(true);
    expect(
      isDeletable(
        email({ owner: { kind: "plugin", name: "shop", installed: false } })
      )
    ).toBe(true);
  });
});
