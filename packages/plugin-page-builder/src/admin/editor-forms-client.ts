"use client";

/**
 * The editor's side of its two form routes: the forms a Form block's
 * "Form: <pick a form>" lists, and one picked form as the canvas draws it.
 *
 * Both are read as the person editing. An answer is kept a short while, for
 * that person only: the panel and the canvas each ask on every draw of a
 * Form, and a form made or closed in another tab shows once the short while
 * is over. A read that fails is never kept.
 *
 * @module admin/editor-forms-client
 */
import { readPluginRoute } from "@nextlyhq/plugin-sdk/admin";

// The CONTRACT, not the route: the route reads the server's providers.
import {
  EDITOR_FORM_PARAMS,
  EDITOR_FORM_ROUTE_PATH,
  EDITOR_FORMS_ROUTE_PATH,
  type EditorFormProvider,
  type EditorFormResponse,
  type EditorFormsResponse,
} from "../forms/editor-forms-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";

/** How long one answer is kept, in milliseconds. */
export const EDITOR_FORMS_KEPT_MS = 15_000;

/** A form a block picked: its provider and the provider's reference. */
export interface PickedForm {
  readonly provider: string;
  readonly ref: string;
}

/** One kept answer, and when it was asked. */
interface Kept {
  readonly read: Promise<unknown>;
  readonly at: number;
}

const kept = new Map<string, Kept>();
let keptFor: string | null = null;

/**
 * `ask`'s answer for `key`, kept {@link EDITOR_FORMS_KEPT_MS} for `userId`.
 * Another person asking drops everything kept first; nobody known keeps
 * nothing.
 */
function keptAnswer<T>(
  userId: string | null,
  key: string,
  ask: () => Promise<T>
): Promise<T> {
  if (userId !== keptFor) {
    kept.clear();
    keptFor = userId;
  }
  if (userId === null) return ask();
  const held = kept.get(key);
  if (held !== undefined && Date.now() - held.at < EDITOR_FORMS_KEPT_MS) {
    return held.read as Promise<T>;
  }
  const read = ask();
  const entry: Kept = { read, at: Date.now() };
  kept.set(key, entry);
  read.catch(() => {
    if (kept.get(key) === entry) kept.delete(key);
  });
  return read;
}

/** Forget every kept answer: for tests, and for a person signing out. */
export function forgetEditorForms(): void {
  kept.clear();
  keptFor = null;
}

/** Whether `body` is the list route's answer. */
function isListAnswer(body: unknown): body is EditorFormsResponse {
  if (typeof body !== "object" || body === null) return false;
  const { providers } = body as Partial<EditorFormsResponse>;
  return (
    Array.isArray(providers) &&
    providers.every(
      (provider: Partial<EditorFormProvider>) =>
        typeof provider?.id === "string" &&
        typeof provider.label === "string" &&
        Array.isArray(provider.forms)
    )
  );
}

/** Whether `body` is the describe route's answer. */
function isFormAnswer(body: unknown): body is EditorFormResponse {
  if (typeof body !== "object" || body === null) return false;
  const { state } = body as { state?: unknown };
  if (state === "missing" || state === "closed") return true;
  if (state !== "published" && state !== "draft") return false;
  const { drawing } = body as { drawing?: { fields?: unknown } };
  return Array.isArray(drawing?.fields);
}

/**
 * Every provider the site has, with the forms this person may pick. Rejects
 * where they could not be read.
 */
export function readEditorForms(
  userId: string | null
): Promise<readonly EditorFormProvider[]> {
  return keptAnswer(userId, "list", async () => {
    const body = await readPluginRoute<EditorFormsResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: EDITOR_FORMS_ROUTE_PATH,
    });
    if (!isListAnswer(body)) throw new Error("Forms could not be listed.");
    return body.providers;
  });
}

/** The describe route's address for one form, in one language. */
export function editorFormPath(
  form: PickedForm,
  locale: string | undefined
): string {
  const query = new URLSearchParams({
    [EDITOR_FORM_PARAMS.provider]: form.provider,
    [EDITOR_FORM_PARAMS.ref]: form.ref,
  });
  if (locale !== undefined) query.set(EDITOR_FORM_PARAMS.locale, locale);
  return `${EDITOR_FORM_ROUTE_PATH}?${query.toString()}`;
}

/**
 * One picked form as this person sees it on the canvas. Rejects where it
 * could not be read, which is never answered as a deleted form.
 */
export function readEditorForm(
  form: PickedForm,
  locale: string | undefined,
  userId: string | null
): Promise<EditorFormResponse> {
  const path = editorFormPath(form, locale);
  return keptAnswer(userId, path, async () => {
    const body = await readPluginRoute<EditorFormResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path,
    });
    if (!isFormAnswer(body)) throw new Error("The form could not be read.");
    return body;
  });
}
