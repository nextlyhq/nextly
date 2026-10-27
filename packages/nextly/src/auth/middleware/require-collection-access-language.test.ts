/**
 * The REST route gate tells an entry's rule the languages the request
 * involves.
 *
 * On REST the route gate is the only place an entry's rule is asked: the
 * service gate below it is told the route already decided. So the route gate
 * must tell the rule what the service would: the request's language for an
 * operation on one language's content, and every language for one on the
 * whole entry. Asked of a rule that closes French, a gate telling it the
 * default language for a bulk update or a delete would let either through.
 *
 * The middleware runs for real; only what sits outside it is replaced, as in
 * `require-permission-entity-rule.test.ts`: the session lookup (none, so the
 * bearer key is used), the container, the rate limiter and the env module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionAccessControl } from "@nextly/domains/auth/services/access-control-types";

import type { GrantedPermission } from "../authenticated-scope";

const state = vi.hoisted(() => ({
  rules: new Map<string, CollectionAccessControl>(),
  grants: [] as GrantedPermission[],
  // A cold worker: the site's configuration is registered only by the first
  // request's authentication, which boots the services.
  coldStart: false,
  booted: false,
}));

const services = vi.hoisted(() => ({
  apiKeyService: {
    authenticateApiKey: async () => {
      // Authentication is what boots the services on a cold worker.
      state.booted = true;
      return {
        id: "key-1",
        userId: "owner-1",
        tokenType: "read-only",
        roleId: null,
      };
    },
    resolveApiKeyGrants: async () => state.grants,
    resolveApiKeyRoles: async () => [],
  },
  rbac: {
    getRegisteredAccess: (slug: string) => state.rules.get(slug),
    getRegisteredTarget: (slug: string) => {
      const access = state.rules.get(slug);
      return access ? { kind: "collection", slug, access } : undefined;
    },
  },
  config: {
    localization: {
      locales: ["en", "fr", "de"].map(code => ({
        code,
        label: code,
        rtl: false,
        fallbackLocale: [] as string[],
      })),
      defaultLocale: "en",
      fallback: true,
    },
    // Declared the same in every language; `notes` is not declared here.
    collections: [{ slug: "shared", localized: false, fields: [] }],
  },
}));

vi.mock("../../di/container", () => ({
  container: {
    has: (key: string) =>
      key === "apiKeyService" ||
      key === "rbacAccessControlService" ||
      (key === "config" && (!state.coldStart || state.booted)),
    get: (key: string) =>
      key === "apiKeyService"
        ? services.apiKeyService
        : key === "config"
          ? services.config
          : services.rbac,
  },
}));

vi.mock("../session", () => ({
  getSession: async () => ({ authenticated: false }),
}));

vi.mock("./rate-limiter", () => ({
  authRateLimiter: () => ({
    check: async () => ({ allowed: true, resetAt: new Date() }),
  }),
}));

vi.mock("../../lib/env", () => ({ env: { NEXTLY_SECRET: "test-secret" } }));

vi.mock("../../services/lib/permissions", () => ({
  hasPermission: async () => false,
  hasAnyPermission: async () => false,
}));

const { requireCollectionAccess } = await import("./index");
const { parseRestRoute } = await import("../../route-handler/route-parser");

/** Open in every language but French. */
const frenchClosed = ({ locales }: { locales: string[] }) =>
  !locales.includes("fr");

/** A request to `notes`, authenticated by its bearer key alone. */
function request(search = ""): Request {
  return new Request(
    `https://example.com/api/collections/notes/entries${search}`,
    { headers: { authorization: "Bearer nx_test_key" } }
  );
}

/**
 * The gate's answer for `method`, handed the parameters the route parser
 * dispatches `search` with, as the route handler hands them.
 */
async function status(
  action: string,
  method: string | undefined,
  search = "",
  slug = "notes"
): Promise<number> {
  const { routeParams } = parseRestRoute(
    ["collections", "notes", "entries"],
    "GET",
    new URLSearchParams(search)
  );
  const answer = await requireCollectionAccess(
    request(search),
    action,
    slug,
    method === undefined ? undefined : { method, params: routeParams ?? {} }
  );
  return "statusCode" in answer ? answer.statusCode : 200;
}

