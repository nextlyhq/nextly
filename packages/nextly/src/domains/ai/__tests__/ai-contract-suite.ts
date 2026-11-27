/**
 * The AI contract on a booted site, one dialect per file: the three
 * permissions as seeding stores them, who the built-in roles give them to on
 * a fresh site and on an upgraded one, and what `nextly.ai` refuses before a
 * provider is asked.
 *
 * Each dialect runs in a file of its own (`ai-contract.<dialect>
 * .integration.test.ts`) so a run on one server never reads another's rows.
 * The provider is a stub registered through the "ai" capability in the test,
 * since the real package comes later; the tasks are recorded through core's
 * task-list seam for the same reason.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../../collections/config/define-collection";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import { ServiceContainer } from "../../../services/index";
import { SUPER_ADMIN_SLUG } from "../../../services/access/super-admin";
import {
  AI_OFF_SWITCH,
  AI_PERMISSIONS,
  type AIProvider,
  type AIProviderRunRequest,
  type AITaskRef,
} from "../ai-contract";
import { recordAITasks } from "../ai-task-list";

const AI_SLUGS: string[] = Object.values(AI_PERMISSIONS)
  .map(p => p.slug)
  .sort();
const AI_RESOURCES: string[] = Object.values(AI_PERMISSIONS).map(
  p => p.resource
);

/** Writes its result onto the target, so running it needs `update` there. */
const ALT_TEXT: AITaskRef = {
  owner: "@test/ai",
  name: "alt-text",
  role: "vision",
  writesToTarget: true,
};

const POSTS: CollectionConfig = {
  slug: "posts",
  fields: [{ name: "title", type: "text" }],
  grants: { presets: ["admin", "editor", "author", "viewer"] },
};

/** A stub provider whose settings are an object the test can read back. */
function stubAI() {
  const settings = { roles: { vision: true, writer: true } };
  const asked: AIProviderRunRequest[] = [];
  const provider: AIProvider = {
    status: () => ({ roles: { ...settings.roles } }),
    run: async request => {
      asked.push(request);
      return {
        output: { alt: "A red bicycle" },
        usage: {
          model: "stub",
          tokensIn: 1,
          tokensOut: 1,
          estimatedCostMicroUsd: 1,
        },
      };
    },
    stream: () => Promise.reject(new Error("not used here")),
    embed: () => Promise.reject(new Error("not used here")),
  };
  const plugin = definePlugin({
    name: "@test/ai",
    version: "1.0.0",
    nextly: ">=0.0.0",
    provides: ["ai"],
    contributes: { services: { ai: () => provider } },
  });
  return { settings, asked, plugin };
}

/** Each booted site's first account, its super admin. */
const owners = new WeakMap<TestNextly, string>();

function ownerOf(t: TestNextly): string {
  const owner = owners.get(t);
  if (owner === undefined) throw new Error("site booted without an owner");
  return owner;
}

async function boot(
  dialect: TestDialect,
  plugins: ReturnType<typeof stubAI>["plugin"][] = []
): Promise<TestNextly> {
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [POSTS],
    // The boot's own seeding: permissions, then the preset roles over them.
    seedPublic: true,
    plugins,
  });
  // The site's first account becomes its super admin, as on a real site, so
  // the people each case makes after it hold only the roles they are given.
  try {
    const made = await t.nextly.users.create({
      email: "owner@ai.test",
      password: "Password123!",
      data: { name: "owner", isActive: true },
    });
    owners.set(t, String((made.item as { id: string | number }).id));
  } catch (error) {
    await t.destroy();
    throw error;
  }
  return t;
}

