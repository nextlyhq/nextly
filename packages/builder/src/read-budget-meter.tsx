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

import type { EditorState } from "./editor-state";
import { blockNameOf, type ComponentTitleOf } from "./layers";
import {
  READ_KIND_WORDS,
  READ_KINDS,
  readBudgetName,
  readBudgetStanding,
  readCount,
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
          // Busy while counting, so a reader is not told a stale number.
          aria-busy={standing === "counting" ? true : undefined}
        >
          <MeterMark standing={standing} />
          <span className="nx-read-meter__count" aria-hidden="true">
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
          Over {readCount(report.cap)} · {String(report.unread.length)} unread
        </span>
        <span className="nx-read-meter__short">{readCount(report.cap)}+</span>
      </>
    );
  }
  return (
    <>
      <span className="nx-read-meter__full">
        {readCount(report.used)}
        <span className="nx-read-meter__of"> / {readCount(report.cap)}</span>
        <span className="nx-read-meter__unit"> reads</span>
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
  onPicked,
}: {
  report: PageReadReport | undefined;
  standing: ReadBudgetStanding;
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
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
  const blocks = report.unread.length;
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
          <span>Limit {readCount(report.cap)}</span>
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
  onPicked,
}: {
  report: PageReadReport;
  editor: ReadBudgetMeterProps["editor"];
  componentTitle: ComponentTitleOf | undefined;
  onPicked: () => void;
}): React.JSX.Element {
  const headingId = React.useId();
  const blocks = report.unread.length;
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
        {report.unread.map(({ nodeId, what }) => {
          const Mark = KIND_MARK[what];
          // A block the document no longer holds (an undo since the draw)
          // is named by what it missed alone, and cannot be selected.
          const name = blockNameOf(editor.document, nodeId, componentTitle);
          return (
            <li key={`${nodeId}:${what}`}>
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
                <span className="nx-read-panel__block-what">
                  {READ_KIND_WORDS[what].unread}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
