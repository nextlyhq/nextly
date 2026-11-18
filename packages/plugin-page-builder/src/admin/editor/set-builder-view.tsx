"use client";

/**
 * A header & footer set in the builder: the screen the admin draws at
 * `/admin/collections/<sets>/<id>/in-builder`. The set's header and footer
 * are drawn around a grey placeholder where any page goes, and with nothing
 * selected the right panel shows the set's settings. Clicking the header or
 * the footer selects it and edits it in place, as on a page.
 *
 * The admin holds everything around it, as for a page: the set's form, its
 * lock, the recovery offer, the leave guard and saving. The settings write
 * the form, so the top bar's Save stores them as the set's draft and Publish
 * publishes them, asking first how many pages that changes. The placeholder
 * is the editor's own, never part of the set: no edit reaches it.
 *
 * Back returns to the page the set was opened from, which its address names
 * (`set-address.ts`); opened from anywhere else, to the sets' list.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/set-builder-view
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import {
  navigateTo,
  useBeforeDocumentAction,
  useDocumentOpensIn,
  type DocumentViewProps,
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
import { useEffect, useMemo, useRef, useState, type JSX } from "react";

import { BlocksEditor } from "./BlocksEditor";
import { BuilderStartup } from "./builder-startup";
import {
  openDocument,
  returnFromSearch,
  returnLabelFromSearch,
} from "./edit-component";
import { useSetStanding } from "./set-reads";
import type { SetMode } from "./set-regions";
import { publishToWords } from "./set-words";

/**
 * The page a set's screen edits: none of its own. Empty, so the canvas
 * draws only the set's header and footer around its placeholder.
 */
const PLACEHOLDER_PAGE: BlockDocument = {
  formatVersion: 1,
  kind: "page",
  nodes: [],
};

/** The kinds the placeholder is read as. */
const PAGE_KINDS = ["page"] as const;

/**
 * Where the editor's page is said to live in the set's form: a name no field
 * of a set holds, so nothing of the placeholder is ever read from the form
 * or handed to it. The editor commits nothing (`ignoreCommit`) either way.
 */
const PLACEHOLDER_FIELD = "__setPage";

/** The editor's commit of its page, which a set has none of. */
function ignoreCommit(): void {}

/**
 * Back's words and where it goes: the page the set was opened from, as its
 * address names it, loaded afresh as another document is; else the sets'
 * list, as the admin names it.
 */
function useBack(): { label: string; go: () => void } | undefined {
  const [from] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : {
          address: returnFromSearch(window.location.search),
          label: returnLabelFromSearch(window.location.search),
        }
  );
  const list = useDocumentOpensIn()?.list;
  return useMemo(() => {
    const back = from?.address;
    if (back !== undefined) {
      return {
        label: `Back to ${from?.label ?? "the page"}`,
        go: () => openDocument(back),
      };
    }
    if (list === undefined) return undefined;
    return {
      label: `Back to ${list.label}`,
      go: () => navigateTo(list.address),
    };
  }, [from, list]);
}

/**
 * Asked before the set is published, from any control: how many pages the
 * publish changes, "Publish to N pages?". A set no page uses changes none,
 * so it is published at once. Answered no, the publish is called off.
 */
function useSetPublishQuestion(set: SetMode): JSX.Element {
  const standing = useSetStanding(set.id);
  const latest = useRef(standing.pages);
  useEffect(() => {
    latest.current = standing.pages;
  });
  const [question, setQuestion] = useState<{
    answer: (go: boolean) => void;
  } | null>(null);
  useBeforeDocumentAction(async action => {
    if (action !== "publish") return;
    const pages = latest.current;
    if (pages !== undefined && pages.pages === 0 && !pages.floor) return;
    const go = await new Promise<boolean>(resolve => {
      setQuestion({ answer: resolve });
    }).finally(() => setQuestion(null));
    if (!go) {
      throw new DOMException("Publishing was cancelled.", "AbortError");
    }
  });
  const asking = question !== null;
  const { reread } = standing;
  // Counted again as the question opens, once, so it says how many pages
  // now.
  useEffect(() => {
    if (asking) reread();
  }, [asking, reread]);
  const words = publishToWords(standing.pages);
  return (
    <AlertDialog
      open={question !== null}
      onOpenChange={next => {
        if (!next) question?.answer(false);
      }}
    >
      <AlertDialogContent className="max-w-md" data-set-publish="">
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle>{words}</AlertDialogTitle>
          <AlertDialogDescription>
            Every page that uses this header & footer set shows its header and
            footer as published here, as soon as you publish.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
          <Button type="button" onClick={() => question?.answer(true)}>
            {words.replace(/\?$/, "")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The set's screen, once its id is known. */
function SetEditor({
  set,
  control,
  exit,
}: {
  set: SetMode;
  control: DocumentViewProps["control"];
  exit: () => void;
}): JSX.Element {
  const back = useBack();
  const publishQuestion = useSetPublishQuestion(set);
  return (
    <>
      {/* First, so the reads the editor asks as it mounts find it sent. */}
      <BuilderStartup />
      <BlocksEditor
        initialValue={PLACEHOLDER_PAGE}
        kinds={PAGE_KINDS}
        onCommit={ignoreCommit}
        onClose={exit}
        back={back}
        name={PLACEHOLDER_FIELD}
        control={control}
        set={set}
      />
      {publishQuestion}
    </>
  );
}

export function SetBuilderView({
  control,
  exit,
  entryId,
  readOnly,
}: DocumentViewProps): JSX.Element | null {
  const set = useMemo(
    () => (entryId === undefined ? undefined : { id: entryId, readOnly }),
    [entryId, readOnly]
  );
  // A set not saved yet has no screen here: the admin opens its form.
  if (set === undefined) return null;
  return <SetEditor set={set} control={control} exit={exit} />;
}
