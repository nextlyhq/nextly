/**
 * What a published page's read of one Single becomes, and what it may never
 * ask for: the same boundary as a list's read, with the Single's own fixed
 * options, every refusal made before anything is read.
 */
import { describe, expect, it, vi } from "vitest";

// The registered schema stood in for as hiding nothing: these tests are about
// what a read is built from and how it runs, not about hidden fields, which
// `public-reader-hidden.test.ts` and the declarations' own tests cover.
vi.mock("../declared-fields", async importOriginal => ({
  ...(await importOriginal<typeof import("../declared-fields")>()),
  hiddenFieldPaths: vi.fn(async () => new Set<string>()),
}));

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import {
  currentCallerScope,
  runWithCallerScope,
} from "../../../auth/caller-scope";
import {
  currentPrincipal,
  runAsPrincipal,
} from "../../../auth/principal-scope";
import { mergeConfig } from "../../../direct-api/namespaces/helpers";
import { NextlyError } from "../../../errors/nextly-error";
import { makePrincipal } from "../../../plugins/principals/principal";
import {
  createPublicReader,
  toPublicFind,
  toPublicFindSingle,
  type PublicReaderSource,
  type PublicSingleQuery,
} from "../public-reader";

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return JSON.stringify(error);
  }
  return expect.unreachable("expected a refusal");
};

/** A reader over stand-ins for the two Direct API reads. */
function readerOver(findSingle: (...args: never[]) => Promise<unknown>) {
  const find = vi.fn();
  return {
    find,
    reader: createPublicReader(
      { find, findSingle } as unknown as PublicReaderSource,
      { locale: "en" }
    ),
  };
}

describe("toPublicFindSingle", () => {
  it("fixes the boundary: published, the anonymous caller's rules, nothing created", () => {
    expect(toPublicFindSingle({ slug: "banner" })).toMatchObject({
      slug: "banner",
      status: "published",
      overrideAccess: false,
      createIfMissing: false,
      depth: 0,
      showHiddenFields: false,
    });
  });

  it("shares the list read's boundary, key for key", () => {
    // One boundary for both reads: every option that decides who sees what
    // on a list's read is on the Single's read with the same value.
    const list = toPublicFind({ collection: "posts" });
    const single = toPublicFindSingle({ slug: "banner" });
    for (const key of [
      "status",
      "overrideAccess",
      "user",
      "actor",
      "fieldAccessUser",
      "trusted",
      "req",
      "request",
      "context",
      "showHiddenFields",
      "depth",
    ] as const) {
      expect(key in single, key).toBe(true);
      expect(single[key], key).toEqual(list[key]);
    }
  });

  it("clears every identity an instance's defaults could carry into the read", () => {
    const merged = mergeConfig(
      {
        overrideAccess: true,
        user: { id: "staff" },
        actor: { actorType: "apiKey" } as unknown as AuthenticatedScope,
        fieldAccessUser: { id: "editor" },
        request: new Request("https://example.test"),
        context: { tenant: "a" },
        showHiddenFields: true,
        depth: 2,
      },
      toPublicFindSingle({ slug: "banner" })
    );
    expect(merged).toMatchObject({
      overrideAccess: false,
      showHiddenFields: false,
      depth: 0,
    });
    for (const key of [
      "user",
      "actor",
      "fieldAccessUser",
      "request",
      "context",
    ] as const) {
      expect(merged[key], key).toBeUndefined();
    }
  });

  it("reads in the route's language", () => {
    expect(toPublicFindSingle({ slug: "banner" }, { locale: "de" })).toEqual(
      expect.objectContaining({ locale: "de" })
    );
    expect(
      toPublicFindSingle({ slug: "banner", locale: "de" }, { locale: "de" })
    ).toEqual(expect.objectContaining({ locale: "de" }));
    expect(
      refusal(() =>
        toPublicFindSingle({ slug: "banner", locale: "fr" }, { locale: "de" })
      )
    ).toContain("public-read-locale-mismatch");
  });

  it.each([
    "status",
    "draft",
    "overrideAccess",
    "user",
    "trusted",
    "fieldAccessUser",
    "createIfMissing",
    "depth",
    "populate",
    "context",
    "showHiddenFields",
  ])("refuses a query that sets %s, by name", key => {
    const query = {
      slug: "banner",
      [key]: true,
    } as unknown as PublicSingleQuery;
    expect(refusal(() => toPublicFindSingle(query))).toContain(`\\"${key}\\"`);
  });

  it.each([
    [{ select: "headline" }, "select"],
    [{ select: [1] }, "select.0"],
    [{ locale: 5 }, "locale"],
    [{ slug: 7 }, "slug"],
  ])("refuses %j as the wrong type, naming where", (bad, where) => {
    const message = refusal(() =>
      toPublicFindSingle({
        slug: "banner",
        ...bad,
      } as unknown as PublicSingleQuery)
    );
    expect(message).toContain("public-read-query-invalid");
    expect(message).toContain(where);
  });

  it("asks the read for the id and the fields named, as a list's read does", () => {
    const single = toPublicFindSingle({
      slug: "banner",
      select: ["headline", "body"],
    });
    expect(single.select).toEqual({ id: true, headline: true, body: true });
    // One spelling of a selection for both reads.
    expect(single.select).toEqual(
      toPublicFind({ collection: "posts", select: ["headline", "body"] }).select
    );
  });

  // The control: with no field named the read is asked for the whole
  // document, as it always was, so an empty selection cannot narrow it.
  it.each([
    ["no selection", {}],
    ["an empty selection", { select: [] }],
  ])("asks the read for the whole document given %s", (_, query) => {
    expect("select" in toPublicFindSingle({ slug: "banner", ...query })).toBe(
      false
    );
  });

  it("refuses a query naming no Single", () => {
    expect(refusal(() => toPublicFindSingle({ slug: "" }))).toContain(
      "public-read-single-missing"
    );
  });

  it("refuses a selected field that is not a field name", () => {
    expect(
      refusal(() =>
        toPublicFindSingle({ slug: "banner", select: ["seo.title"] })
      )
    ).toContain("public-read-field-invalid");
  });
});

