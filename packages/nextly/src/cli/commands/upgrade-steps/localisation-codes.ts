/**
 * Bringing each language code the site configures into its standard form: every stored row that
 * names `pt_BR` names `pt-BR` afterwards, and every key computed from a code is computed again.
 *
 * Earlier releases accepted a code such as `pt_BR`; BCP 47, which every reader and the Settings
 * screen now use, writes it `pt-BR` (`standardLanguageCode`). The site keeps working under the
 * code it configures: the configuration's old code is read as its standard one, so the rows have
 * to be under the standard one too. Where two configured codes become the same code, the upgrade
 * stops before anything changes and names both, since merging two languages' rows would lose one.
 *
 * What is rewritten, for each code: each translation table's `_locale`; each version's language
 * and the key of a pending change (`workingDraftKey`); the language a version records it changed;
 * each pinned base held for a language (`pending:<code>`) and its key; each translation's record of
 * where it came from; the archive of removed translations; each release member's language and
 * key; each media use and preview link in that language. The history of events and the audit
 * trail keep what they recorded at the time.
 *
 * @module cli/commands/upgrade-steps/localisation-codes
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { sql, type SQL } from "drizzle-orm";

import { standardLanguageCode } from "../../../domains/i18n/config/standard-code";
import {
  codesFoldCase,
  columnsFoldingCase,
  sameStoredCode,
  storedOlderSpellings,
  tablesHoldingCode,
} from "../../../domains/i18n/older-codes";
import { releaseMemberKey } from "../../../domains/releases/release-member-key";
import { runStatement } from "../../../domains/schema/pipeline/_internal/run-statement";
import { versionPinKey } from "../../../domains/versions/version-pins";
import { workingDraftKey } from "../../../domains/versions/working-draft-key";
import { NextlyError } from "../../../errors/nextly-error";
import { LANGUAGES_TABLE } from "../../../schemas/languages/table-name";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import { TRANSLATION_PROVENANCE_TABLE } from "../../../schemas/translation-provenance/table-name";
import { TRANSLATION_SOURCES_TABLE } from "../../../schemas/translation-sources/table-name";
import type { VersionScopeKind } from "../../../schemas/versions/types";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import {
  NOTHING_CHANGED,
  type UpgradeReport,
  type UpgradeStepContext,
} from "../upgrade-step";

import {
  assertVersionHistoryReady,
  configuredLanguages,
  siteEntities,
} from "./localisation-site";

const VERSION_PINS_TABLE = "nextly_version_pins";
const RELEASE_MEMBERS_TABLE = "nextly_release_members";
const I18N_ARCHIVE_TABLE = "nextly_i18n_archive";
const PREVIEW_LINKS_TABLE = "nextly_preview_links";

/** A configured code and the standard form its rows move to. */
interface CodeConversion {
  from: string;
  to: string;
}

/**
 * The conversions the site's configured codes need, or the refusal of codes that become one: two
 * configured codes with the same standard form are two spellings of one language, and which of
 * them holds the content is the developer's to say.
 */
function conversionsOf(codes: readonly string[]): CodeConversion[] {
  const byStandard = new Map<string, string[]>();
  for (const code of codes) {
    const standard = standardLanguageCode(code) ?? code;
    byStandard.set(standard, [...(byStandard.get(standard) ?? []), code]);
  }
  const colliding = [...byStandard].filter(
    ([, spellings]) => new Set(spellings).size > 1
  );
  if (colliding.length > 0) throw collision(colliding);
  return codes.flatMap(code => {
    const to = standardLanguageCode(code);
    return to !== undefined && to !== code ? [{ from: code, to }] : [];
  });
}

/** The refusal of codes that become one, naming each spelling and the code they become. */
function collision(colliding: [string, string[]][]): NextlyError {
  const named = colliding
    .map(
      ([standard, spellings]) =>
        `${spellings.map(code => `"${code}"`).join(" and ")} (both "${standard}")`
    )
    .join("; ");
  return new NextlyError({
    code: "NEXTLY_LANGUAGE_CODES_COLLIDE",
    publicMessage:
      `The configuration names ${named}: one language under two codes once written in standard ` +
      `form. Keep one of them in the configuration and run \`nextly migrate\` again. ${NOTHING_CHANGED}`,
    logContext: { colliding: colliding.map(([standard]) => standard) },
  });
}

