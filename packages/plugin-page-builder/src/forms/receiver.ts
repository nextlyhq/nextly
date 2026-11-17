/**
 * The one place every form on the site posts to.
 *
 * A post is checked in this order, each step before any work it guards:
 *
 * 1. A browser saying the post comes from another site is refused, so a
 *    page elsewhere cannot make its visitors' browsers send through a form
 *    here, each with an allowance of its own.
 * 2. Its size and its number of fields are capped before anything is parsed
 *    from it.
 * 3. A filled spam trap is answered exactly as a success, and the post goes
 *    no further: nothing is read, counted, delivered or stored.
 * 4. Sends per visitor address are limited, in the deployment's shared limit
 *    store, before the form is read.
 * 5. The form is read from the PUBLISHED document the post names, by its
 *    node; the browser names which form, never what the form is.
 * 6. A form picked from a provider is handed to it, trimmed to the fields
 *    it describes; a simple form's answers are checked against its own
 *    fields and passed on to its "Send to" address, and stored nowhere.
 *
 * Every answer is a `303` back to a path of the same site, with the outcome
 * in the fragment (`#form-<id>-sent`, `-invalid`, `-closed` or `-error`), so
 * the page that is shown again is the same cacheable page and needs no
 * script to say what happened. A return address that is not a same-site path
 * sends the visitor to the site's root instead.
 *
 * Nothing here logs an answer: a failure is logged by its outcome alone.
 *
 * @module forms/receiver
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import {
  FORM_HONEYPOT_FIELD,
  formFields,
  type FormProps,
} from "@nextlyhq/blocks-react/blocks";
import type { PluginContext, PluginLimiter } from "@nextlyhq/plugin-sdk";
import type {
  FormAcceptResult,
  FormAfterSending,
  FormDescription,
  FormFieldDescription,
  FormProvider,
} from "@nextlyhq/plugin-sdk/blocks";

import { checkAnswers, describedAnswers, type CheckedAnswer } from "./answers";
import {
  parseDefiningDocument,
  type DefiningDocument,
} from "./defining-document";
import type { Delivery } from "./deliver";
import { SIMPLE_FORM_PROVIDER } from "./providers";

/** The hidden fields a form posts beside its answers, and the trap. */
const FORM_POST_FIELDS: {
  readonly document: "_form";
  readonly node: "_node";
  readonly returnTo: "_return";
  readonly item: "_item";
  readonly locale: "_locale";
  readonly honeypot: typeof FORM_HONEYPOT_FIELD;
} = {
  /** The document defining the form (`defining-document.ts`). */
  document: "_form",
  /** The form node's id in that document. */
  node: "_node",
  /** The path to come back to. */
  returnTo: "_return",
  /** The item's position, for a form repeated in a collection list. */
  item: "_item",
  /** The page's language, when the site has several. */
  locale: "_locale",
  /** The spam trap the Form block draws. */
  honeypot: FORM_HONEYPOT_FIELD,
};

/** The largest post read, in bytes: far past any form a person fills in. */
export const MOST_POST_BYTES: number = 64 * 1024;

/** The most fields one post may carry, its hidden ones included. */
export const MOST_POST_FIELDS = 200;

/** The limit rule a send is counted under (`contributes.limits`). */
export const FORM_SEND_RULE = "form-sends";

/** Sends one visitor address may make in a minute. */
export const FORM_SENDS_PER_MINUTE = 10;

/** The key every visitor shares when their address cannot be read. */
const UNRESOLVED_ADDRESS = "unresolved-address";

/** What a send came to, as the fragment the visitor comes back to says. */
type FormOutcome = "sent" | "invalid" | "closed" | "error";

/** What the receiver needs, so each part can be stood in for in a test. */
export interface ReceiverDeps {
  /** The node `nodeId` of the published `document`, or `null`. */
  readonly readNode: (
    document: DefiningDocument,
    nodeId: string,
    locale: string | undefined
  ) => Promise<BlockNode | null>;
  /** The provider registered under `id`. */
  readonly provider: (id: string) => FormProvider | undefined;
  /** The plugin's limiter; absent, every send is refused. */
  readonly limits: Pick<PluginLimiter, "reserve" | "clientKey"> | undefined;
  /** Pass a simple form's checked answers on to its address. */
  readonly deliver: (
    address: string,
    answers: readonly CheckedAnswer[]
  ) => Promise<Delivery>;
  readonly logger: Pick<PluginContext["logger"], "warn">;
}