beforeEach(() => {
  state.rules.clear();
  state.coldStart = false;
  state.booted = false;
  // The key holds every grant on `notes`, so only the rule can refuse.
  state.grants = ["read", "create", "update", "delete"].map(action => ({
    slug: `${action}-notes`,
    action,
    resource: "notes",
  }));
});

describe("the REST route gate, asking a rule that closes French", () => {
  beforeEach(() => {
    state.rules.set("notes", {
      read: frenchClosed,
      create: frenchClosed,
      update: frenchClosed,
      delete: frenchClosed,
    });
  });

  it("refuses a read in French and allows one in another language or the default", async () => {
    expect(await status("read", "getEntry", "?locale=fr")).toBe(403);
    expect(await status("read", "getEntry", "?locale=de")).toBe(200);
    expect(await status("read", "listEntries")).toBe(200);
    // An unknown language is read as the default, and judged as it; so is
    // the write selector `*`, which a read resolves to the default too.
    expect(await status("read", "countEntries", "?locale=xx")).toBe(200);
    expect(await status("read", "getEntry", "?locale=*")).toBe(200);
    // Every translation at once involves French.
    expect(await status("read", "getEntry", "?locale=all")).toBe(403);
  });

  it("refuses an update in French and allows one in another language", async () => {
    expect(await status("update", "updateEntry", "?locale=fr")).toBe(403);
    expect(await status("update", "updateEntry", "?locale=en")).toBe(200);
    // A write to every language involves French.
    expect(await status("update", "updateEntry", "?locale=*")).toBe(403);
  });

  it("judges a request naming a language twice in the one it is dispatched in, the last", async () => {
    expect(await status("update", "updateEntry", "?locale=en&locale=fr")).toBe(
      403
    );
    expect(await status("update", "updateEntry", "?locale=fr&locale=en")).toBe(
      200
    );
    expect(
      await status("read", "getEntry", "?fallback-locale=de&fallback-locale=fr")
    ).toBe(403);
  });

  it("judges a read of translation states in every language, still showing its own", async () => {
    expect(
      await status("read", "getEntry", "?locale=en&translation-status=1")
    ).toBe(403);
    expect(
      await status(
        "read",
        "listEntries",
        `?where=${encodeURIComponent('{"_translated":{"locale":"de","state":"missing"}}')}`
      )
    ).toBe(403);
    expect(
      await status(
        "read",
        "countEntries",
        "?where[_translated][locale]=de&where[_translated][state]=missing"
      )
    ).toBe(403);
    // A filter on content alone reads the language shown.
    expect(
      await status(
        "read",
        "listEntries",
        `?where=${encodeURIComponent('{"title":{"equals":"x"}}')}`
      )
    ).toBe(200);
    // A filter the dispatcher will refuse is told every language.
    expect(await status("read", "listEntries", "?where=%7Bnot-json")).toBe(403);
  });

  it("judges a bulk update in the default language it writes, whatever language the request names", async () => {
    expect(await status("update", "bulkUpdateEntries", "?locale=fr")).toBe(200);
  });

  it("judges a bulk update by query in every language, as its filter is in the body", async () => {
    // The filter may choose rows by French translation state, and the gate
    // cannot see it, so it is told every language.
    expect(await status("update", "bulkUpdateByQuery")).toBe(403);
  });

  it("judges a duplicate in the default language and each it falls back to, whatever language the request names", async () => {
    expect(await status("create", "duplicateEntry", "?locale=fr")).toBe(200);
    // The default falling back to French, the source read can copy French.
    const [english] = services.config.localization.locales;
    english.fallbackLocale = ["fr"];
    try {
      expect(await status("create", "duplicateEntry")).toBe(403);
    } finally {
      english.fallbackLocale = [];
    }
  });

  it("judges an autosave in the language it names, and one the site does not configure in every language", async () => {
    expect(await status("update", "autosaveEntry", "?locale=en")).toBe(200);
    expect(await status("update", "autosaveEntry", "?locale=fr")).toBe(403);
    // Kept as written, not as the default a write resolves it to.
    expect(await status("update", "autosaveEntry", "?locale=xx")).toBe(403);
    expect(await status("update", "autosaveSingle", "?locale=xx")).toBe(403);
  });

  it("judges discarding a working draft in the language it names, and one the site does not configure in every language", async () => {
    expect(await status("update", "discardWorkingDraft", "?locale=en")).toBe(
      200
    );
    expect(await status("update", "discardWorkingDraft", "?locale=fr")).toBe(
      403
    );
    // The draft is deleted under the name as given, not the default.
    expect(await status("update", "discardWorkingDraft", "?locale=xx")).toBe(
      403
    );
    expect(
      await status("update", "discardSingleWorkingDraft", "?locale=xx")
    ).toBe(403);
  });

  it("judges sharing a preview link in the language it names, and one the site does not configure in every language", async () => {
    expect(await status("update", "sharePreviewLink", "?locale=en")).toBe(200);
    expect(await status("update", "sharePreviewLink", "?locale=fr")).toBe(403);
    expect(await status("update", "sharePreviewLink", "?locale=xx")).toBe(403);
  });

  it("judges an autosave read in every language, whatever language the request names", async () => {
    // The autosave returned is the caller's latest, in whatever language it
    // was saved; `?locale=` does not choose it.
    expect(await status("read", "getEntryAutosave", "?locale=en")).toBe(403);
    expect(await status("read", "getSingleAutosave", "?locale=en")).toBe(403);
  });

  it("judges a history list in the language it is filtered to, and in every language unfiltered", async () => {
    expect(await status("read", "listEntryVersions", "?locale=en")).toBe(200);
    expect(await status("read", "listEntryVersions", "?locale=fr")).toBe(403);
    expect(await status("read", "listEntryVersions")).toBe(403);
    // An empty `?locale=` filters nothing, so the list is of every language.
    expect(await status("read", "listEntryVersions", "?locale=")).toBe(403);
  });

  it("refuses an operation on the whole entry, whatever language the request names", async () => {
    expect(await status("update", "publishAllLocales")).toBe(403);
    expect(await status("delete", "deleteEntry", "?locale=en")).toBe(403);
    expect(await status("delete", "bulkDeleteEntries")).toBe(403);
  });

  it("works out the languages after authentication, which registers them on a cold worker", async () => {
    // Worked out before, the site would have no languages yet, and a rule
    // closing French would be told none and let a French update through.
    state.coldStart = true;
    expect(await status("update", "updateEntry", "?locale=fr")).toBe(403);
  });

  it("tells a caller that names no operation every language", async () => {
    expect(await status("read", undefined, "?locale=en")).toBe(403);
  });
});

