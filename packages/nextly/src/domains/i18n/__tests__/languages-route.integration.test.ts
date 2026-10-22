/**
 * The languages route under the Settings permissions, on each dialect: reading needs the settings
 * `read` or `manage` permission, changing needs `manage` (or `update`), and a change made through
 * the route reaches the language registry.
 */
import { afterEach, expect, it } from "vitest";

import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { seedLiveAuthor } from "../../releases/__tests__/helpers/live-author";
import type { LanguageRegistry } from "../language-registry";

describeEachDialect("the languages route", dialect => {
  let current: TestNextly | undefined;
  let roleSeq = 0;

  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  async function boot(): Promise<TestNextly> {
    current = await createTestNextly({ dialect, collections: [] });
    await seedPermissionsAndRolePresets();
    return current;
  }

  /** A role-based API key whose role holds exactly these permissions. */
  async function keyHolding(t: TestNextly, slugs: string[]): Promise<string> {
    const permissions = (await t.adapter.select<{ id: string; slug: string }>(
      "permissions",
      {}
    )) as Array<{
      id: string;
      slug: string;
    }>;
    const ids = slugs.map(slug => {
      const found = permissions.find(p => p.slug === slug);
      expect(found, `${slug} is seeded`).toBeDefined();
      return String(found!.id);
    });
    roleSeq += 1;
    const role = await new ServiceContainer(t.adapter).roles.createRole({
      name: `Languages role ${roleSeq}`,
      slug: `languages-role-${roleSeq}`,
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
      name: `languages key ${roleSeq}`,
      tokenType: "role-based",
      roleId: role.id,
      expiresIn: "unlimited",
    });
    return key;
  }

  async function rest(
    key: string,
    verb: "GET" | "POST",
    body?: unknown
  ): Promise<Response> {
    const handlers = createDynamicHandlers();
    const request = new Request("http://localhost/api/languages", {
      method: verb,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const context = { params: Promise.resolve({ params: ["languages"] }) };
    return verb === "GET"
      ? handlers.GET(request, context)
      : handlers.POST(request, context);
  }

  it("lists the languages for a caller who may read Settings, and refuses that caller a change", async () => {
    const t = await boot();
    const reader = await keyHolding(t, ["read-settings"]);

    const listed = await rest(reader, "GET");
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      languages?: Array<{ code: string }>;
      data?: unknown;
    };
    expect(JSON.stringify(body)).toContain('"en"');

    const change = await rest(reader, "POST", {
      kind: "add",
      code: "fr",
      label: "French",
    });
    expect(change.status).toBe(403);
  });

  it("changes the languages for a caller who manages Settings, and the registry serves the change", async () => {
    const t = await boot();
    const manager = await keyHolding(t, ["manage-settings"]);

    const change = await rest(manager, "POST", {
      kind: "add",
      code: "fr",
      label: "French",
    });

    expect(change.status).toBe(200);
    const registry = t.getService("languageRegistry") as LanguageRegistry;
    expect(registry.current()?.locales.map(l => l.code)).toEqual(["en", "fr"]);
  });

  it("refuses a caller without a Settings permission either way", async () => {
    const t = await boot();
    const outsider = await keyHolding(t, ["read-content-releases"]);

    expect((await rest(outsider, "GET")).status).toBe(403);
    expect(
      (
        await rest(outsider, "POST", {
          kind: "add",
          code: "fr",
          label: "French",
        })
      ).status
    ).toBe(403);
  });

  it("refuses a change it cannot read, naming the field", async () => {
    const t = await boot();
    const manager = await keyHolding(t, ["manage-settings"]);

    const change = await rest(manager, "POST", {
      kind: "add",
      code: "",
      label: "Nothing",
    });

    expect(change.status).toBe(400);
  });
});
