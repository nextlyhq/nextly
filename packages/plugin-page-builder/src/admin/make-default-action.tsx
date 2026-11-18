"use client";

/**
 * "Make site default" on the Header & footer list: the one place a person
 * chooses the set every page that names none is drawn inside.
 *
 * Each published set's row offers **Make site default**, except the default
 * itself; a set that is not published offers **Publish it, then make
 * default**, since only a published set can be the default. Both are offered
 * only to someone the make-default route admits (the site permission and the
 * rights to update and publish sets), as the Site settings read reports it;
 * the route judges every request again on its own.
 *
 * A published set whose header or footer places components that are not
 * published asks first, as publishing a page does: make it the default
 * anyway, or publish them, then make it the default. A set being made the
 * default after it is published publishes its own unpublished parts with it.
 *
 * Row actions are descriptions, not components, so the tools drawn above the
 * list (`LayoutListTools`) register them and draw the question for the row
 * chosen.
 *
 * @module admin/make-default-action
 */
import {
  registerRowAction,
  usePluginRoute,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { toast } from "@nextlyhq/ui";
import { useQueryClient } from "@tanstack/react-query";
import { PanelsTopLeft, Send } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_SETTINGS_ROUTE_PATH,
  type SiteSettingsRead,
} from "../library-contract";
import type {
  PublishReadinessResponse,
  UnpublishedDependency,
} from "../publish-readiness-contract";

import { lazyPart, withEditorStylesheet } from "./lazy-part";
import {
  askReadiness,
  publishChosen,
  PublishOfferDialog,
  reportLeftUnpublished,
  type PublishChoice,
} from "./publish-offer";
import type { TransferImport as TransferImportPart } from "./transfer-import";

/*
 * Import from file is fetched when drawn, with the editor's stylesheet it is
 * styled by, as above the other lists: this module carries none of it until
 * the list is shown.
 */
const TransferImport: typeof TransferImportPart = lazyPart(() =>
  withEditorStylesheet(import("./transfer-import")).then(m => m.TransferImport)
);

/** The row actions' ids on the Header & footer list. */
const MAKE_DEFAULT_ACTION_ID = "page-builder-make-site-default";
const PUBLISH_THEN_DEFAULT_ACTION_ID = "page-builder-publish-then-make-default";

/** The set a row action was chosen on. */
export interface MakeDefaultAsked {
  readonly id: string;
  readonly title: string;
  readonly published: boolean;
}

/** How the flow asks the author, and is told the answer. */
type Ask = (readiness: PublishReadinessResponse) => Promise<PublishChoice>;

/**
 * What the flow reaches outside itself: the question it may ask, and what it
 * reports once a publish has written something, so the list showing the sets
 * can read their new status whatever happens after.
 */
interface MakeDefaultFlow {
  readonly ask: Ask;
  readonly published: () => void;
}

/** What a refusal says, past the route's own words where it gives none. */
function refusalOf(error: unknown): string {
  if ((error as { status?: unknown } | null)?.status === 403) {
    return "Making a header & footer set the site default needs the rights to manage the site's settings and to update and publish header & footer sets.";
  }
  return error instanceof Error && error.message !== ""
    ? error.message
    : "The site default could not be changed. Try again.";
}

/** Make the set the default, through the one route that may. */
async function makeDefault(asked: MakeDefaultAsked): Promise<boolean> {
  try {
    await writePluginRoute({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: `/layouts/${encodeURIComponent(asked.id)}/make-default`,
      body: {},
    });
  } catch (error) {
    toast.error(refusalOf(error));
    return false;
  }
  toast.success(`${asked.title} is now the site default header & footer.`);
  return true;
}

/**
 * Publish what was chosen, then make the set the default, unless publishing
 * refused the set itself: an unpublished set cannot be the default.
 */
async function publishThenMakeDefault(
  asked: MakeDefaultAsked,
  chosen: readonly UnpublishedDependency[],
  readiness: PublishReadinessResponse,
  published: () => void
): Promise<boolean> {
  let result: Awaited<ReturnType<typeof publishChosen>>;
  try {
    result = await publishChosen(chosen);
  } catch (error) {
    toast.error(refusalOf(error));
    return false;
  }
  // Reported before the set is made the default: a publish that landed has
  // changed the rows' status even when making the default is then refused.
  published();
  const own = result.refused.find(
    refusal => refusal.kind === "layout" && refusal.id === asked.id
  );
  if (own !== undefined) {
    toast.error(`${asked.title} wasn't published: ${own.reason}`);
    return false;
  }
  reportLeftUnpublished(result, readiness, "header & footer set");
  return makeDefault(asked);
}

/**
 * The whole of "Make site default" for one set, answering whether it is now
 * the default.
 */
async function makeSiteDefault(
  asked: MakeDefaultAsked,
  flow: MakeDefaultFlow
): Promise<boolean> {
  const readiness = await askReadiness({ documents: [], layout: asked.id });
  // Not published: "Publish it, then make default" says what it does, so it
  // publishes the set and the parts of it this author may publish, unasked.
  if (!asked.published) {
    const own: UnpublishedDependency = {
      kind: "layout",
      id: asked.id,
      title: asked.title,
      mayPublish: true,
    };
    // The set itself always, whatever readiness reports: a readiness check
    // turned off answers no dependencies at all, and a publish without the
    // set would leave it a draft the default cannot be.
    const parts = (readiness?.dependencies ?? []).filter(
      entry =>
        entry.mayPublish && !(entry.kind === "layout" && entry.id === asked.id)
    );
    return publishThenMakeDefault(
      asked,
      [...parts, own],
      readiness ?? { dependencies: [own], missing: 0 },
      flow.published
    );
  }
  if (
    readiness === null ||
    (readiness.dependencies.length === 0 && readiness.missing === 0)
  ) {
    return makeDefault(asked);
  }
  const choice = await flow.ask(readiness);
  if (choice.kind === "cancel") return false;
  if (choice.kind === "only") return makeDefault(asked);
  return publishThenMakeDefault(
    asked,
    choice.dependencies,
    readiness,
    flow.published
  );
}

