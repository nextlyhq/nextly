/**
 * Guards the field-level function registry: code-first `validate` /
 * `access` / `hooks` are dropped when field definitions are serialized to
 * the database, so this registry restores them by capturing the live
 * config. A regression would silently disable field access rules and hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry resolves the caller's grants through these. Mocked so a field
// rule's permission check is driven by the test rather than by a database, and
// so the number of LOOKUPS is observable — the resolver promises to make one
// per call however many rules ask.
const listEffectivePermissions = vi.fn(
  async (_userId: string) => [] as string[]
);
const listRoleSlugsForUser = vi.fn(async (_userId: string) => [] as string[]);
vi.mock("../../../services/lib/permissions", () => ({
  listEffectivePermissions: (userId: string) =>
    listEffectivePermissions(userId),
  listRoleSlugsForUser: (userId: string) => listRoleSlugsForUser(userId),
}));

import { validateEntryData } from "../entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  clearFieldFunctions,
  getFieldFunctions,
  type ReadAccessRedactions,
  registerFieldFunctions,
  runFieldHooks,
} from "../field-level-registry";

afterEach(() => clearFieldFunctions());

describe("field access can ask what the caller is granted", () => {
  beforeEach(() => {
    listEffectivePermissions.mockReset().mockResolvedValue([]);
    listRoleSlugsForUser.mockReset().mockResolvedValue([]);
  });

  const registerGated = (): void =>
    registerFieldFunctions("collection", "pages", [
      { name: "title" },
      {
        name: "customCss",
        access: {
          update: ({ permissions }: { permissions: string[] }) =>
            permissions.includes("builder-custom-css:write"),
        },
      },
    ]);

  it("strips the field when the caller lacks the permission", async () => {
    listEffectivePermissions.mockResolvedValue(["pages:update"]);
    registerGated();
    const data: Record<string, unknown> = { title: "Home", customCss: ".a{}" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "pages",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    // Silently stripped, not rejected: the rest of the write goes through and
    // whatever CSS is stored stays as it was.
    expect(data).toEqual({ title: "Home" });
  });

  it("keeps the field when the caller has it", async () => {
    listEffectivePermissions.mockResolvedValue([
      "pages:update",
      "builder-custom-css:write",
    ]);
    registerGated();
    const data: Record<string, unknown> = { title: "Home", customCss: ".a{}" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "pages",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    expect(data).toEqual({ title: "Home", customCss: ".a{}" });
  });

  it("resolves the grants once however many rules ask", async () => {
    listEffectivePermissions.mockResolvedValue(["a:read"]);
    registerFieldFunctions("collection", "pages", [
      {
        name: "one",
        access: {
          update: ({ permissions }: { permissions: string[] }) =>
            permissions.length > 0,
        },
      },
      {
        name: "two",
        access: {
          update: ({ permissions }: { permissions: string[] }) =>
            permissions.length > 0,
        },
      },
      {
        name: "three",
        access: {
          update: ({ permissions }: { permissions: string[] }) =>
            permissions.length > 0,
        },
      },
    ]);
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "pages",
      data: { one: 1, two: 2, three: 3 },
      operation: "update",
      user: { id: "u1" },
    });
    // Three rules, one lookup. Field access runs on every authenticated write,
    // so a per-rule lookup would multiply the cost by the field count.
    expect(listEffectivePermissions).toHaveBeenCalledTimes(1);
  });

  it("makes no lookup at all when no rule runs", async () => {
    registerFieldFunctions("collection", "pages", [
      { name: "title", validate: () => true },
    ]);
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "pages",
      data: { title: "Home" },
      operation: "update",
      user: { id: "u1" },
    });
    expect(listEffectivePermissions).not.toHaveBeenCalled();
  });

  it("denies when the grant lookup fails", async () => {
    listEffectivePermissions.mockRejectedValue(new Error("db down"));
    registerGated();
    const data: Record<string, unknown> = { title: "Home", customCss: ".a{}" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "pages",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    // Fail CLOSED: an unreadable grant set is not an open one.
    expect(data).toEqual({ title: "Home" });
  });
});

describe("field-level registry", () => {
  it("captures only function-bearing fields and replaces on re-register", () => {
    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
      { name: "secret", type: "text", access: { read: () => false } },
    ]);
    expect(Object.keys(getFieldFunctions("collection", "posts")!)).toEqual([
      "secret",
    ]);

    registerFieldFunctions("collection", "posts", [
      { name: "plain", type: "text" },
    ]);
    expect(getFieldFunctions("collection", "posts")).toBeUndefined();
  });

  it("write access strips denied fields silently; overrideAccess bypasses", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "internalScore",
        type: "number",
        access: {
          update: ({ req }: { req: { user?: { role?: string } } }) =>
            req.user?.role === "admin",
        },
      },
    ]);

    const data: Record<string, unknown> = { title: "t", internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { role: "editor" },
    });
    expect(data).toEqual({ title: "t" });

    const trusted: Record<string, unknown> = { internalScore: 9 };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: trusted,
      operation: "update",
      user: { role: "editor" },
      overrideAccess: true,
    });
    expect(trusted).toEqual({ internalScore: 9 });
  });

  it("read access strips denied fields and fails secure on throwing rules", async () => {
    registerFieldFunctions("collection", "posts", [
      { name: "hidden", type: "text", access: { read: () => false } },
      {
        name: "broken",
        type: "text",
        access: {
          read: () => {
            throw new Error("boom");
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = {
      id: "1",
      title: "t",
      hidden: "x",
      broken: "y",
    };
    await applyFieldReadAccess({
      kind: "collection",
      slug: "posts",
      entry,
    });
    expect(entry).toEqual({ id: "1", title: "t" });
  });

  it("shows a rule the nested values another field's redaction removes", async () => {
    // Redaction recurses into nested containers and rewrites them in place. A
    // rule at the parent level that reads into one must be shown the level as
    // it was entered, or its answer turns on which field happened to be
    // registered first.
    const seen: unknown[] = [];
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "secret", type: "text", access: { read: () => false } },
        ],
      },
      {
        name: "title",
        type: "text",
        access: {
          read: ({ data }: { data: Record<string, unknown> }) => {
            seen.push((data.meta as { secret?: string } | undefined)?.secret);
            return true;
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = {
      id: "1",
      title: "t",
      meta: { secret: "s" },
    };

    await applyFieldReadAccess({ kind: "collection", slug: "posts", entry });

    expect(seen).toEqual(["s"]);
    // The response still has it removed.
    expect(entry.meta).toEqual({});
  });

  it("keeps a rule's writes to its argument out of the entry", async () => {
    // Access callbacks decide; they do not transform. A shallow snapshot left
    // every nested container shared with the entry being judged.
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          read: ({ data }: { data: Record<string, unknown> }) => {
            const meta = data.meta as Record<string, unknown> | undefined;
            if (meta) meta.injected = "from-the-rule";
            return true;
          },
        },
      },
    ]);
    const entry: Record<string, unknown> = { id: "1", title: "t", meta: {} };

    await applyFieldReadAccess({ kind: "collection", slug: "posts", entry });

    expect(entry.meta).toEqual({});
  });

  it("accepts a payload carrying a value that cannot be structurally cloned", async () => {
    // A JSON field may define `toJSON()` to choose its stored representation.
    // Isolating the snapshot with `structuredClone` rejects the whole write on
    // such a value, before the rule it was taken for even runs.
    registerFieldFunctions("collection", "posts", [
      { name: "title", type: "text", access: { update: () => true } },
    ]);
    const data: Record<string, unknown> = {
      title: "t",
      payload: { toJSON: () => ({ ok: true }) },
    };

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      // Required: the write path treats a caller-less write as trusted and
      // returns before any rule (or snapshot) runs.
      user: { id: "u1" },
    });

    expect(data.title).toBe("t");
  });

  it("keeps a rule's writes to a Map or Set out of the payload", async () => {
    // The snapshot copies plain containers, and a Map or Set is just as
    // reachable and just as mutable — a callback writing into one would change
    // the payload that goes on to be validated and persisted.
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            (data.tags as Map<string, string>).set("injected", "x");
            (data.flags as Set<string>).add("injected");
            return true;
          },
        },
      },
    ]);
    const data: Record<string, unknown> = {
      title: "t",
      tags: new Map([["a", "1"]]),
      flags: new Set(["a"]),
    };

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });

    expect(Array.from(data.tags as Map<string, string>)).toEqual([["a", "1"]]);
    expect(Array.from(data.flags as Set<string>)).toEqual(["a"]);
  });

  it("keeps a rule's writes to a Map KEY out of the payload", async () => {
    // A mutable object used as a key is as reachable, and as writable, as the
    // value it points at.
    const key = { id: "k" };
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            for (const [entryKey] of data.tags as Map<
              Record<string, unknown>,
              string
            >) {
              entryKey.injected = "x";
            }
            return true;
          },
        },
      },
    ]);
    const data: Record<string, unknown> = {
      title: "t",
      tags: new Map([[key, "1"]]),
    };

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });

    expect(key).toEqual({ id: "k" });
  });

  it("survives a payload that refers to itself", async () => {
    // A hook is free to build a cycle. A naive deep copy would recurse until
    // the stack gives out, failing a read or write that has nothing wrong with
    // it. Shared references stay shared in the copy, so a rule comparing two
    // paths still sees what the document says.
    registerFieldFunctions("collection", "posts", [
      { name: "title", type: "text", access: { update: () => true } },
    ]);
    const shared: Record<string, unknown> = { name: "s" };
    const cyclic: Record<string, unknown> = { shared };
    cyclic.self = cyclic;
    const data: Record<string, unknown> = {
      title: "t",
      a: cyclic,
      b: shared,
    };

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });

    expect(data.title).toBe("t");
  });

  it("keeps a shared Date one object in the copy", async () => {
    // Identity is part of the contract: two paths to one value must stay one
    // value, or a callback comparing them by reference decides differently
    // from what the document says.
    const shared = new Date("2020-01-01T00:00:00.000Z");
    let sameObject: boolean | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            const a = (data.a as { at?: Date }).at;
            const b = (data.b as { at?: Date }).at;
            sameObject = a === b;
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", a: { at: shared }, b: { at: shared } },
      operation: "update",
      user: { id: "u1" },
    });

    expect(sameObject).toBe(true);
  });

  it("passes a Map subclass through instead of rebuilding it", async () => {
    // Rebuilding it as a plain Map would strip its prototype and whatever it
    // keeps privately — the same reason any other class instance is passed
    // through rather than reconstructed.
    class Tags extends Map<string, string> {
      describe(): string {
        return `tags(${this.size})`;
      }
    }
    let described: string | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            described = (data.tags as Tags).describe();
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", tags: new Tags([["a", "1"]]) },
      operation: "update",
      user: { id: "u1" },
    });

    expect(described).toBe("tags(1)");
  });

  it("keeps a sparse array's holes", async () => {
    // Iterating fills holes with `undefined` and makes them real elements, so a
    // callback testing membership decides on a different structure from the
    // payload being authorized.
    let hasHole: boolean | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            hasHole = !(1 in (data.items as unknown[]));
            return true;
          },
        },
      },
    ]);
    const items: unknown[] = [];
    items[0] = "a";
    items[2] = "c";

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", items },
      operation: "update",
      user: { id: "u1" },
    });

    expect(hasHole).toBe(true);
  });

  it("carries a decorated collection's own properties into the copy", async () => {
    // A Map can hold state beyond its entries, and a rule reading one of those
    // properties would otherwise be shown a collection missing it.
    const flags = new Map<string, string>([["a", "1"]]);
    (flags as unknown as Record<string, unknown>).restricted = true;
    let sawRestricted: unknown;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            sawRestricted = (data.flags as unknown as Record<string, unknown>)
              .restricted;
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", flags },
      operation: "update",
      user: { id: "u1" },
    });

    expect(sawRestricted).toBe(true);
  });

  it("keeps an array's decorations under their own keys", async () => {
    // `"01"` and `"1"` both coerce to the number 1, so keying a copy off the
    // number lets a decoration overwrite a real element. Non-numeric keys are
    // properties too, and dropping them shows a callback a different array from
    // the one being authorized.
    let seen: { one?: unknown; oh1?: unknown; meta?: unknown } | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            const items = data.items as unknown[] & Record<string, unknown>;
            seen = { one: items[1], oh1: items["01"], meta: items.meta };
            return true;
          },
        },
      },
    ]);
    const items = ["a", "b"] as unknown[] & Record<string, unknown>;
    items["01"] = "decoration";
    items.meta = "note";

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", items },
      operation: "update",
      user: { id: "u1" },
    });

    expect(seen).toEqual({ one: "b", oh1: "decoration", meta: "note" });
  });

  it("carries symbol-keyed metadata into the copy", async () => {
    // Metadata is often attached under a symbol, and `Object.entries` does not
    // see one — so a rule reading it would be shown a collection without the
    // state it was meant to decide on.
    const RESTRICTED = Symbol("restricted");
    const flags = new Map<string, string>();
    (flags as unknown as Record<symbol, unknown>)[RESTRICTED] = true;
    let seen: unknown;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            seen = (data.flags as unknown as Record<symbol, unknown>)[
              RESTRICTED
            ];
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", flags },
      operation: "update",
      user: { id: "u1" },
    });

    expect(seen).toBe(true);
  });

  it("copies a decorated collection without tripping inherited accessors", async () => {
    // `size` is a getter-only accessor on Map.prototype, so assigning an own
    // `size` onto the copy throws under strict mode — before the rule it was
    // taken for ever runs. `__proto__` is the other trap: assigning it would
    // repoint the copy's prototype rather than become a property on it.
    const flags = new Map<string, string>([["a", "1"]]);
    Object.defineProperty(flags, "size", {
      value: 99,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    let seen: { size?: unknown; proto?: unknown } | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            const copy = data.flags as unknown as Record<string, unknown>;
            seen = {
              size: copy.size,
              proto: Object.getPrototypeOf(copy) === Map.prototype,
            };
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", flags },
      operation: "update",
      user: { id: "u1" },
    });

    expect(seen).toEqual({ size: 99, proto: true });
  });

  it("copies an array's metadata without repointing its prototype", async () => {
    // `__proto__` is an inherited setter, so assigning that key would change
    // the copy's prototype rather than land on it as a property — and the copy
    // would lose the array methods a callback expects.
    const items = ["a", "b"];
    Object.defineProperty(items, "__proto__", {
      value: { spoofed: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    let seen: { isArray?: boolean; proto?: unknown } | undefined;
    registerFieldFunctions("collection", "posts", [
      {
        name: "title",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) => {
            const copy = data.items as unknown[];
            seen = {
              isArray: Array.isArray(copy) && typeof copy.map === "function",
              proto: Object.getPrototypeOf(copy) === Array.prototype,
            };
            return true;
          },
        },
      },
    ]);

    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data: { title: "t", items },
      operation: "update",
      user: { id: "u1" },
    });

    expect(seen).toEqual({ isArray: true, proto: true });
  });

  it("field hooks transform values in phase order", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "slugish",
        type: "text",
        hooks: {
          beforeChange: [
            ({ value }: { value: unknown }) => String(value).toLowerCase(),
            ({ value }: { value: unknown }) =>
              String(value).replace(/\s+/g, "-"),
          ],
        },
      },
    ]);
    const data: Record<string, unknown> = { slugish: "Hello World" };
    await runFieldHooks({
      kind: "collection",
      slug: "posts",
      phase: "beforeChange",
      data,
      operation: "create",
    });
    expect(data.slugish).toBe("hello-world");
  });

  it("attachFieldValidators makes registered custom validate run in the entry validator", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "code",
        type: "text",
        validate: (value: unknown) =>
          typeof value === "string" && value.startsWith("X")
            ? true
            : "Must start with X",
      },
    ]);
    // Serialized field defs carry no functions — exactly the registry's
    // reason to exist.
    const serializedFields = [{ name: "code", type: "text" }];
    const fields = attachFieldValidators(
      "collection",
      "posts",
      serializedFields
    );
    const issues = await validateEntryData({ code: "nope" }, fields, {
      mode: "create",
    });
    expect(issues).toEqual([
      { path: "code", code: "CUSTOM", message: "Must start with X." },
    ]);
  });

  it("evaluates each access rule against a snapshot, so order does not matter", async () => {
    // Rule on `b` reads `a`; rule on `a` denies. Whether `a` is deleted
    // first must not change `b`'s outcome.
    registerFieldFunctions("collection", "posts", [
      { name: "a", type: "text", access: { update: () => false } },
      {
        name: "b",
        type: "text",
        access: {
          update: ({ data }: { data: Record<string, unknown> }) =>
            data.a === "present",
        },
      },
    ]);
    const data: Record<string, unknown> = { a: "present", b: "keep" };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    // `a` denied and removed; `b` allowed because the snapshot still had `a`.
    expect(data).toEqual({ b: "keep" });
  });

  it("enforces access rules for fields nested in groups and repeaters", async () => {
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "secret", type: "text", access: { update: () => false } },
          { name: "public", type: "text" },
        ],
      },
      {
        name: "rows",
        type: "repeater",
        fields: [
          { name: "hidden", type: "text", access: { update: () => false } },
        ],
      },
    ]);
    const data: Record<string, unknown> = {
      meta: { secret: "x", public: "ok" },
      rows: [{ hidden: "a" }, { hidden: "b" }],
    };
    await applyFieldWriteAccess({
      kind: "collection",
      slug: "posts",
      data,
      operation: "update",
      user: { id: "u1" },
    });
    expect(data.meta).toEqual({ public: "ok" });
    expect(data.rows).toEqual([{}, {}]);
  });

  it("runs hooks for fields nested in groups and repeaters", async () => {
    const upper = {
      beforeChange: [
        ({ value }: { value: unknown }) => String(value).toUpperCase(),
      ],
    };
    registerFieldFunctions("collection", "posts", [
      {
        name: "meta",
        type: "group",
        fields: [{ name: "slug", type: "text", hooks: upper }],
      },
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "slug", type: "text", hooks: upper }],
      },
    ]);
    const data: Record<string, unknown> = {
      meta: { slug: "hi" },
      rows: [{ slug: "one" }, { slug: "two" }],
    };
    await runFieldHooks({
      kind: "collection",
      slug: "posts",
      phase: "beforeChange",
      data,
      operation: "update",
    });
    expect(data.meta).toEqual({ slug: "HI" });
    expect(data.rows).toEqual([{ slug: "ONE" }, { slug: "TWO" }]);
  });

  it("clears a field's stale redaction once a later pass supplies and allows it", async () => {
    // A field denied in one pass, then supplied by a hook and ALLOWED in a later
    // pass, must clear its recorded removed value. Otherwise a still-later pass
    // restores that stale value as evidence and a NEW protected field whose rule
    // reads it is wrongly allowed. Three passes over one row with a shared
    // redaction store reproduce the sequence the nested-read pipeline runs.
    registerFieldFunctions("collection", "posts", [
      { name: "flag", type: "text" },
      {
        name: "secret",
        type: "text",
        access: {
          read: ({ data }: { data: Record<string, unknown> }) =>
            data.flag === "on",
        },
      },
      {
        name: "derived",
        type: "text",
        access: {
          read: ({ data }: { data: Record<string, unknown> }) =>
            data.secret === "stale",
        },
      },
    ]);
    const redactions: ReadAccessRedactions = new WeakMap();

    // Pass 1: flag off, so `secret` is denied and its value recorded as evidence.
    const entry: Record<string, unknown> = { flag: "off", secret: "stale" };
    await applyFieldReadAccess(
      { kind: "collection", slug: "posts", entry },
      redactions
    );
    expect(entry.secret).toBeUndefined();

    // Pass 2 (a hook set flag on and supplied a fresh `secret`): it is allowed
    // now, so its stale evidence must be discarded rather than kept.
    entry.flag = "on";
    entry.secret = "fresh";
    await applyFieldReadAccess(
      { kind: "collection", slug: "posts", entry },
      redactions
    );
    expect(entry.secret).toBe("fresh");

    // Pass 3 (a later hook deleted `secret` and added `derived`, whose rule reads
    // the OLD secret value): with the stale evidence cleared, nothing restores
    // `secret`, so `derived`'s rule sees none and it is withheld.
    delete entry.secret;
    entry.derived = "leak";
    await applyFieldReadAccess(
      { kind: "collection", slug: "posts", entry },
      redactions
    );
    expect(entry.derived).toBeUndefined();
  });
});
