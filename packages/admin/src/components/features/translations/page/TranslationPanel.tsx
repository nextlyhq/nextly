"use client";

/**
 * Where the language stands, beside the cards: its status, and the fields that
 * are not translated here, each said to be edited where it is.
 *
 * @module components/features/translations/page/TranslationPanel
 */

import { useId, type JSX, type ReactNode } from "react";

import type { LocaleTranslationMeta } from "@admin/components/features/entries/translation-meta";
import { Link } from "@admin/components/ui/link";

import type { LanguageStanding } from "./language-standing";
import type { TranslationField } from "./translation-fields";

/**
 * The language's status in words, or undefined where it can't be known:
 * "Live, 1 out of date".
 */
export function statusWords(
  standing: LanguageStanding,
  meta: LocaleTranslationMeta | undefined,
  outOfDate: number
): string | undefined {
  if (standing.published === undefined) return undefined;
  const state = standing.published
    ? "Live"
    : meta?.translated === true || standing.pending === true
      ? "Draft"
      : "Not started";
  return [
    state,
    ...(outOfDate > 0 ? [`${outOfDate} out of date`] : []),
    ...(standing.published && standing.pending === true
      ? ["changes not published"]
      : []),
  ].join(", ");
}

export interface TranslationPanelProps {
  /** The language's name. */
  title: string;
  status: string | undefined;
  /** The document's editor. */
  editorHref: string;
  shared: readonly TranslationField[];
  /** Kept per language and written in an editor of its own. */
  elsewhere: readonly TranslationField[];
  /** Further rows, under the status. */
  children?: ReactNode;
}

/** One row: what it is, and what it says. */
function Row({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): JSX.Element {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 text-sm"
    >
      <h3 id={id} className="text-muted-foreground">
        {name}
      </h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Names({
  fields,
}: {
  fields: readonly TranslationField[];
}): JSX.Element {
  return (
    <ul className="mt-1 text-muted-foreground">
      {fields.map(field => (
        <li key={field.name}>{field.label}</li>
      ))}
    </ul>
  );
}

export function TranslationPanel({
  title,
  status,
  editorHref,
  shared,
  elsewhere,
  children,
}: TranslationPanelProps): JSX.Element {
  const titleId = useId();
  return (
    <aside
      aria-labelledby={titleId}
      data-slot="translation-panel"
      className="w-full shrink-0 space-y-3 @5xl/translation:w-72 @5xl/translation:border-l @5xl/translation:border-border @5xl/translation:pl-6"
    >
      <h2
        id={titleId}
        className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {title}
      </h2>
      {status === undefined ? null : <Row name="Status">{status}</Row>}
      {children}
      {shared.length === 0 ? null : (
        <Row name="Shared fields">
          <Link href={editorHref} className="underline underline-offset-4">
            Edited in the document
          </Link>
          <Names fields={shared} />
        </Row>
      )}
      {elsewhere.length === 0 ? null : (
        <Row name="Not translated here">
          Translated in their own editor
          <Names fields={elsewhere} />
        </Row>
      )}
    </aside>
  );
}
