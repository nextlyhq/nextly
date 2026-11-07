"use client";

/**
 * An entry's own design's "Own design" section, in its document panel after
 * Details: the entry it serves, that entry's collection and id, and the
 * template it was copied from, read-only.
 *
 * These are the plugin's own bookkeeping, written as the system when the own
 * design is made and when its template is deleted, so the form does not draw
 * them as inputs (`admin.hidden`). They are still worth reading, so they are
 * said here, where Details says the document's id and dates. The values are
 * the form's, as the rest of the screen shows them, a past version included;
 * the names they are said with come from the own-designs read the template's
 * panel already makes. A collection's template names none of them, and draws
 * no section.
 *
 * @module admin/TemplateDesignDetails
 */
import type { DocumentPanelSectionProps } from "@nextlyhq/plugin-sdk/admin";
import { ExternalLink } from "lucide-react";
import type { JSX } from "react";
import {
  useFormContext,
  useWatch,
  type Control,
  type FieldValues,
} from "react-hook-form";

import type { EntryDesignsResponse } from "../templates/entry-designs-contract";
import {
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
  TEMPLATE_FORKED_FROM_FIELD,
} from "../templates/template-preview-contract";

import {
  designOf,
  entryHref,
  openInAdmin,
  useTemplateDesigns,
} from "./entry-designs-client";
import { navigateWithin } from "./plain-click";

/** The four values, as the form holds them, each trimmed or null. */
export interface DesignDetailValues {
  readonly entry: string | null;
  readonly entryCollection: string | null;
  readonly entryId: string | null;
  readonly forkedFrom: string | null;
}

/** One row of the section. */
export interface DesignDetailRow {
  readonly label: string;
  /** What is said; a link where `href` is set. */
  readonly value: string;
  readonly href?: string;
  /** Drawn in the code face, for an id. */
  readonly code?: boolean;
  /** Said muted, for the absence of a value. */
  readonly muted?: boolean;
}

/** A stored text value, or null for none. */
function filledText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Whether the form is an entry's own design: any of its fields names one. */
function isOwnDesign(values: DesignDetailValues): boolean {
  return (
    values.entry !== null ||
    values.entryCollection !== null ||
    values.entryId !== null
  );
}

/**
 * The rows an own design's section draws, from its values and the read that
 * names them. Its own function so what is said is pinned apart from the
 * render. Empty for a collection's template.
 */
export function designDetailRows(
  values: DesignDetailValues,
  answer: EntryDesignsResponse | undefined
): DesignDetailRow[] {
  if (!isOwnDesign(values)) return [];
  const { entryCollection, entryId, forkedFrom } = values;
  // The read's names only where it answered for this entry's collection.
  const names =
    answer !== undefined &&
    entryCollection !== null &&
    answer.meta.collection === entryCollection
      ? answer.meta.names
      : undefined;
  const rows: DesignDetailRow[] = [];
  if (entryCollection !== null && entryId !== null) {
    rows.push({
      label: "Entry",
      value:
        (names === undefined ? undefined : designOf(answer, entryId)?.title) ??
        "Open entry",
      href: entryHref(entryCollection, entryId),
    });
  }
  rows.push({
    label: "Entry's collection",
    value: names?.plural ?? entryCollection ?? "None",
    ...(entryCollection === null ? { muted: true } : {}),
  });
  rows.push(
    entryId === null
      ? { label: "Entry id", value: "None", muted: true }
      : { label: "Entry id", value: entryId, code: true }
  );
  rows.push(copiedFromRow(forkedFrom, answer));
  return rows;
}

/**
 * The template the design was copied from: by its title where the read names
 * it, else by id; and that it is gone once that template was deleted, which
 * empties the field.
 */
function copiedFromRow(
  forkedFrom: string | null,
  answer: EntryDesignsResponse | undefined
): DesignDetailRow {
  if (forkedFrom === null) {
    return {
      label: "Copied from",
      value: "A template since deleted",
      muted: true,
    };
  }
  const template = answer?.meta.template;
  const templates = answer?.meta.templatesCollection;
  const titled = template?.id === forkedFrom ? template.title : undefined;
  return {
    label: "Copied from",
    value: titled ?? forkedFrom,
    ...(titled === undefined ? { code: true } : {}),
    ...(templates === undefined || templates === ""
      ? {}
      : { href: entryHref(templates, forkedFrom) }),
  };
}

/** The control of the form the panel sits beside, as its context gives it. */
type FormControl = Control<FieldValues, unknown, unknown>;

/** The four values on the form, as `control` holds them now. */
function useDesignValues(control: FormControl): DesignDetailValues {
  const [entry, entryCollection, entryId, forkedFrom] = useWatch({
    control,
    name: [
      TEMPLATE_ENTRY_FIELD,
      TEMPLATE_ENTRY_COLLECTION_FIELD,
      TEMPLATE_ENTRY_ID_FIELD,
      TEMPLATE_FORKED_FROM_FIELD,
    ],
  });
  return {
    entry: filledText(entry),
    entryCollection: filledText(entryCollection),
    entryId: filledText(entryId),
    forkedFrom: filledText(forkedFrom),
  };
}

/** The rows, read from the form the panel sits beside. */
function DesignDetails({
  control,
  templateId,
}: {
  control: FormControl;
  templateId: string;
}): JSX.Element | null {
  const values = useDesignValues(control);
  const ownDesign = isOwnDesign(values);
  // Asked only of an own design: a collection's template draws nothing here.
  const read = useTemplateDesigns(ownDesign ? templateId : undefined);
  const rows = designDetailRows(values, read.data ?? undefined);
  if (rows.length === 0) return null;
  return (
    <dl className="space-y-3">
      {rows.map(row => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-3"
        >
          <dt className="shrink-0 text-xs text-muted-foreground">
            {row.label}
          </dt>
          <dd className="flex min-w-0 items-center justify-end">
            <RowValue row={row} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A row's value: a link, an id, or plain words, cut to the panel's width. */
function RowValue({ row }: { row: DesignDetailRow }): JSX.Element {
  const face = row.code === true ? "font-mono" : "";
  const tone = row.muted === true ? "text-muted-foreground" : "text-foreground";
  if (row.href !== undefined) {
    return (
      <a
        href={row.href}
        {...navigateWithin(row.href, openInAdmin)}
        title={row.value}
        className={`inline-flex min-w-0 items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring ${face}`}
      >
        <span className="truncate">{row.value}</span>
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      </a>
    );
  }
  return (
    <span className={`truncate text-xs ${tone} ${face}`} title={row.value}>
      {row.value}
    </span>
  );
}

/**
 * The "Own design" section of a template's document panel. Draws nothing on
 * a collection's template, or outside a form.
 */
export function TemplateDesignDetails({
  entryId,
}: DocumentPanelSectionProps): JSX.Element | null {
  // The panel sits inside the document's form; drawn anywhere else it has
  // no values to say, and says nothing.
  const form = useFormContext() as ReturnType<typeof useFormContext> | null;
  if (form === null) return null;
  return <DesignDetails control={form.control} templateId={entryId} />;
}
