"use client";

/**
 * Publishing a component that removes fields: the count taken again, and the
 * question asked again when more documents place the component than the
 * designer was told when they removed the field.
 *
 * The removal dialog says how many documents place the component directly.
 * At publish this asks the server for a hold on the removed fields
 * (`removal-hold`): it counts again, and when the count has grown it answers
 * the new number instead of holding. The designer is then asked with that
 * number, and publishing goes ahead only once a hold is made for a count they
 * confirmed. While held, no write may newly set a removed field, so the
 * number confirmed is the number that lose a value.
 *
 * Asked from the action runner's before-action hook, so every way of
 * publishing from the editor asks it. A publish that removes no field asks
 * nothing. A hold that cannot be asked for refuses the publish, with words
 * that say to try again: the removal takes values from pages, and going ahead
 * on a count nobody checked is the outcome the hold exists to prevent.
 *
 * @module admin/removal-hold-client
 */
import {
  isComponentDocument,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import {
  readPluginRoute,
  useBeforeDocumentAction,
  useDocumentIdentity,
  useDocumentLocale,
  useDocumentStatus,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type JSX } from "react";

import {
  componentFactsPath,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentFactsResponse,
} from "../library-contract";
import {
  REMOVAL_HOLD_ROUTE_PATH,
  type RemovalHoldRequest,
  type RemovalHoldResult,
} from "../removal-hold-contract";
import { exposureIdsOf } from "../retired-history";

import { DESTRUCTIVE_CONFIRM_CLASS } from "./destructive-confirm";

/** A count of the documents placing a component, as the dialogs say it. */
type Reach = RemovalHoldResult["reach"];

/** What the hook reads. */
export interface RemovalHoldInput {
  /** The document the publish stores, read when a publish starts. */
  readonly document: () => BlockDocument;
  /** The document being edited now, as each render has it. */
  readonly editing: BlockDocument;
  /**
   * How many documents place the component, as the removal dialog says it
   * now. Kept as it stood when each field was removed: that is the count the
   * designer confirmed, however the number has moved since.
   */
  readonly reach: () => Reach | undefined;
}

/** The removed fields and slots a publish takes out. */
interface Removed {
  readonly properties: readonly string[];
  readonly slots: readonly string[];
}

/** The question shown when the count has grown. */
interface Recount {
  /** The count the designer was told, or `undefined` where none was said. */
  readonly confirmed: Reach | undefined;
  readonly reach: Reach;
}

/**
 * How many times a grown count is asked about before giving up. Each answer
 * is followed by one more request, so every "Publish and remove" is tried.
 */
const MAX_ASKS = 3;

/**
 * How many times the document may change under a hold being asked for before
 * giving up: each change asks again for what it removes.
 */
const MAX_CHANGES = 3;

/** Said when the hold cannot be had, so the publish is refused. */
export const HOLD_FAILED =
  "This component wasn’t published: how many documents lose the removed fields’ values couldn’t be checked. Try again.";

/** Said when the count kept growing while the designer was asked. */
const HOLD_MOVING =
  "This component wasn’t published: the documents placing it kept changing. Try again in a moment.";

/**
 * The action ids that put the definition live: Publish, and where the store
 * has no Draft/Published lifecycle (the document has no status), every save.
 */
function putsLive(action: string, lifecycle: boolean): boolean {
  return action === "publish" || (!lifecycle && action === "save");
}

/**
 * Hold a publish that removes fields, and return the dialog that asks again.
 * Renders nothing until a count has grown; place it inside the editor.
 */
export function useRemovalHold(input: RemovalHoldInput): JSX.Element {
  const identity = useDocumentIdentity();
  const locale = useDocumentLocale();
  const lifecycle = useDocumentStatus() !== null;
  const [question, setQuestion] = useState<{
    recount: Recount;
    answer: (go: boolean) => void;
  } | null>(null);
  const told = useToldReach(input.editing, input.reach);
  const latest = useRef({ input, id: identity?.documentId, locale, lifecycle });
  useEffect(() => {
    latest.current = { input, id: identity?.documentId, locale, lifecycle };
  });

  useBeforeDocumentAction(async action => {
    if (!putsLive(action, latest.current.lifecycle)) return;
    const { id, locale: language } = latest.current;
    if (id === undefined) return;
    const ask = (recount: Recount) =>
      new Promise<boolean>(resolve => {
        setQuestion({ recount, answer: resolve });
      }).finally(() => setQuestion(null));
    for (let change = 0; change < MAX_CHANGES; change += 1) {
      const document = latest.current.input.document();
      if (!isComponentDocument(document)) return;
      const removed = await removedIds(
        id,
        document,
        language?.code ?? undefined
      );
      if (removed.properties.length === 0 && removed.slots.length === 0) {
        return;
      }
      await holdRemoval({ id, removed, said: told(removed), ask });
      // Held for the document read above: a change made meanwhile may remove
      // more, so it is asked about in turn before anything is stored.
      if (latest.current.input.document() === document) return;
    }
    throw new Error(HOLD_MOVING);
  });

  return (
    <RemovalRecountDialog
      recount={question?.recount ?? null}
      onAnswer={go => question?.answer(go)}
    />
  );
}

/**
 * Hold a removal at the count the designer confirmed, asking again while it
 * has grown. Every answer to go ahead is followed by a request for the count
 * it confirmed; the asking stops once that has grown {@link MAX_ASKS} times.
 */
async function holdRemoval(args: {
  readonly id: string;
  readonly removed: Removed;
  /** The count the designer was told; none told asks of any document. */
  readonly said: Reach | undefined;
  readonly ask: (recount: Recount) => Promise<boolean>;
}): Promise<void> {
  let said = args.said;
  for (let asked = 0; ; asked += 1) {
    const answer = await askHold({
      id: args.id,
      properties: [...args.removed.properties],
      slots: [...args.removed.slots],
      confirmed: said?.count ?? 0,
      // A count of none told is held to as a whole one: a floor now asks.
      confirmedComplete: said?.complete ?? true,
    });
    if (answer.kind === "held") return;
    if (asked === MAX_ASKS) throw new Error(HOLD_MOVING);
    if (!(await args.ask({ confirmed: said, reach: answer.reach }))) {
      throw new DOMException("Publishing was cancelled.", "AbortError");
    }
    said = answer.reach;
  }
}

/** A removed field's or slot's key among the counts told. */
const toldKey = (kind: "property" | "slot", id: string) => `${kind}\u001F${id}`;

/**
 * The count the removal dialog said as each field or slot left the edited
 * document, kept from then on: a later read of the number, refetched when the
 * window regains focus say, is not what the designer confirmed. Answers, for
 * the fields a publish removes, the smallest count told, or `undefined` where
 * one left with no count said (removed before this editor opened, say), so
 * the designer is asked with the count now.
 */
function useToldReach(
  editing: BlockDocument,
  reach: () => Reach | undefined
): (removed: Removed) => Reach | undefined {
  const told = useRef(new Map<string, Reach | undefined>());
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    const exposed = isComponentDocument(editing)
      ? exposureIdsOf(editing)
      : { properties: [], slots: [] };
    const now = new Set([
      ...exposed.properties.map(id => toldKey("property", id)),
      ...exposed.slots.map(id => toldKey("slot", id)),
    ]);
    // The first count told for a field is the one kept: an undo and a redo
    // say nothing again, and asking more often is the safe side.
    for (const key of before.current ?? []) {
      if (!now.has(key) && !told.current.has(key)) {
        told.current.set(key, reach());
      }
    }
    before.current = now;
  }, [editing, reach]);
  return useCallback((removed: Removed) => {
    const keys = [
      ...removed.properties.map(id => toldKey("property", id)),
      ...removed.slots.map(id => toldKey("slot", id)),
    ];
    let least: Reach | undefined;
    for (const key of keys) {
      const said = told.current.get(key);
      if (said === undefined) return undefined;
      // The smallest number, held as whole if any was: both ask the most.
      least =
        least === undefined
          ? said
          : {
              count: Math.min(least.count, said.count),
              complete: least.complete || said.complete,
            };
    }
    return least;
  }, []);
}

