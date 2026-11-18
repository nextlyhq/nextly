"use client";

/**
 * The page's data against its limit: in the top bar once it matters, and in
 * Page settings always.
 *
 * A published page loads every piece of data its blocks show (a list's
 * entries, an image, a link to an entry) under one limit per visit. The top
 * bar stays quiet on a page far from it: the meter appears only from 80% of
 * the limit, amber, saying "Page data: 430 of 500 · what's this?", and red
 * once the limit is spent or passed ("· over the limit"). A count that could
 * not be made shows too, since a hidden failure could hide a page over its
 * limit. Page settings draws the same meter as a line at every level, so the
 * count can always be found.
 *
 * Each is one button; "what's this?" is drawn as a link inside it, not a
 * second control. Pressed, it opens a panel saying what the page loads and,
 * over the limit, naming each block that comes up empty on the live site,
 * each one a way to select that block.
 *
 * @module read-budget-meter
 * @experimental Settles with the canvas's read count.
 */

import { DEFAULT_MAX_QUERIES } from "@nextlyhq/blocks-react";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import {
  CircleAlert,
  CircleCheck,
  FileText,
  Image,
  Info,
  Link,
  List,
  LoaderCircle,
  Repeat,
  Component as ComponentMark,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";

import type { CanvasRegion } from "../canvas/canvas-regions";
import type { EditorState } from "../editor-state";
import { blockNameOf, type ComponentTitleOf } from "../panels/layers/layers";
import { BUILDER_TOKENS_CLASS } from "../shell-state";

import {
  COUNT_FAILED_NAME,
  pageDataCount,
  READ_KIND_WORDS,
  READ_KINDS,
  readBudgetName,
  readBudgetStanding,
  readCount,
  shownInTopBar,
  unreadBlocks,
  readShare,
  warningAt,
  type PageReadReport,
  type ReadBudgetStanding,
  type ReadKind,
} from "./read-budget";

export interface ReadBudgetMeterProps {
  /** The latest draw's count, or `undefined` while the canvas is counting. */
  report: PageReadReport | undefined;
  /** The editor whose page this counts, for block names and selection. */
  editor: Pick<EditorState, "document" | "select">;
  /** A component's title by id, so a placement is named as Layers names it. */
  componentTitle?: ComponentTitleOf;
  /**
   * The Layout regions the page is drawn inside, as the canvas draws them, so
   * an unread block of a header or footer is named with the Layout it comes
   * from, and offers the way to edit that Layout.
   */
  regions?: readonly CanvasRegion[];
  /**
   * Given when the latest count could not be made: the meter says so, in
   * place of a count, and pressing it counts again.
   */
  failed?: { readonly retry: () => void } | undefined;
  /**
   * Where it is drawn: the top bar (the default), which shows it only from
   * 80% of the limit or when the count failed, or Page settings, which shows
   * the count at every level, counting included.
   */
  place?: "bar" | "settings";
}

/** The mark each standing wears in the panel's verdict. */
const STANDING_MARK: Record<
  ReadBudgetStanding,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  counting: LoaderCircle,
  within: CircleCheck,
  near: TriangleAlert,
  over: CircleAlert,
};

/** The mark of each kind of read, in the panel's rows and its unread list. */
const KIND_MARK: Record<
  ReadKind,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  entries: List,
  related: Repeat,
  image: Image,
  link: Link,
  page: FileText,
  component: ComponentMark,
};

/** No Layout: a page drawn inside none. */
const NO_REGIONS: readonly CanvasRegion[] = [];

/** The panel's one-line verdict, beside its title. */
const STANDING_WORDS: Record<ReadBudgetStanding, string> = {
  counting: "Counting",
  within: "Within the limit",
  near: "Near the limit",
  over: "Over the limit",
};