/** Receive one post and answer where the visitor goes next. */
export async function receiveFormPost(
  request: Request,
  deps: ReceiverDeps
): Promise<Response> {
  // A browser marks a post another site's page sent; a script cannot change
  // the mark. One sent from this site, or with no mark at all, goes on.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return plain(403, "This form can only be sent from its own site.");
  }
  const read = await readPost(request);
  if (read.kind === "refused") return plain(read.status, read.message);
  const post = read.fields;
  const back = returnPath(post.get(FORM_POST_FIELDS.returnTo)?.[0]);
  const anchor = anchorOf(post);
  const answer = (outcome: FormOutcome, retryAfter?: number): Response =>
    redirect(back, anchor, outcome, retryAfter);

  if (read.tooManyFields) return answer("error");
  // First, and answered as a success: a bot told it was refused would try
  // another way in.
  const trap = post.get(FORM_POST_FIELDS.honeypot) ?? [];
  if (trap.some(value => value.trim() !== "")) return answer("sent");

  const limited = await reserveSend(request, deps);
  if (limited !== null) return answer("error", limited.retryAfter);

  const document = parseDefiningDocument(
    post.get(FORM_POST_FIELDS.document)?.[0]
  );
  const nodeId = post.get(FORM_POST_FIELDS.node)?.[0];
  if (document === null || nodeId === undefined || anchor === null) {
    return answer("error");
  }
  const locale = localeOf(post.get(FORM_POST_FIELDS.locale)?.[0]);
  let node: BlockNode | null;
  try {
    node = await deps.readNode(document, nodeId, locale);
  } catch {
    deps.logger.warn("[page-builder] A form's page could not be read.");
    return answer("error");
  }
  if (node === null || node.type !== "core/form") return answer("error");

  const answers = answersOf(post);
  const picked = pickedForm(node);
  if (picked !== null) {
    const outcome = await sendToProvider(
      picked,
      answers,
      locale,
      request,
      deps
    );
    return outcome.kind === "page"
      ? redirect(outcome.href, null, "sent")
      : answer(outcome.kind);
  }
  return answer(await sendSimpleForm(node, answers, deps));
}

/** A post's fields, or why it was refused before any was read. */
type ReadPost =
  | {
      readonly kind: "read";
      readonly fields: Map<string, string[]>;
      readonly tooManyFields: boolean;
    }
  | {
      readonly kind: "refused";
      readonly status: number;
      readonly message: string;
    };

/** Read a post's body, capped, and parse it as the form encodings a browser sends. */
async function readPost(request: Request): Promise<ReadPost> {
  // The media type is compared without case; the header itself is parsed as
  // sent, since a multipart boundary is matched exactly.
  const header = request.headers.get("content-type") ?? "";
  const type = header.toLowerCase();
  const urlencoded = type.startsWith("application/x-www-form-urlencoded");
  if (!urlencoded && !type.startsWith("multipart/form-data")) {
    return refused(415, "Send this form from its page.");
  }
  const bytes = await cappedBody(request, MOST_POST_BYTES);
  if (bytes === null) return refused(413, "This form's answers are too long.");
  let entries: [string, string | null][];
  try {
    entries = urlencoded
      ? [...new URLSearchParams(new TextDecoder().decode(bytes))]
      : [
          ...(
            await new Response(bytes, {
              headers: { "content-type": header },
            }).formData()
          ).entries(),
        ].map(([name, value]) => [
          name,
          // A file is not an answer the receiver passes on.
          typeof value === "string" ? value : null,
        ]);
  } catch {
    return refused(400, "This form's answers could not be read.");
  }
  const fields = new Map<string, string[]>();
  for (const [name, value] of entries.slice(0, MOST_POST_FIELDS)) {
    if (value === null) continue;
    const values = fields.get(name) ?? [];
    values.push(value);
    fields.set(name, values);
  }
  return {
    kind: "read",
    fields,
    tooManyFields: entries.length > MOST_POST_FIELDS,
  };
}

function refused(status: number, message: string): ReadPost {
  return { kind: "refused", status, message };
}