/**
 * The fields and slots the live definition has that the document published
 * does not: what this publish removes.
 */
async function removedIds(
  id: string,
  document: BlockDocument,
  locale: string | undefined
): Promise<{ properties: string[]; slots: string[] }> {
  let facts: ComponentFactsResponse | undefined;
  try {
    facts = await readPluginRoute<ComponentFactsResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: componentFactsPath(id, locale),
    });
  } catch (error) {
    throw new Error(HOLD_FAILED, { cause: error });
  }
  if (facts === undefined) throw new Error(HOLD_FAILED);
  const kept = exposureIdsOf(document);
  return {
    properties: facts.live.properties.filter(
      field => !kept.properties.includes(field)
    ),
    slots: facts.live.slots.filter(slot => !kept.slots.includes(slot)),
  };
}

/** The server's answer to a hold, or the refusal of the publish. */
async function askHold(
  request: RemovalHoldRequest
): Promise<RemovalHoldResult> {
  let answer: { item?: RemovalHoldResult } | undefined;
  try {
    answer = await writePluginRoute<{ item?: RemovalHoldResult }>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: REMOVAL_HOLD_ROUTE_PATH,
      body: request,
    });
  } catch (error) {
    throw new Error(HOLD_FAILED, { cause: error });
  }
  const item = answer?.item;
  if (item?.kind !== "held" && item?.kind !== "recount") {
    throw new Error(HOLD_FAILED);
  }
  return item;
}

/** A count in words: "at least 4 documents" while it is a floor. */
function documentsWord(reach: RemovalHoldResult["reach"]): string {
  // A floor of none says nothing about how many there are.
  if (!reach.complete && reach.count === 0) {
    return "an unknown number of documents";
  }
  const noun = reach.count === 1 ? "document" : "documents";
  return reach.complete
    ? `${String(reach.count)} ${noun}`
    : `at least ${String(reach.count)} ${noun}`;
}

/** What the question says: the count told, and the count now. */
function recountWords(recount: Recount): string {
  const now =
    recount.confirmed === undefined
      ? `This component is placed directly in ${documentsWord(recount.reach)}.`
      : `When you removed its fields, this component was placed directly in ${documentsWord(recount.confirmed)}. It is now placed in ${documentsWord(recount.reach)}.`;
  return `${now} Publishing removes those fields, and every use that filled one in loses that value.`;
}

/** The question itself. */
function RemovalRecountDialog({
  recount,
  onAnswer,
}: {
  recount: Recount | null;
  onAnswer: (go: boolean) => void;
}): JSX.Element {
  return (
    <AlertDialog
      open={recount !== null}
      onOpenChange={open => {
        if (!open) onAnswer(false);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle className="flex items-start gap-2">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <span>More documents use this component now</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {recount === null ? "" : recountWords(recount)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-between">
          {/* The dialog's own cancel, so it takes the first focus: Enter
              never publishes, and closing answers "cancel". */}
          <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            // The deeper red the page builder's destructive confirmations share.
            className={DESTRUCTIVE_CONFIRM_CLASS}
            onClick={() => onAnswer(true)}
          >
            Publish and remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
