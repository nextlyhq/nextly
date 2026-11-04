/**
 * The install the step and assignment tests run against, and the people, roles and keys they act
 * as.
 *
 * One boot per case: Posts (localized, with a shared field) and Pages on `editorial`, Memos on
 * `handover` and Notes on the preset, in English, Spanish and Arabic. People and their roles are
 * written directly, as a test seeds a caller; a role is given exactly the permissions named, each
 * created where the boot did not seed it. Review state is seeded through #817's repository, so a
 * refusal test starts from a state the service under test did not write.
 */
import { randomUUID } from "node:crypto";

import { actorForKey } from "../../../../auth/access/resolve-actor";
import type { KeyActor } from "../../../../auth/access/actor";
import { defineCollection, text } from "../../../../config";
import { getDialectTables } from "../../../../database/index";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { permissionSlug } from "../../../../schemas/_zod/rbac";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { ServiceContainer } from "../../../../services/index";
import {
  ContentEventsRepository,
  type ContentEventRecord,
} from "../../../content-events/repository";
import { reviewWorkflow } from "../../preset";
import {
  createReviewState,
  readReviewState,
  type ReviewPart,
  type ReviewState,
  type ReviewStatesDb,
} from "../../review-state-repository";
import type { WorkflowCaller } from "../../steps";

import { editorial, handover } from "./step-workflows";

/** Whole seconds: SQLite stores timestamps to the second. */
export const AT = new Date("2026-11-02T10:00:00.000Z");

const drafts = { status: true, versions: { drafts: true } } as const;

/** Boots the install every case uses. */
export function bootSteps(dialect: TestDialect): Promise<TestNextly> {
  return createTestNextly({
    dialect,
    localization: { locales: ["en", "es", "ar"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        ...drafts,
        workflow: editorial,
        fields: [
          text({ name: "title", localized: true }),
          // A field every language shares, so the document has a shared part.
          text({ name: "code" }),
        ],
      }),
      defineCollection({
        slug: "pages",
        ...drafts,
        workflow: editorial,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "memos",
        ...drafts,
        workflow: handover,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "notes",
        ...drafts,
        workflow: reviewWorkflow(),
        fields: [text({ name: "title" })],
      }),
    ],
  });
}

/** The adapter, as the review-state repository reads it. */
export const stateDb = (t: TestNextly): ReviewStatesDb =>
  t.adapter as unknown as ReviewStatesDb;

/** A document of `slug`, stored through the ordinary write, trusted. */
export async function entry(t: TestNextly, slug: string): Promise<string> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  const created = await handler.createEntry(
    { collectionName: slug, overrideAccess: true },
    { title: "Hello" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error(`no id from create on ${slug}`);
  return id;
}

/** One part of a collection's document. */
export const partOf = (
  slug: string,
  entryId: string,
  part: string | null
): ReviewPart => ({ scopeKind: "collection", scopeSlug: slug, entryId, part });

/** Gives a part a review state, at revision 1, as though someone had moved it there. */
export function seedState(
  t: TestNextly,
  part: ReviewPart,
  stage: string,
  fields: Partial<Pick<ReviewState, "enteredBy" | "approval" | "assignee">> & {
    definitionHash: string;
  }
): Promise<ReviewState> {
  return createReviewState(stateDb(t), part, {
    stage,
    enteredAt: AT,
    enteredBy: fields.enteredBy ?? "seeder",
    ...fields,
  });
}

export const stateOf = (
  t: TestNextly,
  part: ReviewPart
): Promise<ReviewState | null> => readReviewState(stateDb(t), part);

/** The document's workflow events, oldest first. */
export async function workflowEvents(
  t: TestNextly,
  slug: string,
  entryId: string
): Promise<ContentEventRecord[]> {
  const repo = new ContentEventsRepository(t.adapter, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });
  const { items } = await repo.listForSubject(
    { kind: "collection", slug, id: entryId },
    { limit: 100 }
  );
  return items.filter(event => event.kind.startsWith("workflow-")).reverse();
}

interface RbacApi {
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

interface Inserts {
  insert(table: unknown): { values(row: unknown): Promise<unknown> };
}

const drizzleOf = (t: TestNextly) =>
  t.adapter.getDrizzle() as unknown as Inserts;
const tablesOf = (t: TestNextly) => getDialectTables(t.adapter.dialect);

/** A permission as stored (`sign-off-posts`), split into its action and resource. */
export type Grant = readonly [action: string, resource: string];

async function permissionId(t: TestNextly, [action, resource]: Grant) {
  const api = t.nextly as unknown as RbacApi;
  const slug = permissionSlug(action, resource);
  const found = (await api.permissions.find({ limit: 1000 })).items.find(
    permission => permission.slug === slug
  );
  if (found) return found.id;
  return (
    await api.permissions.create({
      data: { action, resource, name: `${action} ${resource}`, slug },
    })
  ).item.id;
}

/** A role holding exactly `grants`, and inheriting `inherits` (role ids). Returns its id. */
export async function role(
  t: TestNextly,
  slug: string,
  grants: readonly Grant[],
  inherits: readonly string[] = []
): Promise<string> {
  const permissionIds: string[] = [];
  for (const grant of grants) permissionIds.push(await permissionId(t, grant));
  const created = await (t.nextly as unknown as RbacApi).roles.create({
    data: {
      name: slug,
      slug,
      permissionIds,
      ...(inherits.length > 0 ? { childRoleIds: [...inherits] } : {}),
    },
  });
  return created.item.id;
}

/** The install's super-admin role's id. */
export async function superAdminRole(t: TestNextly): Promise<string> {
  return (await new ServiceContainer(t.adapter).roles.ensureSuperAdminRole())
    .id;
}

/** Gives `userId` the role `roleId`, lapsing at `expiresAt` when given. */
export async function giveRole(
  t: TestNextly,
  userId: string,
  roleId: string,
  expiresAt?: Date
): Promise<void> {
  await drizzleOf(t)
    .insert(tablesOf(t).userRoles)
    .values({
      id: randomUUID(),
      userId,
      roleId,
      createdAt: new Date(),
      ...(expiresAt ? { expiresAt } : {}),
    });
}

/**
 * A person with the fixed id `id`, holding `grants` through a role of their own. Active unless
 * `active: false`.
 */
export async function person(
  t: TestNextly,
  id: string,
  grants: readonly Grant[],
  options: { active?: boolean } = {}
): Promise<WorkflowCaller & { kind: "user" }> {
  const now = new Date();
  await drizzleOf(t)
    .insert(tablesOf(t).users)
    .values({
      id,
      email: `${id}@example.test`,
      name: id,
      isActive: options.active ?? true,
      createdAt: now,
      updatedAt: now,
    });
  if (grants.length > 0) {
    await giveRole(t, id, await role(t, `holds-${id}`, grants));
  }
  return { kind: "user", userId: id };
}

/** An API key `keyId` made by `ownerId`, holding exactly `grants`. */
export function apiKey(
  keyId: string,
  ownerId: string,
  grants: readonly Grant[]
): WorkflowCaller & { kind: "key" } {
  const key: KeyActor = actorForKey({
    keyId,
    userId: ownerId,
    grants: grants.map(([action, resource]) => ({
      slug: permissionSlug(action, resource),
      action,
      resource,
    })),
    roles: [],
    superAdmin: false,
  });
  return { kind: "key", key };
}

export const SYSTEM: WorkflowCaller = { kind: "system" };
