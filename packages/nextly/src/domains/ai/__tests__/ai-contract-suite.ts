/**
 * The AI contract on a booted site, one dialect per file: core seeds no AI
 * permission, a site with no AI package reports "not configured", the
 * `NEXTLY_AI=off` lock holds for the whole boot, and `nextly.ai` judges a
 * person with the permissions the AI package declares.
 *
 * Each dialect runs in a file of its own (`ai-contract.<dialect>
 * .integration.test.ts`) so a run on one server never reads another's rows.
 * The provider is a stub plugin answering the "ai" capability, declaring its
 * own three permissions as the real package will; the tasks are recorded
 * through core's task-list seam, which the task registry fills later.
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
import { ServiceContainer } from "../../../services/index";
import {
  AI_LOCK_VARIABLE,
  type AIProvider,
  type AIProviderRunRequest,
  type AITaskRef,
} from "../ai-contract";
import { recordAITasks } from "../ai-task-list";

/** The permissions the stub provider declares, as the AI package will. */
const DECLARED = {
  use: { action: "use", resource: "ai" },
  bulk: { action: "run", resource: "bulk-ai-jobs" },
  manage: { action: "manage", resource: "ai-settings" },
} as const;

const DECLARED_SLUGS = Object.values(DECLARED).map(
  p => `${p.action}-${p.resource}`
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
    permissions: DECLARED,
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
    contributes: {
      services: { ai: () => provider },
      // Registered by the package, as the AI package registers its own.
      permissions: Object.values(DECLARED).map(p => ({ ...p })),
    },
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

/** The permission rows spelled like the AI package's, as stored. */
async function storedAIPermissions(t: TestNextly): Promise<string[]> {
  const all = (await t.nextly.permissions.find({ limit: 500 })).items;
  return all
    .map(p => String(p.slug))
    .filter(slug => DECLARED_SLUGS.includes(slug))
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

const altText = (userId: string) => ({
  user: { id: userId },
  task: { owner: "@test/ai", name: "alt-text" },
  input: { image: "m1" },
  target: { collection: "posts" },
});

export function describeAIContract(dialect: TestDialect): void {
  const configured = getConfiguredTestDialects().includes(dialect);
  (configured ? describe : describe.skip)(
    `the AI contract (${dialect})`,
    () => {
      describe("on a site with no AI package", () => {
        let t: TestNextly;
        beforeAll(async () => {
          t = await boot(dialect);
          recordAITasks([ALT_TEXT]);
        }, 120_000);
        afterAll(async () => {
          recordAITasks([]);
          await t?.destroy();
        });

        it("seeds no AI permission", async () => {
          expect(await storedAIPermissions(t)).toEqual([]);
        });

        it("reports not configured, with nothing held, and refuses a run with how to set AI up", async () => {
          const admin = await personInRole(
            t,
            "nopkg-admin",
            await roleId(t, "admin")
          );
          expect(
            await t.nextly.ai.status({ user: { id: admin } })
          ).toMatchObject({
            configured: false,
            reason: "no-ai-package",
            permissions: { use: false, bulk: false, manage: false },
            tasks: [
              { name: "alt-text", available: false, reason: "not-configured" },
            ],
          });
          const error = await refusal(t.nextly.ai.run(altText(admin)));
          expect(error.code).toBe("SERVICE_UNAVAILABLE");
          expect(error.publicMessage).toContain("@nextlyhq/ai");
        });
      });

      describe(`with ${AI_LOCK_VARIABLE}=off where the site is deployed`, () => {
        afterEach(() => {
          delete process.env[AI_LOCK_VARIABLE];
          recordAITasks([]);
        });

        it("reports turned off for the whole boot, asks the provider nothing, and keeps every setting for the next start", async () => {
          const ai = stubAI();
          process.env[AI_LOCK_VARIABLE] = "off";
          const locked = await boot(dialect, [ai.plugin]);
          const before = structuredClone(ai.settings);
          try {
            recordAITasks([ALT_TEXT]);
            const owner = ownerOf(locked);
            expect(
              await locked.nextly.ai.status({ user: { id: owner } })
            ).toMatchObject({
              configured: false,
              reason: "turned-off",
            });
            const error = await refusal(locked.nextly.ai.run(altText(owner)));
            expect(error.publicMessage).toContain(`${AI_LOCK_VARIABLE}=off`);

            // Lifting the variable while the site runs lifts nothing: the
            // lock is this boot's.
            delete process.env[AI_LOCK_VARIABLE];
            expect(
              (await locked.nextly.ai.status({ user: { id: owner } })).reason
            ).toBe("turned-off");
            expect(ai.asked).toEqual([]);
          } finally {
            await locked.destroy();
          }

          const open = await boot(dialect, [ai.plugin]);
          try {
            recordAITasks([ALT_TEXT]);
            expect(ai.settings).toEqual(before);
            expect(
              await open.nextly.ai.status({ user: { id: ownerOf(open) } })
            ).toMatchObject({ configured: true });
          } finally {
            await open.destroy();
          }
        }, 240_000);
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
          ai.asked.length = 0;
        });
        afterAll(async () => {
          recordAITasks([]);
          await t?.destroy();
        });

        it("judges a person by the permissions the package declares", async () => {
          expect(await storedAIPermissions(t)).toEqual(
            [...DECLARED_SLUGS].sort()
          );
          const user = await personWith(t, "ai-user", ["use-ai", "read-posts"]);
          expect(
            (await t.nextly.ai.status({ user: { id: user } })).permissions
          ).toEqual({ use: true, bulk: false, manage: false });
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

        it("refuses a person without the package's use permission, naming it in the status", async () => {
          const viewer = await personInRole(
            t,
            "ai-viewer",
            await roleId(t, "viewer")
          );
          const status = await t.nextly.ai.status({ user: { id: viewer } });
          expect(status.tasks[0]).toMatchObject({
            available: false,
            reason: "missing-permission",
            permission: "use-ai",
          });
          const error = await refusal(t.nextly.ai.run(altText(viewer)));
          expect(error.code).toBe("FORBIDDEN");
          expect(ai.asked).toEqual([]);
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

        it("refuses an agent starting a bulk job for a person who may use AI but not run bulk jobs", async () => {
          const user = await personWith(t, "ai-bulkless", ["use-ai"]);
          const error = await refusal(
            t.nextly.ai.checkBulkJob({
              user: { id: user },
              agent: { id: "agent-1", name: "Agent" },
            })
          );
          expect(error.code).toBe("FORBIDDEN");

          const bulk = await personWith(t, "ai-bulk", [
            "use-ai",
            "run-bulk-ai-jobs",
          ]);
          await expect(
            t.nextly.ai.checkBulkJob({
              user: { id: bulk },
              agent: { id: "agent-1", name: "Agent" },
            })
          ).resolves.toBeUndefined();
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
