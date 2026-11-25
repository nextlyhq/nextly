"use client";

/**
 * The form one language of a document is written in, and its save.
 *
 * It holds the whole document in that language, because a field's condition may
 * read any other, and sends only the translatable fields the translator
 * changed, and the containers whose text they changed. The save goes to the
 * language alone: it names no status, so a published language keeps its readers
 * on what they have where drafts are held, and a language nobody has published
 * stays unpublished.
 *
 * @module components/features/translations/page/useTranslationForm
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldConfig } from "nextly/config";
import { useEffect, useMemo, useRef } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";

import { adoptStoredValues } from "@admin/components/features/entries/EntryForm/adopt-stored";
import { submitDocument } from "@admin/components/features/entries/EntryForm/submit-document";
import {
  useVersionConflict,
  type VersionConflict,
} from "@admin/components/features/entries/EntryForm/useVersionConflict";
import { relaxRequired } from "@admin/components/features/singles/identity-fields";
import type { EditorRestore } from "@admin/components/features/versions/editor-restore";
import { useFormRestore } from "@admin/components/features/versions/useEditorRestoreSurface";
import { toast } from "@admin/components/ui";
import { drawnFieldPath } from "@admin/hooks/queries/drawn-field-path";
import { useUpdateSingleDocument } from "@admin/hooks/queries/useSingles";
import { useUpdateEntry } from "@admin/hooks/queries/useUpdateEntry";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { staleVersionOf } from "@admin/lib/document-version";
import { placeServerRefusal } from "@admin/lib/errors/error-mapping";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
import {
  toastMutationResult,
  type MutationResult,
} from "@admin/lib/mutation-warnings";
import type { TranslatedDocument } from "@admin/lib/navigation/translation-address";
import { addressableFieldsWithin } from "@admin/lib/plugins/document-view-registry";
import type { UpdateEntryPayload } from "@admin/services/entryApi";

import { nestedPayload, ontoCurrent, type NestedPayload } from "./nested-text";
import type { TranslationField } from "./translation-fields";
import {
  changedRows,
  PROVENANCE_KEY,
  translationPayload,
} from "./translation-save";
import type { DocumentRow } from "./useTranslationDocument";

export interface TranslationFormOptions {
  document: TranslatedDocument;
  /** The language being written. */
  target: { code: string; label: string };
  /** The collection's or Single's fields. */
  fields: readonly FieldConfig[];
  /** The fields written here. */
  rows: readonly TranslationField[];
  /** The containers whose text is written here. */
  nested: readonly TranslationField[];
  /** The document in the language, as it was read. */
  written: DocumentRow;
  /**
   * The language the source of a field, or of a text inside a container, is
   * shown in, by its path in the form; undefined where it has none.
   */
  sourceOf: (name: string) => string | undefined;
  /** Read the document again. */
  reload: () => Promise<DocumentRow | undefined>;
}

export interface TranslationForm {
  form: UseFormReturn<Record<string, unknown>>;
  /** Every field the form holds; one list for as long as it is one schema. */
  fields: FieldConfig[];
  isDirty: boolean;
  isSaving: boolean;
  /** Save what changed; answers whether nothing is left to save. */
  save: () => Promise<boolean>;
  /** The version the form's copy started from. */
  startedFrom: () => string | undefined;
  /**
   * What puts a past version's values into this form. The save names the
   * version each one came from, and with none it names nothing.
   */
  restore: EditorRestore;
  /** The save refused because the document changed since it was read. */
  conflict: VersionConflict | null;
  loadCurrent: () => Promise<void>;
  saveAnyway: () => Promise<void>;
}

/** A saved document, with what failed after the save. */
type Saved = MutationResult<DocumentRow & { id: string }>;

/**
 * Saves one language of the document. Both hooks are called, as hooks must be,
 * and the one the document is not of is never asked to write.
 */
