/**
 * The promotion resolver, exercised directly.
 *
 * It is a pure function answering an intricate question over four documents,
 * and the integration suites reach it only through a whole publish, one shape
 * per test at considerable cost. Every defect it has had so far was a shape
 * question the caller could not see: a `Date` rebuilt as `{}`, a container
 * exempted because the caller supplied one field of it, a property deleted on
 * the live side that no traversal enumerated. Those belong here, where a shape
 * costs three lines.
 *
 * @module shared/lib/__tests__/denied-change.test
 */
import { describe, expect, it } from "vitest";

import { declaredFieldNames, resolvePromotedDocument } from "../denied-change";

/** Removes the named top-level or nested paths, as the field rules would. */
function denies(...paths: string[]) {
  return (document: Record<string, unknown>): Promise<void> => {
    for (const path of paths) {
      const segments = path.split(".");
      let cursor: Record<string, unknown> | undefined = document;
      for (const segment of segments.slice(0, -1)) {
        const next: unknown = cursor?.[segment];
        cursor =
          typeof next === "object" && next !== null
            ? (next as Record<string, unknown>)
            : undefined;
      }
      const last = segments[segments.length - 1];
      if (cursor && last) delete cursor[last];
    }
    return Promise.resolve();
  };
}

const allow = (): Promise<void> => Promise.resolve();

function resolve(
  input: Partial<Parameters<typeof resolvePromotedDocument>[0]> & {
    before: Record<string, unknown>;
    live: Record<string, unknown>;
  }
) {
  return resolvePromotedDocument({
    applyRules: allow,
    slug: "posts",
    ...input,
  });
}

