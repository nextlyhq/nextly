/**
 * A Single's one page, read and written for bulk edit and the import as a
 * collection's pages are: as the person asking, so the Single's own access
 * rules, its `seo` group's field rules and its version decide, through the
 * Direct API, the one way a plugin reads and writes a Single it does not own.
 *
 * A Single cannot join a collection write's transaction, so a write of one
 * is a step of its own; `restoreSingleSeo` puts a group back where a later
 * step of the same save is refused.
 *
 * @module bulk/singles
 */
import {
  collectionDraftSplit,
  getCachedNextly,
  resolvedCollectionDraftSplit,
  NextlyError,
  type PluginContext,
  type PluginRouteContext,
  type PluginRouteIdentity,
} from "@nextlyhq/plugin-sdk";

import { isRecord } from "../plain-values";
import { SEO_GROUP } from "../tab/typed";

/** Who a Single is read or written as. */
export type SingleAccess =
  | { overrideAccess: true }
  | {
      overrideAccess: false;
      user: PluginRouteIdentity["user"];
      actor?: NonNullable<PluginRouteIdentity["authenticatedScope"]>;
    };

/** The plugin itself, reading a group as stored. */
export const SINGLE_AS_STORED: SingleAccess = { overrideAccess: true };

/**
 * The route's caller, as a Single's read or write is judged: their user and
 * an API key's own scope, so the key is judged on its own grants.
 */
export async function singleAccessOf(
  ctx: Pick<PluginRouteContext, "caller">
): Promise<SingleAccess> {
  const caller = ctx.caller;
  if (caller === null) throw NextlyError.authRequired();
  const identity = await caller.identity();
  return {
    overrideAccess: false,
    user: identity.user,
    ...(identity.authenticatedScope === undefined
      ? {}
      : { actor: identity.authenticatedScope }),
  };
}

/** The Single's declaration in the app's configuration, where it is there. */
export function singleDeclaration(
  ctx: PluginContext,
  slug: string
): Record<string, unknown> | undefined {
  const declared: readonly unknown[] = ctx.config.singles ?? [];
  return declared.find(
    (entity): entity is Record<string, unknown> =>
      isRecord(entity) && entity.slug === slug
  );
}

/**
 * Whether a change to the published Single is held as a working draft:
 * core's own answer, asked of the Single as code declares it, in two steps.
 * `collectionDraftSplit` reads the declaration as written (`versions: true`
 * included) and says whether drafts are on; where they are, the resolved
 * question is asked again as a Single, with whether its document is
 * localized, so a localized component on a Single that is not refuses the
 * split as the Single's own write does.
 *
 * A Single the code does not declare, made in the Schema Builder, is
 * answered as keeping drafts: nothing a plugin can read says whether it
 * does, and answering otherwise would write over a draft it holds. Its SEO
 * is changed in its own editor.
 */
export async function singleKeepsDrafts(
  ctx: PluginContext,
  slug: string
): Promise<boolean> {
  const declaration = singleDeclaration(ctx, slug);
  if (declaration === undefined) return true;
  const declared = declaration as Parameters<typeof collectionDraftSplit>[0];
  const asCollection = await collectionDraftSplit({ ...declared, slug });
  if (!asCollection.eligible) return false;
  const asSingle = await resolvedCollectionDraftSplit({
    ...(declared.status === undefined ? {} : { status: declared.status }),
    versions: { drafts: { enabled: true } },
    fields: declared.fields,
    slug,
    localized: declaration.localized === true,
    entityKind: "single",
  });
  return asSingle.eligible;
}

/**
 * The Single's one document, as `access` reads it in `locale`, in whatever
 * state it is stored; nothing where it has none yet or the reader may not
 * read it.
 */
export async function readSingle(
  slug: string,
  access: SingleAccess,
  locale: string | undefined
): Promise<Record<string, unknown> | undefined> {
  const nextly = await getCachedNextly();
  try {
    const document: unknown = await nextly.findSingle({
      slug,
      ...access,
      status: "all",
      createIfMissing: false,
      depth: 0,
      ...(locale === undefined ? {} : { locale }),
    });
    return isRecord(document) ? document : undefined;
  } catch (error) {
    if (
      NextlyError.isCode(error, "NOT_FOUND") ||
      NextlyError.isCode(error, "FORBIDDEN")
    ) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Write `seo` as the Single's whole `seo` group, as `access`, at the version
 * `rev` it was read at (any version where none is named), with `more` beside
 * it (the state a published Single keeping drafts is written in). Answers
 * the Single's new version, where it keeps one.
 */
export async function writeSingleSeo(
  slug: string,
  access: SingleAccess,
  locale: string | undefined,
  seo: Record<string, unknown>,
  rev: string | undefined,
  more: Readonly<Record<string, unknown>> = {}
): Promise<string | undefined> {
  const nextly = await getCachedNextly();
  const saved: unknown = await nextly.updateSingle({
    slug,
    ...access,
    data: {
      ...more,
      [SEO_GROUP]: seo,
      ...(rev === undefined ? { _overwrite: true } : { _rev: rev }),
    },
    ...(locale === undefined ? {} : { locale }),
  });
  // The write answers `{ message, item }`, the saved document in `item`.
  const item = isRecord(saved) ? saved.item : undefined;
  const next = isRecord(item) ? item._rev : undefined;
  return typeof next === "string" ? next : undefined;
}

/**
 * Put the Single's `seo` group back to `seo` as it was stored, as the
 * plugin, over the version `rev` a refused save left it at: where a later
 * step of the same save is refused, the Single changes nothing either.
 */
export async function restoreSingleSeo(
  slug: string,
  locale: string | undefined,
  seo: unknown,
  rev: string | undefined
): Promise<void> {
  await writeSingleSeo(
    slug,
    SINGLE_AS_STORED,
    locale,
    isRecord(seo) ? seo : {},
    rev
  );
}
