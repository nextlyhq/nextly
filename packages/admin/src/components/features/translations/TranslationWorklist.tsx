"use client";

/**
 * The translation worklist — one language's outstanding work, across every
 * collection that has any.
 *
 * Every other translation surface in the admin answers "what state is THIS
 * document in": the language panel, translation mode, the language dots on a
 * list row. None of them can answer the question a translator actually arrives
 * with — *what needs me, anywhere, in my language?* — so finding the work meant
 * opening every document in turn.
 *
 * This is only the way IN. Choosing a row hands off to the editor that already
 * exists, in translation mode, with the source language already chosen. It
 * deliberately does not become a second editor: that would duplicate the form,
 * the unsaved-changes guard, autosave and the save intent, and it would make
 * this the fifth surface answering one question — which is the failure the
 * whole multilingual pass exists to undo.
 *
 * @module components/features/translations/TranslationWorklist
 */

import { useEffect } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { LOCALE_PARAM, TRANSLATE_PARAM } from "@admin/constants/search-params";
import { useTranslationWorklist } from "@admin/hooks/queries/useTranslationWorklist";
import { useLocalization } from "@admin/hooks/useLocalization";
import { navigateTo } from "@admin/lib/navigation";
import {
  WORKLIST_STATES,
  resolveActiveTarget,
  type TranslationWorkRow,
  type WorklistState,
} from "@admin/types/translations/worklist";

/** Where a row goes: the document, in the target language, translating from the source. */
function rowHref(
  row: TranslationWorkRow,
  target: string,
  source: string
): string {
  const path = buildRoute(ROUTES.COLLECTION_ENTRY_EDIT, {
    slug: row.collection,
    id: row.id,
  });
  // BOTH params, because the destination needs both facts: which language is
  // being edited, and which one is on display beside it. Sending only the
  // locale opens the ordinary editor in that language with no source — which
  // is not the screen this row promised.
  const params = new URLSearchParams({
    [LOCALE_PARAM]: target,
    [TRANSLATE_PARAM]: source,
  });
  return `${path}?${params.toString()}`;
}