/** Each translation table the site's entities have. */
async function translationTables(
  context: UpgradeStepContext
): Promise<string[]> {
  const tables: string[] = [];
  for (const entity of await siteEntities(context)) {
    const table = `${entity.tableName}_locales`;
    // One the run's migrations drop, as they do where an entity stops being translated.
    if (context.droppedAhead?.has(table.toLowerCase())) continue;
    if (await context.adapter.tableExists(table)) tables.push(table);
  }
  return tables;
}

/**
 * A table the conversion rewrites whose rows are unique per language of something: two rows of
 * one thing, one under each spelling, would become one row, or one key the unique index refuses.
 */
interface KeyedTarget {
  table: string;
  /** The columns, besides the language, that make a row unique. */
  same: readonly string[];
  /** The column that names the language. */
  language: string;
  /** How that column writes a code: the code itself, or a pin's `pending:<code>` slot. */
  spelled: (code: string) => string;
  /** Where only some rows carry the unique key: the column those rows fill. */
  keyed?: string;
}

const asWritten = (code: string) => code;

/** The rewritten tables kept unique per language besides the translation tables. */
const KEYED_TARGETS: readonly KeyedTarget[] = [
  // One pending change per document per language (`draft_key`); a durable version has no key.
  {
    table: VERSIONS_TABLE,
    same: ["scope_kind", "scope_slug", "entry_id"],
    language: "locale",
    spelled: asWritten,
    keyed: "draft_key",
  },
  // One base pinned per holder per language's pending change (`pin_key`).
  {
    table: VERSION_PINS_TABLE,
    same: ["scope_kind", "scope_slug", "entry_id", "holder"],
    language: "slot",
    spelled: code => `pending:${code}`,
  },
  // One member per document per language per release (`member_key`).
  {
    table: RELEASE_MEMBERS_TABLE,
    same: ["release_id", "scope_kind", "scope_slug", "entry_id"],
    language: "locale",
    spelled: asWritten,
  },
  // One record per field of a language of a document, live or drafted.
  {
    table: TRANSLATION_PROVENANCE_TABLE,
    same: ["scope_kind", "scope_slug", "entry_id", "part_state", "field_path"],
    language: "locale",
    spelled: asWritten,
  },
  // One row per version of one field's source text in a language of a document.
  {
    table: TRANSLATION_SOURCES_TABLE,
    same: ["scope_kind", "scope_slug", "entry_id", "field_path", "fingerprint"],
    language: "source_locale",
    spelled: asWritten,
  },
  // One language per code in the Settings registry, whatever else its rows hold.
  {
    table: LANGUAGES_TABLE,
    same: [],
    language: "code",
    spelled: asWritten,
  },
  // One use per item per field per language of a document.
  {
    table: MEDIA_USAGE_TABLE,
    same: [
      "subject_kind",
      "subject_slug",
      "document_id",
      "field_path",
      "media_id",
    ],
    language: "locale",
    spelled: asWritten,
  },
];