/** A row's id, by dialect a string or a number, or null for none. */
function rowId(row: Record<string, unknown>): string | null {
  if (typeof row.id === "string" && row.id !== "") return row.id;
  if (typeof row.id === "number") return String(row.id);
  return null;
}

/** The set a row is, as the flow is asked about it. */
function askedOf(row: Record<string, unknown>): MakeDefaultAsked | null {
  const id = rowId(row);
  if (id === null) return null;
  const title =
    typeof row.title === "string" && row.title.trim() !== "" ? row.title : id;
  return { id, title, published: row.status === "published" };
}

/**
 * Register the two row actions on the list keyed `listSlug` while `may`
 * holds, hiding "Make site default" on the current default's row.
 */
function useMakeDefaultActions(
  listSlug: string,
  may: boolean,
  current: string | null,
  start: (asked: MakeDefaultAsked) => void
): void {
  useEffect(() => {
    if (!may || listSlug === "") return;
    const removeMake = registerRowAction<Record<string, unknown>>(listSlug, {
      id: MAKE_DEFAULT_ACTION_ID,
      label: "Make site default",
      icon: <PanelsTopLeft className="h-4 w-4" aria-hidden="true" />,
      isVisible: row => {
        const asked = askedOf(row);
        return asked !== null && asked.published && asked.id !== current;
      },
      onSelect: row => {
        const asked = askedOf(row);
        if (asked !== null) start(asked);
      },
    });
    const removePublish = registerRowAction<Record<string, unknown>>(listSlug, {
      id: PUBLISH_THEN_DEFAULT_ACTION_ID,
      label: "Publish it, then make default",
      icon: <Send className="h-4 w-4" aria-hidden="true" />,
      isVisible: row => {
        const asked = askedOf(row);
        return asked !== null && !asked.published;
      },
      onSelect: row => {
        const asked = askedOf(row);
        if (asked !== null) start(asked);
      },
    });
    return () => {
      removeMake();
      removePublish();
    };
  }, [listSlug, may, current, start]);
}

/**
 * The whole "Make site default" flow for a set, as one start and the
 * question it may ask: shared by the Header & footer list's row actions and
 * the builder's Pages panel, so both ask the same question and make the same
 * writes.
 *
 * @param on.published - after a publish the flow made, whatever follows
 * @param on.made - after the set became the default
 */
export function useMakeDefaultFlow(on: {
  readonly published: () => void;
  readonly made: () => void;
}): {
  readonly start: (asked: MakeDefaultAsked) => void;
  readonly dialog: JSX.Element;
} {
  const [question, setQuestion] = useState<{
    readiness: PublishReadinessResponse;
    answer: (choice: PublishChoice) => void;
  } | null>(null);
  const onLatest = useLatest(on);
  // One function for as long as the caller is shown, so a list's actions are
  // registered once per change of who may and which set is the default.
  const [start] = useState(() => (asked: MakeDefaultAsked) => {
    void makeSiteDefault(asked, {
      ask: readiness =>
        new Promise<PublishChoice>(resolve => {
          setQuestion({ readiness, answer: resolve });
        }),
      published: () => onLatest.current.published(),
    }).then(made => {
      if (made) onLatest.current.made();
    });
  });
  const dialog = (
    <PublishOfferDialog
      readiness={question?.readiness ?? null}
      subject="header & footer set"
      onAnswer={choice => {
        question?.answer(choice);
        setQuestion(null);
      }}
      onlyLabel="Make default anyway"
      withLabel={count =>
        count === 1
          ? "Publish it, then make default"
          : `Publish ${String(count)}, then make default`
      }
    />
  );
  return { start, dialog };
}

/**
 * Above the Header & footer list: the "Make site default" row actions, and
 * the question a set with unpublished parts asks before it becomes the
 * default. `collectionSlug` is the list's own, renamed or not.
 */
export function MakeDefaultListTools({
  collectionSlug,
}: {
  readonly collectionSlug?: string;
}): JSX.Element {
  const read = usePluginRoute<SiteSettingsRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_SETTINGS_ROUTE_PATH,
    staleTime: 0,
  });
  const queryClient = useQueryClient();
  const { start, dialog } = useMakeDefaultFlow({
    // The list's own entries read, which a plugin route's write leaves as it
    // was: invalidated after a publish, so the published set's row shows its
    // new status and stops offering to publish it.
    published: () => {
      void queryClient.invalidateQueries({
        queryKey: ["entries", "list", collectionSlug ?? ""],
      });
    },
    // The new default's row no longer offers to become it.
    made: () => read.refetch(),
  });
  useMakeDefaultActions(
    collectionSlug ?? "",
    read.data?.mayChooseDefaultLayout === true,
    read.data?.defaultLayout ?? null,
    start
  );
  return dialog;
}

/** The newest `value`, read later without re-subscribing to it. */
function useLatest<T>(value: T): { readonly current: T } {
  const [box] = useState(() => ({ current: value }));
  useEffect(() => {
    box.current = value;
  });
  return box;
}

/**
 * Above the plugin's own Header & footer list: Import from file, as on the
 * Components and Saved sections lists, and the "Make site default" tools.
 */
export function LayoutListTools({
  collectionSlug,
}: {
  readonly collectionSlug?: string;
}): JSX.Element {
  return (
    <>
      <TransferImport />
      <MakeDefaultListTools
        {...(collectionSlug === undefined ? {} : { collectionSlug })}
      />
    </>
  );
}
