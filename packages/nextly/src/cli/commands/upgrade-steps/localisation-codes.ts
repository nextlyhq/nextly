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
import { sql } from "drizzle-orm";

import { standardLanguageCode } from "../../../domains/i18n/config/standard-code";
import { releaseMemberKey } from "../../../domains/releases/release-member-key";
import { runStatement } from "../../../domains/schema/pipeline/_internal/run-statement";
import { versionPinKey } from "../../../domains/versions/version-pins";
import type { VersionScopeKind } from "../../../domains/versions/versions-repository";
import { workingDraftKey } from "../../../domains/versions/working-draft-key";
import { NextlyError } from "../../../errors/nextly-error";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import { TRANSLATION_PROVENANCE_TABLE } from "../../../schemas/translation-provenance/table-name";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { UpgradeReport, UpgradeStepContext } from "../upgrade-step";

import { configuredLanguages, siteEntities } from "./localisation-site";

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
      `form. Keep one of them in the configuration and run the upgrade again. Nothing was changed.`,
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
    if (await context.adapter.tableExists(table)) tables.push(table);
  }
  return tables;
}

/** Whether `table` holds a row in `code`. */
async function holdsCode(
  adapter: DrizzleAdapter,
  table: string,
  code: string
): Promise<boolean> {
  const rows = await adapter.queryStatement<{ found: unknown }>(
    sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(table)} WHERE ${sql.identifier("_locale")} = ${code} LIMIT 1`
  );
  return rows.length > 0;
}

/**
 * Whether a document of `table` holds a row in both spellings: two translations of one document
 * that would become one row, so the upgrade stops rather than keep either.
 */
async function holdsBoth(
  adapter: DrizzleAdapter,
  table: string,
  conversion: CodeConversion
): Promise<boolean> {
  const rows = await adapter.queryStatement<{ found: unknown }>(
    sql`SELECT 1 AS ${sql.identifier("found")} FROM ${sql.identifier(table)} ${sql.identifier("a")} JOIN ${sql.identifier(table)} ${sql.identifier("b")} ON ${sql.identifier("a")}.${sql.identifier("_parent")} = ${sql.identifier("b")}.${sql.identifier("_parent")} WHERE ${sql.identifier("a")}.${sql.identifier("_locale")} = ${conversion.from} AND ${sql.identifier("b")}.${sql.identifier("_locale")} = ${conversion.to} LIMIT 1`
  );
  return rows.length > 0;
}

/** Whether any version is kept under `code`. */
async function versionsHoldCode(
  adapter: DrizzleAdapter,
  code: string
): Promise<boolean> {
  const rows = await adapter.select<{ id: string }>(VERSIONS_TABLE, {
    columns: ["id"],
    where: { and: [{ column: "locale", op: "=", value: code }] },
    limit: 1,
  });
  return rows.length > 0;
}

/**
 * The conversions whose old code some row still holds, refused where a document holds both
 * spellings: what a run has left to do.
 */
async function conversionsToRun(
  context: UpgradeStepContext
): Promise<CodeConversion[]> {
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const conversions = conversionsOf((await configuredLanguages(context)).codes);
  if (conversions.length === 0) return [];
  const tables = await translationTables(context);
  const pending: CodeConversion[] = [];
  for (const conversion of conversions) {
    let held = await versionsHoldCode(adapter, conversion.from);
    for (const table of tables) {
      if (await holdsBoth(adapter, table, conversion)) {
        throw collision([[conversion.to, [conversion.from, conversion.to]]]);
      }
      held = held || (await holdsCode(adapter, table, conversion.from));
    }
    if (held) pending.push(conversion);
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
  for (const { from, to } of conversions) {
    for (const table of tables) {
      await runStatement(
        adapter.getDrizzle(),
        adapter.dialect,
        sql`UPDATE ${sql.identifier(table)} SET ${sql.identifier("_locale")} = ${to} WHERE ${sql.identifier("_locale")} = ${from}`
      );
    }
    await convertVersions(adapter, from, to);
    await convertPins(context, from, to);
    await convertReleaseMembers(context, from, to);
    // The tables that record a language and nothing computed from it.
    for (const [table, columns] of [
      [TRANSLATION_PROVENANCE_TABLE, ["locale", "sourceLocale"]],
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
  to: string
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
  // The languages a version records it changed, stored as a JSON list of codes.
  const changed = await adapter.select<{ id: string; changedLocales: unknown }>(
    VERSIONS_TABLE,
    {
      columns: ["id", "changedLocales"],
      where: {
        and: [
          {
            column: "changedLocales",
            op: "LIKE",
            value: `%${JSON.stringify(from)}%`,
          },
        ],
      },
    }
  );
  for (const row of changed) {
    const list: unknown =
      typeof row.changedLocales === "string"
        ? JSON.parse(row.changedLocales)
        : row.changedLocales;
    if (!Array.isArray(list)) continue;
    await adapter.update(
      VERSIONS_TABLE,
      {
        changedLocales: JSON.stringify(
          list.map(code => (code === from ? to : code))
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
