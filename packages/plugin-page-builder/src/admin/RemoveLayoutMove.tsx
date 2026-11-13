"use client";

/**
 * The Remove Layout dialog when pages use the Layout: move them to the site
 * default, then delete or unpublish it.
 *
 * Drawn inside the dialog `RemoveLayoutAction` opens, once its dry run found
 * pages naming the Layout and read every page. It goes through these states:
 *
 * - **idle**: how many pages use the Layout, the first few with where they
 *   name it, and a note on the published ones, which switch to the site
 *   default's header and footer right away;
 * - **moving**: the route's ticks (`move-pages.ts`), called one after
 *   another while the dialog stays open, with a bar of the pages moved;
 * - **stopped**: after Stop, or a move the server stopped (its lease lapsed);
 *   the pages moved stay moved, and the rest can be moved again;
 * - **done**: every page moved and the Layout removed, with the published
 *   pages whose live version still names it, where the person may edit them
 *   but not publish them, so only their drafts moved;
 * - **refused**: pages that could not be moved, each with why.
 *
 * Closing the dialog while pages move stops the move: the next tick is never
 * sent, and Stop is sent for the move's token so its fence comes down at once.
 *
 * @module admin/RemoveLayoutMove
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Progress,
} from "@nextlyhq/ui";
import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";

import type {
  LiveCopiesLeft,
  MoveProgress,
  UnmovedPage,
} from "../layout-removal/move-pages";
import type {
  CheckedPage,
  CheckedPageState,
  RemovalCheck,
  RemoveResult,
} from "../layout-removal/remove-layout";
import { liveCopiesLeftSentence } from "../layout-removal/words";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** What a move removes the Layout by once its pages have moved. */
type MoveAction = "delete" | "unpublish";

/** Where the dialog's move is. */
type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "moving"; readonly action: MoveAction }
  | { readonly kind: "stopped"; readonly action: MoveAction }
  | {
      readonly kind: "done";
      readonly action: MoveAction;
      readonly liveLeft?: LiveCopiesLeft;
    }
  | {
      readonly kind: "refused";
      readonly action: MoveAction;
      readonly pages: readonly UnmovedPage[];
      readonly unreadable: number;
      readonly complete: boolean;
    }
  | {
      readonly kind: "failed";
      readonly action: MoveAction;
      readonly message: string;
    };

/**
 * Why a page was left, when no tick this dialog sent learned it: one tried by
 * a move an earlier dialog started.
 */
const UNMOVED = "This page couldn't be moved.";

/** How many pages the idle state names before "and N more". */
const PAGES_NAMED = 3;

/** One tick's request body, as the route parses it. */
interface TickBody {
  readonly action: MoveAction;
  readonly move: true;
  readonly token?: string;
  readonly after?: string;
  readonly stop?: true;
}

/** One tick of the move, through the route. */
async function callTick(
  id: string,
  body: TickBody
): Promise<MoveProgress | undefined> {
  const answer = await writePluginRoute<{
    message: string;
    item: RemoveResult;
  }>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: `/layouts/${encodeURIComponent(id)}/remove`,
    body,
  });
  return answer?.item.move;
}

/** "1 page", "3 pages". */
function pages(count: number): string {
  return `${String(count)} ${count === 1 ? "page" : "pages"}`;
}

/** The site default, named in bold when the person may read its title. */
function SiteDefault({ name }: { name: string | null }): JSX.Element {
  return name === null ? (
    <>the site default</>
  ) : (
    <>
      the site default, <strong>{name}</strong>
    </>
  );
}

/** The tag beside a page in the idle list. */
const STATE_TAGS: Record<CheckedPageState, string> = {
  published: "Published",
  unpublished: "Unpublished",
  edited: "Published · unsaved edits",
};