describe("the REST route gate, asking a rule open in every language", () => {
  it("allows the same operations on the whole entry", async () => {
    state.rules.set("notes", {
      update: () => true,
      delete: () => true,
    });
    expect(await status("update", "publishAllLocales")).toBe(200);
    expect(await status("delete", "deleteEntry")).toBe(200);
    expect(await status("delete", "bulkDeleteEntries")).toBe(200);
  });
});

describe("the REST route gate, on content the same in every language", () => {
  it("tells it every language, so naming one admits nothing", async () => {
    // Open to French alone: told French for the asking, it would let
    // anyone read language-independent rows by adding `?locale=fr`.
    state.rules.set("shared", {
      read: ({ locale }) => locale === "fr",
    });
    state.grants.push({
      slug: "read-shared",
      action: "read",
      resource: "shared",
    });
    expect(await status("read", "getEntry", "?locale=fr", "shared")).toBe(403);
    expect(await status("read", "listEntries", "?locale=fr", "shared")).toBe(
      403
    );
  });
});

describe("the REST route gate, asking a rule that admits a read involving French", () => {
  it("widens a read only for the overview or filter its route reads", async () => {
    state.rules.set("notes", {
      read: ({ locales }) => locales.includes("fr"),
    });
    const frenchFilter = `&where=${encodeURIComponent('{"_translated":{"locale":"fr","state":"translated"}}')}`;
    // A single entry reads no filter, and a Single reads its overview for
    // `1` alone: neither involves French, so the rule refuses them.
    expect(await status("read", "getEntry", `?locale=en${frenchFilter}`)).toBe(
      403
    );
    expect(
      await status(
        "read",
        "getSingleDocument",
        "?locale=en&translation-status=true"
      )
    ).toBe(403);
    // The control: a list reads its filter, so it involves French.
    expect(
      await status("read", "listEntries", `?locale=en${frenchFilter}`)
    ).toBe(200);
  });
});
