/**
 * The site's content languages as Settings shows and changes them.
 *
 * A configuration that declares the languages locks the list: it is shown, and every change is
 * refused with where the list is set. Otherwise a change is decided whole before anything is
 * written (`planLanguageChange`), the rows it changes are written in one transaction, and the
 * registry is read again at once, so this instance serves the new list on its next request and
 * every other instance within the registry's interval.
 *
 * @module domains/i18n/services/language-settings-service
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors/nextly-error";
import { LANGUAGES_TABLE } from "../../../schemas/languages/table-name";
import type { LanguageDirection } from "../../../schemas/languages/types";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import type { Logger } from "../../../shared/types/index";
import { fallbackCodes } from "../config/stored-languages";
import {
  countPendingChangesIn,
  type DefaultChangeSummary,
  pendingChangesIn,
  summarizeDefaultChange,
} from "../default-language-change";
import {
  type LanguageChange,
  type LanguageRow,
  planLanguageChange,
} from "../language-changes";
import type { LanguageRegistry } from "../language-registry";

/** One language as Settings shows it. */
export interface LanguageView {
  code: string;
  label: string;
  direction: LanguageDirection;
  fallback: string[];
  position: number;
  isDefault: boolean;
  active: boolean;
}

export interface LanguageListView {
  /** The configuration declares the languages, so Settings may only show them. */
  lockedByConfig: boolean;
  languages: LanguageView[];
}

const COLUMNS = [
  "code",
  "label",
  "direction",
  "fallback",
  "position",
  "isDefault",
  "active",
  "revision",
] as const;

/** The languages as Settings shows them, from the stored rows: English alone while none are. */
function viewOf(rows: readonly LanguageRow[]): LanguageListView {
  return {
    lockedByConfig: false,
    languages:
      rows.length > 0 ? rows.map(toView).sort(byPosition) : [IMPLICIT_ENGLISH],
  };
}

/** English, the site's one language while nothing is stored, as Settings shows it. */
const IMPLICIT_ENGLISH: LanguageView = {
  code: "en",
  label: "English",
  direction: "ltr",
  fallback: [],
  position: 0,
  isDefault: true,
  active: true,
};

export class LanguageSettingsService {
  constructor(
    private readonly adapter: DrizzleAdapter,
    private readonly registry: LanguageRegistry,
    /** Told when the registry cannot be read again after a change has committed. */
    private readonly logger?: Pick<Logger, "warn">
  ) {}

  /** The languages, the removed ones included so they can be added back. */
  async list(): Promise<LanguageListView> {
    const configured = this.registry.lockedByConfig
      ? this.registry.current()
      : undefined;
    if (configured) {
      return {
        lockedByConfig: true,
        languages: configured.locales.map((locale, position) => ({
          code: locale.code,
          label: locale.label,
          direction: locale.rtl ? "rtl" : "ltr",
          fallback: locale.fallbackLocale,
          position,
          isDefault: locale.code === configured.defaultLocale,
          active: true,
        })),
      };
    }
    return viewOf(await this.storedRows());
  }

  /**
   * What making `code` the default would touch, for the admin to confirm first.
   *
   * @throws NextlyError `VALIDATION_ERROR` when the configuration locks the list, or `code` is not
   *   an active language
   */
  async previewDefaultChange(code: string): Promise<DefaultChangeSummary> {
    this.refuseWhenLocked();
    const rows = await this.storedRows();
    const from = defaultCodeOf(rows);
    const to = defaultCodeOf(
      planLanguageChange(rows, { kind: "setDefault", code })
    );
    return summarizeDefaultChange(this.adapter, from, to);
  }