function useSendTranslation(
  document: TranslatedDocument,
  locale: string
): { send: (payload: DocumentRow) => Promise<Saved>; isPending: boolean } {
  const entry = useUpdateEntry({
    collectionSlug: document.kind === "collection" ? document.slug : "",
    entryId: document.kind === "collection" ? document.id : "",
    locale,
    // The page says what happened itself, naming the language; and it holds
    // the document under keys of its own, which no guess of the answer is
    // written to.
    showToast: false,
    optimistic: false,
  });
  const single = useUpdateSingleDocument(document.slug, locale);
  return {
    isPending: entry.isPending || single.isPending,
    send: async payload =>
      document.kind === "single"
        ? { item: await single.mutateAsync(payload) }
        : entry.mutateAsync(payload as UpdateEntryPayload),
  };
}

/** Types whose saved row may leave out a link the reader cannot open. */
const LINK_TYPES: ReadonlySet<string> = new Set(["relationship", "upload"]);

/**
 * What the form starts from after a save: what it sent, with each written field
 * as the server stored it. A link is kept as sent, because the answer leaves
 * out one the reader may not open, and the next save would then remove it.
 */
function afterSave(
  rows: readonly TranslationField[],
  sent: Readonly<Record<string, unknown>>,
  stored: DocumentRow
): Record<string, unknown> {
  const answered = rows.filter(
    ({ field, name }) =>
      !LINK_TYPES.has(field.type) && Object.hasOwn(stored, name)
  );
  return {
    ...sent,
    ...getDefaultValues(
      answered.map(row => row.field),
      stored
    ),
  };
}

/** The save's body: the fields of their own, and the containers' text. */
function together(
  own: Record<string, unknown>,
  inside: NestedPayload
): Record<string, unknown> {
  const claims = {
    ...(own[PROVENANCE_KEY] as NestedPayload["claims"] | undefined),
    ...inside.claims,
  };
  return {
    ...own,
    ...inside.values,
    ...(Object.keys(claims).length === 0 ? {} : { [PROVENANCE_KEY]: claims }),
  };
}

