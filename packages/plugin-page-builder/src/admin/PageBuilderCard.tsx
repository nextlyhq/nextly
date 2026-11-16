"use client";

/**
 * The entry screen's way into the page builder.
 *
 * On the shipped `pages` collection this is the whole editable body of the
 * screen: the collection declares `title`, `slug` and the blocks field, and the
 * first two are system fields the header draws. So this is not one field among
 * several — it is what an author sees when they open a page, and it has to read
 * as the door it is.
 *
 * ## It must not look like a field
 *
 * Gutenberg's own design discussion of switching between editors (WordPress/gutenberg issue 1375)
 * reaches two requirements: an author must recognise which editing modes exist
 * and which one they are in, and the handoff must not look "too similar to a
 * block", which "would ultimately confuse the user about what view they are
 * in". The surface this replaces was a muted bordered box with the type slugs
 * listed inside it and a small outline button underneath — the named
 * anti-pattern, and the reason a page's editor read as an inert summary.
 *
 * ## The page, rather than a list of its parts
 *
 * The reading is the page itself. A list of block TYPES is a debug view: it
 * tells an author what machinery is on the page and nothing about what the page
 * says, and twenty pages listing `core/section, core/text` are indistinguishable
 * from each other. Sanity's page-building guidance reaches the same conclusion
 * from the other direction — a row shows title, subtitle and media, and the
 * type name belongs in the subtitle, never as the label.
 *
 * ## It does not name itself
 *
 * The field's own label already says "Page Builder" directly above this, so a
 * heading here would be the same fact in two places — the shape that produced a
 * document title rendered from two sources and then disagreeing with itself.
 * The icon carries the identity; the words carry the state.
 *
 * ## The page large, its sections listed, each a way in
 *
 * The page is drawn at the column's width and its own height, up to a cap,
 * with its sections listed beneath by number, name and first line. Clicking a
 * section — in the picture or in the list — opens the builder at that section,
 * so changing the fourth part of a page no longer means opening the editor and
 * hunting for it. Adding, reordering and styling stay in the builder; this
 * screen reads and points, it never edits.
 *
 * ## One primary action
 *
 * A single primary control, which is what the empty-state guidance in Carbon
 * and NN/g both reduce to. Where the field cannot be edited there is no
 * disabled twin: {@link BlocksField} established that a disabled control says
 * "you could do this, but not now", which is the wrong sentence for a document
 * nobody may edit. The page is still drawn, because reading a page you may not
 * change is legitimate.
 *
 * @module @nextlyhq/plugin-page-builder/admin/PageBuilderCard
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import type { PageRendererProps } from "@nextlyhq/blocks-react";
import type { ComponentTitleOf } from "@nextlyhq/builder";
import {
  useDocumentLocale,
  useDocumentPreview,
} from "@nextlyhq/plugin-sdk/admin";
import { Button, Skeleton } from "@nextlyhq/ui";
import { ArrowRight, LayoutGrid } from "lucide-react";
import { useId, useMemo, type JSX, type ReactNode } from "react";

import type { ComponentLibraryState } from "./component-library-client";
import { sectionAddress, showsAnotherLanguage } from "./editor/builder-address";
import { entryBlockResolver } from "./entry-block-resolver";
import type { PageRenderInputs } from "./page-render-inputs";
import { pageSections, type PageSection } from "./page-sections";
import { documentNodes } from "./page-summary";
import { PageMiniature, type MiniatureSection } from "./PageMiniature";
import { navigateWithin } from "./plain-click";

/**
 * Whether this site's own style is available to draw the page with.
 *
 * THREE states rather than a boolean, because the third is the one that gets
 * folded into the good one by accident. "Not here yet" and "the read failed"
 * both mean the page must not be drawn, and they mean it for the same reason —
 * omitting the sheet does not draw nothing, it draws a plausible page missing
 * this site's classes, tokens and block defaults. A boolean `pending` collapses
 * a failed read into `ready`, which is exactly the wrong picture the pending
 * branch exists to prevent.
 */
export type SiteStyleState = "ready" | "pending" | "unavailable";

/**
 * What the action says when the page has nothing on it yet.
 *
 * Exported because a test naming this control has to ask for the SAME string
 * the card renders. A copy in the test agrees on the day it is written and
 * then keeps passing — or keeps failing — after the wording moves.
 */
export const BUILD_PAGE_LABEL = "Build this page";

/** What the action says when the page already holds blocks. */
export const OPEN_BUILDER_LABEL = "Open Page Builder";

/** What opens the entry's own preview of the whole page. */
export const PREVIEW_PAGE_LABEL = "Preview full page";

