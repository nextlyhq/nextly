/**
 * Whether one part of a document is live now: what its readers are served.
 *
 * History records what was published, not what still is. A withdrawal is a
 * draft version like any held save, so "the latest published version" goes on
 * naming a version nobody is served any more. A comparison that offers what is
 * published asks here first.
 *
 * The decision is `languageIsLive`, the one answer every path gives; this reads
 * the statuses it decides from, outside any write, on the pooled connection.
 * A due release decides first, as it does for the public read: a document it
 * withdraws is not served, and one it publishes is, before either is written.
 *
 * @module domains/versions/part-liveness
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../collections/fields/types";
import type { VersionScopeKind } from "../../schemas/versions/types";
import { readCompanionLocaleStatus } from "../i18n/companion-join";
import { buildCompanionSchema } from "../i18n/runtime/companion-io";
import { resolveCompanionReadiness } from "../i18n/runtime/companion-readiness";
import { languageIsLive } from "../i18n/runtime/language-lifecycle";
import { releaseVisibilityFor } from "../releases/release-visibility";
import type { ReleaseVisibility } from "../releases/release-visibility";

/** What the read needs to know about the document's entity. */
export interface LivenessEntity {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  /** Whether the entity has the draft/published lifecycle. */
  status?: boolean;
  localized?: boolean;
}

/**
 * Whether the part (a language, or null for the part with none) is live.
 *
 * An entity without the lifecycle serves everything it stores, so every part
 * of it is live.
 */
export async function readPartIsLive(args: {
  adapter: DrizzleAdapter;
  scopeKind: VersionScopeKind;
  entity: LivenessEntity;
  entryId: string;
  part: string | null;
  defaultLocale: string | null;
  /** What a due release makes visible; the adapter's shared one if omitted. */
  visibility?: ReleaseVisibility;
  now?: Date;
}): Promise<boolean> {
  const { adapter, entity, entryId, part } = args;
  if (entity.status !== true) return true;

  // The public read asks a due release before it reads the stored status, and
  // so does this: a scheduled publication or withdrawal is in effect before
  // the release writes it. A withdrawal hides the whole document; a
  // publication widens the main row only, and each language's own status
  // still decides, as the public read's translation filter does.
  const decisions = await (
    args.visibility ?? releaseVisibilityFor(adapter)
  ).decisions({
    scopeKind: args.scopeKind,
    scopeSlug: entity.slug,
    now: args.now ?? new Date(),
  });
  if (decisions.hide.includes(entryId)) return false;
  const mainRevealed = decisions.reveal.includes(entryId);

  const main = await adapter.selectOne<{ status?: unknown }>(entity.tableName, {
    columns: ["status"],
    where: { and: [{ column: "id", op: "=", value: entryId }] },
  });

  const companion =
    part !== null && entity.localized === true
      ? buildCompanionSchema({
          slug: entity.slug,
          tableName: entity.tableName,
          fields: entity.fields as { name: string; type: string }[],
          dialect: adapter.dialect,
          status: true,
        })
      : null;
  let ownStatus: string | null = null;
  if (part !== null && companion?.hasStatus) {
    // A companion whose migration has not run is not queried; the language
    // then has no status of its own.
    const readiness = await resolveCompanionReadiness(adapter, {
      companionTableName: companion.companionTableName,
      mainTableName: entity.tableName,
      localizedColumns: companion.localizedFields.map(f => f.column),
    });
    ownStatus = await readCompanionLocaleStatus(
      adapter.getDrizzle<Parameters<typeof readCompanionLocaleStatus>[0]>(),
      companion.table,
      entryId,
      part,
      readiness
    );
  }

  return languageIsLive({
    mainStatus: main?.status,
    ownStatus,
    locale: part,
    defaultLocale: args.defaultLocale,
    perLanguageStatus: companion?.hasStatus === true,
    mainRevealed,
  });
}
