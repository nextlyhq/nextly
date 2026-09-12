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
import { clearSources, listSources, registerSource } from "../sources";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const revenueSource = {
  id: "plugin:stripe/revenue",
  label: "Revenue",
  kind: "plugin" as const,
  supports: ["count"] as const,
  fields: [{ name: "total", type: "number" as const }],
};

/**
 * The id the source store actually holds for the one `plugin:` source a case
 * registered.
 *
 * Read back from the store rather than assumed, because the case that needs it
 * is about an id whose every read can differ -- naming the expected value here
 * would assert the drift instead of detecting it.
 */
function publishedPluginSourceId(): string {
  const ids = listSources()
    .filter(source => source.kind === "plugin")
    .map(source => source.id);
  expect(ids).toHaveLength(1);
  return ids[0] as string;
}

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
    // declared field list first, so a field name the source never published
    // cannot reach it. That bounds the SHAPE of the question and nothing more:
    // operand VALUES stay caller-controlled, which is why `resolved-sources.ts`
    // makes validating them the resolver's job rather than promising it here.
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

  it("keys the resolver under the id the SOURCE store published", async () => {
    // 🔴 The atomicity the one-call signature promises, against an `id` that
    // answers differently on each read. An accessor and a Proxy trap are both
    // ordinary JavaScript and a plugin's source object is the plugin's, so the
    // host cannot assume a property is a stored value. Registration reads `id`
    // on the way in, so keying the resolver by reading it AGAIN files it under
    // a key no source claims -- the source publishes, every query for it fails
    // as unanswerable, and nothing reports the mismatch.
    let reads = 0;
    const drifting = {
      get id() {
        reads += 1;
        return `plugin:acme/drift-${reads}`;
      },
      label: "Drifting",
      kind: "plugin" as const,
      supports: ["count"] as const,
      fields: [{ name: "total", type: "number" as const }],
    };

    const resolve = vi
      .fn()
      .mockResolvedValue({ op: "count" as const, total: 7 });
    registerResolvedSource(drifting, resolve);

    // More than one read happened, or the case is not exercising anything.
    expect(reads).toBeGreaterThan(1);

    // The id the store published is the one a reader can address, so it is the
    // one the resolver has to be under. Asked of the store rather than of a
    // literal: which read wins is the registry's business, and pinning it here
    // would make this test a copy of the implementation.
    const published = publishedPluginSourceId();
    expect(sourceResolver(published)).toBe(resolve);

    const result = await executeWidgetQuery(
      validateWidgetQuery({ source: published, op: "count" }),
      caller
    );
    expect(result).toEqual({ op: "count", total: 7 });
  });
});
