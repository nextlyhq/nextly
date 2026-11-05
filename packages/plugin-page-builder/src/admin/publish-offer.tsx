"use client";

/**
 * The question asked before a publish that would leave a page's components or
 * Layout unpublished: publish the page only, or publish them too.
 *
 * It never blocks. "Publish page only" is the leading choice, because
 * publishing a page before its parts is an ordinary order of work; the dialog
 * makes sure the author knows what visitors will see. "Publish both" (or
 * "Publish all") is offered only for documents this author may publish, and
 * each is published as them: one they cannot publish is named with the reason
 * and left as it is. Cancel, Esc and a click outside call the publish off,
 * which leaves the save state unchanged.
 *
 * Asked from the action runner's before-action hook, so every way of
 * publishing asks it, from the top bar, the menu or a plugin's `run`. A check
 * that cannot be made publishes as before: the server still says afterwards
 * what went live without its parts. An edit made while the server answers is
 * asked about too, before the publish goes ahead.
 *
 * @module admin/publish-offer
 */
import {
  useBeforeDocumentAction,
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
  Checkbox,
  toast,
} from "@nextlyhq/ui";
import { Component, PanelsTopLeft, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
} from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  MAX_PUBLISHED_DEPENDENCIES,
  PUBLISH_DEPENDENCIES_ROUTE_PATH,
  PUBLISH_READINESS_ROUTE_PATH,
  type PublishDependenciesRequest,
  type PublishDependenciesResult,
  type PublishReadinessRequest,
  type PublishReadinessResponse,
  type UnpublishedDependency,
} from "../publish-readiness-contract";

/** What is being published, in the words the dialog uses for it. */
export type PublishSubject = "page" | "component" | "Layout";

/** The author's answer. */
export type PublishChoice =
  | { kind: "cancel" }
  | { kind: "only" }
  | { kind: "with"; dependencies: readonly UnpublishedDependency[] };

/** What the hook is asked about, read when a publish starts. */
export interface PublishOfferInput {
  /** The block documents the publish will store. */
  readonly documents: () => readonly unknown[];
  /** The Layout the page names, or null. */
  readonly layout: string | null;
  /** Whether the page is drawn inside the site's default Layout instead. */
  readonly siteDefault?: boolean;
  readonly subject: PublishSubject;
  /**
   * Whether this surface asks. False for every blocks field of a form but
   * the one that asks for all of them (see `useFormPublishOffer`).
   */
  readonly enabled?: boolean;
}

/** The action ids that put the document live. */
const PUBLISHING_ACTIONS: ReadonlySet<string> = new Set(["publish"]);

/**
 * How many times one publish asks, the draft having changed while it was
 * asked about. A draft still changing after this many is refused rather than
 * published unasked.
 */
const MAX_ASKS = 3;

/** The readiness request for the draft as it is now. */
function readinessRequest(input: PublishOfferInput): PublishReadinessRequest {
  return {
    documents: input.documents(),
    layout: input.layout,
    // Sent only when it applies, so a request names what it asks about.
    ...(input.siteDefault === true ? { siteDefault: true } : {}),
  };
}

/**
 * Ask before a publish, and return the dialog that asks.
 *
 * The returned element renders nothing until a publish needs the question;
 * place it anywhere inside the document editor.
 */
