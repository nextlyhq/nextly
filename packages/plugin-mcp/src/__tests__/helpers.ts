/**
 * What every integration suite of this package needs to reach the endpoint as an agent does:
 * an install booted with the plugin on, a key minted with exactly the grants a case names, and
 * the JSON-RPC requests and answers of the protocol.
 *
 * Kept out of the suites so each one reads as its cases: the request plumbing is the same in all
 * of them, and a copy per file is a copy that drifts. Not collected as a test (neither config
 * includes it: the unit config takes `*.test.ts`, the integration config `*.integration.test.ts`).
 *
 * Set-up moves review state only through the trusted Direct API (`handle.nextly.workflows`),
 * never through a tool under test, so a case's fixture cannot pass because the tool it checks
 * is broken in the same way.
 */

// Set before the harness boots (env validation reads it once). A suite importing these helpers
// has it set by the time its first case boots an install.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineWorkflow, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { expect } from "vitest";

import { mcpPlugin } from "../plugin";

/** The hostname the endpoint is published under in every suite. */
export const ALLOWED = "cms.example.com";

/** The route handlers an app mounts, as each request is served through them. */
export type Handlers = ReturnType<typeof createDynamicHandlers>;

/** The catch-all route's params for a path under the Nextly mount. */
export function params(...segments: string[]): {
  params: Promise<{ params: string[] }>;
} {
  return { params: Promise.resolve({ params: segments }) };
}

/** A POST to the endpoint, addressed to the published host, with `headers` added. */
export function post(body: unknown, headers: Record<string, string>): Request {
  return new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      host: ALLOWED,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** The protocol's opening request, as a client sends it first. */
export function initialize(headers: Record<string, string>): Request {
  return post(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.0" },
      },
    },
    headers
  );
}

/** A tool as `tools/list` describes it. */
export interface ListedTool {
  name: string;
  inputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
}

/**
 * A JSON-RPC answer. `result` is a tool's result or a listing; `error` is the protocol's own
 * refusal, which is how an unknown tool is answered (`-32602`, "Tool <name> not found").
 */
export interface RpcBody<S = unknown> {
  result?: {
    content?: { type: string; text: string }[];
    structuredContent?: S;
    isError?: boolean;
    tools?: ListedTool[];
  };
  error?: { code: number; message: string };
}

/** The JSON-RPC payload, whether the body is JSON or a single SSE frame. */
export async function payloadOf<S = unknown>(
  response: Response
): Promise<RpcBody<S>> {
  const text = await response.text();
  const line = text
    .split("\n")
    .find(l => l.startsWith("data: ") || l.trimStart().startsWith("{"));
  const json = line?.startsWith("data: ") ? line.slice(6) : (line ?? text);
  return JSON.parse(json) as RpcBody<S>;
}

/** The headers a key authenticates with. */
export const bearer = (key: string): Record<string, string> => ({
  authorization: `Bearer ${key}`,
});

/** One protocol method, after the opening request, as a client makes it. */
async function rpc<S>(
  handlers: Handlers,
  headers: Record<string, string>,
  method: string,
  rpcParams: Record<string, unknown>
): Promise<RpcBody<S>> {
  await handlers.POST(initialize(headers), params("mcp"));
  const response = await handlers.POST(
    post({ jsonrpc: "2.0", id: 2, method, params: rpcParams }, headers),
    params("mcp")
  );
  return payloadOf<S>(response);
}

/** A tool called by name with `args`, as the key whose headers are given. */
export function callTool<S = Record<string, unknown>>(
  handlers: Handlers,
  headers: Record<string, string>,
  name: string,
  args: Record<string, unknown>
): Promise<RpcBody<S>> {
  return rpc<S>(handlers, headers, "tools/call", { name, arguments: args });
}

/** The tools the server lists to the key whose headers are given. */
export async function listTools(
  handlers: Handlers,
  headers: Record<string, string>
): Promise<ListedTool[]> {
  const body = await rpc(handlers, headers, "tools/list", {});
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  return body.result?.tools ?? [];
}

/**
 * A tool's data, from a call that must have succeeded. The protocol's own refusal is checked
 * first, so a tool that is not registered fails here naming that, not on a missing field.
 */
export function dataOf<S>(body: RpcBody<S>): S {
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  expect(body.result?.isError, JSON.stringify(body.result)).not.toBe(true);
  expect(body.result?.structuredContent).toBeDefined();
  return body.result?.structuredContent as S;
}

