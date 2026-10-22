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

import { NextlyError } from "../../../errors/nextly-error";
import { LANGUAGES_TABLE } from "../../../schemas/languages/table-name";
import type { LanguageDirection } from "../../../schemas/languages/types";
import { fallbackCodes } from "../config/stored-languages";
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
    private readonly registry: LanguageRegistry
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
    const rows = await this.adapter.transaction(tx =>
      tx.select<LanguageRow>(LANGUAGES_TABLE, { columns: [...COLUMNS] })
    );
    return {
      lockedByConfig: false,
      languages:
        rows.length > 0
          ? rows.map(toView).sort(byPosition)
          : [IMPLICIT_ENGLISH],
    };
  }

  /**
   * Applies `change` and answers with the list after it.
   *
   * @throws NextlyError `VALIDATION_ERROR` when the configuration locks the list, or when the
   *   change is refused (`planLanguageChange`)
   */
  async change(change: LanguageChange): Promise<LanguageListView> {
    if (this.registry.lockedByConfig) {
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
    await this.adapter.transaction(async tx => {
      const rows = await tx.select<LanguageRow>(LANGUAGES_TABLE, {
        columns: [...COLUMNS],
      });
      const was = new Map(rows.map(row => [row.code, row]));
      const now = new Date();
      for (const row of planLanguageChange(rows, change)) {
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
    });
    await this.registry.refresh({ force: true });
    return this.list();
  }
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
