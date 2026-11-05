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
import { useEffect, useRef, useState, type JSX } from "react";

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

/** What the hook reads when a publish starts. */
export interface RemovalHoldInput {
  /** The document the publish stores. */
  readonly document: () => BlockDocument;
  /** How many documents placing it the removal dialog said, if it said one. */
  readonly confirmed: () => RemovalHoldResult["reach"] | undefined;
}

/** The question shown when the count has grown. */
interface Recount {
  /** The count the designer was told, or `undefined` where none was said. */
  readonly confirmed: RemovalHoldResult["reach"] | undefined;
  readonly reach: RemovalHoldResult["reach"];
}

/** How many times a grown count is asked about before giving up. */
const MAX_ASKS = 3;

/** Said when the hold cannot be had, so the publish is refused. */
export const HOLD_FAILED =
  "This component wasn’t published: how many documents lose the removed fields’ values couldn’t be checked. Try again.";

/** Said when the count kept growing while the designer was asked. */
const HOLD_MOVING =
  "This component wasn’t published: the documents placing it kept changing. Try again in a moment.";

/** The action ids that put the document live. */
const PUBLISHING_ACTIONS: ReadonlySet<string> = new Set(["publish"]);

/**
 * Hold a publish that removes fields, and return the dialog that asks again.
 * Renders nothing until a count has grown; place it inside the editor.
 */
export function useRemovalHold(input: RemovalHoldInput): JSX.Element {
  const identity = useDocumentIdentity();
  const locale = useDocumentLocale();
  const [question, setQuestion] = useState<{
    recount: Recount;
    answer: (go: boolean) => void;
  } | null>(null);
  const latest = useRef({ input, id: identity?.documentId, locale });
  useEffect(() => {
    latest.current = { input, id: identity?.documentId, locale };
  });

  useBeforeDocumentAction(async action => {
    if (!PUBLISHING_ACTIONS.has(action)) return;
    const { input: current, id, locale: language } = latest.current;
    const document = current.document();
    if (id === undefined || !isComponentDocument(document)) return;
    const removed = await removedIds(id, document, language?.code ?? undefined);
    if (removed.properties.length === 0 && removed.slots.length === 0) return;
    // None said is asked about as nothing confirmed: any document placing
    // the component is then one the designer has not been told of.
    let said = current.confirmed();
    for (let ask = 0; ask < MAX_ASKS; ask += 1) {
      const answer = await askHold({
        id,
        ...removed,
        confirmed: said?.count ?? 0,
      });
      if (answer.kind === "held") return;
      const confirmed = said;
      const go = await new Promise<boolean>(resolve => {
        setQuestion({
          recount: { confirmed, reach: answer.reach },
          answer: resolve,
        });
      });
      setQuestion(null);
      if (!go)
        throw new DOMException("Publishing was cancelled.", "AbortError");
      said = answer.reach;
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
  return `${now} Publishing removes those fields, and every use of it that set one loses its value.`;
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
            onClick={() => onAnswer(true)}
          >
            Publish and remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