/** A refusal as a tool answers it: the error's public JSON. */
export interface ToolRefusal {
  code: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * The refusal a tool answered with, from a call that must have been refused by the tool rather
 * than by the protocol: an unregistered tool fails here by its own cause.
 */
export function refusalOf(body: RpcBody): ToolRefusal {
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  expect(body.result?.isError, JSON.stringify(body.result)).toBe(true);
  const error = (body.result?.structuredContent as { error?: ToolRefusal })
    ?.error;
  expect(error, JSON.stringify(body.result)).toBeDefined();
  return error as ToolRefusal;
}

/** The text of a result's content, joined. */
export const textOf = (body: RpcBody): string =>
  (body.result?.content ?? []).map(c => c.text).join("\n");

/** The Direct API members key minting uses, typed as they are called here. */
interface RbacApi {
  users: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

/** The key service's one method minting uses. */
interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string; meta: { id: string } }>;
}

/** Each install's owner, created once per install by the first key minted on it. */
const owners = new WeakMap<TestNextly, string>();

/**
 * The install's first user, who holds the seeded super-admin role, and who mints every key.
 *
 * One owner for every key on an install, because `createApiKey` is itself an authorized
 * operation: an ordinary user cannot mint one, and a key may carry no grant its creator lacks.
 * A super-admin owner does not widen the keys: a `role-based` key is judged on the grants stamped
 * on it, never on its owner's roles, which `plugin-route-key-scope.integration.test.ts` holds.
 */
export async function ownerOf(handle: TestNextly): Promise<string> {
  const known = owners.get(handle);
  if (known !== undefined) return known;
  const api = handle.nextly as unknown as RbacApi;
  const owner = await api.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  owners.set(handle, owner.item.id);
  return owner.item.id;
}

/**
 * The id of the permission spelled `slug` (`read-posts`, `sign-off-posts`), created when the
 * install has not seeded it: a workflow's named action, such as `sign-off`, has no seeded row.
 * The resource is the part after the last `-`, which holds for the one-word slugs used here.
 */
async function permissionId(handle: TestNextly, slug: string) {
  const api = handle.nextly as unknown as RbacApi;
  const found = (await api.permissions.find({ limit: 1000 })).items.find(
    permission => permission.slug === slug
  );
  if (found) return found.id;
  const cut = slug.lastIndexOf("-");
  expect(cut, `${slug} must read <action>-<resource>`).toBeGreaterThan(0);
  const action = slug.slice(0, cut);
  const resource = slug.slice(cut + 1);
  return (
    await api.permissions.create({
      data: { action, resource, name: `${action} ${resource}`, slug },
    })
  ).item.id;
}

/**
 * A key holding exactly the permissions named, by their stored spelling, minted by the
 * install's owner. Returns its secret and its id, as the history of its moves names it.
 */
export async function keyGranting(
  handle: TestNextly,
  label: string,
  slugs: readonly string[]
): Promise<{ key: string; id: string }> {
  const owner = await ownerOf(handle);
  const permissionIds: string[] = [];
  for (const slug of slugs) {
    permissionIds.push(await permissionId(handle, slug));
  }
  const role = await (handle.nextly as unknown as RbacApi).roles.create({
    data: { name: `Key ${label}`, slug: `key-${label}`, permissionIds },
  });
  const apiKeys = handle.getService("apiKeyService") as unknown as ApiKeys;
  const { key, meta } = await apiKeys.createApiKey(owner, {
    name: `an agent's key ${label}`,
    tokenType: "role-based",
    roleId: role.item.id,
    expiresIn: "never",
  });
  return { key, id: meta.id };
}

/**
 * Writing → Legal check → Cleared, with a move out of Legal check to On hold that needs a
 * comment, and approval and changes-requested steps that need `sign-off`. One submit step
 * (`send`), so a submit with no step named takes it.
 */
export const editorial: ReturnType<typeof defineWorkflow> = defineWorkflow({
  slug: "editorial",
  label: "Editorial",
  stages: [
    { name: "writing", label: "Writing" },
    { name: "legal", label: "Legal check" },
    { name: "hold", label: "On hold" },
    { name: "cleared", label: "Cleared", allowsPublish: true },
  ],
  steps: [
    {
      name: "send",
      label: "Send to legal",
      kind: "submit",
      from: "writing",
      to: "legal",
      primary: true,
    },
    {
      name: "clear",
      label: "Clear",
      kind: "approve",
      from: "legal",
      to: "cleared",
      permission: "sign-off",
      refusesSelfApproval: true,
      primary: true,
    },
    {
      name: "bounce",
      label: "Bounce",
      kind: "request-changes",
      from: ["legal", "cleared"],
      to: "writing",
      permission: "sign-off",
    },
    {
      name: "park",
      label: "Park",
      kind: "move",
      from: "legal",
      to: "hold",
      commentRequired: true,
    },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: "hold",
      to: "legal",
      primary: true,
    },
  ],
});

const drafts = { status: true, versions: { drafts: true } } as const;

/**
 * The collections the review suites work on.
 *
 * - `posts`: translated, with drafts, under `editorial`; a translated title and a shared code,
 *   so a document has a part per language and a shared part.
 * - `letters`: the same, but read in every language except Spanish, so a Spanish part is one
 *   its reader may not be told about.
 */