/**
 * The body's bytes, or `null` once it runs past `most`. Read in chunks and
 * stopped at the cap, so an oversized body is never held in full, whatever
 * its `Content-Length` claims.
 */
async function cappedBody(
  request: Request,
  most: number
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > most) return null;
  const reader = request.body?.getReader();
  if (reader === undefined) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > most) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(length));
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/**
 * The path to send the visitor back to: a same-site path as the post names
 * it, without its fragment, or the site's root. A path starting `//` or
 * `/\` would leave the site, and so would anything that is not a path.
 */
function returnPath(raw: string | undefined): string {
  return sameSitePath(raw) ?? "/";
}

/** `raw` as a path of this site, without its fragment, or `null` when it is not one. */
function sameSitePath(raw: string | undefined): string | null {
  if (raw === undefined || !raw.startsWith("/")) return null;
  if (raw.startsWith("//") || hasUnsafeCharacter(raw)) return null;
  const base = "https://site.invalid";
  try {
    const url = new URL(raw, base);
    if (url.origin !== base) return null;
    // Judged again once normalized: `/a/..//elsewhere` normalizes to
    // `//elsewhere`, which a browser reads as another host.
    const path = `${url.pathname}${url.search}`;
    return path.startsWith("//") ? null : path;
  } catch {
    return null;
  }
}

/**
 * Whether `raw` holds a backslash, which a browser reads as `/`, or a control
 * character, which it drops: either can turn a path into another host.
 */