/** Whether `target` holds one thing's row under both spellings of `conversion`. */
async function meetsBoth(
  adapter: DrizzleAdapter,
  target: KeyedTarget,
  conversion: CodeConversion
): Promise<string | undefined> {
  const a = sql`${sql.identifier("a")}`;
  const b = sql`${sql.identifier("b")}`;
  const column = (alias: SQL, name: string) =>
    sql`${alias}.${sql.identifier(name)}`;
  // A table unique by its language alone (the Settings registry) pairs every two rows.
  const joined =
    target.same.length === 0
      ? sql`1 = 1`
      : sql.join(
          target.same.map(name => sql`${column(a, name)} = ${column(b, name)}`),
          sql` AND `
        );
  const keyed =
    target.keyed === undefined
      ? sql``
      : sql` AND ${column(a, target.keyed)} IS NOT NULL AND ${column(b, target.keyed)} IS NOT NULL`;
  // The first thing held under both, by the columns that make it unique, so the refusal can name it.
  const named =
    target.same.length === 0
      ? sql`1 AS ${sql.identifier("found")}`
      : sql.join(
          target.same.map(
            name => sql`${column(a, name)} AS ${sql.identifier(name)}`
          ),
          sql`, `
        );
  const [row] = await adapter.queryStatement<Record<string, unknown>>(
    sql`SELECT ${named} FROM ${sql.identifier(target.table)} ${a} JOIN ${sql.identifier(target.table)} ${b} ON ${joined} WHERE ${column(a, target.language)} = ${target.spelled(conversion.from)} AND ${column(b, target.language)} = ${target.spelled(conversion.to)}${keyed} LIMIT 1`
  );
  if (row === undefined) return undefined;
  const key = target.same
    .map(name => `${name} ${String(row[name])}`)
    .join(", ");
  return key === "" ? target.table : `${target.table} (${key})`;
}

/**
 * The tables the rewrite could collide in, in two sets: those the tables as they stand can be
 * asked about (each translation table, a document translated under both spellings, and every keyed
 * table but the version history), and the version history, whose key of a pending change is one of
 * the columns an earlier release's history lacks until the run's migrations add them.
 */
function collisionTargets(translationTables: readonly string[]): {
  asTheyStand: KeyedTarget[];
  versionHistory: KeyedTarget[];
} {
  const translations = translationTables.map(table => ({
    table,
    same: ["_parent"],
    language: "_locale",
    spelled: asWritten,
  }));
  return {
    asTheyStand: [
      ...translations,
      ...KEYED_TARGETS.filter(target => target.table !== VERSIONS_TABLE),
    ],
    versionHistory: KEYED_TARGETS.filter(
      target => target.table === VERSIONS_TABLE
    ),
  };
}

/**
 * Where some one thing is kept under both spellings of `conversion` among `targets`, each named
 * by its table and the key of the first such thing.
 */
async function tablesMeetingBoth(
  context: UpgradeStepContext,
  targets: readonly KeyedTarget[],
  conversion: CodeConversion
): Promise<string[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const meeting: string[] = [];
  for (const target of targets) {
    if (!(await context.adapter.tableExists(target.table))) continue;
    const where = await meetsBoth(adapter, target, conversion);
    if (where !== undefined) meeting.push(where);
  }
  return meeting;
}

/** The refusal of rows kept under both spellings of one language, naming where. */
function keptUnderBoth(
  conversion: CodeConversion,
  where: readonly string[],
  /** Another older spelling of the same code, where two of them meet rather than one and the code. */
  alongside?: string
): NextlyError {
  const other = alongside ?? conversion.to;
  return new NextlyError({
    code: "NEXTLY_LANGUAGE_CODES_COLLIDE",
    publicMessage:
      `Rows under both "${conversion.from}" and "${other}", one language under two codes, are ` +
      `kept for the same thing in ${where.join("; ")}; moving them to "${conversion.to}" would ` +
      "make them one. Keep the rows of one spelling, then run `nextly migrate` again. " +
      NOTHING_CHANGED,
    logContext: { from: conversion.from, other, to: conversion.to, where },
  });
}

/**
 * Every conversion the site has: each configured code written the earlier way, and each older
 * spelling the rows still hold that a configuration already corrected to the standard code no
 * longer names, found as the start finds them and converted the same way.
 */
async function conversionsOfSite(
  context: UpgradeStepContext,
  tables: readonly string[]
): Promise<CodeConversion[]> {
  const configured = (await configuredLanguages(context)).codes;
  const conversions = conversionsOf(configured);
  const foldsCase = await codesFoldCase(
    context.adapter as unknown as DrizzleAdapter,
    tables
  );
  for (const stored of await storedOlderSpellings(
    context.adapter as unknown as DrizzleAdapter,
    tables,
    configured.map(code => standardLanguageCode(code) ?? code)
  )) {
    // Matched as the database compares codes (`sameStoredCode`): on MySQL a configured `pt_BR`
    // already converts rows stored `PT_br`, so the scan's spelling is no second conversion.
    if (
      !conversions.some(({ from }) =>
        sameStoredCode(foldsCase, from, stored.from)
      )
    ) {
      conversions.push(stored);
    }
  }
  return conversions;
}