export const reviewCollections: NonNullable<
  CreateTestNextlyOptions["collections"]
> = [
  defineCollection({
    slug: "posts",
    localized: true,
    ...drafts,
    workflow: editorial,
    fields: [
      text({ name: "title", localized: true }),
      text({ name: "code", localized: false }),
    ],
  }),
  defineCollection({
    slug: "letters",
    localized: true,
    ...drafts,
    workflow: editorial,
    access: { read: ({ locale }) => locale !== "es" },
    fields: [text({ name: "title", localized: true })],
  }),
];

/** What an install of these suites is booted with, beside the plugin. */
export interface BootOptions {
  dialect?: TestDialect;
  collections: NonNullable<CreateTestNextlyOptions["collections"]>;
  localization?: CreateTestNextlyOptions["localization"];
}

/** An install with the endpoint on, and the handlers that serve it. */
export async function bootMcp(
  options: BootOptions
): Promise<{ handle: TestNextly; handlers: Handlers }> {
  const handle = await createTestNextly({
    ...(options.dialect ? { dialect: options.dialect } : {}),
    ...(options.localization ? { localization: options.localization } : {}),
    collections: options.collections,
    plugins: [mcpPlugin({ enabled: true, allowedHosts: [ALLOWED] })],
  });
  return { handle, handlers: createDynamicHandlers() };
}

/** An install of the review suites: English and Spanish, `posts` and `letters`. */
export function bootReview(
  dialect: TestDialect
): Promise<{ handle: TestNextly; handlers: Handlers }> {
  return bootMcp({
    dialect,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: reviewCollections,
  });
}

/** A collection's document, as the review tools name it. */
export interface DocRef {
  collection: string;
  id: string;
}

/** A draft of `collection` in English, stored trusted. */
export async function draft(
  handle: TestNextly,
  collection: string
): Promise<DocRef> {
  const created = await handle.nextly.create({
    collection,
    data: { title: "Hello" },
  });
  const id: unknown = created.item?.id;
  expect(typeof id, `no id from create on ${collection}`).toBe("string");
  return { collection, id: String(id) };
}

/** Saves a title to `document` in `locale`, trusted, as an editor's ordinary save. */
export async function saveIn(
  handle: TestNextly,
  document: DocRef,
  locale: string
): Promise<void> {
  await handle.nextly.update({
    collection: document.collection,
    id: document.id,
    locale,
    data: { title: `Hello ${locale}`, _overwrite: true },
  });
}

/** One part of a review state, as the review tools and the trusted read tell it. */
export interface PartState {
  part: string | null;
  stage: string | null;
  revision: number;
  version: string | null;
  publishable: boolean;
  approval: unknown;
  enteredAt: unknown;
  steps: { name: string; mayTake: boolean }[];
  lastMove: {
    actor: { kind: string; id?: string };
    comment: string | null;
    at: unknown;
  } | null;
}

/** The trusted read of one part, beyond any caller's read rules. */
export async function trustedPart(
  handle: TestNextly,
  document: DocRef,
  part: string | null
): Promise<PartState | undefined> {
  const review = await handle.nextly.workflows.reviewState({ document });
  return (review.parts as unknown as PartState[]).find(p => p.part === part);
}

/** A part as a step says it saw it. */
export interface SeenPart {
  part: string | null;
  revision: number;
  version: string;
}

/** What a step says it saw of `parts`, as the trusted read tells them now. */
export async function trustedSeen(
  handle: TestNextly,
  document: DocRef,
  parts: (string | null)[]
): Promise<SeenPart[]> {
  const seen: SeenPart[] = [];
  for (const part of parts) {
    const state = await trustedPart(handle, document, part);
    expect(state?.version, `no version of part ${part}`).toEqual(
      expect.any(String)
    );
    seen.push({
      part,
      revision: state?.revision ?? 0,
      version: String(state?.version),
    });
  }
  return seen;
}

/** Sends `parts` to legal, trusted: a submit, which the system may take. */
export async function trustedSend(
  handle: TestNextly,
  document: DocRef,
  parts: (string | null)[]
): Promise<void> {
  await handle.nextly.workflows.takeStep({
    document,
    step: "send",
    parts,
    seen: await trustedSeen(handle, document, parts),
    comment: "Set up in legal",
  });
}

/** Assigns `part` where it stands to the user `userId`, trusted. */
export async function trustedAssign(
  handle: TestNextly,
  document: DocRef,
  part: string | null,
  userId: string
): Promise<void> {
  const state = await trustedPart(handle, document, part);
  await handle.nextly.workflows.assign({
    assignments: [
      {
        document,
        part,
        revision: state?.revision ?? 0,
        assignee: { kind: "user", id: userId },
      },
    ],
  });
}
