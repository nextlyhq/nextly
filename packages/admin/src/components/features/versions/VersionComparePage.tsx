/**
 * A document's version history, as a page.
 *
 * A comparison is two columns of field values, and the history panel is 480px —
 * which is why comparing from the panel had to escape into a dialog stacked
 * over it. A page gives the comparison the width it needs, removes the second
 * floating surface, and makes the browser's own back button the way out.
 *
 * The pair being compared lives in the URL (`?from=&to=`), so a comparison is
 * addressable: it can be linked into a review rather than described. That is
 * the concrete reason this is a route and not a larger dialog.
 *
 * Drawn as the editor draws a past version: the actions in the title row
 * (Copy link, Restore…), one card choosing the two versions and the language,
 * then the comparison's own bar and the fields, each changed one split in
 * place side by side. The history list itself lives beside the document; here
 * the two versions are chosen by name.
 *
 * @module components/features/versions/VersionComparePage
 */

import { ArrowLeftRight, Link2, RotateCcw } from "lucide-react";
import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";

import {
  Breadcrumbs,
  type BreadcrumbItem,
} from "@admin/components/shared/breadcrumbs";
import { Alert, AlertDescription, Button, toast } from "@admin/components/ui";
import { withQuery } from "@admin/constants/routes";
import { LOCALE_PARAM } from "@admin/constants/search-params";
import {
  scopeKey,
  useBaselineDiff,
  useVersion,
  useVersions,
} from "@admin/hooks/queries/useVersions";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";
import { validationIssues } from "@admin/lib/api/parseApiError";
import { formatDateTime } from "@admin/lib/dates/format";
import { navigateTo } from "@admin/lib/navigation";
import type {
  FieldDiff,
  VersionMeta,
  VersionScope,
} from "@admin/services/versionApi";

import type { ChangesLayout } from "./diff/changes-layout";
import { VersionDiffView } from "./diff/VersionDiffView";
import {
  HISTORY_PARAM,
  RESTORE_ALL,
  RESTORE_PARAM,
  VERSION_PARAM,
} from "./history-address";
import {
  HISTORY_COLUMN,
  HISTORY_FRAME,
  HISTORY_PICKER,
} from "./history-layout";
import { useMarkVersionSeen } from "./useMarkVersionSeen";
import { versionAuthorLabel } from "./version-author";
import { isFieldChange } from "./version-changes";
import { baselineLabel, type PairResolution } from "./version-pairing";
import {
  namesServerBaseline,
  resolvePair,
  type ComparisonFrom,
} from "./version-search-params";
import { versionsHref } from "./versions-href";

export interface VersionComparePageProps {
  scope: VersionScope;
  /** Where the back control returns to — the document this history belongs to. */
  documentHref: string;
  /**
   * Where to return instead when the viewer may only READ this document.
   *
   * Reading a history needs `read-${slug}`; the document's own editor needs
   * `update-${slug}`. So a colleague can open a shared comparison, read it, and
   * be sent to a permission-denied page by the one control that is always on
   * screen. This is the destination their permission does reach.
   */
  readOnlyHref: string;
  /** The document's title, so the page says which document it is about. */
  documentTitle?: string;
  /**
   * The list the document belongs to, leading the trail ("Posts"), where it
   * has one: a collection's entries. A Single has none.
   */
  listCrumb?: { label: string; href: string };
  /**
   * Whether the collection or Single is translated, from its schema: the
   * Languages choice is offered by this, never by the versions loaded, since
   * a page of shared-field saves holds no language to tell it by.
   */
  entityLocalized?: boolean;
  /**
   * The pair from the URL. Either may be absent on a link that names none;
   * `from` may name the version before `to` in its language (`previous`).
   */
  from?: ComparisonFrom;
  to?: number;
  /**
   * The language the address names. The page then lists that language's
   * versions (and the shared ones), as the history panel's language filter
   * does, so a link shared from a German history opens on German history.
   * Absent lists every language.
   */
  locale?: string;
  /** How the address asks the comparison to be drawn. */
  view?: "inline" | "side";
}

/** The baselines the older side may be, as "Compare" offers them. */
const COMPARE_WITH: readonly { value: string; label: string }[] = [
  { value: "previous", label: "The version before" },
  { value: "published", label: "Currently published" },
  { value: "draft", label: "Current draft" },
  { value: "last-viewed", label: "The version you last looked at" },
];

