/**
 * The sanitization hook end to end, against registry-shaped definitions.
 *
 * A stored field-group definition is a leaf reference by slug, so the hook's
 * enrichment step — resolving the referenced child schema and attaching it
 * before the descent — is what decides whether the group's nested text is
 * sanitized at all. Testing the descent alone would leave this layer free to
 * stop enriching while every unit test stays green.
 *
 * The resolved children must be read on the CALLER's executor: the hook fires
 * inside entry-write transactions, and a pooled read here waits for a
 * connection that transaction is holding. The executor assertion below is
 * load-bearing, not incidental.
 */
import { describe, expect, it, vi } from "vitest";

import type { HookContext } from "../types";

// Hoisted so the mock factory below can close over it: vitest lifts vi.mock
// above every import and const, and a plain top-level vi.fn() would still be
// uninitialized when the mocked module is first imported.
const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));

vi.mock("../../di/container", () => ({
  container: { get: (token: string) => containerGet(token) },
}));

import { createSanitizationHook } from "../sanitization-hooks";

type FieldRecord = Record<string, unknown>;

const field = (f: FieldRecord): FieldRecord => f;

function makeContext(
  data: Record<string, unknown>,
  executor: unknown = { sentinel: "tx" }
): HookContext {
  return {
    collection: "posts",
    operation: "create",
    data,
    executor,
  } as unknown as HookContext;
}

function stubRegistries(rawFields: FieldRecord[]) {
  const componentBySlug = new Map<string, FieldRecord[]>([
    ["seo", [field({ name: "title", type: "text" })]],
    ["cta", [field({ name: "label", type: "text" })]],
  ]);
  const resolvedExecutors: unknown[] = [];

  containerGet.mockImplementation((token: string) => {
    if (token === "config") {
      throw new Error("config not registered in this test");
    }
    if (token === "collectionRegistryService") {
      return {
        getCollectionBySlug: async () => ({
          fields: JSON.stringify(rawFields),
        }),
      };
    }
    if (token === "fieldGroupRegistryService") {
      return {
        getComponentBySlug: async (slug: string, executor: unknown) => {
          resolvedExecutors.push(executor);
          const fields = componentBySlug.get(slug);
          return fields ? { slug, fields } : null;
        },
      };
    }
    throw new Error(`unexpected token: ${token}`);
  });

  return resolvedExecutors;
}

describe("createSanitizationHook — registry-shaped field groups", () => {
  it("sanitizes the nested text of a migrated field-group leaf reference", async () => {
    const executors = stubRegistries([
      field({ name: "seo", type: "fieldGroup", fieldGroup: "seo" }),
    ]);
    const hook = createSanitizationHook(undefined);
    const data = { seo: { title: "<i>x</i>" } };

    // The executor identity is the load-bearing property: the lookup must run
    // on the CALLER's connection, so the sentinel the context carries is what
    // the registry stub has to have received.
    const executor = { sentinel: "tx" };
    await hook(makeContext(data, executor));

    expect(data.seo).toEqual({ title: "x" });
    expect(executors).toEqual([executor]);
  });

  it("resolves each row of a zone by its own instance type", async () => {
    stubRegistries([
      field({
        name: "slots",
        type: "component",
        components: ["seo", "cta"],
      }),
    ]);
    const hook = createSanitizationHook(undefined);
    const data = {
      slots: [
        { _componentType: "seo", title: "<i>a</i>" },
        { _componentType: "cta", label: "<i>b</i>" },
      ],
    };

    await hook(makeContext(data));

    expect(data.slots).toEqual([
      { _componentType: "seo", title: "a" },
      { _componentType: "cta", label: "b" },
    ]);
  });

  it("still sanitizes the parent's own fields when a lookup fails", async () => {
    const executors = stubRegistries([
      field({ name: "title", type: "text" }),
      field({ name: "seo", type: "fieldGroup", fieldGroup: "gone" }),
    ]);
    const hook = createSanitizationHook(undefined);
    const data = { title: "<b>y</b>", seo: { title: "<i>kept</i>" } };

    await hook(makeContext(data));

    expect(data.title).toBe("y");
    // The unresolved group's subtree stays as written, and nothing threw.
    expect(data.seo).toEqual({ title: "<i>kept</i>" });
    expect(executors).toHaveLength(1);
  });
});
