/**
 * Who made a document and who changed it last, as its details show them.
 *
 * No column records either: what is recorded is who moved each of the
 * document's version counters last (its own row, and each translation row),
 * and the record of content events, whose `created` event names who made the
 * document in its current life. Both are named by the one rule a refused save
 * names a changer by (`shownChanger`): a person by the name their account
 * gives now, never by email, and no name once the account is gone; anything
 * else by its kind. Where nothing is recorded (a row unwritten since the
 * columns were added, a document made before events were kept, a kind this
 * version of Nextly does not know), who is null and the caller shows the date
 * alone.
 *
 * Read only for a caller already allowed to read the document: this module
 * decides nothing about access.
 *
 * @module domains/versions/document-changers
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../../di";
import { container } from "../../di/container";
import type { StaleVersionPublicData } from "../../errors/public-data";
import { ContentEventsRepository } from "../content-events/repository";
import type { CompanionIntrospectAdapter } from "../i18n/runtime/companion-io";
import { isCompanionReady } from "../i18n/runtime/companion-readiness";

import { peopleById } from "./author-hydration";
import { documentShape } from "./recovery-point-changes";
import {
  lastChangerOf,
  poolRevisionReader,
  readDocumentRevision,
  shownChanger,
  type RevisionReader,
} from "./stale-version";

/**
 * @experimental Who, as a document's details show them: the refusal's naming
 * rule, and for a person named by nobody, whether that is because their
 * account is gone (rather than an account that has no name).
 */
export type ShownChanger = NonNullable<StaleVersionPublicData["changedBy"]> & {
  gone?: true;
};

/** @experimental Who made a document, and who changed it last and when. */
export interface DocumentChangers {
  createdBy: ShownChanger | null;
  updatedBy: ShownChanger | null;
  /** When the last recorded change was made, as ISO 8601; null when unknown. */
  updatedAt: string | null;
}

/** The document a caller reads, and the language it reads it in. */
export interface DocumentChangersArgs {
  scopeKind: "collection" | "single";
  slug: string;
  entryId: string;
  /** The language read; null for a document that keeps none. */
  locale: string | null;
}

const NO_CHANGE = { updatedBy: null, updatedAt: null } as const;

/**
 * Who made the document and who changed it last. Each half that fails names
 * nobody, as a failed person lookup does: who is a decoration of a read
 * already granted, never a reason for it to fail.
 *
 * @experimental
 */
export async function documentChangers(
  args: DocumentChangersArgs
): Promise<DocumentChangers> {
  const [updated, createdBy] = await Promise.all([
    lastChange(args).catch(() => NO_CHANGE),
    creator(args).catch(() => null),
  ]);
  return { createdBy, ...updated };
}

/**
 * A changer named by the shared rule, saying so where a person is named by
 * nobody because their account is gone: an account that has no name is
 * still someone, and is not told apart from a deleted one by the rule alone.
 */
async function named(changer: {
  kind: string;
  id: string | null;
  principalKind: string | null;
}): Promise<ShownChanger | null> {
  const shown = await shownChanger(changer, true);
  if (!shown) return null;
  if (shown.kind !== "person" || shown.name !== null || !changer.id) {
    return shown;
  }
  const found = await peopleById([changer.id]);
  return found.has(changer.id) ? shown : { ...shown, gone: true };
}

/**
 * Who moved the document's counters last, of its own row and the row of the
 * language read: the change a save from this read would be judged against.
 */
async function lastChange(
  args: DocumentChangersArgs
): Promise<Pick<DocumentChangers, "updatedBy" | "updatedAt">> {
  const shape = await documentShape(args.scopeKind, args.slug);
  if (!shape) return NO_CHANGE;
  const adapter = getService("adapter") as unknown as RevisionReader &
    CompanionIntrospectAdapter;
  const languagesTable = `${shape.table}_locales`;
  const locale =
    shape.localized &&
    args.locale !== null &&
    (await isCompanionReady(adapter, languagesTable))
      ? args.locale
      : null;
  const state = await readDocumentRevision(poolRevisionReader(adapter), {
    dialect: adapter.dialect,
    table: shape.table,
    id: args.entryId,
    ...(locale === null
      ? {}
      : { languages: { table: languagesTable, locales: [locale] } }),
  });
  if (!state) return NO_CHANGE;
  const changer = lastChangerOf([
    state.main,
    ...Object.values(state.languages),
  ]);
  if (!changer) return NO_CHANGE;
  return {
    updatedBy: await named(changer),
    updatedAt: changer.at ? changer.at.toISOString() : null,
  };
}

/** Who the `created` event of the document's current life names. */
async function creator(
  args: DocumentChangersArgs
): Promise<ShownChanger | null> {
  const repository = new ContentEventsRepository(
    container.get<DrizzleAdapter>("adapter"),
    getService("logger")
  );
  const { items } = await repository.listForSubject(
    { kind: args.scopeKind, slug: args.slug, id: args.entryId },
    { kinds: ["created"], life: "current", limit: 1 }
  );
  const created = items[0];
  if (!created) return null;
  return named({
    kind: created.actorKind,
    id: created.actorId,
    principalKind: created.actorPrincipalKind,
  });
}
