/**
 * The line a start logs when a permission's orphan mark changes says what
 * happened to the permission and to its grants, and what it says is what the
 * database holds.
 *
 * Each change is made by a start's own seeding, on in-memory SQLite: a start
 * without the plugin that declares the permission marks it orphaned, and a
 * start with the plugin back clears the mark. The roles the line names are
 * compared with the roles holding the permission just before the start and
 * once the start has finished, preset roles set again included, so a line
 * claiming grants that the same start then took away fails here.
 */
import { afterEach, describe, expect, it } from "vitest";

import { seedPermissionsAndRolePresets } from "../../../../init/seed-permissions";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { ServiceContainer } from "../../../../services/index";
import type { Logger } from "../../../../services/shared";

const SLUG = "export-submissions";

const formsPlugin = definePlugin({
  name: "@test/forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    permissions: [{ action: "export", resource: "submissions" }],
  },
});

/** Every info line logged since the last reset. */
let infoLines: string[] = [];

const logger = {
  debug() {},
  info(message: unknown) {
    infoLines.push(String(message));
  },
  warn() {},
  error() {},
} as unknown as Logger;

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

function setInstalled(nextly: TestNextly, installed: boolean): void {
  const plugins = nextly.getService("config").plugins;
  if (!plugins) throw new Error("the configuration lists no plugins");
  plugins.splice(0);
  if (installed) plugins.push(formsPlugin);
}

/** The slugs of the roles holding the permission, sorted, read from the database. */
async function holders(nextly: TestNextly): Promise<string[]> {
  const adapter = nextly.adapter;
  const [permission] = await adapter.select<{ id: string }>("permissions", {
    where: { and: [{ column: "slug", op: "=", value: SLUG }] },
  });
  if (!permission) throw new Error(`no ${SLUG} permission`);
  const grants = await adapter.select<{ roleId: string }>("role_permissions", {
    where: {
      and: [{ column: "permissionId", op: "=", value: String(permission.id) }],
    },
  });
  const roles = new Map(
    (await adapter.select<{ id: string; slug: string }>("roles", {})).map(
      row => [String(row.id), String(row.slug)]
    )
  );
  return grants.map(grant => String(roles.get(String(grant.roleId)))).sort();
}

/**
 * The one line logged about the permission's orphan mark during the start,
 * and the roles it names as holding the permission.
 */
function markLine(): { line: string; roles: string[] } {
  const lines = infoLines.filter(line => line.includes(`"${SLUG}"`));
  expect(lines).toHaveLength(1);
  const line = lines[0];
  const named = /\((?:\d+ roles?: ([^)]*)|no role holds it)\)\.$/.exec(line);
  if (!named) throw new Error(`the line names no grants: ${line}`);
  const roles = named[1] ? named[1].split(", ").sort() : [];
  return { line, roles };
}

/** A start's seeding, with only its own lines captured. */
async function start(): Promise<void> {
  infoLines = [];
  await seedPermissionsAndRolePresets();
}

describe("the line logged when a permission's orphan mark changes", () => {
  it("names the grants kept when the permission is orphaned, as the database holds them", async () => {
    handle = await createTestNextly({ logger, plugins: [formsPlugin] });
    await start();
    const services = new ServiceContainer(handle.adapter);
    const [permission] = await handle.adapter.select<{ id: string }>(
      "permissions",
      { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
    );
    await services.roles.createRole({
      name: "Exporter",
      slug: "exporter",
      permissionIds: [String(permission.id)],
    });

    const before = await holders(handle);
    expect(before).toEqual(["admin", "exporter"]);

    setInstalled(handle, false);
    await start();
    const orphaned = markLine();
    expect(orphaned.line).toContain("no longer declared by @test/forms");
    expect(orphaned.line).toContain("marked orphaned");
    expect(orphaned.line).toContain("grants are kept");
    expect(orphaned.roles).toEqual(before);
    expect(await holders(handle)).toEqual(orphaned.roles);

    setInstalled(handle, true);
    await start();
    const declared = markLine();
    expect(declared.line).toContain("declared again by @test/forms");
    expect(declared.line).toContain("orphan mark cleared");
    expect(declared.line).toContain("grants are as they were");
    expect(declared.roles).toEqual(before);
    expect(await holders(handle)).toEqual(declared.roles);
  });

  it("says no role holds a permission orphaned without grants", async () => {
    handle = await createTestNextly({ logger, plugins: [formsPlugin] });
    await start();
    const admin = await new ServiceContainer(
      handle.adapter
    ).roles.findRoleIdBySlug("admin");
    if (!admin) throw new Error("no admin role");
    await new ServiceContainer(
      handle.adapter
    ).rolePermissions.removePermissionFromRole(String(admin.id), {
      action: "export",
      resource: "submissions",
    });
    expect(await holders(handle)).toEqual([]);

    setInstalled(handle, false);
    await start();
    const orphaned = markLine();
    expect(orphaned.line).toContain("(no role holds it).");
    expect(orphaned.roles).toEqual([]);
    expect(await holders(handle)).toEqual([]);
  });
});
