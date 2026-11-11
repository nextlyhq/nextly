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

import { apiKeyScope } from "../../../../auth/authenticated-scope";
import { defineCollection, defineSingle, text } from "../../../../config";
import { getDialectTables } from "../../../../database/index";
import {
  createTestNextly,
  type CreateTestNextlyOptions,
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
import type { VersionsDbApi } from "../../../versions/db-api";
import { VersionsRepository } from "../../../versions/versions-repository";
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

/**
 * Boots the install every case uses, with `plugins` beside it: a case that reads what the install
 * emails boots it with a provider's plugin. `tablePrefix` stores each collection's and Single's
 * table under a name of the file's own, its slug unchanged, so files sharing these slugs never
 * share a table.
 */
export function bootSteps(
  dialect: TestDialect,
  plugins?: CreateTestNextlyOptions["plugins"],
  options: { tablePrefix?: string } = {}
): Promise<TestNextly> {
  const table = (slug: string) =>
    options.tablePrefix === undefined
      ? {}
      : { dbName: `${options.tablePrefix}${slug}` };
  return createTestNextly({
    dialect,
    // Only when given, so every other case boots exactly as before.
    ...(plugins === undefined ? {} : { plugins }),
    localization: { locales: ["en", "es", "ar"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        ...table("posts"),
        localized: true,
        ...drafts,
        workflow: editorial,
        fields: [
          text({ name: "title", localized: true }),
          // A field every language shares, so the document has a shared part. Text is
          // translated by default in a localized collection, so it says it is not.
          text({ name: "code", localized: false }),
        ],
      }),
      defineCollection({
        slug: "pages",
        ...table("pages"),
        ...drafts,
        workflow: editorial,
        fields: [text({ name: "title" })],
      }),
      // Holders of update or publish are refused both by the collection's own rule, which the
      // workflow's built-in steps must meet as any write does.
      defineCollection({
        slug: "locked",
        ...table("locked"),
        ...drafts,
        workflow: editorial,
        access: { update: () => false, publish: () => false },
        fields: [text({ name: "title" })],
      }),
      // Its update rule answers by language: Spanish may be edited, no other language.
      defineCollection({
        slug: "translations",
        ...table("translations"),
        localized: true,
        ...drafts,
        workflow: editorial,
        access: { update: ({ locale }) => locale === "es" },
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: "memos",
        ...table("memos"),
        ...drafts,
        workflow: handover,
        fields: [text({ name: "title" })],
      }),
      // Read in every language but Spanish: a notice about a Spanish part is not for its reader.
      defineCollection({
        slug: "letters",
        ...table("letters"),
        localized: true,
        ...drafts,
        workflow: editorial,
        access: { read: ({ locale }) => locale !== "es" },
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: "notes",
        ...table("notes"),
        ...drafts,
        workflow: reviewWorkflow(),
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: "banner",
        ...table("banner"),
        ...drafts,
        workflow: editorial,
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

/**
 * The content version (`_rev`) a reader of one part holds now: read in that part's language, or,
 * for the shared part, as a plain read answers it.
 */
export async function versionOf(
  t: TestNextly,
  slug: string,
  entryId: string,
  part: string | null
): Promise<string> {
  const doc = (await t.nextly.findByID({
    collection: slug as never,
    id: entryId,
    overrideAccess: true,
    status: "all",
    ...(part !== null ? { locale: part } : {}),
  } as never)) as Record<string, unknown> | null;
  const rev = doc?._rev;
  if (typeof rev !== "string") throw new Error(`no _rev on ${slug} ${entryId}`);
  return rev;
}

/** Saves `data` to a document in `locale`, trusted, as an editor's ordinary save. */
export async function saveIn(
  t: TestNextly,
  slug: string,
  entryId: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const handler = t.getService("collectionsHandler") as CollectionsHandler;
  await handler.updateEntry(
    { collectionName: slug, entryId, overrideAccess: true, locale },
    { ...data, _overwrite: true }
  );
}

/**
 * The newest recorded version of one part, read from the history as a reviewer's comparison
 * shows it: in that language, or for the shared part, in any.
 */
export async function shownVersion(
  t: TestNextly,
  slug: string,
  entryId: string,
  part: string | null
): Promise<number> {
  const ref = { scopeKind: "collection" as const, scopeSlug: slug, entryId };
  // The newest of any language is a locking read, which only a transaction can make.
  const versionNo =
    part === null
      ? (
          await t.adapter.transaction(tx =>
            new VersionsRepository(tx).findNewest(ref)
          )
        )?.versionNo
      : (
          await new VersionsRepository(
            t.adapter as unknown as VersionsDbApi
          ).newestVersionNoByLocale(ref, [part])
        ).get(part);
  if (typeof versionNo !== "number") {
    throw new Error(`no recorded version of ${slug} ${entryId} ${part}`);
  }
  return versionNo;
}

/** The snapshot of one recorded version, as the history keeps it. */
export async function snapshotOf(
  t: TestNextly,
  slug: string,
  entryId: string,
  versionNo: number
): Promise<unknown> {
  const row = await new VersionsRepository(
    t.adapter as unknown as VersionsDbApi
  ).findByVersionNo(
    { scopeKind: "collection", scopeSlug: slug, entryId },
    versionNo
  );
  if (!row) throw new Error(`no version ${versionNo} of ${slug} ${entryId}`);
  return row.snapshot;
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

/** An API key `keyId` made by `ownerId`, holding exactly `grants`, as authentication scopes it. */
export function apiKey(
  keyId: string,
  ownerId: string,
  grants: readonly Grant[]
): WorkflowCaller & { kind: "key" } {
  return {
    kind: "key",
    keyId,
    userId: ownerId,
    scope: apiKeyScope(
      grants.map(([action, resource]) => ({
        slug: permissionSlug(action, resource),
        action,
        resource,
      }))
    ),
  };
}

export const SYSTEM: WorkflowCaller = { kind: "system" };