export function usePublishOffer(input: PublishOfferInput): JSX.Element {
  const [question, setQuestion] = useState<{
    readiness: PublishReadinessResponse;
    answer: (choice: PublishChoice) => void;
  } | null>(null);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  /**
   * Put the question, when the answer calls for one: the author's choice, or
   * null when there was nothing to ask.
   */
  const ask = async (
    readiness: PublishReadinessResponse | null
  ): Promise<PublishChoice | null> => {
    if (
      readiness === null ||
      (readiness.dependencies.length === 0 && readiness.missing === 0)
    ) {
      return null;
    }
    const choice = await new Promise<PublishChoice>(answer => {
      setQuestion({ readiness, answer });
    });
    setQuestion(null);
    if (choice.kind === "cancel") {
      throw new DOMException("Publishing was cancelled.", "AbortError");
    }
    return choice;
  };

  useBeforeDocumentAction(async (action, store) => {
    if (!PUBLISHING_ACTIONS.has(action)) return;
    const { subject, enabled } = latest.current;
    if (enabled === false) return;
    // The form stays editable while the server answers, and the store writes
    // the draft as it is when it writes: an edit made meanwhile was not asked
    // about, so the draft is asked about again until the answer is about the
    // one stored.
    for (let asked = 0; asked < MAX_ASKS; asked++) {
      const request = readinessRequest(latest.current);
      const askedAbout = JSON.stringify(request);
      const unchanged = () =>
        JSON.stringify(readinessRequest(latest.current)) === askedAbout;
      const readiness = await askReadiness(request);
      // An answer about a draft since edited is not put to the author.
      if (!unchanged()) continue;
      const choice = await ask(readiness);
      // Nothing goes live for a store a failed write will refuse: the page
      // would stay as it was while its parts went live without it.
      if (!(await store.writesSettled())) return;
      // Compared before any part is published, so a draft asked about again,
      // or refused, has put nothing live without its page.
      if (!unchanged()) continue;
      if (choice?.kind === "with" && readiness !== null) {
        const result = await publishChosen(choice.dependencies);
        reportLeftUnpublished(result, readiness, subject);
      }
      // Made again just before the write, after the handlers that run after
      // this one and the writes the store waits for: a change in that time
      // runs this again, about the draft as it is.
      store.checkBeforeWrite(unchanged);
      return;
    }
    throw new Error(
      `This ${subject} kept changing while it was checked, so it wasn't published. Publish again once you've finished editing.`
    );
  });

  return (
    <PublishOfferDialog
      readiness={question?.readiness ?? null}
      subject={input.subject}
      onAnswer={choice => question?.answer(choice)}
    />
  );
}

/**
 * The readiness answer, or null when it could not be had. A failed check is
 * not a reason to stop a publish: the after-publish notice still reports a
 * page that went live without its parts.
 */
export async function askReadiness(
  request: PublishReadinessRequest
): Promise<PublishReadinessResponse | null> {
  try {
    const answer = await writePluginRoute<PublishReadinessResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: PUBLISH_READINESS_ROUTE_PATH,
      body: request,
    });
    // An answer without its list is not one to act on: publishing goes ahead
    // as it would have without the question.
    return Array.isArray(answer?.dependencies) ? answer : null;
  } catch {
    return null;
  }
}

/**
 * Publish the chosen documents, as the author. A request that fails outright
 * refuses the publish: the author asked for the page and its parts together,
 * and putting the page live alone would not be what they chose.
 */
export async function publishChosen(
  dependencies: readonly UnpublishedDependency[]
): Promise<PublishDependenciesResult> {
  const published: PublishDependenciesResult["published"][number][] = [];
  const refused: PublishDependenciesResult["refused"][number][] = [];
  // In batches the route accepts, in order, so each still goes live after
  // the parts it places.
  for (let at = 0; at < dependencies.length; at += MAX_PUBLISHED_DEPENDENCIES) {
    const batch = dependencies.slice(at, at + MAX_PUBLISHED_DEPENDENCIES);
    let answer: { item: PublishDependenciesResult } | undefined;
    try {
      answer = await writePluginRoute<{ item: PublishDependenciesResult }>({
        plugin: PAGE_BUILDER_PLUGIN_NAME,
        path: PUBLISH_DEPENDENCIES_ROUTE_PATH,
        body: {
          dependencies: batch.map(({ kind, id }) => ({ kind, id })),
        } satisfies PublishDependenciesRequest,
      });
    } catch (error) {
      const why =
        error instanceof Error ? error.message : "the request failed.";
      throw new Error(
        published.length === 0
          ? `Nothing was published: ${why} Try again, or publish the page only.`
          : `${String(published.length)} were published and the rest weren't: ${why} Try again to publish the rest, or publish the page only.`,
        { cause: error }
      );
    }
    published.push(...(answer?.item.published ?? []));
    refused.push(...(answer?.item.refused ?? []));
  }
  return { published, refused };
}

/**
 * The blocks fields of each form, by name, each with a read of its value, so
 * one Publish asks one question about all of them.
 */
interface FormFields {
  readonly values: Map<string, () => unknown>;
  readonly listeners: Set<() => void>;
}

const formFields = new WeakMap<object, FormFields>();

function fieldsOf(form: object): FormFields {
  let fields = formFields.get(form);
  if (fields === undefined) {
    fields = { values: new Map(), listeners: new Set() };
    formFields.set(form, fields);
  }
  return fields;
}

