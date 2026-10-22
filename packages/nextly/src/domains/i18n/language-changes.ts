/**
 * What a change made in Settings does to the stored language list, decided before anything is
 * written: the next list in full, or a refusal naming what is wrong.
 *
 * Codes are kept in canonical BCP 47 form, so a code that differs from a stored one only in
 * letter case is the same code. A removed language stays, inactive, so its content is kept and
 * adding it again brings it back. The default cannot be removed: another language is made the
 * default first. The list is then judged whole by the rules the configuration's block is judged
 * by, fallback loops included.
 *
 * With nothing stored, the site's one language is English, the default: the first change stores
 * it beside whatever the change adds.
 *
 * @module domains/i18n/language-changes
 */
import { NextlyError } from "../../errors/nextly-error";
import type { LanguageDirection } from "../../schemas/languages/types";

import type { StoredLanguage } from "./config/stored-languages";
import { validateLocalizationConfig } from "./config/validate";
import { isReservedLocaleCode } from "./locale-selector";

/** A stored language with the revision every write raises. */
export interface LanguageRow extends StoredLanguage {
  revision: number;
}

export type LanguageChange =
  | {
      kind: "add";
      code: string;
      label: string;
      direction?: LanguageDirection;
      fallback?: string[];
    }
  | {
      kind: "update";
      code: string;
      label?: string;
      direction?: LanguageDirection;
      fallback?: string[];
    }
  | { kind: "reorder"; codes: string[] }
  | { kind: "remove"; code: string }
  | { kind: "setDefault"; code: string };

/** The site's one language while nothing is stored. */
const IMPLICIT_DEFAULT: LanguageRow = {
  code: "en",
  label: "English",
  direction: "ltr",
  fallback: "[]",
  position: 0,
  isDefault: true,
  active: true,
  revision: 0,
};

/**
 * The stored list after `change`, with each changed row's revision raised.
 *
 * @throws NextlyError `VALIDATION_ERROR` naming what makes the change impossible
 */
export function planLanguageChange(
  rows: readonly LanguageRow[],
  change: LanguageChange
): LanguageRow[] {
  const before = rows.length > 0 ? rows : [IMPLICIT_DEFAULT];
  const next = applyChange(
    before.map(row => ({ ...row })),
    change
  );
  judgeWhole(next);
  const was = new Map(before.map(row => [row.code, row]));
  return next.map(row => {
    const old = was.get(row.code);
    const unchanged =
      old !== undefined && rows.length > 0 && sameLanguage(old, row);
    return unchanged ? row : { ...row, revision: (old?.revision ?? 0) + 1 };
  });
}

function applyChange(
  list: LanguageRow[],
  change: LanguageChange
): LanguageRow[] {
  switch (change.kind) {
    case "add":
      return addLanguage(list, change);
    case "update":
      return updateLanguage(list, change);
    case "reorder":
      return reorder(list, change.codes);
    case "remove":
      return removeLanguage(list, change.code);
    case "setDefault":
      return makeDefault(list, change.code);
  }
}

function updateLanguage(
  list: LanguageRow[],
  change: Extract<LanguageChange, { kind: "update" }>
): LanguageRow[] {
  const row = activeRow(list, change.code);
  row.label = change.label ?? row.label;
  row.direction = change.direction ?? row.direction;
  if (change.fallback !== undefined) {
    row.fallback = fallbackList(list, change.fallback);
  }
  return list;
}

function removeLanguage(list: LanguageRow[], code: string): LanguageRow[] {
  const row = activeRow(list, code);
  if (row.isDefault) {
    throw refused(
      code,
      "default_language",
      `"${row.code}" is the default language. Make another language the default first, then remove it.`
    );
  }
  row.active = false;
  return list;
}

function makeDefault(list: LanguageRow[], code: string): LanguageRow[] {
  const row = activeRow(list, code);
  for (const other of list) other.isDefault = other === row;
  return list;
}

