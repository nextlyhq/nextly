/**
 * A `single:` source: what it publishes, what it executes, and what it feeds.
 *
 * The one-row read is the whole of the executable half, so the cases here
 * are the ones that separate it from a collection's list: the read is the
 * Direct API's own with the caller, the projection is applied after it, a
 * query that chooses or bounds rows is refused by name, and a document the
 * read cannot answer with is an empty list rather than a failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findSingle = vi.fn();
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ findSingle }),
}));

vi.mock("../../../di/container", () => ({ container: { get: vi.fn() } }));

import { container } from "../../../di/container";
import { createErrorFromSingleResult } from "../../../direct-api/namespaces/helpers";
import { NextlyError } from "../../../errors/nextly-error";
import {
  buildSingleErrorResult,
  singleAbsentResult,
} from "../../singles/services/single-utils";
import { registerBuiltInSingleSources } from "../built-in-sources";
import { generatedCollectionSlug, singleWidgets } from "../collection-widgets";
import { setDeferredEntities } from "../deferred-entities";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { refreshSingleSources } from "../single-sources";
import { clearSources, getSource, listSources } from "../sources";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const DOCUMENT = {
  id: "doc-1",
  siteName: "Acme",
  tagline: "Hello",
  updatedAt: "2026-09-11T10:00:00.000Z",
  createdAt: "2026-09-01T10:00:00.000Z",
  status: "published",
};

beforeEach(() => {
  vi.clearAllMocks();
  clearSources();
  setDeferredEntities("single", []);
  findSingle.mockResolvedValue(DOCUMENT);
  registerBuiltInSingleSources([
    {
      slug: "site-settings",
      label: "Site settings",
      status: true,
      fields: [
        { name: "siteName", type: "text", label: "Site name" },
        { name: "tagline", type: "text" },
        { name: "secret", type: "password" },
        // A legal field name that `Object.prototype` also answers for.
        { name: "toString", type: "text" },
      ],
    },
    { slug: "homepage", fields: [{ name: "headline", type: "text" }] },
  ]);
});

describe("what a single publishes", () => {
  it("is a one-row list over the document's fields and its system columns", () => {
    const source = getSource("single:site-settings");
    expect(source?.kind).toBe("single");
    expect(source?.label).toBe("Site settings");
    expect(source?.supports).toEqual(["list"]);
    expect(source?.requiredPermission).toBe("read-site-settings");
    expect(source?.lifecycleStatus).toBe(true);
    // The document's own fields first, a password never; then the columns a
    // single's table carries: no timestamps toggle, so both, and the two the
    // publish lifecycle adds.
    expect(source?.fields.map(field => field.name)).toEqual([
      "siteName",
      "tagline",
      "toString",
      "id",
      "createdAt",
      "updatedAt",
      "status",
      "firstPublishedAt",
    ]);
  });

  it("names a single by its slug when it has no label, and carries no lifecycle columns without the flag", () => {
    const source = getSource("single:homepage");
    expect(source?.label).toBe("homepage");
    expect(source?.lifecycleStatus).toBe(false);
    expect(source?.fields.map(field => field.name)).toEqual([
      "headline",
      "id",
      "createdAt",
      "updatedAt",
    ]);
  });
});

describe("what a single executes", () => {
  it("reads the one document through the access-controlled path and lists it", async () => {
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName", "updatedAt"],
      status: "all",
    });

    const result = await executeWidgetQuery(q, caller);

    // The read is the Direct API's, with the caller and the guard on -- the
    // same read the editor and a REST GET make -- so the single's own rules
    // decide, code-defined ones included.
    expect(findSingle).toHaveBeenCalledWith({
      slug: "site-settings",
      overrideAccess: false,
      user: caller.user,
      status: "all",
    });
    // The projection is applied here: the read returns the whole document,
    // because the singles read does not consume `select`.
    expect(result).toEqual({
      op: "list",
      items: [{ siteName: "Acme", updatedAt: DOCUMENT.updatedAt }],
      fields: [
        { name: "siteName", label: "Site name", type: "string" },
        { name: "updatedAt", type: "date" },
      ],
    });
  });

  it("projects OWN properties, so a field the read removed stays removed", async () => {
    // 🔴 `name in document` walks the prototype chain, and `toString` is a
    // field name the validator permits. A field the read stripped for this
    // caller therefore read as present, and the projection answered with
    // `Object.prototype.toString` -- a function a direct caller received, and
    // a column `fields` advertised while HTTP's JSON dropped the value.
    findSingle.mockResolvedValue({ siteName: "Acme" });
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName", "toString"],
      status: "all",
    });

    const result = await executeWidgetQuery(q, caller);

    expect(result.op).toBe("list");
    if (result.op !== "list") return;
    expect(Object.keys(result.items[0])).toEqual(["siteName"]);
    expect(result.fields?.map(field => field.name)).toEqual(["siteName"]);
  });

  it("hands an API key's own scope to the read, the way a collection read does", async () => {
    const scope = { actorType: "apiKey", permissions: ["read-site-settings"] };
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName"],
    });

    await executeWidgetQuery(q, {
      ...caller,
      authenticatedScope: scope,
    } as unknown as typeof caller);

    expect(findSingle).toHaveBeenCalledWith(
      expect.objectContaining({ actor: scope })
    );
  });

  it("answers an empty list, not a failure, when the read says THIS single has no document", async () => {
    // A draft-only single asked for its published state names no document,
    // and the read says so with its own not-found, naming the single. The
    // card says "Nothing yet", which is true; a failure would say something
    // is broken.
    // The read's own refusal, built the way `findSingle` builds it: the
    // service's envelope through the Direct API's converter.
    findSingle.mockRejectedValue(
      createErrorFromSingleResult(singleAbsentResult("site-settings"))
    );
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName"],
      status: "published",
    });

    expect(await executeWidgetQuery(q, caller)).toEqual({
      op: "list",
      items: [],
    });
  });

  it("fails the query on a not-found raised for something ELSE inside the read", async () => {
    // 🔴 A `beforeRead` hook or a related read can throw a not-found of its
    // own, and it reaches the executor with the same code. Read as "no
    // document", it drew "Nothing yet" over a single that exists and whose
    // read failed -- the Direct API caller sees the failure, and so must the
    // card. Only the read's own refusal, naming this single, is an empty list.
    // A hook's throw, on the path the service and the Direct API give it:
    // caught into an envelope, then rebuilt for the caller.
    findSingle.mockRejectedValue(
      createErrorFromSingleResult(
        buildSingleErrorResult(
          NextlyError.notFound({ message: "Author profile not found." }),
          "Failed to get Single document"
        )
      )
    );
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName"],
    });

    await expect(executeWidgetQuery(q, caller)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // And the read's own refusal of ANOTHER single -- a nested read's -- is
    // not this single's absence either.
    findSingle.mockRejectedValue(
      createErrorFromSingleResult(singleAbsentResult("author-profile"))
    );
    await expect(executeWidgetQuery(q, caller)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets every other refusal through, a forbidden read included", async () => {
    // The control for the case above, and a security property: a rule that
    // refuses the reader must reach them as the refusal, not as an empty card
    // that reads like a single with nothing in it.
    findSingle.mockRejectedValue(NextlyError.forbidden({ logContext: {} }));
    const q = validateWidgetQuery({
      source: "single:site-settings",
      op: "list",
      select: ["siteName"],
    });

    await expect(executeWidgetQuery(q, caller)).rejects.toSatisfy(
      (error: unknown) => NextlyError.isCode(error, "FORBIDDEN")
    );
  });

  it("refuses by name a query that chooses or orders the rows it does not have", async () => {
    // Validation admits these -- `where` names a declared field, `sort` is
    // ordinary -- and a single cannot honour them. Refused rather than
    // accepted and dropped, which would answer a different question than the
    // one asked. `limit` is not among them: validation supplies one on every
    // query, and one row satisfies any bound of at least one.
    for (const extra of [
      { where: { siteName: { equals: "Acme" } } },
      { sort: "-updatedAt" },
    ]) {
      const q = validateWidgetQuery({
        source: "single:site-settings",
        op: "list",
        select: ["siteName"],
        ...extra,
      });
      // The wire message is the flattened one every unavailable-source refusal
      // carries; the field names ride in the log context. Asserted through
      // what the read never received: the refusal came BEFORE it.
      await expect(
        executeWidgetQuery(q, caller),
        JSON.stringify(extra)
      ).rejects.toThrow(/unavailable source or unsupported op/);
    }
    expect(findSingle).not.toHaveBeenCalled();
  });

  it("is refused every op but list before execution", () => {
    // `supports` is what validation reads, so a count over one document is
    // refused where every unsupported op is, and the executor's own arm is
    // not the first thing to say so.
    expect(() =>
      validateWidgetQuery({ source: "single:site-settings", op: "count" })
    ).toThrow();
  });
});

describe("what a single feeds", () => {
  it("derives one status card per single, linking to the single itself", () => {
    const cards = singleWidgets(listSources());
    expect(cards.map(card => card.id)).toEqual([
      "single/site-settings-status",
      "single/homepage-status",
    ]);
    const [settings, homepage] = cards;
    expect(settings.query).toEqual({
      source: "single:site-settings",
      op: "list",
      status: "all",
      select: ["status", "updatedAt"],
    });
    expect(settings.link).toEqual({
      label: "Open Site settings",
      href: "/admin/singles/site-settings",
    });
    // Without a lifecycle there is no state to name, only the last change.
    expect(homepage.query?.select).toEqual(["updatedAt"]);
  });

  it("names the single a derived card reads, so the reader gate can ask about it", () => {
    // The same derivation a collection card gets: the card's subject is the
    // entity its query reads, and `canReadEntity` resolves a single's slug the
    // way it resolves a collection's.
    const [card] = singleWidgets(listSources());
    expect(generatedCollectionSlug(card)).toBe("site-settings");
  });
});

describe("refreshing the single sources from the registry", () => {
  const getAllSingles = vi.fn();

  beforeEach(() => {
    clearSources();
    vi.mocked(container.get).mockImplementation((name: string) => {
      if (name === "singleRegistryService") return { getAllSingles };
      throw new Error(`unexpected container.get("${name}")`);
    });
  });

  it("publishes a source per registered single", async () => {
    getAllSingles.mockResolvedValue([
      {
        slug: "site-settings",
        label: "Site settings",
        status: true,
        migrationStatus: "synced",
        fields: [{ name: "siteName", type: "text" }],
      },
    ]);

    await refreshSingleSources();

    expect(listSources().map(source => source.id)).toEqual([
      "single:site-settings",
    ]);
  });

  it("withholds a single the reload deferred, and one whose label declines its table", async () => {
    // 🔴 Both refusals the collection half makes, from the same store and the
    // same label reading. A deferred single is ahead of its table and would
    // publish columns the table lacks; a `pending` label says nothing about
    // the table at all.
    getAllSingles.mockResolvedValue([
      { slug: "deferred", migrationStatus: "synced", fields: [] },
      { slug: "pending", migrationStatus: "pending", fields: [] },
      { slug: "ready", migrationStatus: "applied", fields: [] },
      // An absent label is read generously, as the collection half reads it:
      // a row predating the column says nothing about its table.
      { slug: "older", fields: [] },
    ]);
    setDeferredEntities("single", ["deferred"]);

    await refreshSingleSources();

    expect(listSources().map(source => source.id)).toEqual([
      "single:ready",
      "single:older",
    ]);
  });

  it("leaves the published sources standing when the registry cannot be read", async () => {
    getAllSingles.mockResolvedValue([
      { slug: "site-settings", migrationStatus: "synced", fields: [] },
    ]);
    await refreshSingleSources();
    getAllSingles.mockRejectedValue(new Error("pool timeout"));

    await refreshSingleSources();

    // Not a widening: a source names what a query may ask, and every
    // execution still runs the access-controlled read.
    expect(listSources().map(source => source.id)).toEqual([
      "single:site-settings",
    ]);
  });
});