/** A version as the page names it: its own name, else its number. */
function versionName(versionNo: number, meta: VersionMeta | undefined): string {
  return meta?.label ? `“${meta.label}”` : `Version ${versionNo}`;
}

/** A version as a choice lists it: its name, when, and by whom. */
function versionChoice(meta: VersionMeta): string {
  const versionNo = meta.versionNo ?? 0;
  return [
    meta.label
      ? `${versionName(versionNo, meta)} (v${versionNo})`
      : `Version ${versionNo}`,
    formatDateTime(meta.createdAt),
    versionAuthorLabel(meta),
  ].join(" · ");
}

/** A baseline's name, as the page says it in a sentence. */
const BASELINE_PHRASE: Record<string, string> = {
  previous: "the version before",
  published: "what is published",
  draft: "the current draft",
  "last-viewed": "the version you last looked at",
};

/**
 * Which version the server compared with, in words: the baseline it resolved,
 * and, where retention had removed the version that baseline named, which one
 * stands in for it.
 */
function BaselineNote({
  baseline,
}: {
  baseline: { name: string; versionNo: number; replaces?: number };
}) {
  // A baseline another feature registered is said by its name in words.
  const phrase =
    BASELINE_PHRASE[baseline.name] ??
    baselineLabel(baseline.name).toLowerCase();
  return (
    <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
      {baseline.replaces !== undefined
        ? baseline.name === "last-viewed"
          ? `Version ${baseline.replaces}, the one you last looked at, is no longer kept. Compared with version ${baseline.versionNo} instead.`
          : `Version ${baseline.replaces} is no longer kept. Compared with version ${baseline.versionNo} instead.`
        : `Compared with ${phrase} (version ${baseline.versionNo}).`}
    </p>
  );
}

/**
 * Why there is nothing to compare, in the reader's terms.
 *
 * A table rather than nested conditionals, so adding a reason is data — and so
 * that no reason can quietly fall through to another's sentence, which is how
 * a document with no versions came to be told it had exactly one.
 */
const NO_PAIR_MESSAGE: Record<
  Exclude<PairResolution["kind"], "pair" | "baseline">,
  string
> = {
  // Said of the comparison, not of the document: the picker beside it offers
  // nothing to choose, and the history panel is where a history is read.
  "no-history": "There is nothing to compare yet.",
  "only-version":
    "There is only one version so far, so there is nothing to compare it with.",
  // Deliberately different from the line above. Saying "there is only one
  // version" beside a picker listing several would leave a reader unable to
  // tell which surface to believe; this says which language is meant, and
  // that there is somewhere else to look.
  "only-in-locale":
    "This is the only version in this language, so there is nothing to compare " +
    "it with. Versions in other languages have their own history.",
  "not-loaded":
    "The version before this one has not been loaded yet. Choose Load older versions to fetch it.",
};

/** A comparison the diff view reports drawn, with the language it is in. */
interface DrawnComparison {
  from: number;
  to: number;
  locale: string | null;
}

/**
 * Why the server refused a baseline, in its words: nothing to compare with
 * (no current draft, nothing published, no earlier visit), or a name it does
 * not know, which it answers with the ones it does. Undefined for any other
 * failure, which is a comparison that did not load.
 */
function baselineRefusalOf(error: unknown): string | undefined {
  return validationIssues(error).find(issue => issue.path === "baseline")
    ?.message;
}