function addLanguage(
  list: LanguageRow[],
  change: Extract<LanguageChange, { kind: "add" }>
): LanguageRow[] {
  const code = canonicalCode(change.code);
  const existing = list.find(
    row => row.code.toLowerCase() === code.toLowerCase()
  );
  if (existing?.active) {
    throw refused(
      code,
      "duplicate",
      `"${code}" is already a language of this site.`
    );
  }
  const fields = {
    label: change.label,
    direction: change.direction ?? "ltr",
    fallback: fallbackList(list, change.fallback ?? []),
    active: true,
  };
  if (existing) {
    // Added again: the row was kept, and with it the content in this language.
    Object.assign(existing, fields, { position: nextPosition(list) });
    return list;
  }
  return [
    ...list,
    {
      code,
      ...fields,
      position: nextPosition(list),
      isDefault: false,
      revision: 0,
    },
  ];
}

function reorder(list: LanguageRow[], codes: readonly string[]): LanguageRow[] {
  const active = list.filter(row => row.active);
  const order = codes.map(canonicalCode);
  const same =
    order.length === active.length &&
    active.every(row => order.includes(row.code));
  if (!same) {
    throw refused(
      "codes",
      "order_incomplete",
      "The order must name every language of this site once."
    );
  }
  for (const row of active) row.position = order.indexOf(row.code);
  return list;
}

/** The active row `code` names, or a refusal saying it is not one. */
function activeRow(list: LanguageRow[], code: string): LanguageRow {
  const canonical = canonicalCode(code);
  const row = list.find(r => r.active && r.code === canonical);
  if (!row) {
    throw refused(
      code,
      "unknown_language",
      `"${code}" is not one of this site's languages.`
    );
  }
  return row;
}

/** A fallback list as stored: canonical codes of the site's active languages, in order. */
function fallbackList(
  list: readonly LanguageRow[],
  codes: readonly string[]
): string {
  const active = new Set(list.filter(row => row.active).map(row => row.code));
  const canonical = codes.map(canonicalCode);
  for (const code of canonical) {
    if (!active.has(code)) {
      throw refused(
        code,
        "unknown_language",
        `"${code}" is not one of this site's languages.`
      );
    }
  }
  return JSON.stringify(canonical);
}

/** A code in canonical BCP 47 form, or a refusal for one that is not a language code. */
function canonicalCode(code: string): string {
  if (isReservedLocaleCode(code)) {
    throw refused(
      code,
      "reserved_code",
      `"${code}" is reserved: it selects languages rather than naming one.`
    );
  }
  try {
    const [canonical] = Intl.getCanonicalLocales(code);
    if (canonical) return canonical;
  } catch {
    // Not a language tag; refused below.
  }
  throw refused(
    code,
    "invalid_code",
    `"${code}" is not a BCP 47 language code, such as "fr" or "pt-BR".`
  );
}

/** Judges the active list by the configuration's rules, fallback loops included. */
function judgeWhole(list: readonly LanguageRow[]): void {
  const active = list
    .filter(row => row.active)
    .sort((a, b) => a.position - b.position);
  const defaultRow = active.find(row => row.isDefault);
  try {
    validateLocalizationConfig({
      defaultLocale: defaultRow?.code ?? "",
      locales: active.map(row => ({
        code: row.code,
        label: row.label,
        rtl: row.direction === "rtl",
        fallbackLocale: (JSON.parse(row.fallback) as string[]).filter(code =>
          active.some(other => other.code === code)
        ),
      })),
    });
  } catch (error) {
    if (error instanceof NextlyError) throw error;
    throw refused(
      "languages",
      "invalid_list",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function nextPosition(list: readonly LanguageRow[]): number {
  return list.reduce((max, row) => Math.max(max, row.position + 1), 0);
}

function sameLanguage(a: LanguageRow, b: LanguageRow): boolean {
  return (
    a.label === b.label &&
    a.direction === b.direction &&
    a.fallback === b.fallback &&
    a.position === b.position &&
    a.isDefault === b.isDefault &&
    a.active === b.active
  );
}

function refused(path: string, code: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code, message }],
    logContext: { reason: "language-list-change-refused", code },
  });
}
