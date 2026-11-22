/**
 * State a boot publishes and a request reads is shared across copies of its
 * module. Next.js can evaluate a module in more than one server module graph;
 * each test loads two copies (`vi.resetModules` between imports), publishes
 * through the first and reads through the second, as a route in another graph
 * would.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

/** A fresh copy of `path`, as another module graph would load it. */
async function copyOf<T>(path: string): Promise<T> {
  vi.resetModules();
  return (await import(path)) as T;
}

afterEach(() => {
  const store = globalThis as unknown as Record<string, unknown>;
  for (const key of Object.keys(store)) {
    if (key.startsWith("__nextly_")) delete store[key];
  }
});

describe("state a boot publishes is read the same from another copy of its module", () => {
  it("the workflow registry", async () => {
    type Registry = typeof import("../../domains/workflows/registry");
    const boot = await copyOf<Registry>("../../domains/workflows/registry");
    const route = await copyOf<Registry>("../../domains/workflows/registry");
    expect(route).not.toBe(boot);
    const entry = {
      collections: ["notes"],
      singles: [],
    } as unknown as ReturnType<Registry["registeredWorkflows"]>[number];

    boot.publishWorkflows(new Map([["review", entry]]));

    expect(route.workflowAttachedTo("collection", "notes")).toBe(entry);
  });

  it("the audit and email retention policies", async () => {
    type Audit = typeof import("../../domains/audit/retention-config");
    type Email = typeof import("../../domains/email/retention-config");
    const auditBoot = await copyOf<Audit>(
      "../../domains/audit/retention-config"
    );
    const auditPass = await copyOf<Audit>(
      "../../domains/audit/retention-config"
    );
    const emailBoot = await copyOf<Email>(
      "../../domains/email/retention-config"
    );
    const emailPass = await copyOf<Email>(
      "../../domains/email/retention-config"
    );
    const audit = { reloaded: true } as unknown as Parameters<
      Audit["setAuditRetention"]
    >[0];
    const email = { reloaded: true } as unknown as Parameters<
      Email["setEmailRetention"]
    >[0];

    auditBoot.setAuditRetention(audit);
    emailBoot.setEmailRetention(email);

    expect(auditPass.activeAuditRetention(undefined)).toBe(audit);
    expect(emailPass.activeEmailRetention(undefined)).toBe(email);
  });

  it("the minimum password length", async () => {
    type Policy = typeof import("../../auth/password/policy");
    const boot = await copyOf<Policy>("../../auth/password/policy");
    const route = await copyOf<Policy>("../../auth/password/policy");

    boot.setMinPasswordLength(12);

    expect(route.getMinPasswordLength()).toBe(12);
  });

  it("the fields each collection declares", async () => {
    type Declared =
      typeof import("../../domains/collections/services/declared-collection-fields");
    const path =
      "../../domains/collections/services/declared-collection-fields";
    const boot = await copyOf<Declared>(path);
    const write = await copyOf<Declared>(path);
    const fields = [{ name: "title", type: "text" }];

    boot.publishDeclaredCollectionFields([{ slug: "notes", fields }]);

    expect(write.declaredCollectionFieldsOf("notes")).toBe(fields);
  });

  it("the active extension schema", async () => {
    type Active = typeof import("../../domains/schema/extension/active-schema");
    const path = "../../domains/schema/extension/active-schema";
    const boot = await copyOf<Active>(path);
    const query = await copyOf<Active>(path);
    const schema = { tables: {} } as unknown as Parameters<
      Active["setActiveExtensionSchema"]
    >[1];

    boot.setActiveExtensionSchema("postgresql", schema);

    expect(query.getActiveExtensionSchema("postgresql")).toBe(schema);
  });

  it("the plugin auth dependencies", async () => {
    type Provider = typeof import("../../plugins/plugin-auth-provider");
    const boot = await copyOf<Provider>("../../plugins/plugin-auth-provider");
    const route = await copyOf<Provider>("../../plugins/plugin-auth-provider");
    const reached = new Error("the boot's resolver was reached");

    boot.setPluginAuthDepsResolver(() => {
      throw reached;
    });

    await expect(
      route.getPluginAuthApi().currentUser(new Request("http://localhost/"))
    ).rejects.toBe(reached);
  });

  it("the migration notifier's log folder", async () => {
    type Production = typeof import("../../runtime/notifications/production");
    const path = "../../runtime/notifications/production";
    const boot = await copyOf<Production>(path);
    const apply = await copyOf<Production>(path);

    boot.setMigrationLogRoot("/nextly-process-global-test");

    expect(apply.getProductionNotifier()).toBe(boot.getProductionNotifier());
  });
});