/**
 * Refuses one thing kept under both spellings of a conversion among `targets`, before any row is
 * written, so one that would collide stops the step with nothing changed rather than part-way.
 * Two older spellings of one code (`pt_BR` and `PT_br`) both become that code, so each pair is
 * checked against the other first, then each spelling against the code itself.
 */
async function refuseCollisions(
  context: UpgradeStepContext,
  targets: readonly KeyedTarget[],
  conversions: readonly CodeConversion[]
): Promise<void> {
  // Each target's language column by its own collation (`columnsFoldingCase`): a site can keep
  // `_locale` binary beside a case-insensitive version history.
  const folds = await columnsFoldingCase(
    context.adapter as unknown as DrizzleAdapter,
    targets.map(({ table, language }) => ({ table, column: language }))
  );
  for (const [index, one] of conversions.entries()) {
    for (const other of conversions.slice(index + 1)) {
      if (other.to !== one.to) continue;
      // Two spellings that differ only in letter case are one stored code where the column folds
      // case: a single row there matches both, and is no pair kept under both.
      const apart = targets.filter(
        target =>
          !(
            folds({ table: target.table, column: target.language }) &&
            sameStoredCode(true, one.from, other.from)
          )
      );
      const meeting = await tablesMeetingBoth(context, apart, {
        from: one.from,
        to: other.from,
      });
      if (meeting.length > 0) throw keptUnderBoth(one, meeting, other.from);
    }
  }
  for (const conversion of conversions) {
    const meeting = await tablesMeetingBoth(context, targets, conversion);
    if (meeting.length > 0) throw keptUnderBoth(conversion, meeting);
  }
}

/**
 * The conversions whose old code some row still holds, refused where a document holds both
 * spellings: what a run has left to do.
 */
async function conversionsToRun(
  context: UpgradeStepContext
): Promise<CodeConversion[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const tables = await translationTables(context);
  const conversions = await conversionsOfSite(context, tables);
  if (conversions.length === 0) return [];
  const targets = collisionTargets(tables);
  // Every collision the tables as they stand can show is refused first, so `nextly migrate` makes
  // that refusal before its schema changes; the version history's waits for its newer columns.
  await refuseCollisions(context, targets.asTheyStand, conversions);
  // Rewriting a version's languages writes the newer columns: only on a history laid out for them.
  await assertVersionHistoryReady(context);
  await refuseCollisions(context, targets.versionHistory, conversions);
  const foldsCase = await codesFoldCase(adapter, tables);
  const pending: CodeConversion[] = [];
  for (const conversion of conversions) {
    // Where the start finds rows under the older spelling, the same answer as its refusal.
    const held = await tablesHoldingCode(adapter, tables, conversion.from);
    if (
      held.length > 0 ||
      (await registryHolds(context, conversion.from, foldsCase))
    ) {
      pending.push(conversion);
    }
  }
  return pending;
}

/** How many configured codes have rows to move to their standard form. */
export async function codesToConvert(
  context: UpgradeStepContext
): Promise<number> {
  return (await conversionsToRun(context)).length;
}

/** A version row as the rewrite reads it. */
interface VersionCodeRow {
  id: string;
  scopeKind: VersionScopeKind;
  scopeSlug: string;
  entryId: string;
  draftKey: string | null;
}

