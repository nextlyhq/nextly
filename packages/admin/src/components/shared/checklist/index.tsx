"use client";

/**
 * A checklist with progress: a thin bar over one line per step, each step
 * marked done, skipped or still open, with its name, one hint line and its
 * buttons on the right.
 *
 * Drawn first for the dashboard's "Set up your project" card, and lifted here
 * so a plugin's own setup list (through `@nextlyhq/plugin-sdk/admin`) is the
 * same component rather than a copy of its look. The setup card composes
 * these parts and keeps everything that is about setup itself — which steps
 * exist, what each button does, sample content — to itself.
 *
 * @module components/shared/checklist
 */

import { Skeleton } from "@nextlyhq/ui";
import { stepFinished, type SetupStep } from "nextly/config";
import {
  createContext,
  useContext,
  type JSX,
  type LiHTMLAttributes,
  type ReactNode,
} from "react";

import { Check } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/**
 * Where one step stands: the setup steps' own statuses, so a checklist and the
 * setup answer the host computes never disagree about what a step can be.
 */
export type ChecklistStatus = SetupStep["status"];

/**
 * How a done step's name is drawn: `quiet` in the muted text colour, as every
 * finished step is; `struck` also struck through, for a list where crossing a
 * step off reads better than greying it.
 */
export type ChecklistDoneStyle = "quiet" | "struck";

/**
 * The list's done style, read by each of its items, so a list sets it once
 * rather than on every step. `quiet` outside a `Checklist`.
 */
const DoneStyleContext = createContext<ChecklistDoneStyle>("quiet");

/** What a screen reader hears for each status, which the mark and styling only show. */
const STATUS_TEXT: Record<ChecklistStatus, string> = {
  done: "done",
  skipped: "skipped",
  open: "still to do",
};

export interface ChecklistProgressProps {
  done: number;
  total: number;
}

/**
 * The progress bar. A picture only, hidden from assistive technology: the
 * count it shows belongs in words beside the list's title ("4 of 6 done"),
 * where it is read once.
 */
