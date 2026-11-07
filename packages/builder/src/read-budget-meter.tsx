"use client";

/**
 * The page's reads against its allowance, in the top bar.
 *
 * A compact reading among the document's own state (its title, status and
 * history), because what a page costs to read is a fact about the page, like
 * whether it is saved. The bottom bar holds the breadcrumb and a hint alone.
 *
 * At rest it is quiet: a count and a short bar in the muted text colour. From
 * 80% of the allowance it turns amber with a warning mark, and over it red with
 * the number of blocks that went unread, so the state is carried by a mark and
 * words as well as a colour. Pressed, it opens a panel saying what the reads
 * were for and, over the limit, naming each block a visitor sees without its
 * data, each one a way to select that block.
 *
 * @module read-budget-meter
 * @experimental Settles with the canvas's read count.
 */

import { DEFAULT_MAX_QUERIES } from "@nextlyhq/blocks-react";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import {
  CircleAlert,
  FileText,
  Gauge,
  Image,
  Link,
  List,
  Repeat,
  Component as ComponentMark,
  TriangleAlert,
} from "lucide-react";
import * as React from "react";

import type { CanvasRegion } from "./canvas-regions";
import type { EditorState } from "./editor-state";
import { blockNameOf, type ComponentTitleOf } from "./layers";
import {
  READ_KIND_WORDS,
  READ_KINDS,
  readBudgetName,
  readBudgetStanding,
  readCount,
  unreadBlocks,
  readShare,
  warningAt,
  type PageReadReport,
  type ReadBudgetStanding,
  type ReadKind,
} from "./read-budget";
import { BUILDER_TOKENS_CLASS } from "./shell-state";

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
}

/** The mark each standing wears beside its count. */
const STANDING_MARK: Record<
  ReadBudgetStanding,
  React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
> = {
  counting: Gauge,
  within: Gauge,
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
}: ReadBudgetMeterProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const standing = readBudgetStanding(report);
  const share = report === undefined ? 0 : readShare(report);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-read-meter"
          data-standing={standing}
          aria-label={readBudgetName(report)}
          // The same words as a tooltip, for the short form a crowded bar
          // draws: its mark and a number alone.
          title={readBudgetName(report)}
          // Busy while counting, so a reader is not told a stale number.
          aria-busy={standing === "counting" ? true : undefined}
        >
          <MeterMark standing={standing} />
          <span
            className="nx-read-meter__count nx-read-meter__words"
            aria-hidden="true"
          >
            <MeterWords report={report} standing={standing} />
          </span>
          <span className="nx-read-meter__track" aria-hidden="true">
            <span
              className="nx-read-meter__fill"
              style={{ inlineSize: `${String(share * 100)}%` }}
            />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        // Drawn in a portal, outside the shell, so it carries the editor's
        // token scope itself, as the component banner does.
        className={`nx-read-panel ${BUILDER_TOKENS_CLASS}`}
        aria-label="Page reads"
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
 * The trigger's words in full, and the short form a crowded top bar draws in
 * their place: the mark and a number.
 */
function MeterWords({
  report,
  standing,
}: {
  report: PageReadReport | undefined;
  standing: ReadBudgetStanding;
}): React.JSX.Element {
  if (report === undefined) {
    return (
      <>
        <span className="nx-read-meter__full">Counting reads</span>
        <span className="nx-read-meter__short">…</span>
      </>
    );
  }
  if (standing === "over") {
    return (
      <>
        <span className="nx-read-meter__full">
          Over {readCount(report.cap)} · {String(unreadBlocks(report).length)}{" "}
          unread
        </span>
        <span className="nx-read-meter__short">{readCount(report.cap)}+</span>
      </>
    );
  }
  return (
    <>
      <span className="nx-read-meter__full">
        {readCount(report.used)}
        <span className="nx-read-meter__of nx-read-meter__words">
          {" "}
          / {readCount(report.cap)}
        </span>
        <span className="nx-read-meter__unit nx-read-meter__words"> reads</span>
      </span>
      <span className="nx-read-meter__short">{readCount(report.used)}</span>
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

/** What the panel says: the count, the bar, what it went on, what was missed. */
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
        <p className="nx-read-panel__title">Page reads</p>
        <p className="nx-read-panel__verdict">
          {standing === "counting" ? null : <MeterMark standing={standing} />}
          {STANDING_WORDS[standing]}
        </p>
      </div>
      {report === undefined ? (
        <p className="nx-read-panel__note">
          The page is still being drawn. Its reads are counted once every block
          has loaded.
        </p>
      ) : (
        <>
          <ReadFigure report={report} standing={standing} />
          <ReadBar report={report} />
          <ReadKinds report={report} />
          {standing === "over" ? (
            <UnreadBlocks
              report={report}
              editor={editor}
              componentTitle={componentTitle}
              regions={regions}
              onPicked={onPicked}
            />
          ) : standing === "near" ? (
            <p className="nx-read-panel__note">
              This page is close to its limit. Past {readCount(report.cap)},
              blocks that need more data show as if it were missing.
            </p>
          ) : null}
          <p className="nx-read-panel__foot">
            Each list, image, link and related entry is a read. A developer can
            change the limit in the site&apos;s code.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * The panel's headline count. Over the limit it says the whole allowance was
 * used and how many blocks went without, never "500 of 500" alone, which
 * reads as a page that fits: what it would need is not known, since a read
 * refused never asks for what it would have led to.
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
      <span className="nx-read-panel__used">{readCount(report.used)}</span> of{" "}
      {readCount(report.cap)}{" "}
      {standing === "over"
        ? `reads used · ${String(blocks)} ${blocks === 1 ? "block" : "blocks"} not read`
        : "reads per visit"}
    </p>
  );
}

/** The allowance as a bar, with the point the editor warns from marked. */
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
          <span>Warns from {readCount(warningAt(report.cap))}</span>
          <span>
            Limit {readCount(report.cap)}
            {/* The editor counts against the default: a site's own limit is
                set in its front end's code, which the admin cannot read. */}
            {report.cap === DEFAULT_MAX_QUERIES ? " (the default)" : ""}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** What the reads were for: one row per kind the page spent any on. */
function ReadKinds({ report }: { report: PageReadReport }): React.JSX.Element {
  const rows = READ_KINDS.filter(kind => (report.byKind[kind] ?? 0) > 0);
  if (rows.length === 0) {
    return <p className="nx-read-panel__note">This page reads nothing yet.</p>;
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

/** The blocks a visitor sees without their data, each a way to select it. */
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
        {String(blocks)} {blocks === 1 ? "block" : "blocks"} not read
      </p>
      <p className="nx-read-panel__note">
        This page needs more than {readCount(report.cap)} reads. Visitors see
        these blocks as if their data were missing:
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