/** The AI permission rows as stored. */
async function storedAIPermissions(t: TestNextly) {
  const all = (await t.nextly.permissions.find({ limit: 500 })).items;
  return all
    .filter(p => AI_RESOURCES.includes(String(p.resource)))
    .map(p => ({
      slug: String(p.slug),
      action: String(p.action),
      resource: String(p.resource),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** The AI permission slugs a role holds, by the role's slug. */
async function aiGrantsOf(t: TestNextly, roleSlug: string): Promise<string[]> {
  const role = (await t.nextly.roles.find({ limit: 200 })).items.find(
    r => r.slug === roleSlug
  );
  if (role === undefined) throw new Error(`no role ${roleSlug}`);
  const held = await t.nextly.roles.getPermissions({ id: String(role.id) });
  return held
    .map(p => String(p.slug))
    .filter(slug => AI_SLUGS.includes(slug))
    .sort();
}

/** Permission ids by slug, for the roles a test makes. */
async function permissionIds(t: TestNextly, slugs: readonly string[]) {
  const all = (await t.nextly.permissions.find({ limit: 500 })).items;
  return slugs.map(slug => {
    const found = all.find(p => p.slug === slug);
    if (found === undefined) throw new Error(`no permission ${slug}`);
    return String(found.id);
  });
}

/** A person holding a new role made of exactly these permissions. */
async function personWith(
  t: TestNextly,
  name: string,
  slugs: readonly string[]
) {
  const services = new ServiceContainer(t.adapter);
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: await permissionIds(t, slugs) },
  });
  return personInRole(t, name, String(role.item.id), services);
}

/** A person holding one existing role, by its id. */
async function personInRole(
  t: TestNextly,
  name: string,
  roleId: string,
  services = new ServiceContainer(t.adapter)
): Promise<string> {
  const made = await t.nextly.users.create({
    email: `${name}@ai.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  return id;
}

async function roleId(t: TestNextly, slug: string): Promise<string> {
  const role = (await t.nextly.roles.find({ limit: 200 })).items.find(
    r => r.slug === slug
  );
  if (role === undefined) throw new Error(`no role ${slug}`);
  return String(role.id);
}

async function refusal(promise: Promise<unknown>): Promise<NextlyError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  if (!NextlyError.is(error)) {
    throw new Error(`expected a NextlyError, got ${String(error)}`);
  }
  return error;
}

export function describeAIContract(dialect: TestDialect): void {
  const configured = getConfiguredTestDialects().includes(dialect);
  (configured ? describe : describe.skip)(
    `the AI contract (${dialect})`,
    () => {
      describe("on a fresh site with no AI package", () => {
        let t: TestNextly;
        beforeAll(async () => {
          t = await boot(dialect);
        }, 120_000);
        afterAll(async () => {
          await t?.destroy();
        });

        it("seeds the three AI permissions with their verbs and names", async () => {
          expect(await storedAIPermissions(t)).toEqual([
            {
              slug: "manage-ai-settings",
              action: "manage",
              resource: "ai-settings",
            },
            {
              slug: "run-bulk-ai-jobs",
              action: "run",
              resource: "bulk-ai-jobs",
            },
            { slug: "use-ai", action: "use", resource: "ai" },
          ]);
        });

        it("grants super admins and Admin all three, Editor and Author Use AI, Viewer none", async () => {
          // A super admin holds every permission by being one, whenever the
          // role was made; asked as they are judged.
          const superAdmin = await t.nextly.ai.status({
            user: { id: ownerOf(t) },
          });
          expect(superAdmin.permissions).toEqual({
            use: true,
            bulk: true,
            manage: true,
          });
          expect(await aiGrantsOf(t, "admin")).toEqual(AI_SLUGS);
          expect(await aiGrantsOf(t, "editor")).toEqual(["use-ai"]);
          expect(await aiGrantsOf(t, "author")).toEqual(["use-ai"]);
          expect(await aiGrantsOf(t, "viewer")).toEqual([]);
        });

        it("reports AI not configured and refuses a run with the setup message", async () => {
          const editor = await personInRole(
            t,
            "nopkg-editor",
            await roleId(t, "editor")
          );
          const status = await t.nextly.ai.status({ user: { id: editor } });
          expect(status).toMatchObject({
            configured: false,
            reason: "no-ai-package",
            permissions: { use: true, bulk: false, manage: false },
          });
          recordAITasks([ALT_TEXT]);
          try {
            const error = await refusal(
              t.nextly.ai.run({
                user: { id: editor },
                task: { owner: "@test/ai", name: "alt-text" },
                input: {},
                target: { collection: "posts" },
              })
            );
            expect(error.code).toBe("SERVICE_UNAVAILABLE");
            expect(error.publicMessage).toContain("@nextlyhq/ai");
          } finally {
            recordAITasks([]);
          }
        });
      });

      describe("on an upgraded site with a custom role", () => {
        let t: TestNextly;
        beforeAll(async () => {
          t = await boot(dialect);
        }, 120_000);
        afterAll(async () => {
          await t?.destroy();
        });

        it("grants the built-in roles as on a fresh site and the custom role none", async () => {
          // The site as it was before AI: no AI permission, and a custom role
          // an administrator made then.
          const ids = await permissionIds(t, AI_SLUGS);
          for (const id of ids) {
            await t.adapter.executeQuery(
              `DELETE FROM role_permissions WHERE permission_id = '${id}'`
            );
            await t.adapter.executeQuery(
              `DELETE FROM permissions WHERE id = '${id}'`
            );
          }
          expect(await storedAIPermissions(t)).toEqual([]);
          await t.nextly.roles.create({
            data: {
              name: "Reviewer",
              slug: "reviewer",
              permissionIds: await permissionIds(t, ["read-posts"]),
            },
          });

          // The upgraded release's first start.
          await seedPermissionsAndRolePresets();

          expect((await storedAIPermissions(t)).map(p => p.slug)).toEqual(
            AI_SLUGS
          );
          expect(await aiGrantsOf(t, SUPER_ADMIN_SLUG)).toEqual(AI_SLUGS);
          expect(await aiGrantsOf(t, "admin")).toEqual(AI_SLUGS);
          expect(await aiGrantsOf(t, "editor")).toEqual(["use-ai"]);
          expect(await aiGrantsOf(t, "author")).toEqual(["use-ai"]);
          expect(await aiGrantsOf(t, "viewer")).toEqual([]);
          expect(await aiGrantsOf(t, "reviewer")).toEqual([]);
        });
      });

      describe("with an AI provider", () => {
        let t: TestNextly;
        let ai: ReturnType<typeof stubAI>;
        beforeAll(async () => {
          ai = stubAI();
          t = await boot(dialect, [ai.plugin]);
          recordAITasks([ALT_TEXT]);
        }, 120_000);
        afterEach(() => {
          delete process.env[AI_OFF_SWITCH];
          ai.asked.length = 0;
        });
        afterAll(async () => {
          recordAITasks([]);
          await t?.destroy();
        });

        const altText = (userId: string) => ({
          user: { id: userId },
          task: { owner: "@test/ai", name: "alt-text" },
          input: { image: "m1" },
          target: { collection: "posts" },
        });

        it("refuses a person who may use AI and read the target but not edit it", async () => {
          const reader = await personWith(t, "ai-reader", [
            "use-ai",
            "read-posts",
          ]);
          const error = await refusal(t.nextly.ai.run(altText(reader)));
          expect(error.code).toBe("FORBIDDEN");
          expect(ai.asked).toEqual([]);

          // The same person given the edit runs it: the refusal was the edit.
          const writer = await personWith(t, "ai-writer", [
            "use-ai",
            "read-posts",
            "update-posts",
          ]);
          await expect(t.nextly.ai.run(altText(writer))).resolves.toMatchObject(
            {
              output: { alt: "A red bicycle" },
            }
          );
          expect(ai.asked.map(r => r.personId)).toEqual([writer]);
        });

        it("judges a call made through an API key on the key's own grants, not its owner's", async () => {
          // The owner is the site's super admin; the key may only read posts.
          const keyScope = {
            actorType: "apiKey" as const,
            permissions: ["read-posts"],
            roles: [],
          };
          const error = await refusal(
            t.nextly.ai.run({ ...altText(ownerOf(t)), actor: keyScope })
          );
          expect(error.code).toBe("FORBIDDEN");
          expect(error.publicMessage).toBe("You can't use AI.");
          const status = await t.nextly.ai.status({
            user: { id: ownerOf(t) },
            actor: keyScope,
          });
          expect(status.permissions).toEqual({
            use: false,
            bulk: false,
            manage: false,
          });
          expect(ai.asked).toEqual([]);
        });

        it("hands back the stop function for a usage listener, and tells it about each run", async () => {
          const heard: string[] = [];
          const stop = t.nextly.ai.onUsage(event => {
            heard.push(event.result);
          });
          expect(typeof stop).toBe("function");
          const writer = await personWith(t, "ai-listened", [
            "use-ai",
            "read-posts",
            "update-posts",
          ]);
          await t.nextly.ai.run(altText(writer));
          stop();
          await t.nextly.ai.run(altText(writer));
          expect(heard).toEqual(["succeeded"]);
        });

        it("shows a task unavailable on content the person may read but not edit", async () => {
          const reader = await personWith(t, "ai-status-reader", [
            "use-ai",
            "read-posts",
          ]);
          const onPosts = await t.nextly.ai.status({
            user: { id: reader },
            target: { collection: "posts" },
          });
          expect(onPosts.tasks).toEqual([
            {
              owner: "@test/ai",
              name: "alt-text",
              role: "vision",
              available: false,
              reason: "missing-permission",
              permission: "update-posts",
            },
          ]);
          const anywhere = await t.nextly.ai.status({ user: { id: reader } });
          expect(anywhere.tasks[0]?.available).toBe(true);
        });

        it("refuses a Viewer's run, saying they can't use AI", async () => {
          const viewer = await personInRole(
            t,
            "ai-viewer",
            await roleId(t, "viewer")
          );
          const error = await refusal(t.nextly.ai.run(altText(viewer)));
          expect(error.code).toBe("FORBIDDEN");
          expect(error.publicMessage).toBe("You can't use AI.");
          expect(ai.asked).toEqual([]);
        });

        it("refuses an agent acting for an Author that starts a bulk job, and lets one acting for an Admin", async () => {
          const author = await personInRole(
            t,
            "ai-author",
            await roleId(t, "author")
          );
          const error = await refusal(
            t.nextly.ai.checkBulkJob({
              user: { id: author },
              agent: { id: "agent-1", name: "Agent" },
            })
          );
          expect(error.code).toBe("FORBIDDEN");
          expect(error.publicMessage).toBe("You can't run bulk AI jobs.");

          const admin = await personInRole(
            t,
            "ai-admin",
            await roleId(t, "admin")
          );
          await expect(
            t.nextly.ai.checkBulkJob({
              user: { id: admin },
              agent: { id: "agent-1", name: "Agent" },
            })
          ).resolves.toBeUndefined();
        });

        it("turns off with the environment switch and back on with every setting as it was", async () => {
          const admin = await personInRole(
            t,
            "ai-switch",
            await roleId(t, "admin")
          );
          const before = structuredClone(ai.settings);
          const on = await t.nextly.ai.status({ user: { id: admin } });
          expect(on.configured).toBe(true);

          process.env[AI_OFF_SWITCH] = "1";
          expect(
            await t.nextly.ai.status({ user: { id: admin } })
          ).toMatchObject({
            configured: false,
            reason: "turned-off",
          });
          const error = await refusal(t.nextly.ai.run(altText(admin)));
          expect(error.publicMessage).toContain(AI_OFF_SWITCH);
          expect(ai.asked).toEqual([]);

          delete process.env[AI_OFF_SWITCH];
          expect(ai.settings).toEqual(before);
          expect(await t.nextly.ai.status({ user: { id: admin } })).toEqual(on);
          expect(await storedAIPermissions(t)).toHaveLength(3);
        });

        it("refuses a checked call that names nobody", async () => {
          const error = await refusal(
            t.nextly.ai.run({
              task: { owner: "@test/ai", name: "alt-text" },
              input: {},
            })
          );
          expect(error.code).toBe("AUTH_REQUIRED");
          expect(ai.asked).toEqual([]);
        });
      });
    }
  );
}
