"use client";

/**
 * A translation page's side of its document's history: whether it is offered,
 * which version is on screen, and what a restore may put back.
 *
 * The editor's own restore, kept to what the page writes. The page's form holds
 * the whole document, because a field's condition may read any other, and saves
 * only the language's own text: a shared value put into it would look restored
 * and be left out of the save. So a shared field is listed with the rest and
 * can't be chosen.
 *
 * @module components/features/translations/history/useTranslationHistory
 */

import type { FieldConfig } from "nextly/config";
import { useMemo } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import type { EditorRestoreSurface } from "@admin/components/features/versions/document-history-context";
import type { EditorRestore } from "@admin/components/features/versions/editor-restore";
import { useHistoryOffered } from "@admin/components/features/versions/history-offered";
import { useEditorRestoreSurface } from "@admin/components/features/versions/useEditorRestoreSurface";
import {
  useViewedVersion,
  type ViewedVersionHost,
} from "@admin/components/features/versions/viewed-version-host";
import type { TakeoverType } from "@admin/lib/builder/takeoverLayout";
import type { VersionScope } from "@admin/services/versionApi";

/** One list for a page with no takeover field, so its identity never changes. */
const NO_TAKEOVERS: TakeoverType[] = [];

export interface TranslationHistoryInput<T extends FieldValues> {
  /** The document, as its history is addressed. */
  scope: VersionScope;
  /** The language the page writes. */
  target: { code: string; label: string };
  form: UseFormReturn<T>;
  /** The form's restore (`useFormRestore`), which the page's save is given too. */
  restore: EditorRestore;
  /** Every field the form holds; the same list for as long as it is the same schema. */
  fields: FieldConfig[];
  /** The fields the page writes; the same list for as long as they are the same. */
  rows: readonly { name: string }[];
  /**
   * Whether nothing may be put into the page now: it is read-only to this
   * person, or a save is on its way, which a restored value would miss.
   */
  readOnly: boolean;
  /** Whether the type keeps versions; undefined where it does not say. */
  historyEnabled: boolean | undefined;
  /** The takeover field types, from the same source the editor uses. */
  takeoverTypes?: TakeoverType[];
}

export interface TranslationHistory {
  scope: VersionScope;
  /** Whether the document offers its history to this person. */
  offered: boolean;
  /** The version on screen, and what the page provides around its content. */
  host: ViewedVersionHost;
  /**
   * The fields a version on screen is drawn with: the editor's own layout, led
   * by the document's title and slug. The editor draws those two in its header,
   * so its layout leaves them out; this page's header draws neither.
   */
  versionFields: FieldConfig[];
}

/** The fields the editor draws in its header and not in its layout. */
const HEADER_FIELDS: ReadonlySet<string> = new Set(["title", "slug"]);

/** Whether the editor's header draws the field, so no layout does. */
function isHeaderField(field: FieldConfig): boolean {
  const { name, admin } = field as {
    name?: string;
    admin?: { hidden?: boolean };
  };
  return HEADER_FIELDS.has(name ?? "") && admin?.hidden !== true;
}

/** `editor`, taking values back into the named fields alone. */
export function restoreInto(
  editor: EditorRestoreSurface,
  names: ReadonlySet<string>
): EditorRestoreSurface {
  return {
    ...editor,
    canEdit: name => names.has(name) && editor.canEdit(name),
  };
}

export function useTranslationHistory<T extends FieldValues>({
  scope,
  target,
  form,
  restore,
  fields,
  rows,
  readOnly,
  historyEnabled,
  takeoverTypes = NO_TAKEOVERS,
}: TranslationHistoryInput<T>): TranslationHistory {
  const surface = useEditorRestoreSurface({
    restore,
    form,
    fields,
    readOnly: () => readOnly,
    localized: true,
    language: target.label,
    locale: target.code,
  });
  const editor = useMemo(
    () => restoreInto(surface, new Set(rows.map(row => row.name))),
    [surface, rows]
  );
  const host = useViewedVersion(fields, takeoverTypes, undefined, editor);
  const offered = useHistoryOffered(scope.slug, {
    mode: "edit",
    documentId: scope.kind === "single" ? scope.documentId : scope.entryId,
    fields,
    enabled: historyEnabled,
  });
  const { historicalFields } = host;
  const versionFields = useMemo(
    () =>
      historicalFields === null
        ? []
        : [...fields.filter(isHeaderField), ...historicalFields],
    [fields, historicalFields]
  );
  return { scope, offered, host, versionFields };
}