describe("resolvePromotedDocument", () => {
  it("returns the promotion unchanged when nothing is denied", async () => {
    const out = await resolve({
      before: { title: "new", body: "new body" },
      live: { title: "old", body: "old body" },
    });
    expect(out).toEqual({ title: "new", body: "new body" });
  });

  it("holds a denied field at its live value rather than dropping it", async () => {
    const out = await resolve({
      before: { title: "new", guarded: "live" },
      live: { title: "old", guarded: "live" },
      applyRules: denies("guarded"),
    });
    // Present, and at what the row already holds. Dropped instead, the write
    // clears a column nobody asked it to.
    expect(out).toEqual({ title: "new", guarded: "live" });
  });

  it("refuses when the promotion CHANGES a denied field", async () => {
    await expect(
      resolve({
        before: { guarded: "edited" },
        live: { guarded: "live" },
        applyRules: denies("guarded"),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps a denied child inside an allowed container", async () => {
    const out = await resolve({
      before: { seo: { title: "new", secret: "live" } },
      live: { seo: { title: "old", secret: "live" } },
      applyRules: denies("seo.secret"),
    });
    expect(out).toEqual({ seo: { title: "new", secret: "live" } });
  });

  it("treats a Date as a value, not a container to rebuild", async () => {
    const when = new Date("2026-09-09T09:09:09.000Z");
    const out = await resolve({
      before: { goesLive: when, guarded: "live" },
      live: { goesLive: new Date("2026-01-01T00:00:00.000Z"), guarded: "live" },
      applyRules: denies("guarded"),
    });
    // Rebuilt as an object it becomes `{}`, and the driver refuses the write
    // with "value.getTime is not a function".
    expect(out.goesLive).toBeInstanceOf(Date);
    expect((out.goesLive as Date).toISOString()).toBe(
      "2026-09-09T09:09:09.000Z"
    );
  });

  it("does not read a Date as an edit when both sides mean the same instant", async () => {
    // A pending change is JSON, so it carries the ISO string; the row comes
    // back from the driver as a Date.
    const out = await resolve({
      before: { guarded: "2026-01-02T03:04:05.000Z" },
      live: { guarded: new Date("2026-01-02T03:04:05.000Z") },
      applyRules: denies("guarded"),
    });
    expect(out).toBeDefined();
  });

  it("drops the CALLER's own denied edit back to live instead of refusing", async () => {
    const out = await resolve({
      before: { guarded: "caller wrote this" },
      live: { guarded: "live" },
      callerSupplied: { guarded: "caller wrote this" },
      applyRules: denies("guarded"),
    });
    expect(out).toEqual({ guarded: "live" });
  });

  it("still refuses a sibling the caller did NOT supply, inside the same container", async () => {
    // The removal is reported at the container, and its contents have two
    // authors: exempting the whole subtree loses the pending change's sibling.
    await expect(
      resolve({
        before: { promo: { label: "caller", tagline: "draft" } },
        live: { promo: { label: "live", tagline: "live tagline" } },
        callerSupplied: { promo: { label: "caller" } },
        applyRules: denies("promo"),
      })
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "promo.tagline" }] },
    });
  });

  it("refuses a denied property the promotion DELETES", async () => {
    // Absent from the promotion, so the rules never judged it there: it is the
    // live-side pass that puts it in the denied set at all.
    await expect(
      resolve({
        before: { seo: { title: "new" } },
        live: { seo: { title: "old", secret: "live" } },
        applyRules: denies("seo.secret"),
      })
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "seo.secret" }] },
    });
  });

  it("does not import a stale live verdict for a field the promotion still holds", async () => {
    // A rule reads its siblings. Live says `kind: "private"`, which denies
    // `guarded`; the pending change sets `kind` to `public` and edits `guarded`
    // legitimately. The promoted document is the one that has the right of it,
    // so taking live's verdict too would refuse a valid publish.
    const rulesByKind = (document: Record<string, unknown>): Promise<void> => {
      if (document.kind === "private") delete document.guarded;
      return Promise.resolve();
    };
    const out = await resolve({
      before: { kind: "public", guarded: "edited" },
      live: { kind: "private", guarded: "live" },
      applyRules: rulesByKind,
    });
    expect(out).toEqual({ kind: "public", guarded: "edited" });
  });

  it("refuses a deleted child even when the live rule denies its whole container", async () => {
    // The live rule removes `seo` entirely, so the live-side denial names the
    // container. The promotion keeps `seo` and drops `secret` from inside it,
    // so a filter applied at the container asks the wrong question and the
    // deletion goes through unjudged.
    const rulesByKind = (document: Record<string, unknown>): Promise<void> => {
      if (document.kind === "private") delete document.seo;
      return Promise.resolve();
    };
    await expect(
      resolve({
        before: { kind: "public", seo: { title: "new" } },
        live: { kind: "private", seo: { title: "old", secret: "live" } },
        applyRules: rulesByKind,
      })
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "seo.secret" }] },
    });
  });

  it("keeps an own __proto__ key instead of invoking the prototype setter", async () => {
    const before: Record<string, unknown> = { guarded: "live" };
    Object.defineProperty(before, "__proto__", {
      value: { evil: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const out = await resolve({
      before,
      live: { guarded: "live" },
      applyRules: denies("guarded"),
    });
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it("judges a declared field named like a store column", async () => {
    // `id` is one of the store's own column names, and the name list exists so
    // a denied component's own row identity and timestamps do not refuse every
    // publish. A collection that DECLARES a field called `id` means it, and
    // skipping that one lets an edit the rules deny reach the row.
    await expect(
      resolve({
        before: { meta: { id: "draft wrote this" } },
        live: { meta: { id: "live" } },
        authoredFieldNames: new Set(["meta", "id"]),
        applyRules: denies("meta.id"),
      })
    ).rejects.toMatchObject({
      publicData: { errors: [{ path: "meta.id" }] },
    });
  });

  it("still skips a store column the schema does NOT declare", async () => {
    // The control for the test above. A component row carries its own `id` and
    // timestamps beside the author's fields, and a snapshot's never match the
    // row's, so counted as content a denied component refuses every publish.
    const out = await resolve({
      before: { promo: { label: "live", id: "row-1", updated_at: "T1" } },
      live: { promo: { label: "live", id: "row-1", updated_at: "T2" } },
      authoredFieldNames: new Set(["promo", "label"]),
      applyRules: denies("promo"),
    });
    expect(out).toBeDefined();
  });

  it("collects a name declared inside a NAMED container", async () => {
    // `addressableFields` pushes a named field and stops, so a set built from
    // it holds the top level only, and the nested name the metadata list is
    // meant to defer to is exactly the one it misses.
    const names = declaredFieldNames([
      { name: "title", type: "text" },
      { name: "meta", type: "group", fields: [{ name: "id", type: "text" }] },
      {
        type: "row",
        fields: [
          {
            name: "rows",
            type: "repeater",
            fields: [{ name: "updatedAt", type: "text" }],
          },
        ],
      },
    ]);
    expect(names.has("meta")).toBe(true);
    expect(names.has("id")).toBe(true);
    expect(names.has("updatedAt")).toBe(true);
  });

  it("leaves an allowed deletion deleted", async () => {
    const out = await resolve({
      before: { title: "new" },
      live: { title: "old", subtitle: "going away" },
    });
    expect(Object.prototype.hasOwnProperty.call(out, "subtitle")).toBe(false);
  });
});