/** What fills the comparison side: a failure, a reason there is no pair, or one. */
function ComparisonPane({
  scope,
  pair,
  baselineDiff,
  refusal,
  view,
  onViewChange,
  onShown,
  isError,
  isLoading,
  onRetry,
  nameOf,
  fieldAction,
}: {
  scope: VersionScope;
  pair: PairResolution;
  /** The server's answer for a baseline it resolves. */
  baselineDiff: ReturnType<typeof useBaselineDiff>;
  /** Why the server refused that baseline, in its words, when it did. */
  refusal: string | undefined;
  view?: "inline" | "side";
  onViewChange: (layout: ChangesLayout) => void;
  /** Hears the diff view report the comparison it has drawn. */
  onShown: (shown: DrawnComparison | null) => void;
  isError: boolean;
  isLoading: boolean;
  onRetry: () => void;
  /** Names the drawn pair's two versions, from the versions the page holds. */
  nameOf: (versionNo: number) => string;
  /** What the page offers on one field: "Restore this field". */
  fieldAction?: (node: FieldDiff) => React.ReactNode;
}) {
  if (isError) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Alert variant="destructive">
          <AlertDescription>
            This document&apos;s history could not be loaded.
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (pair.kind === "baseline") {
    if (baselineDiff.isError) {
      // A refusal is the server's answer about the document, and asking again
      // gets the same one, so it is said without a retry. Any other failure
      // is a comparison that did not load, which can be asked for again: this
      // answer is not asked again on a return to the tab for every baseline,
      // so without the control a reload would be the only way back.
      if (refusal !== undefined) {
        return (
          <div className="p-4">
            <Alert variant="info">
              <AlertDescription>{refusal}</AlertDescription>
            </Alert>
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-3 p-4">
          <Alert variant="destructive">
            <AlertDescription>
              This comparison could not be loaded.
            </AlertDescription>
          </Alert>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void baselineDiff.refetch()}
          >
            Try again
          </Button>
        </div>
      );
    }
    const data = baselineDiff.data;
    if (!data) {
      return (
        <div className="px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Loading comparison…</p>
        </div>
      );
    }
    return (
      <>
        {data.baseline ? <BaselineNote baseline={data.baseline} /> : null}
        <VersionDiffView
          key={`${scopeKey(scope).join(":")}:${data.from}-${data.to}`}
          scope={scope}
          from={data.from}
          to={data.to}
          // The baseline's answer is this pair's whole comparison, and has
          // already filled the pair's own, so it is drawn without asking the
          // server to compute it again.
          seededBy={pair.baseline}
          {...(view ? { view } : {})}
          onViewChange={onViewChange}
          onShown={onShown}
          fromLabel={nameOf(data.from)}
          toLabel={nameOf(data.to)}
          {...(fieldAction ? { fieldAction } : {})}
        />
      </>
    );
  }

  if (pair.kind !== "pair") {
    // Said plainly rather than shown as an empty comparison, which would read
    // as "nothing changed" — the answer this feature must never give by
    // accident. Which sentence depends on WHY there is no pair: the three cases
    // are different situations and a reader acts differently on each.
    return (
      <div className="px-4 py-8 text-center">
        {/* Keyed by what it says, so the answer replaces the loading line as a
            new line rather than rewriting its text in place: centred text
            rewritten in place starts at a new point, which the browser counts
            as the line moving. */}
        <p
          key={isLoading ? "loading" : pair.kind}
          className="text-sm text-muted-foreground"
        >
          {isLoading ? "Loading history…" : NO_PAIR_MESSAGE[pair.kind]}
        </p>
      </div>
    );
  }

  return (
    <VersionDiffView
      // Keyed by the DOCUMENT as well as the pair. Moving between two
      // documents' histories can carry the same `from`/`to`, and the diff query
      // keeps previous data while the new one loads — so without the scope here
      // the previous document's comparison stays painted under the new
      // document's heading.
      key={`${scopeKey(scope).join(":")}:${pair.from}-${pair.to}`}
      scope={scope}
      from={pair.from}
      to={pair.to}
      {...(view ? { view } : {})}
      onViewChange={onViewChange}
      onShown={onShown}
      fromLabel={nameOf(pair.from)}
      toLabel={nameOf(pair.to)}
      {...(fieldAction ? { fieldAction } : {})}
    />
  );
}

