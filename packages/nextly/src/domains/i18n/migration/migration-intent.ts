import { NextlyError } from "../../../errors/nextly-error";

import type { I18nTransitionKind } from "./transition-state";
import type { CompanionMigrationSpec } from "./types";

/**
 * Header field carrying a companion migration's declared intent.
 *
 * Written before the `-- UP` marker, so `parseSqlSections` never routes it into the executable
 * statements. Kept on ONE line because the header is parsed line by line.
 */
export const LOCALIZATION_INTENT_HEADER = "-- Localization:";

/**
 * Payload version, so a later shape change can be recognised rather than guessed at.
 *
 * A reader that meets a HIGHER version refuses the file. Falling back to verbatim would be the
 * worst of both: the statements were chosen for a database in a state this reader can no longer
 * establish, and running them anyway is precisely what recording the intent exists to prevent.
 * Absence of the field is different, and does mean verbatim — that is what every file written
 * before this existed looks like.
 */
export const LOCALIZATION_INTENT_VERSION = 1;

/**
 * What a companion migration file declares it is FOR, as opposed to the statements it happens to
 * contain.
 *
 * The statements describe one route to the goal — the route that is right for a database which
 * has had nothing done to it yet. Whether that route is the right one here depends on what the
 * target database has already had done, which only the target database can say. Recording the
 * goal separately is what lets the apply path ask.
 *
 * 🔴 Read from the FILE, never from the current config. A migration replayed out of history has
 * to describe the schema as of the migration, and today's config describes today's. Resolving an
 * old migration against a config that has since gained or dropped fields would have it do work no
 * one ever asked for.
 */
export interface LocalizationMigrationIntent {
  version: number;
  /**
   * `enable` relocates existing values into the companion; `create-only` makes a companion for a
   * collection that never held them on main; `disable` brings them home and drops the companion.
   */
  kind: "enable" | "create-only" | "disable";
  /**
   * Which kind of entity this is, which the transition record is keyed by along with the slug.
   * A collection, a single and a field group may share one slug and only one of them may have
   * transitioned, so a slug alone cannot find the right record.
   */
  entity: I18nTransitionKind;
  spec: CompanionMigrationSpec;
}

/**
 * Render the intent as the single header line.
 *
 * Keys are written in a fixed order rather than handed to `JSON.stringify` as-is, because the
 * file's checksum covers this line: two runs that produced the same intent with keys in a
 * different order would look like two different migrations.
 */
export function formatLocalizationIntent(
  intent: Omit<LocalizationMigrationIntent, "version">
): string {
  const s = intent.spec;
  const ordered = {
    version: LOCALIZATION_INTENT_VERSION,
    kind: intent.kind,
    entity: intent.entity,
    spec: {
      dialect: s.dialect,
      collection: s.collection,
      mainTable: s.mainTable,
      companionTable: s.companionTable,
      defaultLocale: s.defaultLocale,
      parentIdType: s.parentIdType,
      columns: s.columns.map(c => ({
        name: c.name,
        kind: c.kind,
        ...(c.length === undefined ? {} : { length: c.length }),
        ...(c.precision === undefined ? {} : { precision: c.precision }),
        ...(c.scale === undefined ? {} : { scale: c.scale }),
      })),
      ...(s.columnsOnMain === undefined
        ? {}
        : { columnsOnMain: s.columnsOnMain }),
      ...(s.status === undefined ? {} : { status: s.status }),
    },
  };
  // `JSON.stringify` escapes newlines, so the result is always one line whatever the identifiers
  // contain.
  return `${LOCALIZATION_INTENT_HEADER} ${JSON.stringify(ordered)}`;
}

/** Shape guard for the parsed payload — the file is user-editable text, not a trusted channel. */
function isIntentShape(value: unknown): value is LocalizationMigrationIntent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.version !== "number") return false;
  if (v.kind !== "enable" && v.kind !== "create-only" && v.kind !== "disable")
    return false;
  if (
    v.entity !== "collection" &&
    v.entity !== "single" &&
    v.entity !== "fieldGroup"
  )
    return false;
  const spec = v.spec;
  if (typeof spec !== "object" || spec === null) return false;
  const s = spec as Record<string, unknown>;
  return (
    typeof s.mainTable === "string" &&
    typeof s.companionTable === "string" &&
    typeof s.defaultLocale === "string" &&
    typeof s.collection === "string" &&
    Array.isArray(s.columns)
  );
}

/**
 * Read the declared intent out of a migration file's text.
 *
 * Returns null when the file declares none, which covers both an ordinary migration and a
 * companion file written before this field existed. Those apply verbatim, exactly as they always
 * have.
 *
 * @throws NextlyError when the field is present but unreadable. A header that was meant to steer
 * the apply and cannot be understood must not be silently downgraded to "no intent" — that would
 * quietly run the very statements the intent existed to reconsider.
 */
export function parseLocalizationIntent(
  content: string,
  filename: string
): LocalizationMigrationIntent | null {
  const line = content
    .split("\n")
    .find(l => l.trim().startsWith(LOCALIZATION_INTENT_HEADER));
  if (line === undefined) return null;

  const payload = line.trim().slice(LOCALIZATION_INTENT_HEADER.length).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    throw NextlyError.internal({
      cause: cause instanceof Error ? cause : undefined,
      logContext: { reason: "localization_intent_unparsable", filename },
    });
  }
  if (!isIntentShape(parsed)) {
    throw NextlyError.internal({
      logContext: { reason: "localization_intent_malformed", filename },
    });
  }
  // A newer writer may describe the transition in terms this reader has no rule for. Refusing is
  // the safe half of the trade: applying it verbatim would run statements chosen for a database
  // in a different state from the one in front of us.
  if (parsed.version > LOCALIZATION_INTENT_VERSION) {
    throw NextlyError.internal({
      logContext: {
        reason: "localization_intent_version_unsupported",
        filename,
        found: parsed.version,
        supported: LOCALIZATION_INTENT_VERSION,
      },
    });
  }
  return parsed;
}
