"use client";

/**
 * The sidebar's card for a header or footer selected on the canvas.
 *
 * A click on the header used to do nothing and leave the last block's
 * settings in the sidebar, so it looked broken. Selected now, the header is
 * explained here: it is the site header, which header & footer set it comes
 * from, how many pages show it (so a change here changes all of them), the
 * way to edit it for someone who may edit components, and where a page
 * chooses a different one.
 *
 * The count is the component's reach, the same number its own view's banner
 * says, read through the component facts the editor already asks
 * (`component-page-reach`), never counted again here.
 *
 * @module admin/editor/region-card
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import { useId, type JSX } from "react";

import { useComponentFacts } from "../component-facts-client";
import { siteRegionName, type RegionCardFacts } from "../page-layout";

/** How many pages show the region, or nothing while that is not known. */
type PagesShown =
  | { readonly count: number; readonly complete: boolean }
  | undefined;

/** The area as a sentence says it: "header", "footer". */
function areaWord(area: RegionArea): "header" | "footer" {
  return area === "header" ? "header" : "footer";
}

/**
 * What Delete says while a header or footer is selected: it is not the
 * page's to remove, and where it is changed.
 */
export function regionRefusal(area: RegionArea): string {
  return `The site ${areaWord(area)} isn't part of this page. Change it in Page settings.`;
}

/** Where the region comes from and how far a change to it reaches. */
function reachSentence(setTitle: string, pages: PagesShown): string {
  const from = `From the ${setTitle} header & footer.`;
  // Nothing counted, or a count of none, which an unsaved choice of set can
  // give: the sentence says what is true without a number.
  if (pages === undefined || pages.count === 0) {
    return `${from} Changes here change every page that shows it.`;
  }
  const noun = pages.count === 1 ? "page" : "pages";
  const count = pages.complete
    ? `${pages.count} ${noun}`
    : `at least ${pages.count} ${noun}`;
  return `${from} It shows on ${count}, so changes here change all of them.`;
}

/**
 * The card for a selected header or footer: drawn from the region's facts,
 * the pages that show it, and the host's two ways on.
 */
export function RegionCard({
  facts,
  pages,
  onEdit,
  onOpenSettings,
}: {
  facts: RegionCardFacts;
  pages: PagesShown;
  /** Edit the region; absent for someone who may not edit components. */
  onEdit: (() => void) | undefined;
  /** Open the page's settings, where it chooses its header and footer. */
  onOpenSettings: () => void;
}): JSX.Element {
  const headingId = useId();
  const name = siteRegionName(facts.area);
  const word = areaWord(facts.area);
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-3"
      data-region-card={facts.area}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="rounded-sm border border-[color:var(--nx-builder-border)] px-1.5 py-0.5 text-[11px] font-medium leading-none text-[color:var(--nx-builder-text-muted)]"
          aria-hidden="true"
        >
          {word === "header" ? "Header" : "Footer"}
        </span>
        <h2
          id={headingId}
          className="text-[color:var(--nx-builder-text)] m-0 text-sm font-semibold"
        >
          {name}
        </h2>
      </div>
      <p className="text-[color:var(--nx-builder-text-muted)] m-0 text-xs leading-relaxed">
        {reachSentence(facts.setTitle, pages)}
      </p>
      {facts.note === undefined ? null : (
        <p className="text-[color:var(--nx-builder-text-muted)] m-0 text-xs">
          {facts.note}
        </p>
      )}
      {onEdit === undefined ? (
        <p className="text-[color:var(--nx-builder-text-muted)] m-0 text-xs">
          {`You can't change the site ${word}. Ask someone who can edit components.`}
        </p>
      ) : (
        <Button type="button" size="sm" className="self-start" onClick={onEdit}>
          {word === "header" ? "Edit header" : "Edit footer"}
        </Button>
      )}
      <p className="text-[color:var(--nx-builder-text-muted)] m-0 text-xs leading-relaxed">
        {`To use a different ${word} on this page, change it in `}
        <button
          type="button"
          className="text-[color:var(--nx-builder-text)] cursor-pointer border-0 bg-transparent p-0 font-medium underline underline-offset-2"
          onClick={onOpenSettings}
        >
          Page settings
        </button>
        .
      </p>
    </section>
  );
}

/**
 * The card for the region selected, with the pages that show it read from
 * the component's facts: asked each time a region is selected, so a set
 * published elsewhere since is counted.
 */
export function SelectedRegionCard({
  facts,
  onEditComponent,
  onOpenSettings,
}: {
  facts: RegionCardFacts;
  /** Open a component in its own view; absent where the author may not. */
  onEditComponent: ((componentId: string) => void) | undefined;
  onOpenSettings: () => void;
}): JSX.Element {
  const read = useComponentFacts(facts.componentId);
  return (
    <RegionCard
      facts={facts}
      pages={read?.pages}
      onEdit={
        onEditComponent === undefined
          ? undefined
          : () => onEditComponent(facts.componentId)
      }
      onOpenSettings={onOpenSettings}
    />
  );
}
