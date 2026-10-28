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
import { LanguageRegistry } from "../language-registry";
import { LanguageSettingsService } from "../services/language-settings-service";
import { storedLanguageReader } from "../stored-language-reader";

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
    // The canonical list envelope, as every list endpoint answers: the languages in `items`, and
    // whether the configuration locks them beside the page facts in `meta`.
    const body = (await listed.json()) as {
      items?: Array<{ code: string }>;
      meta?: { total?: number; lockedByConfig?: boolean };
    };
    expect(body.items?.map(l => l.code)).toEqual(["en"]);
    expect(body.meta).toMatchObject({ total: 1, lockedByConfig: false });

    const change = await rest(reader, "POST", {
      kind: "add",
      code: "fr",
      label: "French",
    });
    expect(change.status).toBe(403);
  });

  it("changes the languages for a caller who manages Settings, and the registry serves the change", async () => {
    const t = await boot();
    const manager = await keyHolding(t, [
      "read-settings",
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);

    const change = await rest(manager, "POST", {
      kind: "add",
      code: "fr",
      label: "French",
    });

    expect(change.status).toBe(200);
    const registry = t.getService("languageRegistry") as LanguageRegistry;
    expect(registry.current()?.locales.map(l => l.code)).toEqual(["en", "fr"]);
  });

  // The admin's workspace is read outside a content request, so it brings the list up to date
  // itself: a language added on another server reaches it within the registry's interval.
  it("tells the admin's workspace of a language another server added", async () => {
    const t = await boot();
    const reader = await keyHolding(t, ["read-settings"]);
    // Another server: its own registry, writing to the same database.
    const elsewhere = new LanguageSettingsService(
      t.adapter,
      new LanguageRegistry({ reader: storedLanguageReader(t.adapter) })
    );
    await elsewhere.change({ kind: "add", code: "fr", label: "French" });
    // Past this server's interval for trusting the list it last read.
    await new Promise(resolve => setTimeout(resolve, 1100));

    const handlers = createDynamicHandlers();
    const response = await handlers.GET(
      new Request("http://localhost/api/admin-meta/workspace", {
        headers: { authorization: `Bearer ${reader}` },
      }),
      { params: Promise.resolve({ params: ["admin-meta", "workspace"] }) }
    );

    expect(response.status).toBe(200);
    const workspace = (await response.json()) as {
      locales?: { locales?: Array<{ code: string }> };
    };
    expect(workspace.locales?.locales?.map(l => l.code)).toEqual(["en", "fr"]);
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
    const manager = await keyHolding(t, [
      "read-settings",
      "create-settings",
      "update-settings",
      "delete-settings",
    ]);

    const change = await rest(manager, "POST", {
      kind: "add",
      code: "",
      label: "Nothing",
    });

    expect(change.status).toBe(400);
  });
});