export function VersionComparePage({
  scope,
  documentHref,
  readOnlyHref,
  documentTitle,
  listCrumb,
  entityLocalized = false,
  from,
  to,
  locale,
  view,
}: VersionComparePageProps): JSX.Element {
  const list = useVersions({ scope, locale });
  // `useCan` answers false while permissions load, which is the right default
  // here: the read-only destination is reachable by everyone who can reach this
  // page, so an unresolved permission costs a less specific target rather than
  // a dead link.
  const canEditDocument = useCan(`update-${scope.slug}`);
  const backHref = canEditDocument ? documentHref : readOnlyHref;

  // Autosave rows carry a null `versionNo` and cannot be compared, so they are
  // not offered as either half of a pair.
  const versions = useMemo(
    () => list.data?.pages.flatMap(page => page.items) ?? [],
    [list.data]
  );
  const pair = resolvePair(versions, from, to, list.hasNextPage ?? false);
  // Derived once and given to BOTH surfaces. An infinite query flips to
  // `isError` when a LATER page fails while keeping the pages it already holds,
  // so the aggregate state says "this failed" about a page nobody asked for.
  // Taken raw, it would empty the versions the picker offers and unmount a
  // valid comparison — two different lies about the same event. Only a
  // failure that left nothing on screen is a failure of the history itself.
  const historyUnavailable = list.isError && versions.length === 0;

  // A baseline only the server resolves is asked of it; its answer names the
  // two versions compared.
  const baselineDiff = useBaselineDiff({
    scope,
    baseline: pair.kind === "baseline" ? pair.baseline : null,
    ...(pair.kind === "baseline" && pair.to !== undefined
      ? { to: pair.to }
      : {}),
    // The language to pair in when the address names no version; with one,
    // the server takes that version's own.
    ...(locale !== undefined ? { locale } : {}),
  });
  const refusal =
    pair.kind === "baseline" && baselineDiff.isError
      ? baselineRefusalOf(baselineDiff.error)
      : undefined;
  const pairFrom = pair.kind === "pair" ? pair.from : baselineDiff.data?.from;
  const pairTo = pair.kind === "pair" ? pair.to : baselineDiff.data?.to;
  const shown = useMemo(
    () =>
      pairFrom !== undefined && pairTo !== undefined
        ? { from: pairFrom, to: pairTo }
        : null,
    [pairFrom, pairTo]
  );
  // Seen means drawn, and only the diff view knows when it has drawn a
  // comparison's fields: anything the page could judge from (a query that
  // loaded, a pair that resolved) also holds while the space shows a loading
  // line, a failure, or another pair's answer instead. So the page marks only
  // from the view's own report, tagged with the document it was made for.
  const scopeId = scopeKey(scope).join(":");
  const [reported, setReported] = useState<
    (DrawnComparison & { scopeId: string }) | null
  >(null);
  const onShown = useCallback(
    (drawn: DrawnComparison | null) =>
      setReported(drawn ? { scopeId, ...drawn } : null),
    [scopeId]
  );
  // A report counts only for the document and pair now on screen, so one left
  // over from a previous document or pair can never mark this one.
  const seen =
    reported !== null &&
    shown !== null &&
    reported.scopeId === scopeId &&
    reported.from === shown.from &&
    reported.to === shown.to
      ? reported
      : null;
  // The newer of the two is what the reader has now seen, whichever side it
  // is on, once per showing.
  useMarkVersionSeen(
    scope,
    scopeId,
    seen ? Math.max(seen.from, seen.to) : null
  );

  // What "Restore…" hands the editor: the version on screen, in the language
  // its loaded comparison names, which is the comparison's own and holds
  // where the address names none; or, while the server says there is nothing
  // to compare with, the version the address named. A version's restore list
  // compares it with the editor, not with a baseline, so having nothing to
  // compare it with is no reason to withhold it.
  //
  // That version's language comes from its own record. The refusal names
  // none, the address's `locale` is not that version's (the server takes a
  // named version's part from the version), and the list is paged, so the
  // version may sit beyond what is loaded. The record is the one the editor
  // reads for the hand-off anyway, so reading it here asks nothing twice.
  // Nothing is offered until it arrives: the editor offers a restore only
  // while open in the version's language.
  const refusedTo =
    refusal !== undefined && pair.kind === "baseline" && pair.to !== undefined
      ? pair.to
      : null;
  const refusedVersion = useVersion({ scope, versionNo: refusedTo });
  const refusedLocale =
    refusedTo !== null && refusedVersion.data?.versionNo === refusedTo
      ? refusedVersion.data.locale
      : undefined;
  const restoreTarget = useMemo(
    () =>
      seen
        ? { versionNo: seen.to, locale: seen.locale }
        : refusedTo !== null && refusedLocale !== undefined
          ? { versionNo: refusedTo, locale: refusedLocale }
          : null,
    [seen, refusedTo, refusedLocale]
  );

  /** The same comparison, at another baseline or in another view. */
  const rewrite = useCallback(
    (next: { from?: ComparisonFrom; view?: "inline" | "side" }) => {
      const nextFrom = next.from ?? from ?? shown?.from;
      if (nextFrom === undefined) return;
      // A baseline the server resolves keeps the address's own target, and
      // one the address left to the server stays so, whether the view or the
      // baseline changes. Pinning the version the server chose would ask a
      // different question: "the version you last looked at", asked about the
      // version this page has just marked seen, has nothing earlier to compare
      // with, so the comparison would vanish on a change of layout. A pair of
      // versions, or "the version before", is drawn on the client from the
      // version it ends at, so that one names the version on screen.
      const nextTo = namesServerBaseline(nextFrom) ? to : (shown?.to ?? to);
      navigateTo(
        versionsHref(
          scope,
          { from: nextFrom, ...(nextTo !== undefined ? { to: nextTo } : {}) },
          locale,
          next.view ?? view
        )
      );
    },
    [from, to, shown, scope, locale, view]
  );
  const onViewChange = useCallback(
    (layout: ChangesLayout) =>
      rewrite({ view: layout === "split" ? "side" : "inline" }),
    [rewrite]
  );

  // A version's record, by number, from the pages the page holds.
  const metaOf = useCallback(
    (versionNo: number) => versions.find(v => v.versionNo === versionNo),
    [versions]
  );
  const nameOf = useCallback(
    (versionNo: number) => versionName(versionNo, metaOf(versionNo)),
    [metaOf]
  );
  // In the middle of a sentence ("Restore version 5…"), a number reads lower.
  const restoreName = (versionNo: number) => {
    const meta = metaOf(versionNo);
    return meta?.label ? `“${meta.label}”` : `version ${versionNo}`;
  };

  // Choosing the newer side keeps the older one where it still pairs with it:
  // a baseline always does, and a version only in the same language, since a
  // localized document numbers its languages in one history and the server
  // refuses a pair across two. Otherwise the older side becomes the version
  // before the one chosen, in its own language.
  const chooseTo = useCallback(
    (versionNo: number) => {
      const chosen = metaOf(versionNo);
      // The older side as the Compare picker shows it: the address's, or the
      // one the page resolved where the address named none.
      const older = from ?? shown?.from;
      const olderMeta = typeof older === "number" ? metaOf(older) : undefined;
      const nextFrom: ComparisonFrom =
        typeof older === "string"
          ? older
          : typeof older === "number" &&
              older !== versionNo &&
              olderMeta !== undefined &&
              olderMeta.locale === (chosen?.locale ?? null)
            ? older
            : "previous";
      // Compared as the VALUES that decide the comparison, not as URL text:
      // `navigateTo` skips a push only for an identical path, which a target
      // carrying a query never is, so choosing what is already on screen
      // would stack copies of one comparison for Back to walk through.
      if (versionNo === (shown?.to ?? to) && nextFrom === older) return;
      // The language comes from the chosen version, so choosing one in
      // another language moves the page to that language.
      navigateTo(
        versionsHref(
          scope,
          { from: nextFrom, to: versionNo },
          // Its own record's language, none included: a shared version holds
          // no language, and the address's earlier one would no longer fit.
          chosen !== undefined ? chosen.locale : locale,
          view
        )
      );
    },
    [metaOf, from, to, shown, scope, locale, view]
  );

  // The older side: a baseline, or a version by number.
  const chooseFrom = useCallback(
    (value: string) => {
      const versionNo = Number(value);
      const next: ComparisonFrom =
        value !== "" && Number.isInteger(versionNo) ? versionNo : value;
      if (next === (from ?? shown?.from)) return;
      rewrite({ from: next });
    },
    [from, shown, rewrite]
  );

  // The two versions trade places, so the change reads the other way.
  const swap = useCallback(() => {
    if (!shown) return;
    navigateTo(
      versionsHref(scope, { from: shown.to, to: shown.from }, locale, view)
    );
  }, [shown, scope, locale, view]);

  // The language the versions are listed in, as the history panel's filter.
  const { locales } = useLocalization();
  const chooseLocale = useCallback(
    (code: string) =>
      navigateTo(versionsHref(scope, undefined, code || undefined, view)),
    [scope, view]
  );

  // The link names the pair on screen by number, in its language: an address
  // that left the pair to the page, or named a baseline such as "the version
  // you last looked at", would open a different comparison after the next
  // save, or for another reader.
  const pinnedHref = useMemo(
    () =>
      shown
        ? new URL(
            versionsHref(
              scope,
              { from: shown.from, to: shown.to },
              seen?.locale ?? locale,
              view
            ),
            window.location.origin
          ).href
        : window.location.href,
    [shown, scope, seen, locale, view]
  );
  // The link to copy by hand, shown where the browser would not copy it: the
  // address bar may still name the reader's own baseline, so it is not the
  // link to share. Shown only while it is still the link to this comparison:
  // another pair or layout makes it the link to something no longer on
  // screen, and sharing that would share the wrong comparison.
  const [manualLink, setManualLink] = useState<string | null>(null);
  const shownManualLink = manualLink === pinnedHref ? manualLink : null;
  const copyLink = useCallback(() => {
    const href = pinnedHref;
    const failed = () => {
      setManualLink(href);
      toast.error("Couldn't copy the link. Copy it from the box below.");
    };
    // A page served without HTTPS, or a browser that withholds it, has no
    // clipboard to write to: said, rather than a press that does nothing.
    if (typeof navigator.clipboard?.writeText !== "function") {
      failed();
      return;
    }
    void navigator.clipboard
      .writeText(href)
      .then(() => {
        // Copied: the box for THIS link has done its work. A copy answering
        // late, after the page moved to another comparison, leaves that
        // comparison's box alone: what it put on the clipboard is not it.
        setManualLink(current => (current === href ? null : current));
        toast.success("Link copied. It opens this comparison.");
      })
      .catch(failed);
  }, [pinnedHref]);

  // Hands the version on screen to the editor, as "Restore…" does: every
  // field it changed, or one field asked for by name.
  const handToEditor = useCallback(
    (fieldName?: string) => {
      if (!restoreTarget) return;
      // The editor restores it: the values go back as unsaved edits through
      // its list, and nothing is saved from here. The version's language goes
      // with it, under the key the editor reads its language from: the editor
      // offers a version's restore only while open in that version's
      // language, so one opened in its default language would take the
      // hand-off and never show the restore list. Absent for a version in no
      // language, as the editor expects.
      navigateTo(
        withQuery(documentHref, {
          [HISTORY_PARAM]: 1,
          [VERSION_PARAM]: restoreTarget.versionNo,
          [RESTORE_PARAM]: fieldName ?? RESTORE_ALL,
          [LOCALE_PARAM]: restoreTarget.locale ?? undefined,
        })
      );
    },
    [restoreTarget, documentHref]
  );
  const mayRestore = canEditDocument && restoreTarget !== null;
  // "Restore this field" on each field the version changed that the form
  // still has; the editor's list judges whether the person may restore it.
  const fieldAction = useCallback(
    (node: FieldDiff) =>
      isFieldChange(node) && "label" in node ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto gap-1.5 px-0 text-xs"
          aria-label={`Restore this field: ${node.label}`}
          onClick={() => handToEditor(node.name)}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Restore this field
        </Button>
      ) : null,
    [handToEditor]
  );

  const trail: BreadcrumbItem[] = [
    ...(listCrumb ? [listCrumb] : []),
    { label: documentTitle || "Document", href: backHref },
    { label: "Compare" },
  ];
  const olderValue =
    typeof from === "string" ? from : String(from ?? shown?.from ?? "");
  const newerValue = String(shown?.to ?? to ?? "");
  const newerMeta = metaOf(Number(newerValue));
  // The newer side's language: its record where it is loaded, else what the
  // drawn comparison says, since a shared link can name a version beyond the
  // loaded page. Unknown until either answers.
  const newerLocale =
    newerMeta !== undefined
      ? newerMeta.locale
      : seen !== null
        ? seen.locale
        : undefined;
  // A version the older side may be: one in the newer side's language, and
  // not the newer one itself, which compared with itself says nothing.
  // Until a chosen newer version's language is known, no number is offered:
  // one could pair two languages, which the server refuses. The baselines
  // stay, since the server pairs those itself.
  const olderChoices =
    newerValue !== "" && newerLocale === undefined
      ? []
      : versions.filter(
          v =>
            v.versionNo !== null &&
            String(v.versionNo) !== newerValue &&
            (newerLocale === undefined || v.locale === newerLocale)
        );

  return (
    <div className={HISTORY_FRAME}>
      <div className={HISTORY_COLUMN}>
        <Breadcrumbs items={trail} placement="inline" />
        <div
          data-frame-part="history-head"
          className="flex flex-wrap items-center gap-3"
        >
          <h1 className="text-xl font-semibold text-foreground">
            Compare versions
          </h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyLink}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Copy link
            </Button>
            {canEditDocument && restoreTarget ? (
              <Button type="button" size="sm" onClick={() => handToEditor()}>
                {/* Names the version it restores, as the page names it. */}
                Restore {restoreName(restoreTarget.versionNo)}…
              </Button>
            ) : null}
          </div>
        </div>

        {shownManualLink !== null ? (
          <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
            Link to this comparison
            <input
              readOnly
              value={shownManualLink}
              // Chosen whole as it is reached, ready to copy.
              onFocus={event => event.currentTarget.select()}
              className="h-9 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground"
            />
          </label>
        ) : null}

        {/* A labelled region rather than `main`: the dashboard shell already
            provides the document's one primary landmark, and nesting a second
            makes landmark navigation announce two. */}
        <section aria-label="Comparison" className="flex flex-col gap-4">
          <div className={HISTORY_PICKER}>
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              Compare
              <select
                aria-label="Compare"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={olderValue}
                onChange={event => chooseFrom(event.target.value)}
              >
                {olderValue === "" ? <option value="">Choose…</option> : null}
                {/* A baseline another feature registered, named by the
                    address, is offered as itself, so the control says what
                    is compared rather than showing another choice. */}
                {typeof from === "string" &&
                !COMPARE_WITH.some(option => option.value === from) ? (
                  <option value={from}>{baselineLabel(from)}</option>
                ) : null}
                {COMPARE_WITH.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <optgroup label="Versions">
                  {typeof from === "number" &&
                  !olderChoices.some(v => v.versionNo === from) ? (
                    <option value={String(from)}>{nameOf(from)}</option>
                  ) : null}
                  {olderChoices.map(v => (
                    <option key={v.versionNo} value={String(v.versionNo)}>
                      {versionChoice(v)}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 px-0"
              aria-label="Swap the two versions"
              title="Swap the two versions"
              // Any two versions drawn can trade places, a pair resolved from
              // "the version before" among them; only a baseline the server
              // resolves again on each read cannot be pinned the other way.
              disabled={
                !shown ||
                (typeof from === "string" && namesServerBaseline(from))
              }
              onClick={swap}
            >
              <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
            </Button>
            <label className="flex min-w-[14rem] flex-1 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
              with
              <select
                aria-label="with"
                className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                value={newerValue}
                disabled={versions.length === 0}
                onChange={event => chooseTo(Number(event.target.value))}
              >
                {newerValue === "" ? <option value="">Choose…</option> : null}
                {newerValue !== "" && newerMeta === undefined ? (
                  <option value={newerValue}>
                    {nameOf(Number(newerValue))}
                  </option>
                ) : null}
                {versions.map(v =>
                  v.versionNo === null ? null : (
                    <option key={v.versionNo} value={String(v.versionNo)}>
                      {versionChoice(v)}
                    </option>
                  )
                )}
              </select>
            </label>
            {entityLocalized && locales.length > 1 ? (
              <label className="flex min-w-[12rem] flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Languages
                <select
                  aria-label="Languages"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                  value={locale ?? ""}
                  onChange={event => chooseLocale(event.target.value)}
                >
                  <option value="">All languages</option>
                  {locales.map(l => (
                    <option key={l.code} value={l.code}>
                      {`${l.label} and shared fields`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {list.hasNextPage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage
                  ? "Loading older versions…"
                  : "Load older versions"}
              </Button>
            ) : null}
            {list.isFetchNextPageError && versions.length > 0 ? (
              // A later page failing is not the history failing: what is
              // listed stays, and the retry says what it retries.
              <p role="alert" className="basis-full text-xs text-destructive">
                Older versions could not be loaded. Choose Load older versions
                to try again.
              </p>
            ) : null}
          </div>

          <div className="flex min-h-[16rem] flex-col rounded-lg border border-border bg-background">
            <ComparisonPane
              scope={scope}
              pair={pair}
              baselineDiff={baselineDiff}
              refusal={refusal}
              {...(view ? { view } : {})}
              onViewChange={onViewChange}
              onShown={onShown}
              isError={historyUnavailable}
              isLoading={list.isLoading}
              onRetry={() => void list.refetch()}
              nameOf={nameOf}
              {...(mayRestore ? { fieldAction } : {})}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