/**
 * Matches the card's action in EITHER state.
 *
 * A caller that wants to OPEN the builder cares that there is exactly one way
 * in, not which sentence the card chose for this particular document. Deriving
 * the pattern from both labels keeps such a caller correct when a fixture's
 * document gains or loses blocks — which is otherwise a failure that names the
 * wording rather than the change that caused it.
 */
export const OPEN_BUILDER_ACTION: RegExp = new RegExp(
  `^(?:${BUILD_PAGE_LABEL}|${OPEN_BUILDER_LABEL})$`
);

export interface PageBuilderCardProps {
  /** The document the field currently holds. */
  document: BlockDocument;
  /**
   * The site's compiled sheet.
   *
   * Spelled as the renderer's own prop type so this cannot drift from what
   * `PageRenderer` accepts.
   */
  siteStyles: PageRendererProps["siteStyles"];
  /**
   * Whether this site's own style is available yet.
   *
   * A separate answer from `siteStyles` being absent: absent means "this site
   * emits no sheet", which is a legitimate state to render in, while `pending`
   * and `unavailable` both mean the sheet that WILL apply is not in hand.
   */
  styleState: SiteStyleState;
  /**
   * Whether this site's component definitions are available to draw the page
   * with, and the way to ask again when they are not.
   *
   * The style's states and one more, for the same reason: drawing without
   * them does not draw nothing, it draws every instance as could-not-be-loaded,
   * which reads as a site whose components were deleted. The extra one is a
   * read that failed to REFRESH what it had — the page draws from the last
   * answer, which may be out of date, and the sentence says that rather than
   * "missing". And a retry, because a failed read is the state with a remedy
   * the author can reach from here.
   *
   * `titleOf` names a placed component's section by its component's title,
   * as Layers names it; without it the section is a "Component".
   */
  components: {
    state: ComponentLibraryState;
    retry: () => void;
    titleOf?: ComponentTitleOf;
  };
  /**
   * Everything else this site's rendering depends on, as one bundle.
   *
   * The same bundle the canvas is handed, from the same derivation.
   */
  render: PageRenderInputs;
  /** Whether this author may open the editor at all. */
  canEdit: boolean;
  /**
   * The builder's own address for this document and field, or `undefined`
   * while the document has none — a page that has never been saved.
   */
  href: string | undefined;
  /** Moves to `href` within the admin, keeping the form mounted. */
  onNavigate: (href: string) => void;
  /**
   * The sentence beneath the way in: why there is no `href`, beside the
   * disabled action, or where an enabled one leads.
   */
  note?: string;
  /**
   * What the card holds after the page: the page's Layout picker, for a
   * collection whose pages are drawn inside a Layout. Drawn in both the empty
   * and the built card, so the choice is there before the first block is.
   */
  after?: ReactNode;
}

/**
 * `children`, followed by `after` when there is one. Without it the children
 * are returned bare, so a card with nothing after it keeps its own layout.
 */
function WithAfter({
  after,
  children,
}: {
  after: ReactNode;
  children: JSX.Element;
}): JSX.Element {
  if (after == null) return children;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {children}
      {after}
    </div>
  );
}

/** Why a page never saved has no way in yet: it has no address. */
const SAVE_FIRST = "Save this page to open the Page Builder.";

/**
 * The way in: a real link to the builder's address, handled within the admin
 * on a plain click so the form and its unsaved work stay mounted. Disabled
 * while the document has no address yet; the reason is said beneath the bar.
 */
function OpenBuilder({
  href,
  label,
  onNavigate,
}: {
  href: string | undefined;
  label: string;
  onNavigate: (href: string) => void;
}): React.JSX.Element {
  if (href === undefined) {
    return (
      <Button type="button" size="sm" disabled>
        {label}
      </Button>
    );
  }
  const { onClick } = navigateWithin(href, onNavigate);
  return (
    <Button asChild size="sm">
      {/* Marked as the way in, so the field returning from the builder can
          hand it the focus back (see `builder-return`). */}
      <a href={href} onClick={onClick} data-builder-open="">
        {label}
      </a>
    </Button>
  );
}

/**
 * The miniature, or what stands in for it while a read it cannot draw
 * without is still coming or has failed.
 *
 * Two reads are waited for, because both fail in the same direction while
 * they are pending: without the site's sheet the page draws a plausible design
 * the site does not have, and without the component definitions every
 * instance draws as could-not-be-loaded and re-lays out when they land. Only
 * the style's FAILURE refuses the page; a failed component read draws it and
 * says so beneath, for the reason given there.
 */