export function ChecklistProgress({
  done,
  total,
}: ChecklistProgressProps): JSX.Element {
  return (
    <div
      className="mt-0.5 mb-1.5 h-1 w-full overflow-hidden rounded-full bg-secondary"
      aria-hidden="true"
      data-checklist-progress=""
    >
      <div
        className="h-full rounded-full bg-success-solid transition-[width] duration-300 motion-reduce:transition-none"
        style={{
          width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%`,
        }}
      />
    </div>
  );
}

export interface ChecklistMarkProps {
  status: ChecklistStatus;
}

/**
 * A step's mark, in its own shape: a tick on the success colour once it is
 * done, a dashed circle once it is skipped, and an empty circle while it is
 * open, so the status never rests on colour alone.
 */
export function ChecklistMark({ status }: ChecklistMarkProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-checklist-mark={status}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-control-border",
        status === "done" &&
          "border-success-solid bg-success-solid text-success-foreground",
        status === "skipped" && "border-dashed"
      )}
    >
      {status === "done" && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

export interface ChecklistItemProps
  extends Omit<LiHTMLAttributes<HTMLLIElement>, "children"> {
  status: ChecklistStatus;
  /** The step's name. */
  label: ReactNode;
  /** One line under the name: what the step asks, or how far it is. */
  hint?: ReactNode;
  /** Draws the hint as a failure, in the danger text colour. */
  hintFailed?: boolean;
  /**
   * The step's buttons, on the right beside its name or, where the line is
   * too narrow for both, wrapped under it.
   */
  actions?: ReactNode;
  /** Anything the step shows under its hint while open, such as a list. */
  children?: ReactNode;
}

/**
 * One step's line. A finished step (done or skipped) reads quieter than an
 * open one, and its status is spoken after its name, since the mark is a
 * picture.
 */
export function ChecklistItem({
  status,
  label,
  hint,
  hintFailed = false,
  actions,
  children,
  className,
  ...props
}: ChecklistItemProps): JSX.Element {
  // Finished is the host's own judgement of a step, not a second one here.
  const finished = stepFinished({ status });
  // Struck through only once done: a skipped step was not done, so it stays
  // quiet rather than reading as crossed off.
  const struck = useContext(DoneStyleContext) === "struck" && status === "done";
  return (
    <li
      data-status={status}
      {...props}
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border py-2.5 first:border-t-0",
        className
      )}
    >
      <ChecklistMark status={status} />
      <div className="min-w-36 flex-1">
        <p
          className={cn(
            "text-[13.5px] leading-5 break-words",
            finished ? "text-muted-foreground" : "font-medium text-foreground",
            struck && "line-through"
          )}
        >
          {label}
          <span className="sr-only"> — {STATUS_TEXT[status]}</span>
        </p>
        {hint !== undefined && (
          <p
            className={cn(
              "text-[12.5px] leading-[18px] text-muted-foreground",
              hintFailed && "text-danger-text"
            )}
            data-checklist-hint=""
          >
            {hint}
          </p>
        )}
        {children}
      </div>
      {/* Hidden while empty: a line with nothing to press takes no room. */}
      <div
        className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 empty:hidden"
        data-checklist-actions=""
      >
        {actions}
      </div>
    </li>
  );
}

export interface ChecklistProps {
  /** Names the list of steps for assistive technology ("Setup steps"). */
  label: string;
  /** How many steps are finished, for the bar. */
  done: number;
  /** How many steps there are, for the bar. */
  total: number;
  /** One `ChecklistItem` per step, in order. */
  children: ReactNode;
  /**
   * `2` lays the steps in two columns, without the rule between steps, once
   * the checklist's own box is wide enough (one column below that). Default
   * `1`.
   */
  columns?: 1 | 2;
  /** How a done step's name is drawn. Default `quiet`. */
  doneStyle?: ChecklistDoneStyle;
  className?: string;
}

/**
 * The bar over an ordered list of steps. Each column is narrowed to its share
 * whatever its content, so a long step name wraps rather than widening the
 * card.
 *
 * Two columns follow the checklist's own width (a container query), not the
 * window's: in a card beside the admin's sidebars the window promises room
 * the card does not have. The rule between steps goes with them, since rules
 * in two columns of uneven steps would not line up.
 */
export function Checklist({
  label,
  done,
  total,
  children,
  columns = 1,
  doneStyle = "quiet",
  className,
}: ChecklistProps): JSX.Element {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[minmax(0,1fr)]",
        columns === 2 && "@container",
        className
      )}
    >
      <ChecklistProgress done={done} total={total} />
      <ol
        aria-label={label}
        className={cn(
          "grid min-w-0",
          columns === 2
            ? "grid-cols-1 gap-x-6 @2xl:grid-cols-2 [&>li]:border-t-0"
            : "grid-cols-[minmax(0,1fr)]"
        )}
      >
        <DoneStyleContext.Provider value={doneStyle}>
          {children}
        </DoneStyleContext.Provider>
      </ol>
    </div>
  );
}

/**
 * A checklist while its steps are on their way: the bar, then `steps` lines
 * drawn by `ChecklistItem` itself, each with a still bar for its name and
 * one for its hint, so the checklist that replaces it stands as tall as this,
 * line for line. Hidden from assistive technology: whatever draws it says
 * that it is loading.
 */
export function ChecklistOutline({ steps }: { steps: number }): JSX.Element {
  return (
    <div aria-hidden="true">
      <Checklist label="" done={0} total={steps}>
        {Array.from({ length: steps }, (_, step) => (
          <ChecklistItem
            key={step}
            status="open"
            label={
              <Skeleton
                still
                className={cn(
                  "inline-block h-3 align-middle",
                  OUTLINE_NAME_WIDTHS[step % OUTLINE_NAME_WIDTHS.length]
                )}
              />
            }
            hint={
              <Skeleton
                still
                className="inline-block h-2.5 w-3/5 bg-muted align-middle"
              />
            }
          />
        ))}
      </Checklist>
    </div>
  );
}

/** The widths of an outline's step names, in turn. */
const OUTLINE_NAME_WIDTHS = ["w-2/5", "w-1/2", "w-1/3"] as const;