export function ReadBudgetMeter({
  report,
  editor,
  componentTitle,
  regions,
  failed,
  place = "bar",
}: ReadBudgetMeterProps): React.JSX.Element | null {
  const [open, setOpen] = React.useState(false);
  const standing = readBudgetStanding(report);
  const shown = place === "settings" || shownInTopBar(standing);
  // Closed on failing, or on leaving the bar, so neither a retry, a late
  // answer nor the page nearing its limit again opens the panel by itself:
  // it was opened on a count that has since been replaced. Set while
  // rendering, so no frame draws the panel open over what replaced it.
  if ((failed !== undefined || !shown) && open) setOpen(false);
  if (failed !== undefined) {
    return <ReadCountFailed retry={failed.retry} place={place} />;
  }
  if (!shown) return null;
  const name = readBudgetName(report);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-read-meter"
          data-place={place}
          data-standing={standing}
          aria-label={name}
          // The same words as a tooltip, for the shorter form a crowded bar
          // draws.
          title={name}
          // Busy while counting, so a reader is not told a stale number.
          aria-busy={standing === "counting" ? true : undefined}
        >
          <MeterWords report={report} standing={standing} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={place === "bar" ? "start" : "end"}
        sideOffset={6}
        // Drawn in a portal, outside the shell, so it carries the editor's
        // token scope itself, as the component banner does.
        className={`nx-read-panel ${BUILDER_TOKENS_CLASS}`}
        aria-label="Page data"
      >
        <ReadPanel
          report={report}
          standing={standing}
          editor={editor}
          componentTitle={componentTitle}
          regions={regions ?? NO_REGIONS}
          onPicked={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The meter when the count could not be made, in its place, saying so:
 * pressing it counts again. Not a panel's trigger, since there is nothing to
 * say past this.
 */
function ReadCountFailed({
  retry,
  place,
}: {
  readonly retry: () => void;
  readonly place: "bar" | "settings";
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="nx-read-meter"
      data-place={place}
      data-standing="failed"
      aria-label={COUNT_FAILED_NAME}
      // The same words as a tooltip.
      title={COUNT_FAILED_NAME}
      onClick={retry}
    >
      <span className="nx-read-meter__label">
        Page data: couldn&apos;t count
      </span>
      <span className="nx-read-meter__standing">
        {" · "}
        <span className="nx-read-meter__link">Retry</span>
      </span>
    </button>
  );
}

/**
 * The meter's words: the count, then near the limit a "what's this?" drawn
 * as a link (which a crowded bar drops first), over it "over the limit",
 * and within it, in Page settings, a quiet mark that it explains itself.
 */
function MeterWords({
  report,
  standing,
}: {
  report: PageReadReport | undefined;
  standing: ReadBudgetStanding;
}): React.JSX.Element {
  if (report === undefined) {
    return <span className="nx-read-meter__label">Page data: counting…</span>;
  }
  const count = (
    <span className="nx-read-meter__label">{pageDataCount(report)}</span>
  );
  if (standing === "over") {
    return (
      <>
        {count}
        <span className="nx-read-meter__standing"> · over the limit</span>
      </>
    );
  }
  if (standing === "near") {
    return (
      <>
        {count}
        <span className="nx-read-meter__more">
          {" · "}
          <span className="nx-read-meter__link">what&apos;s this?</span>
        </span>
      </>
    );
  }
  return (
    <>
      {count}
      <Info className="nx-read-meter__info" aria-hidden={true} />
    </>
  );
}

function MeterMark({
  standing,
}: {
  standing: ReadBudgetStanding;
}): React.JSX.Element {
  const Mark = STANDING_MARK[standing];
  return <Mark className="nx-read-meter__mark" aria-hidden={true} />;
}

/**
 * What the panel says, in plain words: what the page loads and its limit, the
 * bar, what it went on, and over the limit, the blocks that come up empty.
 */
function ReadPanel({
  report,
  standing,
  editor,
  componentTitle,
  regions,
  onPicked,
}: {
  report: PageReadReport | undefined;
  standing: ReadBudgetStanding;
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
  regions: readonly CanvasRegion[];
  onPicked: () => void;
}): React.JSX.Element {
  return (
    <div className="nx-read-panel__body" data-standing={standing}>
      <div className="nx-read-panel__head">
        <p className="nx-read-panel__title">Page data</p>
        <p className="nx-read-panel__verdict">
          <MeterMark standing={standing} />
          {STANDING_WORDS[standing]}
        </p>
      </div>
      {report === undefined ? (
        <p className="nx-read-panel__note">
          The page is still being drawn. Its data is counted once every block
          has loaded.
        </p>
      ) : (
        <>
          <ReadFigure report={report} standing={standing} />
          <p className="nx-read-panel__note">
            Each time someone opens this page, it loads the data its blocks
            show: a list&apos;s entries, an image, a link to an entry. Each one
            counts once.{" "}
            {Number.isFinite(report.cap)
              ? `A page can load up to ${readCount(report.cap)}.`
              : "This site sets no limit."}
          </p>
          <ReadBar report={report} />
          <ReadKinds report={report} />
          <StandingNote
            report={report}
            standing={standing}
            editor={editor}
            componentTitle={componentTitle}
            regions={regions}
            onPicked={onPicked}
          />
          {/* How the site's front end reads media lives in its code, which
              the admin cannot read: the count takes the media library's
              way, and says so. */}
          <p className="nx-read-panel__foot">
            Images are counted as the media library loads them. A developer can
            change the limit in the site&apos;s code.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * What the standing means for the live site: near the limit, a warning;
 * over it, the blocks that come up empty, or with none yet, that the next
 * one would.
 */
function StandingNote({
  report,
  standing,
  ...unread
}: {
  report: PageReadReport;
  standing: ReadBudgetStanding;
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
  regions: readonly CanvasRegion[];
  onPicked: () => void;
}): React.JSX.Element | null {
  if (standing === "near") {
    return (
      <p className="nx-read-panel__note">
        This page is close to its limit. Past {readCount(report.cap)}, blocks
        that need more data come up empty on the live site.
      </p>
    );
  }
  if (standing !== "over") return null;
  if (unreadBlocks(report).length === 0) {
    return (
      <p className="nx-read-panel__note">
        This page uses its whole limit. One more list, image or link would come
        up empty on the live site.
      </p>
    );
  }
  return <UnreadBlocks report={report} {...unread} />;
}

/** "1 block comes up empty", "3 blocks come up empty". */
function emptyBlocks(count: number): string {
  return count === 1
    ? "1 block comes up empty"
    : `${String(count)} blocks come up empty`;
}

/**
 * The panel's headline count. Over the limit it says how many blocks come up
 * empty too, never "500 of 500" alone, which reads as a page that fits:
 * what it would need is not known, since a read refused never asks for what
 * it would have led to.
 */
function ReadFigure({
  report,
  standing,
}: {
  report: PageReadReport;
  standing: ReadBudgetStanding;
}): React.JSX.Element {
  const blocks = unreadBlocks(report).length;
  return (
    <p className="nx-read-panel__figure">
      <span className="nx-read-panel__used">{readCount(report.used)}</span>
      {Number.isFinite(report.cap)
        ? ` of ${readCount(report.cap)}`
        : " (no limit)"}
      {standing === "over" && blocks > 0 ? ` · ${emptyBlocks(blocks)}` : ""}
    </p>
  );
}

/** The limit as a bar, with the point the editor warns from marked. */
function ReadBar({ report }: { report: PageReadReport }): React.JSX.Element {
  const limited = Number.isFinite(report.cap) && report.cap > 0;
  return (
    <div className="nx-read-panel__bar">
      <div className="nx-read-panel__track" aria-hidden="true">
        <span
          className="nx-read-panel__fill"
          style={{ inlineSize: `${String(readShare(report) * 100)}%` }}
        />
        {limited ? <span className="nx-read-panel__tick" /> : null}
      </div>
      {limited ? (
        <p className="nx-read-panel__scale">
          <span>Warning from {readCount(warningAt(report.cap))}</span>
          <span>
            Limit {readCount(report.cap)}
            {report.cap === DEFAULT_MAX_QUERIES ? " (the default)" : ""}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** What the page loads: one row per kind it loads any of. */
function ReadKinds({ report }: { report: PageReadReport }): React.JSX.Element {
  const rows = READ_KINDS.filter(kind => (report.byKind[kind] ?? 0) > 0);
  if (rows.length === 0) {
    return <p className="nx-read-panel__note">This page loads no data yet.</p>;
  }
  return (
    <dl className="nx-read-panel__kinds">
      {rows.map(kind => {
        const Mark = KIND_MARK[kind];
        return (
          <div className="nx-read-panel__kind" key={kind}>
            <dt>
              <Mark className="nx-read-panel__kind-mark" aria-hidden={true} />
              {READ_KIND_WORDS[kind].label}
            </dt>
            <dd>{readCount(report.byKind[kind] ?? 0)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** The blocks that come up empty on the live site, each a way to select it. */
function UnreadBlocks({
  report,
  editor,
  componentTitle,
  regions,
  onPicked,
}: {
  report: PageReadReport;
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
  regions: readonly CanvasRegion[];
  onPicked: () => void;
}): React.JSX.Element {
  const headingId = React.useId();
  const rows = unreadBlocks(report);
  const blocks = rows.length;
  return (
    <section className="nx-read-panel__unread" aria-labelledby={headingId}>
      <p className="nx-read-panel__unread-title" id={headingId}>
        {emptyBlocks(blocks)}
      </p>
      <p className="nx-read-panel__note">
        This page needs more than {readCount(report.cap)}. On the live site,
        these blocks show without their data:
      </p>
      <ul className="nx-read-panel__list">
        {rows.map(({ nodeId, what }) => (
          <li key={nodeId}>
            <UnreadRow
              nodeId={nodeId}
              what={what}
              editor={editor}
              componentTitle={componentTitle}
              regions={regions}
              onPicked={onPicked}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Layout region whose document holds a block, when one does. */
function regionHolding(
  regions: readonly CanvasRegion[],
  nodeId: string,
  componentTitle: ComponentTitleOf | undefined
): { region: CanvasRegion; name: string } | undefined {
  for (const region of regions) {
    const name = blockNameOf(region.document, nodeId, componentTitle);
    if (name !== undefined) return { region, name };
  }
  return undefined;
}

/**
 * One unread block: a page's selects it; a Layout region's is named with
 * the Layout it comes from and offers that Layout's editor, since the page's
 * editor cannot select it; one neither holds (an undo since the draw) is
 * named by what it missed alone.
 */
function UnreadRow({
  nodeId,
  what,
  editor,
  componentTitle,
  regions,
  onPicked,
}: {
  nodeId: string;
  what: readonly ReadKind[];
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
  regions: readonly CanvasRegion[];
  onPicked: () => void;
}): React.JSX.Element {
  const Mark = KIND_MARK[what[0] ?? "page"];
  const missed = what.map(kind => READ_KIND_WORDS[kind].unread).join(" · ");
  const name = blockNameOf(editor.document, nodeId, componentTitle);
  const held =
    name === undefined
      ? regionHolding(regions, nodeId, componentTitle)
      : undefined;
  if (held !== undefined) {
    const { region } = held;
    return (
      <div className="nx-read-panel__block" data-source="layout">
        <Mark className="nx-read-panel__kind-mark" aria-hidden={true} />
        <span className="nx-read-panel__block-name">{held.name}</span>
        <span className="nx-read-panel__block-what">
          {region.label} · {missed}
        </span>
        {region.edit === undefined ? null : (
          <a
            className="nx-read-panel__block-edit"
            href={region.edit.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={region.edit.name}
          >
            {region.edit.text}
          </a>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="nx-read-panel__block"
      disabled={name === undefined}
      onClick={() => {
        editor.select(nodeId);
        onPicked();
      }}
    >
      <Mark className="nx-read-panel__kind-mark" aria-hidden={true} />
      <span className="nx-read-panel__block-name">
        {name ?? "A removed block"}
      </span>
      <span className="nx-read-panel__block-what">{missed}</span>
    </button>
  );
}
