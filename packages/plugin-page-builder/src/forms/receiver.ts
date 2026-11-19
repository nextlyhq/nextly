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
 * 7. Once a send is accepted, the visitor is sent where the block says: the
 *    picked form's own setting, the block's message, or the page the block
 *    names, read from the stored block and never from the post.
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
import { migrateDocument, type BlockNode } from "@nextlyhq/blocks-engine";
import {
  form as FORM_BLOCK,
  FORM_FILE_NEEDS_SCRIPT,
  FORM_HONEYPOT_FIELD,
  FORM_POST_FIELDS as BLOCK_POST_FIELDS,
  formFieldDrawings,
} from "@nextlyhq/blocks-react/blocks";
import type { PluginContext, PluginLimiter } from "@nextlyhq/plugin-sdk";
import type {
  FormAcceptResult,
  FormAfterSending,
  FormDescription,
  FormProvider,
} from "@nextlyhq/plugin-sdk/blocks";

import { checkAnswers, describedAnswers, type CheckedAnswer } from "./answers";
import { servedUnderBase } from "./base-path";
import {
  parseDefiningDocument,
  type DefiningDocument,
} from "./defining-document";
import type { Delivery } from "./deliver";
import { SIMPLE_FORM_PROVIDER } from "./providers";

/**
 * The hidden fields a form posts beside its answers, and the trap. The ones
 * the Form block draws (the document defining the form, its node, the path
 * to come back to, the page's language) are named once, by the block.
 */
const FORM_POST_FIELDS: typeof BLOCK_POST_FIELDS & {
  readonly honeypot: typeof FORM_HONEYPOT_FIELD;
} = {
  ...BLOCK_POST_FIELDS,
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
  /**
   * Where a page or entry of the site is served, in `locale`, for a block
   * that sends visitors there once a send is accepted; `null` where it is
   * served nowhere. Absent, such a block shows its message instead.
   */
  readonly entryAddress?: (
    collection: string,
    id: string,
    locale: string | undefined,
    /** The same-site path the visitor sent from, in its own language's form. */
    from: string
  ) => Promise<string | null>;
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
  if (node === null || node.type !== FORM_BLOCK.name) return answer("error");
  const current = upgraded(node);
  if (current === null) return answer("error");

  return sendForm({
    node: current,
    answers: answersOf(post),
    back,
    locale,
    request,
    deps,
    answer,
  });
}

/**
 * Send a post's answers to the form `node` is, and answer where the visitor
 * goes: the provider's or the simple form's outcome, and once accepted, the
 * page the block or its form names.
 */
async function sendForm(send: {
  readonly node: BlockNode;
  readonly answers: Map<string, string[]>;
  /** The same-site path the visitor came from and goes back to. */
  readonly back: string;
  readonly locale: string | undefined;
  readonly request: Request;
  readonly deps: ReceiverDeps;
  readonly answer: (outcome: FormOutcome) => Response;
}): Promise<Response> {
  const { node, answers, back, locale, request, deps, answer } = send;
  const picked = pickedForm(node);
  const chosen = afterSendingChosen(node, picked !== null);
  // Where the block itself sends a visitor once a send is accepted.
  const blockPage = async (): Promise<Response> => {
    const href = await blockPageOf(node, locale, back, deps);
    return href === null ? answer("sent") : redirect(href, null, "sent");
  };
  if (picked === null) {
    const sent = await sendSimpleForm(node, answers, deps);
    return sent === "sent" && chosen === "page" ? blockPage() : answer(sent);
  }
  const outcome = await sendToProvider(
    picked,
    answers,
    locale,
    request,
    deps,
    chosen
  );
  if (outcome.kind === "block-page") return blockPage();
  if (outcome.kind === "needs-script") {
    return plain(422, FORM_FILE_NEEDS_SCRIPT);
  }
  return outcome.kind === "page"
    ? redirect(outcome.href, null, "sent")
    : answer(outcome.kind);
}

/**
 * The form as its page draws it: a node stored at an older version of the
 * block upgraded, as every reader of the page upgrades it, so its answers
 * are checked under the names and settings the visitor was shown. `null`
 * where the upgrade fails, which the page draws as no form.
 */
function upgraded(node: BlockNode): BlockNode | null {
  if (node.version === FORM_BLOCK.version) return node;
  const { doc } = migrateDocument(
    { formatVersion: 1, kind: "page", nodes: [node] },
    {
      get: type =>
        type === FORM_BLOCK.name
          ? {
              version: FORM_BLOCK.version,
              ...(FORM_BLOCK.migrate === undefined
                ? {}
                : { migrate: FORM_BLOCK.migrate }),
            }
          : undefined,
    }
  );
  const [migrated] = doc.nodes;
  return migrated?.version === FORM_BLOCK.version ? migrated : null;
}