function Preview({
  document,
  siteStyles,
  styleState,
  components,
  render,
  sections,
  onNavigate,
}: Pick<
  PageBuilderCardProps,
  "document" | "siteStyles" | "styleState" | "components" | "render"
> & {
  sections: readonly MiniatureSection[] | undefined;
  onNavigate: (href: string) => void;
}): React.JSX.Element {
  if (styleState === "pending" || components.state === "pending") {
    // Sized like a short page, so the card does not collapse and then jump
    // under the author the moment the reads arrive.
    return <Skeleton className="aspect-[16/10] w-full rounded-none" />;
  }
  if (styleState === "unavailable") {
    /*
     * A refusal, not a fallback. The page COULD be drawn from the config
     * defaults, and it would look entirely reasonable while missing this
     * site's stored classes, tokens, fonts and block defaults — a confident
     * wrong picture, which is worse than none. Saying so also keeps the list
     * and the action below, so the author is not blocked by it.
     */
    return (
      <div
        className="flex aspect-[16/10] w-full items-center justify-center p-4 text-center text-sm text-muted-foreground"
        role="status"
      >
        This page cannot be previewed right now — the site&apos;s styles could
        not be loaded.
      </div>
    );
  }
  /*
   * A failed COMPONENT read does not refuse the page. The route refuses a role
   * that may edit pages but not read components, and such an author would
   * otherwise see every page card refuse to preview, forever. The page is
   * drawn — its instances as the could-not-be-loaded marker — and the sentence
   * beneath is what tells that marker apart from a deleted component, with
   * the one remedy reachable from here.
   */
  return (
    <>
      <PageMiniature
        document={document}
        siteStyles={siteStyles}
        render={render}
        {...(sections === undefined ? {} : { sections, onNavigate })}
      />
      {components.state === "unavailable" || components.state === "stale" ? (
        <p
          className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          <span>
            {components.state === "unavailable"
              ? "The site’s components could not be loaded, so any on this page draw as missing."
              : "The site’s components could not be reloaded, so this preview may be out of date."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={components.retry}
          >
            Try again
          </Button>
        </p>
      ) : null}
    </>
  );
}

/**
 * What a section is called: its number, its name, and its first line when it
 * has one. One spelling for the picture's links and the list's, so a screen
 * reader hears the same section named the same way from either.
 */
function sectionName(
  { number, label, firstLine }: PageSection,
  lead: "Section" | "Edit section"
): string {
  const named = `${lead} ${number}, ${label}`;
  return firstLine === "" ? named : `${named}: ${firstLine}`;
}

/** The sections, in page order, each a way into the builder at that section. */
function SectionList({
  sections,
  hrefFor,
  onNavigate,
}: {
  sections: readonly PageSection[];
  hrefFor: ((section: PageSection) => string) | undefined;
  onNavigate: (href: string) => void;
}): React.JSX.Element {
  const heading = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={heading} className="text-sm font-medium text-foreground">
        Sections
      </p>
      <ol
        aria-labelledby={heading}
        className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card"
      >
        {sections.map(section => {
          const row = (
            <>
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tabular-nums text-muted-foreground"
              >
                {section.number}
              </span>
              <span className="shrink-0 text-sm font-medium text-foreground">
                {section.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {section.firstLine}
              </span>
            </>
          );
          const href = hrefFor?.(section);
          return (
            <li key={section.id}>
              {href === undefined ? (
                <div className="flex items-center gap-3 px-3 py-2.5">{row}</div>
              ) : (
                <a
                  href={href}
                  // Starts with the visible word, so speaking "Edit" reaches it.
                  aria-label={sectionName(section, "Edit section")}
                  className="group flex items-center gap-3 px-3 py-2.5 outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={navigateWithin(href, onNavigate).onClick}
                >
                  {row}
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
                    Edit
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </span>
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {hrefFor === undefined ? null : (
        <p className="text-xs text-muted-foreground">
          Add, reorder and style sections in the Page Builder.
        </p>
      )}
    </div>
  );
}

/** A page with nothing on it yet: what it is, and the way to start one. */
function EmptyPage({
  canEdit,
  href,
  onNavigate,
  said,
}: {
  canEdit: boolean;
  href: string | undefined;
  onNavigate: (href: string) => void;
  said: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <LayoutGrid
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-muted-foreground">
            Nothing here yet — lay this page out visually.
          </span>
        </div>
        {canEdit ? (
          <OpenBuilder
            href={href}
            label={BUILD_PAGE_LABEL}
            onNavigate={onNavigate}
          />
        ) : null}
      </div>
      {said === undefined ? null : (
        <p className="text-xs text-muted-foreground">{said}</p>
      )}
    </div>
  );
}

/**
 * The bar under the preview: how many sections it shows, the entry's own
 * full-page preview where the editor offers one, and the way into the builder.
 */
function PreviewBar({
  count,
  canEdit,
  href,
  onNavigate,
}: {
  count: number;
  canEdit: boolean;
  href: string | undefined;
  onNavigate: (href: string) => void;
}): React.JSX.Element {
  // The editor's own Preview action, where it offers one; see the hook.
  const preview = useDocumentPreview();
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2.5">
      {/* Takes the line's room down to its own width, after which the
          actions wrap below it rather than squeezing it to a word a line. */}
      <span className="min-w-0 flex-1 basis-40 text-sm text-muted-foreground">
        Live preview · {count} {count === 1 ? "section" : "sections"}
      </span>
      {/* Only on the editable page. A page drawn read-only inside the editor
          — a version in history, the source language beside a translation —
          inherits the live editor's preview, which opens the CURRENT page in
          the language being edited, not the one this card shows. */}
      {preview === null || !canEdit ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void preview.open()}
        >
          {PREVIEW_PAGE_LABEL}
        </Button>
      )}
      {canEdit ? (
        <OpenBuilder
          href={href}
          label={OPEN_BUILDER_LABEL}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

/**
 * Where each section opens, for an author who may edit a page that has an
 * address; `undefined` for anyone else, who is shown the page and its parts
 * and nothing more.
 *
 * None either while another language is on screen. The sections listed are
 * that language's, and the builder opens the default language's document,
 * whose sections need not match: a link would select an unrelated section or
 * none. The way into the builder itself stays, saying where it leads.
 */
function sectionLinks(
  sections: readonly PageSection[],
  canEdit: boolean,
  href: string | undefined,
  anotherLanguage: boolean
): {
  hrefFor: ((section: PageSection) => string) | undefined;
  inPicture: MiniatureSection[] | undefined;
} {
  if (!canEdit || href === undefined || anotherLanguage) {
    return { hrefFor: undefined, inPicture: undefined };
  }
  // Opened at the section's target, which is what the editor's document holds;
  // placed in the picture by the id it was drawn with.
  const hrefFor = (section: PageSection) =>
    sectionAddress(href, section.target);
  return {
    hrefFor,
    inPicture: sections.map(section => ({
      id: section.id,
      parts: section.parts,
      name: sectionName(section, "Section"),
      href: hrefFor(section),
    })),
  };
}

/**
 * @param props - the document, the site's sheet and its readiness, and the way in
 * @returns the entry screen's view of the page, in place of the blocks field
 */
export function PageBuilderCard({
  document,
  siteStyles,
  styleState,
  components,
  render,
  canEdit,
  href,
  onNavigate,
  note,
  after,
}: PageBuilderCardProps): JSX.Element {
  const sections = useMemo(
    // The same resolver and inputs the picture draws with, so the list names
    // exactly the sections drawn above it.
    () =>
      pageSections(document, entryBlockResolver(), render, components.titleOf),
    [document, render, components.titleOf]
  );

  const said = note ?? (canEdit && href === undefined ? SAVE_FIRST : undefined);
  const anotherLanguage = showsAnotherLanguage(useDocumentLocale());
  // Held across renders that change none of its inputs: the preview keys its
  // whole page render on the sections it is handed, so a fresh array from
  // every render of the form around this card would redo that render each time.
  const { hrefFor, inPicture } = useMemo(
    () => sectionLinks(sections, canEdit, href, anotherLanguage),
    [sections, canEdit, href, anotherLanguage]
  );

  // Empty means nothing stored, not nothing drawn: a page whose only sections
  // are gated by a condition still holds a page, and inviting the author to
  // build one would be wrong.
  if (documentNodes(document).length === 0) {
    return (
      <WithAfter after={after}>
        <EmptyPage
          canEdit={canEdit}
          href={href}
          onNavigate={onNavigate}
          said={said}
        />
      </WithAfter>
    );
  }

  return (
    // `min-w-0` because the form lays fields out as grid items, whose default
    // minimum is their content's: without it the view grows to the widest
    // thing inside it and runs off a phone's screen instead of wrapping.
    <div className="flex min-w-0 flex-col gap-4" data-slot="page-entry-view">
      <div
        data-slot="page-entry-preview"
        className="min-w-0 overflow-hidden rounded-lg border border-border bg-card"
      >
        <Preview
          document={document}
          siteStyles={siteStyles}
          styleState={styleState}
          components={components}
          render={render}
          sections={inPicture}
          onNavigate={onNavigate}
        />
        <PreviewBar
          count={sections.length}
          canEdit={canEdit}
          href={href}
          onNavigate={onNavigate}
        />
        {said === undefined ? null : (
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {said}
          </p>
        )}
      </div>
      <SectionList
        sections={sections}
        hrefFor={hrefFor}
        onNavigate={onNavigate}
      />
      {after}
    </div>
  );
}