/**
 * The publish question for a blocks field on an entry form.
 *
 * A form may hold several blocks fields, and each mounts this. They register
 * with their form, and the first registered asks, once, about all of their
 * documents; the others render nothing and let the publish through. A
 * question per field would show a part once per field, and cancelling a later
 * one could leave parts an earlier one published live beside a draft.
 */
export function useFormPublishOffer(input: {
  /** The form, the same object for every field on it (its `control`). */
  readonly form: object;
  readonly name: string;
  readonly value: () => unknown;
  readonly layout: string | null;
  readonly siteDefault?: boolean;
  readonly subject: PublishSubject;
}): JSX.Element {
  const fields = fieldsOf(input.form);
  const value = useRef(input.value);
  useEffect(() => {
    value.current = input.value;
  });
  useEffect(() => {
    fields.values.set(input.name, () => value.current());
    for (const listener of fields.listeners) listener();
    return () => {
      fields.values.delete(input.name);
      for (const listener of fields.listeners) listener();
    };
  }, [fields, input.name]);
  const asking = useSyncExternalStore(
    listener => {
      fields.listeners.add(listener);
      return () => fields.listeners.delete(listener);
    },
    () => fields.values.keys().next().value === input.name,
    // On the server no field has registered yet, and none asks; the client
    // elects the first once its effects run.
    () => false
  );
  return usePublishOffer({
    documents: () => [...fields.values.values()].map(read => read()),
    layout: input.layout,
    ...(input.siteDefault === undefined
      ? {}
      : { siteDefault: input.siteDefault }),
    subject: input.subject,
    enabled: asking,
  });
}

/** Say which documents the author asked for stayed unpublished, and why. */
export function reportLeftUnpublished(
  result: PublishDependenciesResult,
  readiness: PublishReadinessResponse,
  subject: PublishSubject
): void {
  if (result.refused.length === 0) return;
  const named = new Map(
    readiness.dependencies.map(entry => [`${entry.kind}:${entry.id}`, entry])
  );
  const lines = result.refused.map(refusal => {
    const entry = named.get(`${refusal.kind}:${refusal.id}`);
    return `${entry === undefined ? "One" : nameOf(entry)}: ${refusal.reason}`;
  });
  toast.warning(
    result.refused.length === 1
      ? `1 wasn't published with this ${subject}`
      : `${String(result.refused.length)} weren't published with this ${subject}`,
    { description: lines.join(" "), duration: 10_000 }
  );
}

/** A dependency as the dialog names it. */
function nameOf(entry: UnpublishedDependency): string {
  if (entry.title !== null) return entry.title;
  return entry.kind === "layout"
    ? "A Layout you can't view"
    : "A component you can't view";
}

/** Why the dialog will not publish an entry, or null when it may. */
function withheldBecause(entry: UnpublishedDependency): string | null {
  if (entry.mayPublish) return null;
  if (entry.title === null) return "You can't view it";
  return entry.kind === "layout"
    ? "You can't publish Layouts"
    : "You can't publish components";
}

/** The dialog's heading for what the page needs. */
function headingFor(
  readiness: PublishReadinessResponse,
  subject: PublishSubject
): string {
  const components = readiness.dependencies.filter(
    entry => entry.kind === "component"
  ).length;
  const layout = readiness.dependencies.some(entry => entry.kind === "layout");
  if (components === 0 && !layout) {
    return readiness.missing === 1
      ? `This ${subject} uses a component that no longer exists`
      : `This ${subject} uses components that no longer exist`;
  }
  if (components === 0) return `This ${subject}'s Layout isn't published`;
  const noun =
    components === 1 ? "1 component" : `${String(components)} components`;
  return layout
    ? `This ${subject}'s Layout and ${noun} aren't published`
    : `This ${subject} uses ${noun} that ${
        components === 1 ? "isn't" : "aren't"
      } published`;
}

/** What visitors will see meanwhile. */
function consequenceFor(
  readiness: PublishReadinessResponse,
  subject: PublishSubject
): string {
  const layout = readiness.dependencies.some(entry => entry.kind === "layout");
  const components = readiness.dependencies.some(
    entry => entry.kind === "component"
  );
  const parts = [
    components
      ? `Visitors see nothing where an unpublished component sits until it's published.`
      : null,
    layout
      ? `Until its Layout is published, the ${subject} is shown inside the site's default Layout.`
      : null,
    readiness.missing > 0
      ? `${
          readiness.missing === 1
            ? "A component it places no longer exists"
            : `${String(readiness.missing)} components it places no longer exist`
        }, so nothing shows there.`
      : null,
  ];
  return parts.filter(part => part !== null).join(" ");
}