function hasUnsafeCharacter(raw: string): boolean {
  for (const character of raw) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The fragment's stem, `form-<node>` or `form-<node>-<item>`; `null` without a usable node id. */
function anchorOf(post: Map<string, string[]>): string | null {
  const node = post.get(FORM_POST_FIELDS.node)?.[0];
  if (node === undefined || !/^[A-Za-z0-9_-]{1,128}$/.test(node)) return null;
  const item = post.get(FORM_POST_FIELDS.item)?.[0];
  return item !== undefined && /^\d{1,4}$/.test(item)
    ? `form-${node}-${item}`
    : `form-${node}`;
}

/** A language code as a post names it, or `undefined` for the default. */
function localeOf(raw: string | undefined): string | undefined {
  return raw !== undefined &&
    /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(raw)
    ? raw
    : undefined;
}

/** The visitor's answers: every field but the receiver's own. */
function answersOf(post: Map<string, string[]>): Map<string, string[]> {
  const reserved = new Set<string>(Object.values(FORM_POST_FIELDS));
  return new Map([...post].filter(([name]) => !reserved.has(name)));
}

/**
 * Count this send against the visitor's address. `null` when it may go on;
 * otherwise how long until it may, in seconds, where that is known.
 */
async function reserveSend(
  request: Request,
  deps: ReceiverDeps
): Promise<{ retryAfter?: number } | null> {
  const { limits } = deps;
  // Refused rather than sent unlimited: no limiter means a boot that went
  // wrong, and a limit that fails open is no limit.
  if (limits === undefined) return {};
  try {
    const reservation = await limits.reserve([
      {
        rule: FORM_SEND_RULE,
        // With the address unreadable (`trustProxy` off), every visitor
        // shares one allowance, as a plugin route's own limit does.
        key: limits.clientKey(request) ?? UNRESOLVED_ADDRESS,
      },
    ]);
    if (reservation.status === "admitted") return null;
    if (reservation.status === "refused") {
      return {
        retryAfter: Math.max(1, Math.ceil(reservation.retryAfterMs / 1000)),
      };
    }
  } catch {
    // Answered below, as a store that did not answer.
  }
  deps.logger.warn("[page-builder] The form send limit could not be checked.");
  return {};
}

/** A provider form a block picked: the provider's id and its reference. */
interface PickedForm {
  readonly provider: string;
  readonly ref: string;
}

/** The provider form `node` picked, or `null` for the block's own fields. */
function pickedForm(node: BlockNode): PickedForm | null {
  const form: unknown = node.props.form;
  if (typeof form !== "object" || form === null) return null;
  const { provider, ref } = form as Record<string, unknown>;
  if (typeof provider !== "string" || provider === SIMPLE_FORM_PROVIDER) {
    return null;
  }
  return { provider, ref: typeof ref === "string" ? ref : "" };
}

/** A provider send's outcome: an outcome to show, or a page to go to. */
type ProviderOutcome =
  | { readonly kind: FormOutcome }
  | { readonly kind: "page"; readonly href: string };

/**
 * Hand a post to the provider of a form the block picked. The provider's
 * public description is read first, so only the fields it describes reach
 * it and a form it no longer offers is refused before it is asked to take
 * anything.
 */
async function sendToProvider(
  picked: PickedForm,
  answers: Map<string, string[]>,
  locale: string | undefined,
  request: Request,
  deps: ReceiverDeps
): Promise<ProviderOutcome> {
  const provider = deps.provider(picked.provider);
  if (provider === undefined) return { kind: "error" };
  let result: FormAcceptResult;
  let description: FormDescription;
  try {
    const described = await provider.describe(picked.ref, {
      access: { as: "public" },
      ...(locale === undefined ? {} : { locale }),
    });
    if ("unavailable" in described) {
      return {
        kind: described.unavailable === "closed" ? "closed" : "error",
      };
    }
    description = described;
    result = await provider.accept(picked.ref, {
      answers: describedAnswers(description.fields, answers),
      ...(locale === undefined ? {} : { locale }),
      request,
    });
  } catch {
    deps.logger.warn("[page-builder] A form provider failed to take a send.", {
      provider: provider.id,
    });
    return { kind: "error" };
  }
  switch (result.kind) {
    case "sent":
      // The provider's answer overrides the form's own setting; without one,
      // the form's own applies.
      return afterSending(result.afterSending ?? description.afterSending);
    case "invalid":
      return { kind: "invalid" };
    case "closed":
      return { kind: "closed" };
    default:
      return { kind: "error" };
  }
}

/** Where an accepted send goes: the page a provider named, if it is this site's. */
function afterSending(after: FormAfterSending | undefined): ProviderOutcome {
  if (after?.kind !== "page") return { kind: "sent" };
  const href = sameSitePath(after.href);
  // A page that is not one of this site's is shown as the message instead,
  // never followed off the site.
  return href === null ? { kind: "sent" } : { kind: "page", href };
}

/**
 * Check a simple form's answers against its own fields and pass them on to
 * its "Send to" address.
 */
async function sendSimpleForm(
  node: BlockNode,
  answers: Map<string, string[]>,
  deps: ReceiverDeps
): Promise<FormOutcome> {
  const address = sendTo(node);
  if (address === null) return "error";
  const checked = checkAnswers(simpleFormFields(node), answers);
  if (!checked.ok) return "invalid";
  const delivery = await deps.deliver(address, checked.answers);
  if (delivery.ok) return "sent";
  deps.logger.warn(
    "[page-builder] A simple form's answers were not passed on.",
    {
      reason: delivery.reason,
      ...(delivery.status === undefined ? {} : { status: delivery.status }),
      host: hostOf(address),
    }
  );
  return "error";
}

/**
 * The simple form's fields as the block draws them, in the provider
 * contract's shape: one description for drawing and for checking.
 */
function simpleFormFields(node: BlockNode): FormFieldDescription[] {
  return formFields(node.props as FormProps).map(field => ({
    name: field.name,
    label: field.label,
    kind: field.type,
    required: field.required,
  }));
}

/**
 * Where a simple form's answers go: the block's stored "Send to", or `null`
 * when it has none. A bound address is refused rather than resolved: what a
 * binding gives is page data, and where answers go must be what the author
 * wrote.
 */
function sendTo(node: BlockNode): string | null {
  if (node.bindings?.action !== undefined) return null;
  const action: unknown = node.props.action;
  return typeof action === "string" && action.trim() !== ""
    ? action.trim()
    : null;
}

/** An address's host alone, for a log line; never its path. */
function hostOf(address: string): string | null {
  try {
    return new URL(address).host;
  } catch {
    return null;
  }
}

/** A `303` to `path`, with the outcome in its fragment. */
function redirect(
  path: string,
  anchor: string | null,
  outcome: FormOutcome,
  retryAfter?: number
): Response {
  const headers = new Headers({
    location: anchor === null ? path : `${path}#${anchor}-${outcome}`,
    "cache-control": "no-store",
  });
  if (retryAfter !== undefined) headers.set("retry-after", String(retryAfter));
  return new Response(null, { status: 303, headers });
}

/** A plain-text refusal, for a post with no usable way back. */
function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