  /**
   * Applies `change` and answers with the list after it.
   *
   * @throws NextlyError `VALIDATION_ERROR` when the configuration locks the list, when a default
   *   change meets pending changes in the current default, or when the change is refused
   *   (`planLanguageChange`)
   */
  async change(change: LanguageChange): Promise<LanguageListView> {
    this.refuseWhenLocked();
    // Asked before the transaction, so it cannot run inside it on another connection.
    const draftsKept =
      change.kind === "setDefault" &&
      (await this.adapter.tableExists("nextly_versions"));
    if (change.kind === "setDefault") {
      await this.refusePendingDefaultChanges();
    }
    // With nothing stored the locked read locks no row, so a change made at the same moment also
    // planned from the implicit English list, and its insert of English met this one's: a
    // duplicate on PostgreSQL and SQLite, a deadlock on MySQL (`lostToFirstChange`). Run
    // again, in a transaction of its own now the failed one has rolled back, it plans from what
    // the other stored and is locked behind it as every later change is.
    const written =
      (await this.writeChange(change, draftsKept)) ??
      (await this.writeChange(change, draftsKept));
    if (!written) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "Another change to the languages was being saved at the same moment. Try again.",
      });
    }
    // The rows are committed: a failure from here on must not read as the change failing, since
    // a retried add would then be refused as a duplicate of itself. The answer is the list as
    // written, and an instance that cannot read it again now does so within its interval.
    await this.registry.refresh({ force: true }).catch((error: unknown) => {
      this.logger?.warn(
        `[languages] The language list was saved, but this server could not read it again: ${
          error instanceof Error ? error.message : String(error)
        }. It reads it again within a second.`
      );
    });
    return viewOf(written);
  }

  /**
   * Plans `change` against the stored rows, locked, and writes the rows it changes, in one
   * transaction.
   *
   * @returns the stored list as the change left it, or null when, with nothing stored, another
   *   change stored the list first (rolled back, nothing written)
   */
  private async writeChange(
    change: LanguageChange,
    draftsKept: boolean
  ): Promise<LanguageRow[] | null> {
    let wasEmpty = false;
    try {
      return await this.adapter.transaction(async tx => {
        // Locked, so a second change made at the same moment plans from this one's result:
        // planned from the same rows, both would write the same next revision, and the
        // fingerprint would stay where the first left it, hiding the second from every other
        // instance. SQLite takes no row lock and needs none, as its writers already run one at
        // a time.
        const rows = await tx.select<LanguageRow>(LANGUAGES_TABLE, {
          columns: [...COLUMNS],
          forUpdate: true,
        });
        wasEmpty = rows.length === 0;
        // Asked again where the change is written: the admin confirms from a summary that can
        // stay open for minutes, and a draft saved meanwhile in the current default would be
        // left behind.
        if (draftsKept) {
          const current = defaultCodeOf(rows);
          refuseWhenPending(current, await countPendingChangesIn(tx, current));
        }
        const planned = planLanguageChange(rows, change);
        const was = new Map(rows.map(row => [row.code, row]));
        const now = new Date();
        for (const row of planned) {
          const old = was.get(row.code);
          if (old && old.revision === row.revision) continue;
          const values = {
            label: row.label,
            direction: row.direction,
            fallback: row.fallback,
            position: row.position,
            isDefault: row.isDefault,
            active: row.active,
            revision: row.revision,
            updatedAt: now,
          };
          if (old) {
            await tx.update(LANGUAGES_TABLE, values, {
              and: [{ column: "code", op: "=", value: row.code }],
            });
          } else {
            await tx.insert(LANGUAGES_TABLE, {
              code: row.code,
              ...values,
              createdAt: now,
            });
          }
        }
        return planned;
      });
    } catch (error) {
      if (wasEmpty && lostToFirstChange(this.adapter, error)) return null;
      throw error;
    }
  }

  private refuseWhenLocked(): void {
    if (!this.registry.lockedByConfig) return;
    throw NextlyError.validation({
      errors: [
        {
          path: "languages",
          code: "languages_locked_by_config",
          message:
            "This site's languages are set in its configuration (the `localization` block), so they can only be changed there.",
        },
      ],
      logContext: { reason: "language-list-locked-by-config" },
    });
  }

  /** Refuses a default change while the current default has pending changes. */
  private async refusePendingDefaultChanges(): Promise<void> {
    const current = defaultCodeOf(await this.storedRows());
    refuseWhenPending(current, await pendingChangesIn(this.adapter, current));
  }

  private storedRows(): Promise<LanguageRow[]> {
    return this.adapter.transaction(tx =>
      tx.select<LanguageRow>(LANGUAGES_TABLE, { columns: [...COLUMNS] })
    );
  }
}

/** Refuses a default change while `current`, the default, has `pending` changes. */
function refuseWhenPending(current: string, pending: number): void {
  if (pending === 0) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "code",
        code: "default_has_pending_changes",
        message: `"${current}" has ${pending} pending change(s). Publish or discard them before making another language the default.`,
      },
    ],
    logContext: { reason: "default-language-has-pending-changes", pending },
  });
}

/**
 * Whether, with nothing stored, a change lost to another that stored the list first. PostgreSQL
 * and SQLite refuse the second insert of English as a duplicate. MySQL's locked read of an empty
 * table takes a gap lock in each transaction, so each insert waits on the other's, and MySQL
 * rolls one back as a deadlock instead.
 */
function lostToFirstChange(adapter: DrizzleAdapter, error: unknown): boolean {
  if (isUniqueViolation(error)) return true;
  return (
    toDbError(adapter.getCapabilities().dialect, error).kind === "deadlock"
  );
}

/** The default language's code, English while nothing is stored. */
function defaultCodeOf(rows: readonly LanguageRow[]): string {
  return rows.find(row => row.active && row.isDefault)?.code ?? "en";
}

function toView(row: LanguageRow): LanguageView {
  return {
    code: row.code,
    label: row.label,
    direction: row.direction,
    fallback: fallbackCodes(row.fallback),
    position: Number(row.position),
    isDefault: Boolean(row.isDefault),
    active: Boolean(row.active),
  };
}

function byPosition(a: LanguageView, b: LanguageView): number {
  return a.position - b.position;
}