describe("createPublicReader findSingle", () => {
  it("reads through findSingle with the mapped arguments", async () => {
    const findSingle = vi.fn(async () => ({ id: "s1", headline: "Hi" }));
    const { reader, find } = readerOver(findSingle);
    await expect(reader.findSingle({ slug: "banner" })).resolves.toEqual({
      id: "s1",
      headline: "Hi",
    });
    expect(findSingle).toHaveBeenCalledWith(
      toPublicFindSingle({ slug: "banner" }, { locale: "en" })
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("keeps the id and the fields named, and nothing else", async () => {
    const findSingle = vi.fn(async () => ({
      id: "s1",
      headline: "Hi",
      body: "Long",
    }));
    const { reader } = readerOver(findSingle);
    await expect(
      reader.findSingle({ slug: "banner", select: ["headline", "missing"] })
    ).resolves.toEqual({ id: "s1", headline: "Hi" });
  });

  it("asks the read for only the fields named, and answers only those", async () => {
    // Takes the read, so its arguments can be read back from `mock.calls`.
    // Answers the whole document, as a read that ignores `select` does.
    const findSingle = vi.fn(async (_read: unknown) => ({
      id: "s1",
      headline: "Hi",
      body: "Long",
    }));
    const { reader } = readerOver(findSingle);
    await expect(
      reader.findSingle({ slug: "banner", select: ["headline"] })
    ).resolves.toEqual({ id: "s1", headline: "Hi" });
    expect(findSingle).toHaveBeenCalledTimes(1);
    expect(findSingle.mock.calls[0]?.[0]).toMatchObject({
      slug: "banner",
      select: { id: true, headline: true },
    });
  });

  it("asks the read for the whole document when no field is named", async () => {
    // The control for the read above: the same read, no selection.
    const findSingle = vi.fn(async (_read: unknown) => ({
      id: "s1",
      headline: "Hi",
      body: "Long",
    }));
    const { reader } = readerOver(findSingle);
    await expect(reader.findSingle({ slug: "banner" })).resolves.toEqual({
      id: "s1",
      headline: "Hi",
      body: "Long",
    });
    expect(findSingle).toHaveBeenCalledTimes(1);
    expect(findSingle.mock.calls[0]?.[0]).toMatchObject({ slug: "banner" });
    expect(findSingle.mock.calls[0]?.[0]).not.toHaveProperty("select");
  });

  it.each([
    ["missing or unpublished", NextlyError.notFound()],
    ["refused to the visitor", NextlyError.forbidden()],
    ["refused for want of a sign-in", NextlyError.authRequired()],
  ])("answers null for a Single that is %s", async (_, error) => {
    const { reader } = readerOver(
      vi.fn(async () => {
        throw error;
      })
    );
    await expect(reader.findSingle({ slug: "banner" })).resolves.toBeNull();
  });

  // A source a route hands over may fail before it returns a promise. That is
  // the same miss, so it gets the same answer.
  it.each([
    ["missing or unpublished", NextlyError.notFound()],
    ["refused to the visitor", NextlyError.forbidden()],
    ["refused for want of a sign-in", NextlyError.authRequired()],
  ])(
    "answers null for a Single that is %s when the source throws at once",
    async (_, error) => {
      const { reader } = readerOver(
        vi.fn(() => {
          throw error;
        })
      );
      await expect(reader.findSingle({ slug: "banner" })).resolves.toBeNull();
    }
  );

  it("lets any other failure through when the source throws at once", async () => {
    const failure = NextlyError.internal();
    const { reader } = readerOver(
      vi.fn(() => {
        throw failure;
      })
    );
    await expect(reader.findSingle({ slug: "banner" })).rejects.toBe(failure);
  });

  it("answers null when the Single has no document", async () => {
    const { reader } = readerOver(vi.fn(async () => null));
    await expect(reader.findSingle({ slug: "banner" })).resolves.toBeNull();
  });

  it("lets any other failure through", async () => {
    const failure = NextlyError.internal();
    const { reader } = readerOver(
      vi.fn(async () => {
        throw failure;
      })
    );
    await expect(reader.findSingle({ slug: "banner" })).rejects.toBe(failure);
  });

  it("refuses before reading", async () => {
    const findSingle = vi.fn(async () => ({ id: "s1" }));
    const { reader } = readerOver(findSingle);
    await expect(
      reader.findSingle({
        slug: "banner",
        status: "all",
      } as unknown as PublicSingleQuery)
    ).rejects.toThrow(/"status"/);
    expect(findSingle).not.toHaveBeenCalled();
  });

  it("reads detached from the request it runs in", async () => {
    const seen: unknown[] = [];
    const { reader } = readerOver(
      vi.fn(async () => {
        seen.push(currentCallerScope());
        return { id: "s1" };
      })
    );
    const scope = { actorType: "apiKey" } as unknown as AuthenticatedScope;
    await runWithCallerScope(scope, async () => {
      // The control: the scope is pinned where the reader is called.
      expect(currentCallerScope()).toBe(scope);
      await reader.findSingle({ slug: "banner" });
    });
    expect(seen).toEqual([undefined]);
  });

  it("reads as no one inside a plugin person's operation, for every read", async () => {
    const seen: unknown[] = [];
    const record = async () => {
      seen.push(currentPrincipal());
      return { id: "s1", items: [], meta: { total: 0 } };
    };
    const reader = createPublicReader({
      find: vi.fn(record),
      findSingle: vi.fn(record),
    } as unknown as PublicReaderSource);
    const person = makePrincipal("accounts:account", "acc_1", {});
    await runAsPrincipal(person, async () => {
      // The control: the person is pinned where the reader is called.
      expect(currentPrincipal()).toBe(person);
      await reader.find({ collection: "posts" });
      await reader.count({ collection: "posts" });
      await reader.findSingle({ slug: "banner" });
    });
    expect(seen).toEqual([null, null, null]);
  });

  it("refuses when the reader it was made over cannot read a Single", async () => {
    const reader = createPublicReader({
      find: vi.fn(),
    } as unknown as PublicReaderSource);
    await expect(reader.findSingle({ slug: "banner" })).rejects.toThrow(
      NextlyError
    );
  });
});
