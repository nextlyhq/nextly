/**
 * The address check's routes ask the permission the create of their kind asks, before anything
 * is looked up, on each dialect.
 *
 * A caller who may not create a kind is refused its check with the same answer whether the address
 * is held or free, and no registry is read for it: the check tells nobody more than the create
 * would. The control is a caller who may create the kind, whose check reads the registry (so the
 * watch on it can see a lookup) and gets the create's own answers.
 */
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { ServiceContainer } from "../../../services/index";
import { seedLiveAuthor } from "../../../domains/releases/__tests__/helpers/live-author";

/** The registry tables a check of an address reads. */
const REGISTRIES = new Set([
  "dynamic_collections",
  "dynamic_singles",
  STORAGE_FORMAT.registryTable,
]);

/** Each kind's check route. */
const ROUTES = [
  ["collections", "schema", "address-check"],
  ["singles", "schema", "address-check"],
  ["field-groups", "schema", "address-check"],
] as const;

describeEachDialect("the address check routes", dialect => {
  let current: TestNextly | undefined;
  let roleSeq = 0;

  afterEach(async () => {
    vi.restoreAllMocks();
    await current?.destroy();
    current = undefined;
  });

  async function boot(): Promise<TestNextly> {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: "notes", fields: [text({ name: "body" })] }),
      ],
    });
    await seedPermissionsAndRolePresets();
    return current;
  }

  /** A role-based API key whose role holds exactly these permissions. */
  async function keyHolding(t: TestNextly, slugs: string[]): Promise<string> {
    const permissions = await t.adapter.select<{ id: string; slug: string }>(
      "permissions",
      {}
    );
    const ids = slugs.map(slug => {
      const found = permissions.find(p => p.slug === slug);
      expect(found, `${slug} is seeded`).toBeDefined();
      return String(found!.id);
    });
    roleSeq += 1;
    const role = await new ServiceContainer(t.adapter).roles.createRole({
      name: `Address check role ${roleSeq}`,
      slug: `address-check-role-${roleSeq}`,
      permissionIds: ids,
    });
    const apiKeys = t.getService("apiKeyService") as unknown as {
      createApiKey: (
        userId: string,
        input: {
          name: string;
          tokenType: string;
          roleId: string;
          expiresIn: string;
        }
      ) => Promise<{ key: string }>;
    };
    const { key } = await apiKeys.createApiKey(await seedLiveAuthor(t), {
      name: `address check key ${roleSeq}`,
      tokenType: "role-based",
      roleId: role.id,
      expiresIn: "unlimited",
    });
    return key;
  }

  function check(
    key: string,
    path: readonly string[],
    address: string
  ): Promise<Response> {
    const request = new Request(`http://localhost/api/${path.join("/")}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ address, pendingCreates: [] }),
    });
    return createDynamicHandlers().POST(request, {
      params: Promise.resolve({ params: [...path] }),
    });
  }

  /** Watches the registry reads made while `run` runs, by table. */
  async function registryReads(
    t: TestNextly,
    run: () => Promise<void>
  ): Promise<string[]> {
    const tables: string[] = [];
    const record = (table: unknown) => {
      if (typeof table === "string" && REGISTRIES.has(table))
        tables.push(table);
    };
    const selectOne = t.adapter.selectOne.bind(t.adapter);
    const select = t.adapter.select.bind(t.adapter);
    vi.spyOn(t.adapter, "selectOne").mockImplementation((async (
      table: string,
      ...rest: unknown[]
    ) => {
      record(table);
      return (selectOne as (...a: unknown[]) => unknown)(table, ...rest);
    }) as typeof t.adapter.selectOne);
    vi.spyOn(t.adapter, "select").mockImplementation((async (
      table: string,
      ...rest: unknown[]
    ) => {
      record(table);
      return (select as (...a: unknown[]) => unknown)(table, ...rest);
    }) as typeof t.adapter.select);
    await run();
    vi.restoreAllMocks();
    return tables;
  }

  it("refuses a caller who may not create that kind, before any address is looked up", async () => {
    const t = await boot();
    const reader = await keyHolding(t, ["read-settings"]);

    for (const path of ROUTES) {
      const answers: Array<{ status: number; body: unknown }> = [];
      const reads = await registryReads(t, async () => {
        // A held address and a free one: the refusal must not tell them apart.
        for (const address of ["notes", "free-address"]) {
          const response = await check(reader, path, address);
          const body = (await response.json()) as {
            error?: { code?: string };
          };
          answers.push({ status: response.status, body: body.error?.code });
        }
      });
      expect(answers[0]?.status, path.join("/")).toBe(403);
      expect(answers[1], path.join("/")).toEqual(answers[0]);
      expect(reads, path.join("/")).toEqual([]);
    }
  });

  it("answers a caller who may create that kind as the create would, reading the registry to do it", async () => {
    const t = await boot();
    const builder = await keyHolding(t, [
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);

    let held: Response | undefined;
    const reads = await registryReads(t, async () => {
      held = await check(builder, ROUTES[0], "notes");
    });
    expect(reads.length).toBeGreaterThan(0);
    expect(held?.status).toBe(200);
    expect(await held?.json()).toEqual({
      kind: "collection",
      address: "notes",
      refusal: { code: "DUPLICATE", message: "Resource already exists." },
    });

    const free = await check(builder, ROUTES[0], "free-address");
    expect(await free.json()).toEqual({
      kind: "collection",
      address: "free-address",
      refusal: null,
    });
  });

  // The answer names the address it is about, so a client checking as a person
  // types can match it to what it sent: it comes back exactly as sent, even one
  // that reads as a date.
  it("echoes the address as it was sent, a date-like one too", async () => {
    const t = await boot();
    const builder = await keyHolding(t, [
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);
    const sent = "2026-11-13T12:00:00Z";
    const answer = (await (await check(builder, ROUTES[0], sent)).json()) as {
      address: unknown;
    };
    expect(answer.address).toBe(sent);
  });

  it("gates each kind by its own create: a field-group creator may check field groups only", async () => {
    const t = await boot();
    const fieldGroupCreator = await keyHolding(t, ["create-settings"]);

    expect((await check(fieldGroupCreator, ROUTES[2], "hero")).status).toBe(
      200
    );
    expect((await check(fieldGroupCreator, ROUTES[0], "hero")).status).toBe(
      403
    );
    expect((await check(fieldGroupCreator, ROUTES[1], "hero")).status).toBe(
      403
    );
  });
});