function WorklistRow({
  row,
  target,
  source,
}: {
  row: TranslationWorkRow;
  target: string;
  source: string;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* The title does not shrink away: it is the row's identity, and a
            truncated collection label still tells you where you are while a
            truncated title names nothing. */}
        <span className="truncate text-sm font-medium">{row.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {row.collectionLabel}
        </span>
      </div>
      {/* Named for the document it opens. Read out of context — a screen
          reader stepping through this list — fifty buttons all saying
          "Translate" name nothing at all.

          `navigateTo` rather than an anchor: this admin is a single page, and a
          real href would reload the whole application to reach a route the
          router already owns. It is the same call the entry list makes to open
          a row in a language. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        aria-label={`Translate ${row.title}`}
        onClick={() => navigateTo(rowHref(row, target, source))}
      >
        Translate
      </Button>
    </li>
  );
}

function WorklistBody({
  rows,
  target,
  source,
  stateLabel,
}: {
  rows: readonly TranslationWorkRow[];
  target: string;
  source: string;
  stateLabel: string;
}) {
  if (rows.length === 0) {
    // Said, rather than shown as an empty list. A blank area under a filter
    // reads as "something failed" as easily as "nothing to do", and the two
    // deserve opposite reactions.
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        Nothing {stateLabel.toLowerCase()} in this language.
      </p>
    );
  }
  return (
    <ul aria-label="Documents needing translation">
      {rows.map(row => (
        <WorklistRow
          key={`${row.collection}:${row.id}`}
          row={row}
          target={target}
          source={source}
        />
      ))}
    </ul>
  );
}

export function TranslationWorklist({
  locale,
  state,
  onLocaleChange,
  onStateChange,
}: {
  /** The language being worked on, or undefined before one is chosen. */
  locale: string | undefined;
  state: WorklistState;
  onLocaleChange: (code: string) => void;
  onStateChange: (state: WorklistState) => void;
}) {
  const { enabled, locales, defaultLocale } = useLocalization();
  // The active language is resolved BEFORE the query, not after it.
  //
  // Arriving from the sidebar there is no `?locale=`, so asking with `undefined`
  // leaves the query disabled — and a disabled query is `isPending` forever, so
  // the page sat on skeletons until someone clicked the language that was
  // already highlighted. The component knew which language it meant the whole
  // time; it simply worked it out one line too late.
  const source = defaultLocale;
  const targets = locales.filter(l => l.code !== source);
  // Not `locale ?? targets[0]`: a URL naming the SOURCE language is a
  // configured locale, so the server accepts it and answers nonsense — nothing
  // is missing in the language everything is written in, and every document
  // counts as translated. See `resolveActiveTarget`.
  const active = resolveActiveTarget(
    locale,
    targets.map(t => t.code)
  );
  const query = useTranslationWorklist({ locale: active, state });

  // Put the URL back in step when it asked for a language this worklist cannot
  // answer for, so the address bar keeps describing what is on screen and a
  // copied link reproduces it. Only when the URL NAMED one: arriving with no
  // `?locale=` is the ordinary path from the sidebar and must not be rewritten.
  useEffect(() => {
    if (locale !== undefined && active !== undefined && locale !== active) {
      onLocaleChange(active);
    }
  }, [locale, active, onLocaleChange]);

  if (!enabled) {
    // A worklist on a site with one language is a list that can never have a
    // row. Saying so beats an empty table that looks like a loading failure.
    return (
      <Alert>
        <AlertTitle>No languages configured</AlertTitle>
        <AlertDescription>
          Add a second language to this app&rsquo;s localization config, and the
          work outstanding in it will be listed here.
        </AlertDescription>
      </Alert>
    );
  }

  const stateLabel =
    WORKLIST_STATES.find(t => t.value === state)?.label ?? "outstanding";
  const notConsulted = query.data?.meta.notConsulted ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Language
        </span>
        {targets.map(l => (
          <Button
            key={l.code}
            type="button"
            variant={l.code === active ? "default" : "outline"}
            size="sm"
            aria-pressed={l.code === active}
            onClick={() => onLocaleChange(l.code)}
          >
            {l.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Showing
        </span>
        {WORKLIST_STATES.map(tab => (
          <Button
            key={tab.value}
            type="button"
            variant={tab.value === state ? "default" : "outline"}
            size="sm"
            aria-pressed={tab.value === state}
            onClick={() => onStateChange(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Named rather than swallowed. A worklist that silently omits a
          collection reads as "nothing to do there" — indistinguishable from the
          truth at a glance, and the only way this page can lie.

          The wording states the OMISSION and not a cause, because the server
          reports two causes through one field: the fan-out cap, and a
          collection whose read failed. Explaining it as capacity would tell
          someone with a broken query that their site is too big — a confident
          answer to a question they did not ask, pointing away from the fault. */}
      {notConsulted.length > 0 && (
        <Alert>
          <AlertTitle>Not everything was checked</AlertTitle>
          <AlertDescription>
            These collections were left out of this answer:{" "}
            {notConsulted.join(", ")}. That happens when a site has more
            collections than one request covers, or when a collection
            can&rsquo;t be read just now. Reload to see whether it was
            temporary.
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border border-border">
        {query.isPending && active !== undefined ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Couldn&rsquo;t load the worklist. {query.error.message}
          </p>
        ) : (
          <WorklistBody
            rows={query.data?.items ?? []}
            target={active ?? ""}
            source={source}
            stateLabel={stateLabel}
          />
        )}
      </div>

      {/* Says WHICH of the two it is showing. A truncated backlog presented as
          a complete one is the same lie as an unconsulted collection, one level
          down — so when more was found than fits, the count says so rather than
          reporting the slice as the whole. */}
      {query.data !== undefined && query.data.items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {query.data.meta.total > query.data.items.length ? (
            <>
              Showing <Badge variant="default">{query.data.items.length}</Badge>{" "}
              of {query.data.meta.total} documents
            </>
          ) : (
            <>
              <Badge variant="default">{query.data.items.length}</Badge>{" "}
              documents
            </>
          )}
        </p>
      )}
    </div>
  );
}