/** A page, as a link that opens it in a new tab, with a tag beside it. */
function PageRow({
  page,
  pagesCollection,
  tag,
  tagTone = "muted",
}: {
  page: Pick<CheckedPage, "id" | "title">;
  pagesCollection: string;
  tag: string;
  tagTone?: "muted" | "error";
}): JSX.Element {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <a
        className="truncate font-medium text-primary underline-offset-4 hover:underline"
        href={`/admin/collections/${encodeURIComponent(pagesCollection)}/${encodeURIComponent(page.id)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {page.title === "" ? "Untitled page" : page.title}
      </a>
      {/* The design system's chip: its destructive pair holds 4.5:1 in
          both themes, which red text on the muted fill did not in light. */}
      <Badge
        className="shrink-0"
        variant={tagTone === "error" ? "destructive" : "default"}
      >
        {tag}
      </Badge>
    </li>
  );
}

/** The bar and its line, in the moving and stopped states. */
function MoveBar({
  moved,
  total,
  running,
}: {
  moved: number;
  total: number;
  running: boolean;
}): JSX.Element {
  const shown = Math.min(moved, total);
  const percent = total === 0 ? 100 : Math.round((shown / total) * 100);
  const line = `Moved ${String(shown)} of ${pages(total)}`;
  return (
    <div className="space-y-2">
      <Progress value={percent} aria-label={line} />
      <p className="text-sm text-muted-foreground">
        {running ? `${line}…` : line}
      </p>
    </div>
  );
}

/** What the dialog says and shows in each state. */
interface Face {
  readonly title: string;
  /** Marks a finished move beside the title; the sentence stays plain text. */
  readonly succeeded?: true;
  readonly sentence: ReactNode;
  readonly body: ReactNode;
}

/** The idle state's list and note. */
function IdleBody({ check }: { check: RemovalCheck }): JSX.Element {
  const total = check.pages.length + check.unreadable;
  const named = check.pages.slice(0, PAGES_NAMED);
  const more = total - named.length;
  const target = check.siteDefault ?? "the site default";
  return (
    <div className="space-y-3">
      {named.length > 0 ? (
        <ul className="text-sm">
          {named.map(page => (
            <PageRow
              key={page.id}
              page={page}
              pagesCollection={check.pagesCollection}
              tag={STATE_TAGS[page.state]}
            />
          ))}
        </ul>
      ) : null}
      {more > 0 ? (
        <p className="text-sm text-muted-foreground">
          {named.length === 0
            ? `${pages(more)} you can't view`
            : `and ${String(more)} more`}
        </p>
      ) : null}
      {check.liveRows > 0 ? (
        <Alert variant="warning">
          <AlertDescription>
            {`${String(check.liveRows)} published ${check.liveRows === 1 ? "page switches" : "pages switch"} to ${target}'s header and footer right away.`}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** The refused state's list of the pages left, each with why. */
function RefusedBody({
  phase,
  pagesCollection,
  reasons,
}: {
  phase: Extract<Phase, { kind: "refused" }>;
  pagesCollection: string;
  reasons: ReadonlyMap<string, string>;
}): JSX.Element {
  const left = phase.pages.length + phase.unreadable;
  return (
    <div className="space-y-3">
      {phase.pages.length > 0 ? (
        <ul className="max-h-60 overflow-y-auto text-sm">
          {phase.pages.map(page => (
            <PageRow
              key={page.id}
              page={page}
              pagesCollection={pagesCollection}
              tag={page.reason ?? reasons.get(page.id) ?? UNMOVED}
              tagTone="error"
            />
          ))}
        </ul>
      ) : null}
      {phase.unreadable > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`And ${pages(phase.unreadable)} you can't view.`}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {phase.complete
          ? `Ask someone who can edit ${left === 1 ? "it" : "them"} to choose another Layout, then try again.`
          : "Not every page could be checked. Try again in a moment."}
      </p>
    </div>
  );
}

/**
 * The done state's note on the published pages whose live version still names
 * the Layout, each linked so a publisher can open it, the rest counted.
 */
function LiveLeftBody({
  left,
  pagesCollection,
}: {
  left: LiveCopiesLeft;
  pagesCollection: string;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <Alert variant="warning">
        <AlertDescription>
          {liveCopiesLeftSentence(left.pages.length + left.unreadable)}
        </AlertDescription>
      </Alert>
      {left.pages.length > 0 ? (
        <ul className="max-h-60 overflow-y-auto text-sm">
          {left.pages.map(page => (
            <PageRow
              key={page.id}
              page={page}
              pagesCollection={pagesCollection}
              tag="Published version kept"
            />
          ))}
        </ul>
      ) : null}
      {left.unreadable > 0 ? (
        <p className="text-sm text-muted-foreground">
          {`And ${pages(left.unreadable)} you can't view.`}
        </p>
      ) : null}
    </div>
  );
}

/** How many pages a finished move left with their live version on the Layout. */
function liveLeftCount(left: LiveCopiesLeft | undefined): number {
  return left === undefined ? 0 : left.pages.length + left.unreadable;
}

/** The verb a sentence uses for what the move does to the Layout. */
function removed(action: MoveAction): string {
  return action === "delete" ? "deleted" : "unpublished";
}

/** "uses" for one, "use" for more. */
function uses(count: number): string {
  return count === 1 ? "uses" : "use";
}

/** "it" for one, "them" for more. */
function them(count: number): string {
  return count === 1 ? "it" : "them";
}

/** What every state's words are drawn from. */
interface FaceArgs {
  readonly check: RemovalCheck;
  readonly published: boolean;
  /** Pages moved, never more than `total`. */
  readonly moved: number;
  readonly total: number;
  readonly reasons: ReadonlyMap<string, string>;
}

/** The face of each state, by its kind. */
const FACES: {
  readonly [K in Phase["kind"]]: (
    phase: Extract<Phase, { kind: K }>,
    args: FaceArgs
  ) => Face;
} = {
  idle: (_phase, { check, published, total }) => ({
    title: "Remove Layout",
    sentence: (
      <>
        {`${pages(total)} ${uses(total)} this Layout. Move ${them(total)} to `}
        <SiteDefault name={check.siteDefault} />
        {`, and then ${published ? "delete or unpublish" : "delete"} it, or close and choose another Layout for ${them(total)} yourself.`}
      </>
    ),
    body: <IdleBody check={check} />,
  }),
  moving: (phase, { check, moved, total }) => ({
    title: "Moving pages",
    sentence: (
      <>
        {"Moving pages to "}
        <SiteDefault name={check.siteDefault} />
        {`. Keep this open; the Layout is ${removed(phase.action)} when every page has moved. If you close this, moving stops; pages already moved stay on ${check.siteDefault ?? "the site default"}.`}
      </>
    ),
    body: <MoveBar moved={moved} total={total} running />,
  }),
  stopped: (phase, { check, moved, total }) => ({
    title: "Stopped",
    sentence: (
      <>
        {`${pages(moved)} now ${uses(moved)} `}
        <SiteDefault name={check.siteDefault} />
        {`. ${String(total - moved)} still ${uses(total - moved)} this Layout, so it was not ${removed(phase.action)}.`}
      </>
    ),
    body: <MoveBar moved={moved} total={total} running={false} />,
  }),
  done: (phase, { check, total }) => {
    const left = liveLeftCount(phase.liveLeft);
    return {
      title:
        phase.action === "delete" ? "Layout deleted" : "Layout unpublished",
      succeeded: true,
      sentence: `${pages(Math.max(total - left, 0))} moved to the site default${check.siteDefault === null ? "" : `, ${check.siteDefault}`}, and the Layout was ${removed(phase.action)}.`,
      body:
        phase.liveLeft === undefined || left === 0 ? null : (
          <LiveLeftBody
            left={phase.liveLeft}
            pagesCollection={check.pagesCollection}
          />
        ),
    };
  },
  refused: (phase, { check, moved, total, reasons }) => {
    const left = phase.pages.length + phase.unreadable;
    const still =
      left === 1 ? "one page still uses" : `${String(left)} pages still use`;
    return {
      title: "Some pages couldn't be moved",
      sentence: (
        <>
          {`${String(moved)} of ${pages(total)} moved to `}
          <SiteDefault name={check.siteDefault} />
          {`. The Layout was not ${removed(phase.action)}, because ${still} it:`}
        </>
      ),
      body: (
        <RefusedBody
          phase={phase}
          pagesCollection={check.pagesCollection}
          reasons={reasons}
        />
      ),
    };
  },
  failed: (phase, { moved }) => ({
    title: "Remove Layout",
    sentence: `${pages(moved)} moved to the site default. The Layout was not ${removed(phase.action)}.`,
    body: (
      <Alert variant="destructive">
        <AlertDescription>{phase.message}</AlertDescription>
      </Alert>
    ),
  }),
};

/** The dialog's title, sentence and body for `phase`. */
function faceOf(phase: Phase, args: FaceArgs): Face {
  const face = FACES[phase.kind] as (phase: Phase, args: FaceArgs) => Face;
  return face(phase, args);
}

/** The buttons for `phase`. */
function Footer({
  phase,
  total,
  moved,
  published,
  onStart,
  onStop,
  onFinished,
}: {
  phase: Phase;
  total: number;
  moved: number;
  published: boolean;
  onStart: (action: MoveAction) => void;
  onStop: () => void;
  onFinished: (action: MoveAction) => void;
}): JSX.Element {
  switch (phase.kind) {
    case "idle":
      return (
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          {published ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onStart("unpublish")}
            >
              {`Move ${pages(total)}, then unpublish`}
            </Button>
          ) : null}
          <Button type="button" onClick={() => onStart("delete")}>
            {`Move ${pages(total)}, then delete`}
          </Button>
        </AlertDialogFooter>
      );
    case "moving":
      return (
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onStop}>
            Stop
          </Button>
          <Button type="button" disabled>
            Moving…
          </Button>
        </AlertDialogFooter>
      );
    case "done":
      return (
        <AlertDialogFooter>
          <Button type="button" onClick={() => onFinished(phase.action)}>
            Close
          </Button>
        </AlertDialogFooter>
      );
    case "stopped":
      return (
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <Button type="button" onClick={() => onStart(phase.action)}>
            {`Move the other ${String(Math.max(total - moved, 0))}, then ${phase.action}`}
          </Button>
        </AlertDialogFooter>
      );
    case "refused":
    case "failed":
      return (
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <Button type="button" onClick={() => onStart(phase.action)}>
            Try again
          </Button>
        </AlertDialogFooter>
      );
  }
}

