/**
 * The notice and the mark for a collection or Single removed from code.
 *
 * The notice names the entity, says it is no longer in the configuration and
 * gives the next step for its state. In the editor it goes in the
 * `documentBanner` slot, as a strip under the header like the other document
 * banners; on a list screen it is a box above the list. The mark is the short
 * label the navigation and the lists put beside the entity's name, carrying
 * the whole notice as its accessible description and its tooltip.
 *
 * @module components/features/entries/RemovedFromCodeNotice
 */
import { Badge } from "@nextlyhq/ui";
import type { JSX } from "react";

import { FileQuestion } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { RemovedFromCodeState } from "@admin/types/removed-from-code";

import {
  noticeAsText,
  removedFromCodeNotice,
  type NoticePart,
  type RemovedEntity,
} from "./removed-from-code-notice";

function Parts({ parts }: { parts: readonly NoticePart[] }): JSX.Element {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{part}</span>
        ) : (
          <code
            key={index}
            className="rounded-sm border border-border bg-background px-1 py-0.5 font-mono text-xs text-foreground"
          >
            {part.code}
          </code>
        )
      )}
    </>
  );
}

export interface RemovedFromCodeNoticeProps {
  entity: RemovedEntity;
  state: RemovedFromCodeState | undefined;
  /** `strip` under the editor's header, `box` above a list. */
  variant?: "strip" | "box";
  className?: string;
}

export function RemovedFromCodeNotice({
  entity,
  state,
  variant = "box",
  className,
}: RemovedFromCodeNoticeProps): JSX.Element {
  const notice = removedFromCodeNotice(entity, state);
  return (
    // `status`, not `alert`: a standing fact about the entity rather than
    // something that just went wrong, present on every visit.
    <div
      role="status"
      data-testid="removed-from-code-notice"
      className={cn(
        "flex flex-wrap items-start gap-3 bg-muted px-4 py-3 text-sm",
        variant === "strip"
          ? "border-b border-border px-6"
          : "rounded-md border border-border",
        className
      )}
    >
      <FileQuestion
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-foreground">Removed from code</p>
        <p className="text-foreground">{notice.summary}</p>
        <p className="text-muted-foreground">
          <Parts parts={notice.step} />
        </p>
      </div>
    </div>
  );
}

export interface RemovedFromCodeMarkProps {
  entity: RemovedEntity;
  state: RemovedFromCodeState | undefined;
  className?: string;
}

/**
 * The id of a removed entity's mark description, for `aria-describedby` on
 * whatever names the entity. Derived from the entity, so a list rendering
 * many marks needs no hook per row.
 */
export function removedFromCodeMarkId(entity: RemovedEntity): string {
  return `removed-from-code-${entity.kind}-${entity.slug}`;
}

/**
 * The short label beside a removed entity's name, "Removed", with the whole
 * notice as its tooltip. Hidden from assistive technology: the notice reaches
 * it through {@link RemovedFromCodeDescription}, which the element naming the
 * entity points at with `aria-describedby`, so the name stays the name.
 */
export function RemovedFromCodeMark({
  entity,
  state,
  className,
}: RemovedFromCodeMarkProps): JSX.Element {
  return (
    <Badge
      variant="default"
      title={noticeAsText(removedFromCodeNotice(entity, state))}
      aria-hidden
      data-testid="removed-from-code-mark"
      className={cn("ml-auto shrink-0", className)}
    >
      Removed
    </Badge>
  );
}

/**
 * The notice as one sentence, read only by assistive technology, under
 * {@link removedFromCodeMarkId}. Placed outside the element it describes, so
 * it is that element's description and not part of its name.
 */
export function RemovedFromCodeDescription({
  entity,
  state,
}: Omit<RemovedFromCodeMarkProps, "className">): JSX.Element {
  return (
    <span id={removedFromCodeMarkId(entity)} className="sr-only">
      {noticeAsText(removedFromCodeNotice(entity, state))}
    </span>
  );
}