/** What a block shows once a send is accepted. */
type AfterSendingChoice = "form" | "message" | "page";

/**
 * What the block chose to show once a send is accepted: the picked form's
 * own setting, its message, or a page it names. Absent or unknown, a
 * provider's form follows its own setting and a simple form shows its
 * message.
 */
function afterSendingChosen(
  node: BlockNode,
  picked: boolean
): AfterSendingChoice {
  const stored: unknown = node.props.afterSending;
  if (stored === "message" || stored === "page") return stored;
  return picked ? "form" : "message";
}

/** A stored prop's text, or `""` where it holds none. */
function storedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The page a block sends visitors to once a send is accepted, as the
 * author stored it: a page of the site picked by its entry, where the site
 * serves it, or an address the author wrote, on this site or another.
 * `null` where it names none that can be followed, and the block's message
 * shows instead. A bound address is refused, as "Send to" is: where a
 * visitor is sent must be what the author wrote.
 */
async function blockPageOf(
  node: BlockNode,
  locale: string | undefined,
  from: string,
  deps: ReceiverDeps
): Promise<string | null> {
  const collection = storedText(node.props.entryCollection);
  const id = storedText(node.props.entryId);
  if (collection !== "" && id !== "" && deps.entryAddress !== undefined) {
    const served = await deps
      .entryAddress(collection, id, locale, from)
      .catch(() => null);
    const path = sameSitePath(served ?? undefined);
    if (path !== null) return path;
  }
  if (node.bindings?.href !== undefined) return null;
  const href = storedText(node.props.href);
  return authoredPath(href, from) ?? webAddress(href);
}

/** A fragment as an author may name a section of a page. */
const FRAGMENT = /^#[A-Za-z0-9_\-:.]{1,128}$/;

/**
 * A same-site destination an author wrote, its section kept: a path with
 * its fragment, or a fragment alone, on the page the visitor sent from.
 * `null` for anything else.
 */
function authoredPath(raw: string, from: string): string | null {
  const at = raw.indexOf("#");
  const fragment = at === -1 ? "" : raw.slice(at);
  if (fragment !== "" && !FRAGMENT.test(fragment)) return null;
  if (at === 0) return `${from}${fragment}`;
  const path = sameSitePath(at === -1 ? raw : raw.slice(0, at));
  return path === null ? null : `${path}${fragment}`;
}

/** `raw` as an `http` or `https` address an author wrote, or `null`. */
function webAddress(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
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

/**
 * The fragment's stem, `form-<node>` or `form-<node>-<item>`, as the block
 * names the copy it drew; `null` without a usable node id. An item is the
 * copy's position among its list's entries, after those of the lists around
 * it (`3`, `0-3`).
 */
function anchorOf(post: Map<string, string[]>): string | null {
  const node = post.get(FORM_POST_FIELDS.node)?.[0];
  if (node === undefined || !/^[A-Za-z0-9_-]{1,128}$/.test(node)) return null;
  const item = post.get(FORM_POST_FIELDS.item)?.[0];
  return item !== undefined && /^\d{1,4}(?:-\d{1,4}){0,7}$/.test(item)
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

/**
 * A provider send's outcome: an outcome to show, a page to go to, or the
 * page the block itself names.
 */
type ProviderOutcome =
  | { readonly kind: FormOutcome }
  | { readonly kind: "page"; readonly href: string }
  | { readonly kind: "block-page" }
  | { readonly kind: "needs-script" };

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
  deps: ReceiverDeps,
  chosen: AfterSendingChoice
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
    // A plain form post through the page builder carries no file, and the
    // file is never dropped without a word: such a form is refused here.
    if (description.fields.some(field => field.kind === "file")) {
      return { kind: "needs-script" };
    }
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
      // The block's own choice comes first. Without one, the provider's
      // answer overrides the form's own setting, and the form's own applies.
      if (chosen === "message") return { kind: "sent" };
      if (chosen === "page") return { kind: "block-page" };
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
  // Checked against the description the block draws its controls from, so
  // the rules the browser applied are the rules checked here.
  const checked = checkAnswers(formFieldDrawings(node.props), answers);
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

/**
 * A `303` to `path`, with the outcome in its fragment. A path of the app's
 * own is one its routes name, so it is sent under the app's base path,
 * where the browser reaches it.
 */
function redirect(
  path: string,
  anchor: string | null,
  outcome: FormOutcome,
  retryAfter?: number
): Response {
  const served = servedUnderBase(path);
  const headers = new Headers({
    location: anchor === null ? served : `${served}#${anchor}-${outcome}`,
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