export function useTranslationForm({
  document,
  target,
  fields,
  rows,
  nested,
  written,
  sourceOf,
  reload,
}: TranslationFormOptions): TranslationForm {
  // The fields as the form addresses them, an unnamed group's among them.
  const named = useMemo(
    () =>
      addressableFieldsWithin(fields)
        .filter(({ path }) => path !== "")
        .map(({ field }) => field),
    [fields]
  );
  const startingValues = useMemo(
    () => getDefaultValues(named, written),
    [named, written]
  );
  // A language other than the default may leave any field empty: its readers
  // are shown another language's. What a field does hold is still checked.
  const resolver = useMemo(
    () =>
      zodResolver(
        generateClientSchema(
          rows.map(row => relaxRequired(row.field)),
          { mode: "edit" }
        )
      ),
    [rows]
  );
  const form = useForm<Record<string, unknown>>({
    resolver,
    defaultValues: startingValues,
    mode: "onSubmit",
  });
  const { isDirty, isSubmitting } = form.formState;
  const restore = useFormRestore(form);
  const version = useVersionConflict();
  const { send, isPending } = useSendTranslation(document, target.code);

  // A newer read replaces a form nobody has written in. One being written in
  // keeps its words and the version they began from, so its save is refused
  // with the choice rather than made over a change nobody saw.
  // Run for a newer read alone: the version moving by a save is no reason to
  // put back the read from before it.
  const versionNow = useRef(version);
  useEffect(() => {
    versionNow.current = version;
  }, [version]);
  useEffect(() => {
    if (form.formState.isDirty || versionNow.current.pinned()) return;
    versionNow.current.adoptRead(written);
    form.reset(startingValues);
  }, [form, written, startingValues]);

  // A refused save whose words were then put back has nothing left to ask
  // about: the form starts afresh from the document as it now is.
  const reloadNow = useRef(reload);
  const latest = useRef({ written, startingValues });
  useEffect(() => {
    reloadNow.current = reload;
    latest.current = { written, startingValues };
  }, [reload, written, startingValues]);
  useEffect(() => {
    if (isDirty || !versionNow.current.pinned()) return;
    versionNow.current.release();
    versionNow.current.adoptRead(latest.current.written);
    form.reset(latest.current.startingValues);
    void reloadNow.current();
  }, [form, isDirty]);

  const fail = (error: unknown) => {
    // The conflict is said by its own dialog.
    if (staleVersionOf(error) !== undefined) return;
    const placed = placeServerRefusal(error, form.setError, {
      isFormField: drawnFieldPath(
        [...rows, ...nested].map(row => row.field),
        path => form.getValues(path)
      ),
    });
    if (placed.handled) return;
    toast.error(
      placed.toastMessage ??
        apiErrorMessage(error, `${target.label} couldn't be saved.`)
    );
  };

  const save = async () => {
    // Read here rather than as the form started: an earlier save moved it.
    const startedFrom = form.formState.defaultValues ?? {};
    const shown = form.getValues();
    const inside = nestedPayload(nested, shown, startedFrom, sourceOf);
    if (
      changedRows(rows, shown, startedFrom).length === 0 &&
      Object.keys(inside.values).length === 0
    ) {
      // Typed and put back: there is nothing to send.
      form.reset(startedFrom);
      return true;
    }
    const write = version.writeFor();
    const outcome = await submitDocument({
      form,
      recordingsFor: null,
      restore,
      toPayload: values =>
        together(
          translationPayload(rows, values, startedFrom, sourceOf),
          inside
        ),
      write: async payload => {
        const { item, warnings } = await send(
          version.withVersion(payload)
        ).catch(write.refusedThen(payload, shown));
        write.answered(item);
        write.released();
        toastMutationResult(`${target.label} saved`, warnings);
        return { item, stored: afterSave(rows, shown, item) };
      },
      onFailure: fail,
    });
    // What was typed while the save was on its way is still unsaved. Asked of
    // the form as it is now: its state is the last render's.
    return (
      outcome.ok &&
      ![...rows, ...nested].some(({ name }) => form.getFieldState(name).isDirty)
    );
  };

  const loadCurrent = async () => {
    const current = await reload();
    if (current === undefined) {
      const message = "The current version couldn't be loaded.";
      version.failed(message);
      throw new Error(message);
    }
    version.release();
    version.adoptRead(current);
    form.reset(getDefaultValues(named, current));
  };

  /**
   * A refused save made again over what is stored now. A container is written
   * whole, so its text goes onto the rows it has now rather than putting back
   * those it had. The form then holds every container as it is now, whether or
   * not this save wrote it: the next one would put back the rows it held.
   */
  const ontoLatest = async (
    refused: Record<string, unknown>,
    sent: Record<string, unknown>
  ): Promise<{
    payload: Record<string, unknown>;
    containers: Record<string, unknown>;
  }> => {
    if (nested.length === 0) return { payload: refused, containers: {} };
    const current = await reload();
    if (current === undefined) {
      throw new Error("The current version couldn't be loaded.");
    }
    const payload = ontoCurrent(nested, refused, sent, current);
    const starting = getDefaultValues(named, current);
    return {
      payload,
      containers: Object.fromEntries(
        nested.map(container => [
          container.name,
          Object.hasOwn(payload, container.name)
            ? payload[container.name]
            : starting[container.name],
        ])
      ),
    };
  };

  const saveAnyway = async () => {
    const refused = version.overwrite();
    if (refused === null) return;
    // Read before the conflict is closed, which forgets it: what was typed
    // since the refusal is kept as unsaved work.
    const sent = version.refusedValues() ?? form.getValues();
    const write = version.writeFor();
    try {
      const { payload, containers } = await ontoLatest(refused, sent);
      const { item, warnings } = await send(payload);
      write.answered(item);
      write.released();
      restore.saved();
      toastMutationResult(`${target.label} saved`, warnings);
      adoptStoredValues(
        form,
        { ...afterSave(rows, sent, item), ...containers },
        sent
      );
    } catch (error) {
      version.failed(
        apiErrorMessage(error, `${target.label} couldn't be saved.`)
      );
      throw error;
    }
  };

  return {
    form,
    fields: named,
    isDirty,
    isSaving: isSubmitting || isPending,
    save,
    startedFrom: version.startedFrom,
    restore,
    conflict: version.conflict,
    loadCurrent,
    saveAnyway,
  };
}