/** A refusal's own words, or a plain fallback. */
function reasonOf(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The pages could not be moved.";
}

/**
 * The dialog's content while pages use the Layout, by the states in the
 * module docblock. `onFinished` runs once the Layout is gone (or
 * unpublished), when the author closes the dialog; `onRemoved` as soon as it
 * is, so the dialog around this knows closing it must leave the screen.
 */
export function MovePagesDialog({
  entryId,
  check,
  published,
  onRemoved,
  onFinished,
}: {
  entryId: string;
  check: RemovalCheck;
  published: boolean;
  onRemoved: (action: MoveAction) => void;
  onFinished: (action: MoveAction) => void;
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  // Pages moved by every tick this dialog sent, across restarts.
  const [moved, setMoved] = useState(0);
  const [reasons, setReasons] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const open = useRef(true);
  const stopAsked = useRef(false);
  // The running move's token and action, so closing can stop it.
  const running = useRef<{ token: string; action: MoveAction } | null>(null);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
      const held = running.current;
      running.current = null;
      if (held !== null) sendStop(entryId, held);
    };
  }, [entryId]);

  const start = (action: MoveAction): void => {
    stopAsked.current = false;
    setPhase({ kind: "moving", action });
    void runTicks(action);
  };

  const runTicks = async (action: MoveAction): Promise<void> => {
    let body: TickBody | null = { action, move: true };
    try {
      while (body !== null) {
        body = await afterTick(action, await callTick(entryId, body));
      }
    } catch (error) {
      const held = running.current;
      running.current = null;
      if (held !== null) sendStop(entryId, held);
      if (open.current) {
        setPhase({ kind: "failed", action, message: reasonOf(error) });
      }
    }
  };

  /** Act on one tick's answer: the next tick's body, or null when done. */
  const afterTick = async (
    action: MoveAction,
    move: MoveProgress | undefined
  ): Promise<TickBody | null> => {
    if (move === undefined) throw new Error("The move did not answer.");
    if (!open.current) {
      // Closed while this tick ran: the move stops with it. A last tick that
      // removed the Layout all the same still leaves this screen, since what
      // it shows is gone (deleted) or out of date (unpublished).
      if (move.state === "moving") sendStop(entryId, { ...move, action });
      else if (move.state === "done") onFinished(action);
      return null;
    }
    setMoved(count => count + move.moved);
    if (move.state !== "moving") {
      running.current = null;
      settle(action, move);
      return null;
    }
    running.current = { token: move.token, action };
    noteRefusals(move.refused);
    if (!stopAsked.current) {
      return { action, move: true, token: move.token, after: move.after };
    }
    running.current = null;
    await callTick(entryId, {
      action,
      move: true,
      token: move.token,
      stop: true,
    }).catch(() => undefined);
    if (open.current) setPhase({ kind: "stopped", action });
    return null;
  };

  const noteRefusals = (refused: readonly UnmovedPage[]): void => {
    if (refused.length === 0) return;
    setReasons(known => {
      const next = new Map(known);
      for (const page of refused) {
        if (page.reason !== null) next.set(page.id, page.reason);
      }
      return next;
    });
  };

  const settle = (
    action: MoveAction,
    move: Exclude<MoveProgress, { state: "moving" }>
  ): void => {
    switch (move.state) {
      case "done":
        onRemoved(action);
        setPhase({
          kind: "done",
          action,
          ...(move.liveLeft === undefined ? {} : { liveLeft: move.liveLeft }),
        });
        return;
      case "stopped":
        setPhase({ kind: "stopped", action });
        return;
      case "refused":
        setPhase({
          kind: "refused",
          action,
          pages: move.pages,
          unreadable: move.unreadable,
          complete: move.complete,
        });
        return;
    }
  };

  const total = check.pages.length + check.unreadable;
  const face = faceOf(phase, {
    check,
    published,
    moved: Math.min(moved, total),
    total,
    reasons,
  });
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          {/* The success colour marks the outcome on an icon, where it
              needs only 3:1, so the sentence keeps the body text colour. */}
          {face.succeeded === true ? (
            <CircleCheck
              aria-hidden="true"
              className="size-5 shrink-0 text-success"
            />
          ) : null}
          {face.title}
        </AlertDialogTitle>
        <AlertDialogDescription>{face.sentence}</AlertDialogDescription>
      </AlertDialogHeader>
      {face.body}
      <Footer
        phase={phase}
        total={check.pages.length + check.unreadable}
        moved={moved}
        published={published}
        onStart={start}
        onStop={() => {
          stopAsked.current = true;
        }}
        onFinished={onFinished}
      />
    </>
  );
}

/** Stop a move the dialog no longer watches; its lease covers a failure. */
function sendStop(
  entryId: string,
  held: { token: string; action: MoveAction }
): void {
  void callTick(entryId, {
    action: held.action,
    move: true,
    token: held.token,
    stop: true,
  }).catch(() => undefined);
}
