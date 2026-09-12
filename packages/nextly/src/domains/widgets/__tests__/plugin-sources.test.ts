/**
 * A source a PLUGIN publishes: that it is reachable at all, and what the host
 * hands its resolver.
 *
 * The chain this covers is the one that was broken by construction before
 * Phase 5.1: `registerSource` has always accepted `kind: "plugin"`, so such a
 * source was discoverable and passed query validation, and
 * `resolveExecutableSource` then refused it as "not executable yet". A plugin
 * could describe a source nobody could ever query.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();
const count = vi.fn();

// The collection path's collaborator, stubbed so the control below exercises a
// real dispatch rather than falling over on a missing Direct API.
vi.mock("../../../direct-api/nextly", () => ({
  requireNextly: () => ({ find, count }),
}));

import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import {
  clearResolvers,
  registerResolvedSource,
  sourceResolver,
} from "../resolved-sources";
import { clearSources, registerSource } from "../sources";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const revenueSource = {
  id: "plugin:stripe/revenue",
  label: "Revenue",
  kind: "plugin" as const,
  supports: ["count"] as const,
  fields: [{ name: "total", type: "number" as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  find.mockResolvedValue({ items: [] });
  count.mockResolvedValue({ total: 0 });
  clearSources();
  clearResolvers();
});

describe("a plugin's widget source", () => {
  it("is answered by the resolver registered with it", async () => {
    const resolve = vi
      .fn()
      .mockResolvedValue({ op: "count" as const, total: 42 });
    registerResolvedSource(revenueSource, resolve);

    const result = await executeWidgetQuery(
      validateWidgetQuery({ source: revenueSource.id, op: "count" }),
      caller
    );

    expect(result).toEqual({ op: "count", total: 42 });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("hands the resolver the caller, unchanged", async () => {
    // 🔴 The whole authorization story for a plugin source. The host does not
    // filter for the resolver and cannot: it passes the caller through, and
    // the plugin decides. A host that dropped the caller would leave every
    // plugin unable to scope its own rows, with nothing to say so -- the
    // resolver would simply answer the same rows to everyone.
    const resolve = vi
      .fn()
      .mockResolvedValue({ op: "count" as const, total: 1 });
    registerResolvedSource(revenueSource, resolve);

    const query = validateWidgetQuery({
      source: revenueSource.id,
      op: "count",
    });
    await executeWidgetQuery(query, caller);

    expect(resolve).toHaveBeenCalledWith(query, caller);
  });

  it("refuses a query naming a field the source never declared", async () => {
    // The resolver is never reached. Validation runs against the plugin's OWN
    // declared field list first, which is what makes the resolver signature a
    // boundary: by the time it is called, no string in the query is one the
    // caller invented.
    const resolve = vi.fn();
    registerResolvedSource(revenueSource, resolve);

    expect(() =>
      validateWidgetQuery({
        source: revenueSource.id,
        op: "count",
        where: { secret: { equals: 1 } },
      })
    ).toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a plugin source published with no resolver", async () => {
    // Reachable only by going around `registerResolvedSource` -- which is why
    // that function takes both halves at once. Asserted anyway, because the
    // generic `registerSource` door is public and a source registered through
    // it is discoverable and passes validation.
    registerSource(revenueSource);
    expect(sourceResolver(revenueSource.id)).toBeUndefined();

    await expect(
      executeWidgetQuery(
        validateWidgetQuery({ source: revenueSource.id, op: "count" }),
        caller
      )
    ).rejects.toThrow();
  });

  it("refuses a resolver offered for a collection id", async () => {
    // 🔴 The dangerous registration, and the reason the kind is checked at
    // runtime rather than left to the type. A resolver under a `collection:`
    // id answers a question the access-controlled Direct API is supposed to
    // answer, diverting that collection's rows away from every rule that
    // governs them -- and such a source is well-formed by every other check,
    // since its kind and its namespace agree.
    expect(() =>
      registerResolvedSource(
        {
          id: "collection:posts",
          label: "Posts",
          kind: "collection",
          supports: ["count"],
          fields: [{ name: "title", type: "string" }],
        } as never,
        vi.fn()
      )
    ).toThrow(/may only be registered for a "system:" or "plugin:" source/);
    // Neither store was written: a refusal that registered the source first
    // would leave it discoverable and unanswerable.
    expect(sourceResolver("collection:posts")).toBeUndefined();
  });

  it("still answers a system source from the same store", async () => {
    // The control for sharing one store between the two kinds: a change that
    // keyed resolvers by kind, or that gave plugins a store of their own,
    // would break this while every plugin case above still passed.
    const resolve = vi
      .fn()
      .mockResolvedValue({ op: "count" as const, total: 9 });
    registerResolvedSource(
      {
        id: "system:releases",
        label: "Releases",
        kind: "system",
        supports: ["count"],
        fields: [{ name: "title", type: "string" }],
      },
      resolve
    );

    const result = await executeWidgetQuery(
      validateWidgetQuery({ source: "system:releases", op: "count" }),
      caller
    );

    expect(result).toEqual({ op: "count", total: 9 });
  });
});
