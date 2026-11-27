/**
 * Operations the list's tests are run on. Core's own list is still empty, so
 * every check is shown working on these: one complete, valid declaration that
 * each test changes in one way, and two shaped like the content update and
 * the settings change whose levels depend on their input.
 */
import { z } from "zod";

import { defineOperation, type OperationDefinition } from "../definition";

/** A complete read: every field filled, valid on its own. */
export function readOperation(
  overrides: Partial<OperationDefinition> = {}
): OperationDefinition {
  return {
    ...defineOperation({
      id: "posts.list",
      command: ["posts", "list"],
      aliases: [],
      summary: "List posts",
      description: "Lists posts the person may read, newest first. Changes nothing.",
      input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
      output: z.object({ items: z.array(z.object({ id: z.string() })) }),
      level: "read",
      effects: { destroys: false, idempotent: true, outside: false, spendsAi: false },
      doors: ["local", "site"],
      permission: { kind: "permission", name: "read-posts" },
      dryRun: false,
      long: false,
      examples: [{ summary: "The first ten posts", input: { limit: 10 } }],
      exitCodes: [],
      source: { kind: "core" },
      stability: "experimental",
    }),
    ...overrides,
  };
}

/** A complete write that offers a dry run. */
export function writeOperation(
  overrides: Partial<OperationDefinition> = {}
): OperationDefinition {
  return readOperation({
    id: "posts.publish",
    command: ["posts", "publish"],
    summary: "Publish a post",
    description: "Publishes one post so visitors see it. Unpublish puts it back.",
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string() }),
    examples: [{ summary: "Publish post 128", input: { id: "128" } }],
    level: "change",
    effects: { destroys: false, idempotent: true, outside: false, spendsAi: false },
    permission: { kind: "permission", name: "publish-posts" },
    dryRun: true,
    ...overrides,
  });
}

/** More entries than this in one update make it a change others see at once. */
export const BULK_THRESHOLD = 25;

/** Shaped like the content update: a draft write that bulk raises to `change`. */
export const contentUpdateLike = defineOperation({
  id: "content.update",
  command: ["content", "update"],
  aliases: [],
  summary: "Update entries",
  description: "Saves changes to entries as drafts. Publishing is its own step.",
  input: z.object({ ids: z.array(z.string()).min(1), data: z.record(z.string(), z.unknown()) }),
  output: z.object({ updated: z.number() }),
  level: "draft",
  raise: [
    {
      when: `more than ${BULK_THRESHOLD} entries at once`,
      level: "change",
      applies: ({ input }) => input.ids.length > BULK_THRESHOLD,
    },
  ],
  effects: { destroys: true, idempotent: true, outside: false, spendsAi: false },
  doors: ["local", "site", "chat"],
  chatExposed: true,
  permission: { kind: "permission", name: "update-posts" },
  dryRun: true,
  long: false,
  examples: [{ summary: "Retitle one entry", input: { ids: ["128"], data: { title: "Spring" } } }],
  exitCodes: [],
  source: { kind: "core" },
  stability: "experimental",
});

/** The settings that guard sign-in and security. */
const SECURITY_KEYS: ReadonlySet<string> = new Set(["auth.passwordMinLength", "auth.allowRegistration"]);

/**
 * Shaped like the settings change: a `change`, raised to a `critical` that
 * "Always allow" never covers when the key guards sign-in or security.
 */
export const settingsSetLike = defineOperation({
  id: "settings.set",
  command: ["settings", "set"],
  aliases: [],
  summary: "Change a setting",
  description: "Changes one site setting. Security and sign-in settings need approval.",
  input: z.object({ key: z.string(), value: z.unknown() }),
  output: z.object({ key: z.string() }),
  level: "change",
  raise: [
    {
      when: "the key is a security or sign-in setting",
      level: "critical",
      alwaysAllow: false,
      applies: ({ input }) => SECURITY_KEYS.has(input.key),
    },
  ],
  effects: { destroys: true, idempotent: true, outside: false, spendsAi: false },
  doors: ["local", "site"],
  permission: { kind: "permission", name: "update-settings" },
  dryRun: true,
  long: false,
  examples: [{ summary: "Rename the site", input: { key: "site.title", value: "Corner Bakery" } }],
  exitCodes: [],
  source: { kind: "core" },
  stability: "experimental",
});