/**
 * The dialog. Exported for its tests and for the default-Layout choice, which
 * asks the same question before a Layout goes site-wide.
 */
export function PublishOfferDialog({
  readiness,
  subject,
  onAnswer,
  onlyLabel,
  withLabel,
}: {
  readiness: PublishReadinessResponse | null;
  subject: PublishSubject;
  onAnswer: (choice: PublishChoice) => void;
  /** The leading choice's words; "Publish {subject} only" by default. */
  onlyLabel?: string;
  /** The offer's words, given how many it would publish. */
  withLabel?: (count: number) => string;
}): JSX.Element {
  const listId = useId();
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  // A new question starts with everything the author may publish chosen.
  useEffect(() => {
    setUnchecked(new Set());
  }, [readiness]);

  // Published deepest first, but listed in the order the page places them:
  // the server's order reversed, with a Layout, which wraps the page, last.
  const publishOrder = readiness?.dependencies ?? [];
  const entries = [
    ...publishOrder.filter(entry => entry.kind === "component").reverse(),
    ...publishOrder.filter(entry => entry.kind === "layout"),
  ];
  const keyOf = (entry: UnpublishedDependency) => `${entry.kind}:${entry.id}`;
  const offered = publishOrder.filter(entry => entry.mayPublish);
  const chosen = offered.filter(entry => !unchecked.has(keyOf(entry)));
  const offerWords =
    withLabel ??
    ((count: number) =>
      count === 1 ? "Publish both" : `Publish all ${String(count + 1)}`);

  return (
    <AlertDialog
      open={readiness !== null}
      onOpenChange={open => {
        if (!open) onAnswer({ kind: "cancel" });
      }}
    >
      <AlertDialogContent className="max-w-lg">
        {/* Left-aligned at every width, so the icon and the list below sit
            on one edge. */}
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle className="flex items-start gap-2">
            <TriangleAlert
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <span>
              {readiness === null ? "" : headingFor(readiness, subject)}
            </span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            {readiness === null ? "" : consequenceFor(readiness, subject)}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {entries.length === 0 ? null : (
          <ul
            id={listId}
            aria-label="Not published"
            className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border"
          >
            {entries.map(entry => {
              const key = keyOf(entry);
              const withheld = withheldBecause(entry);
              const checkboxId = `${listId}-${key}`;
              const Icon = entry.kind === "layout" ? PanelsTopLeft : Component;
              return (
                <li key={key} className="flex items-center gap-3 px-3 py-2">
                  {withheld === null ? (
                    <Checkbox
                      id={checkboxId}
                      checked={!unchecked.has(key)}
                      onCheckedChange={checked => {
                        setUnchecked(previous => {
                          const next = new Set(previous);
                          if (checked === true) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                    />
                  ) : (
                    <span aria-hidden className="size-4 shrink-0" />
                  )}
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <label
                    htmlFor={withheld === null ? checkboxId : undefined}
                    // Wrapped rather than cut off: a long title is read whole.
                    className="min-w-0 flex-1 text-sm break-words"
                  >
                    {nameOf(entry)}
                    <span className="sr-only">
                      {entry.kind === "layout" ? ", Layout" : ", component"}
                    </span>
                  </label>
                  {withheld === null ? null : (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {withheld}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <AlertDialogFooter className="gap-2 sm:justify-between">
          {/* The dialog's own cancel, so it takes the first focus: Enter
              never publishes, and closing answers "cancel" through
              `onOpenChange`. */}
          <AlertDialogCancel className="mt-0">Cancel</AlertDialogCancel>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {offered.length === 0 ? null : (
              <Button
                type="button"
                variant="outline"
                disabled={chosen.length === 0}
                onClick={() => onAnswer({ kind: "with", dependencies: chosen })}
              >
                {offerWords(chosen.length)}
              </Button>
            )}
            <Button type="button" onClick={() => onAnswer({ kind: "only" })}>
              {onlyLabel ?? `Publish ${subject} only`}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