/** Rewrite every stored row of each pending conversion; how many codes moved. */
export async function convertLanguageCodes(
  context: UpgradeStepContext
): Promise<number> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const conversions = await conversionsToRun(context);
  const tables = await translationTables(context);
  // One case rule for every list and registry entry the conversions rewrite (`sameStoredCode`).
  const foldsCase = await codesFoldCase(adapter, tables);
  for (const { from, to } of conversions) {
    for (const table of tables) {
      await runStatement(
        adapter.getDrizzle(),
        adapter.dialect,
        sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier("_locale")} = ${to} WHERE ${sql.identifier("_locale")} = ${from}`
      );
    }
    await convertVersions(adapter, from, to, foldsCase);
    await convertPins(context, from, to);
    await convertReleaseMembers(context, from, to);
    await convertLanguageRegistry(context, from, to, foldsCase);
    // The tables that record a language and nothing computed from it.
    for (const [table, columns] of [
      [TRANSLATION_PROVENANCE_TABLE, ["locale", "sourceLocale"]],
      [TRANSLATION_SOURCES_TABLE, ["sourceLocale"]],
      [I18N_ARCHIVE_TABLE, ["locale"]],
      [MEDIA_USAGE_TABLE, ["locale"]],
      [PREVIEW_LINKS_TABLE, ["locale"]],
    ] as const) {
      if (!(await context.adapter.tableExists(table))) continue;
      for (const column of columns) {
        await adapter.update(
          table,
          { [column]: to },
          {
            and: [{ column, op: "=", value: from }],
          }
        );
      }
    }
  }
  return conversions.length;
}

/** Each version kept under `from`, with a pending change's key, and each list of changed languages. */
async function convertVersions(
  adapter: DrizzleAdapter,
  from: string,
  to: string,
  foldsCase: boolean
): Promise<void> {
  const rows = await adapter.select<VersionCodeRow>(VERSIONS_TABLE, {
    columns: ["id", "scopeKind", "scopeSlug", "entryId", "draftKey"],
    where: { and: [{ column: "locale", op: "=", value: from }] },
  });
  for (const row of rows) {
    const ref = {
      scopeKind: row.scopeKind,
      scopeSlug: row.scopeSlug,
      entryId: row.entryId,
    };
    await adapter.update(
      VERSIONS_TABLE,
      {
        locale: to,
        // A key is kept only by a pending change, computed from its language.
        ...(row.draftKey === null
          ? {}
          : { draftKey: workingDraftKey(ref, to) }),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
  // The languages a version records it changed, stored as a JSON list of codes: a JSON column on
  // PostgreSQL and MySQL, so it is matched as its text, which every dialect can compare with LIKE.
  const asText = sql.raw(adapter.dialect === "mysql" ? "CHAR" : "TEXT");
  const changed = await adapter.queryStatement<{
    id: string;
    changed_locales: unknown;
  }>(
    sql`SELECT ${sql.identifier("id")} AS ${sql.identifier("id")}, ${sql.identifier("changed_locales")} AS ${sql.identifier("changed_locales")} FROM ${sql.identifier(VERSIONS_TABLE)} WHERE CAST(${sql.identifier("changed_locales")} AS ${asText}) LIKE ${`%${JSON.stringify(from)}%`}`
  );
  for (const row of changed) {
    const list: unknown =
      typeof row.changed_locales === "string"
        ? JSON.parse(row.changed_locales)
        : row.changed_locales;
    if (!Array.isArray(list)) continue;
    await adapter.update(
      VERSIONS_TABLE,
      {
        changedLocales: JSON.stringify(
          // Each entry the database reads as `from`, as the scan found it (`sameStoredCode`).
          list.map(code =>
            typeof code === "string" && sameStoredCode(foldsCase, code, from)
              ? to
              : code
          )
        ),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/** Each base pinned for a language's pending change (`pending:<code>`), and its key. */
async function convertPins(
  context: UpgradeStepContext,
  from: string,
  to: string
): Promise<void> {
  if (!(await context.adapter.tableExists(VERSION_PINS_TABLE))) return;
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const rows = await adapter.select<{
    id: string;
    scopeKind: VersionScopeKind;
    scopeSlug: string;
    entryId: string;
    holder: string;
  }>(VERSION_PINS_TABLE, {
    columns: ["id", "scopeKind", "scopeSlug", "entryId", "holder"],
    where: { and: [{ column: "slot", op: "=", value: `pending:${from}` }] },
  });
  for (const row of rows) {
    const slot = `pending:${to}`;
    await adapter.update(
      VERSION_PINS_TABLE,
      {
        slot,
        pinKey: versionPinKey(
          {
            scopeKind: row.scopeKind,
            scopeSlug: row.scopeSlug,
            entryId: row.entryId,
          },
          row.holder,
          slot
        ),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/** A row of the Settings language registry, as the conversion reads it. */
interface RegistryRow {
  code: string;
  fallback: string | null;
  revision: number | null;
}

/** The Settings registry's rows naming `code`: as their own code or in their fallback list. */
async function registryRowsNaming(
  context: UpgradeStepContext,
  code: string,
  foldsCase: boolean
): Promise<RegistryRow[]> {
  if (!(await context.adapter.tableExists(LANGUAGES_TABLE))) return [];
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const rows = await adapter.select<RegistryRow>(LANGUAGES_TABLE, {
    columns: ["code", "fallback", "revision"],
  });
  // Compared as the database compares codes (`sameStoredCode`), as the scan found them.
  const same = (stored: string) => sameStoredCode(foldsCase, stored, code);
  return rows.filter(row => same(row.code) || fallbackOf(row).some(same));
}

/** A registry row's fallback codes; a list that cannot be read names none. */
function fallbackOf(row: RegistryRow): string[] {
  try {
    const list: unknown = JSON.parse(row.fallback ?? "[]");
    return Array.isArray(list)
      ? list.filter((code): code is string => typeof code === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether the Settings registry still names `code`. */
async function registryHolds(
  context: UpgradeStepContext,
  code: string,
  foldsCase: boolean
): Promise<boolean> {
  return (await registryRowsNaming(context, code, foldsCase)).length > 0;
}

/**
 * The Settings language registry under `from`: the language's own row and every row that falls
 * back to it, each written once with its revision raised, so every instance reading the registry's
 * fingerprint notices the change. A language managed in Settings is then named as its content is
 * stored.
 */
async function convertLanguageRegistry(
  context: UpgradeStepContext,
  from: string,
  to: string,
  foldsCase: boolean
): Promise<void> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  for (const row of await registryRowsNaming(context, from, foldsCase)) {
    await adapter.update(
      LANGUAGES_TABLE,
      {
        code: sameStoredCode(foldsCase, row.code, from) ? to : row.code,
        fallback: JSON.stringify(
          fallbackOf(row).map(code =>
            sameStoredCode(foldsCase, code, from) ? to : code
          )
        ),
        revision: (row.revision ?? 0) + 1,
        updatedAt: new Date(),
      },
      { and: [{ column: "code", op: "=", value: row.code }] }
    );
  }
}

/** Each release member in `from`, and its key. */
async function convertReleaseMembers(
  context: UpgradeStepContext,
  from: string,
  to: string
): Promise<void> {
  if (!(await context.adapter.tableExists(RELEASE_MEMBERS_TABLE))) return;
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const rows = await adapter.select<{
    id: string;
    releaseId: string;
    scopeKind: VersionScopeKind;
    scopeSlug: string;
    entryId: string;
  }>(RELEASE_MEMBERS_TABLE, {
    columns: ["id", "releaseId", "scopeKind", "scopeSlug", "entryId"],
    where: { and: [{ column: "locale", op: "=", value: from }] },
  });
  for (const row of rows) {
    await adapter.update(
      RELEASE_MEMBERS_TABLE,
      {
        locale: to,
        memberKey: releaseMemberKey(row.releaseId, {
          scopeKind: row.scopeKind,
          scopeSlug: row.scopeSlug,
          entryId: row.entryId,
          locale: to,
        }),
      },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/** What the dry run lists of the conversion: each code and the form its rows move to. */
export async function codesReport(
  context: UpgradeStepContext
): Promise<UpgradeReport> {
  return {
    move: (await conversionsToRun(context)).map(
      ({ from, to }) =>
        `language code "${from}" to "${to}" in every stored row; the configuration can name "${to}" from now on`
    ),
    conflicts: [],
    check: [],
  };
}
