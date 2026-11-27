/**
 * Fixture operations for the adapter's tests: a small content store with
 * entries, pages and media, and operations of every risk level and effect
 * over it. None of these exist in core; they stand in for the operations
 * that will, with the same shapes an operation declares.
 */
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, Server } from "@modelcontextprotocol/server";
import { NextlyError, type PublicData } from "nextly/errors";
import { z } from "zod";

import type {
  AgentOperation,
  OperationEffects,
  OperationOutcome,
  OperationSource,
  RiskLevel,
} from "../operation";
import type { UnknownNameData } from "../errors";
import type { ToolTableRow } from "../names";
import { buildToolSet, type ToolBinding, type ToolSet } from "../tool-set";

/** The caller a fixture run acts for. */
export interface FixtureCaller {
  readonly person: string;
}

const NONE: OperationEffects = {
  destroys: false,
  idempotent: false,
  outside: false,
  spendsAi: false,
};

/** An entry as the fixture store holds it. */
interface StoredEntry {
  readonly id: string;
  readonly title: string;
  readonly status: "draft" | "published";
  readonly body: string;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly adminPath: string;
  };
  readonly cover: {
    readonly id: string;
    readonly filename: string;
    readonly adminPath: string;
  };
}

/** `count` entries in the `posts` collection, the first one with rich text in Markdown. */
export function fixtureEntries(count: number): StoredEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `Post ${index + 1}`,
    status: index % 2 === 0 ? "published" : "draft",
    body:
      index === 0
        ? "## Spring menu\n\nNew dishes, **fresh** from the market.\n\n- Asparagus\n- Peas"
        : `Body of post ${index + 1}.`,
    author: { id: "u1", name: "Sara Malik", adminPath: "/admin/users/u1" },
    cover: { id: "m1", filename: "spring.jpg", adminPath: "/admin/media/m1" },
  }));
}

const RELATION = z
  .object({ id: z.string(), name: z.string(), adminPath: z.string() })
  .strict();
const UPLOAD = z
  .object({ id: z.string(), filename: z.string(), adminPath: z.string() })
  .strict();
const ENTRY = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["draft", "published"]).optional(),
    adminPath: z.string(),
    body: z.string().meta({ contentMediaType: "text/markdown" }).optional(),
    author: RELATION.optional(),
    cover: UPLOAD.optional(),
  })
  .strict();

/** The collections the fixture site has. */
export const COLLECTIONS = ["posts", "pages", "products"] as const;

/** The fields a `posts` entry has, which `fields` may name. */
export const ENTRY_FIELDS = [
  "title",
  "status",
  "body",
  "author",
  "cover",
] as const;

const FIND_INPUT = z
  .object({
    collection: z.string(),
    search: z.string().optional(),
    fields: z.array(z.string()).optional(),
    limit: z.number().int().optional(),
    after: z.string().optional(),
  })
  .strict();
const FIND_OUTPUT = z
  .object({ collection: z.string(), items: z.array(ENTRY) })
  .strict();

/**
 * A refusal naming something that doesn't exist, with the names the caller
 * may use instead, in the shape the adapter reads (`UnknownNameData`). Core's
 * public-data union does not list that shape yet, so the one cast that lets a
 * test build it lives here, and goes when core adds the shape.
 */
export function unknownNameError(
  code: "NOT_FOUND" | "VALIDATION_ERROR",
  unknown: UnknownNameData["unknown"]
): NextlyError {
  const publicData: UnknownNameData = { unknown };
  return new NextlyError({
    code,
    publicMessage: code === "NOT_FOUND" ? "Not found." : "Validation failed.",
    publicData: publicData as PublicData,
  });
}

/** A refusal naming a collection that doesn't exist, with the ones that do. */
function unknownCollection(name: string): NextlyError {
  return unknownNameError("NOT_FOUND", {
    kind: "collection",
    name,
    choices: [...COLLECTIONS],
  });
}

/** An entry as an answer shows it, with only the chosen fields when some were chosen. */
function shown(
  entry: StoredEntry,
  fields: readonly string[] | undefined
): z.infer<typeof ENTRY> {
  const full = { ...entry, adminPath: `/admin/collections/posts/${entry.id}` };
  if (!fields) return full;
  const out: Record<string, unknown> = {
    id: full.id,
    title: full.title,
    adminPath: full.adminPath,
  };
  for (const field of fields) out[field] = full[field as keyof typeof full];
  return ENTRY.parse(out);
}

/** Options for one fixture operation. */
interface FixtureOptions {
  readonly id: string;
  readonly summary?: string;
  readonly level: RiskLevel;
  readonly effects?: Partial<OperationEffects>;
  readonly chatExposed?: boolean;
  readonly doors?: AgentOperation["doors"];
  readonly toolNameAliases?: AgentOperation["toolNameAliases"];
}

/** A simple operation that takes `{ id }` and answers `{ id, done }`. */
function simpleOperation(options: FixtureOptions): AgentOperation {
  return {
    id: options.id,
    summary: options.summary ?? `Fixture ${options.id}.`,
    description: `A fixture operation (${options.id}) for the adapter's tests.`,
    input: z.object({ id: z.string() }).strict(),
    output: z.object({ id: z.string(), done: z.boolean() }).strict(),
    level: options.level,
    effects: { ...NONE, ...options.effects },
    doors: options.doors ?? ["chat", "local"],
    chatExposed: options.chatExposed ?? true,
    ...(options.toolNameAliases
      ? { toolNameAliases: options.toolNameAliases }
      : {}),
  };
}

/** The operation behind `find_entries`: a paged list of a collection's entries. */
export const FIND_ENTRIES: AgentOperation = {
  id: "entries.find",
  summary: "Find entries.",
  description: "Finds entries in a collection by text, a page at a time.",
  input: FIND_INPUT,
  output: FIND_OUTPUT,
  level: "read",
  effects: { ...NONE, idempotent: true },
  doors: ["chat", "local"],
  chatExposed: true,
};

/** The operation behind `get_entry`: one entry with every field. */
export const GET_ENTRY: AgentOperation = {
  id: "entries.get",
  summary: "Get an entry",
  description: "Gets one entry with its fields, rich text as Markdown.",
  input: z.object({ collection: z.string(), id: z.string() }).strict(),
  output: ENTRY,
  level: "read",
  effects: { ...NONE, idempotent: true },
  doors: ["chat", "local"],
  chatExposed: true,
};

/** One fixture operation of each kind the hints tell apart, by tool name. */
export const KIND_OPERATIONS: Readonly<Record<string, AgentOperation>> = {
  get_thing: simpleOperation({
    id: "things.get",
    level: "read",
    effects: { idempotent: true },
  }),
  create_draft: simpleOperation({ id: "drafts.create", level: "draft" }),
  update_draft: simpleOperation({
    id: "drafts.update",
    level: "draft",
    effects: { idempotent: true },
  }),
  update_thing: simpleOperation({
    id: "things.update",
    level: "change",
    effects: { idempotent: true },
  }),
  delete_thing: simpleOperation({
    id: "things.delete",
    level: "change",
    effects: { destroys: true, idempotent: true },
  }),
  run_webhook: simpleOperation({
    id: "webhooks.run",
    level: "critical",
    effects: { outside: true },
  }),
  purge_things: simpleOperation({
    id: "things.purge",
    level: "critical",
    effects: { destroys: true, outside: true },
  }),
};

/** An operation renamed from `fetch_thing` (not a verb list name) to `get_renamed`. */
export const RENAMED: AgentOperation = simpleOperation({
  id: "renamed.get",
  level: "read",
  effects: { idempotent: true },
  toolNameAliases: [
    { name: "get_old_name", addedIn: "1.2.0", removableFrom: "1.3.0" },
  ],
});

/** Operations no chat door serves: one not marked for agents, one not on the chat door. */
export const NOT_SERVED: readonly AgentOperation[] = [
  simpleOperation({
    id: "secret.get",
    level: "read",
    chatExposed: false,
    doors: ["local"],
  }),
  simpleOperation({
    id: "local.only",
    level: "read",
    chatExposed: false,
    doors: ["local", "chat"],
  }),
];

/** The fixture operations' tool names, the list's forward map. */
export const FIXTURE_NAMES: ReadonlyMap<string, string> = new Map([
  ["entries.find", "find_entries"],
  ["entries.get", "get_entry"],
  ["renamed.get", "get_renamed"],
  ["secret.get", "get_secret"],
  ["local.only", "get_local_only"],
  ...Object.entries(KIND_OPERATIONS).map(
    ([name, op]) => [op.id, name] as [string, string]
  ),
]);

/** The fixture door's table: a row for every fixture tool, and one for a tool not built yet. */
export const FIXTURE_TABLE: readonly ToolTableRow[] = [
  ...[...FIXTURE_NAMES].map(([operation, name]) => ({ name, operation })),
  { name: "get_page", operation: null },
];

/** A run that answers from the fixture store; `fail` makes every run throw it instead. */
export interface FixtureRunOptions {
  readonly entries?: readonly StoredEntry[];
  readonly fail?: unknown;
}

/** Refuses a collection the fixture site doesn't have. */
function checkCollection(collection: string): void {
  if (!(COLLECTIONS as readonly string[]).includes(collection)) {
    throw unknownCollection(collection);
  }
}

/** Refuses the first chosen field an entry doesn't have. */
function checkFields(fields: readonly string[] | undefined): void {
  const unknown = (fields ?? []).find(
    field => !(ENTRY_FIELDS as readonly string[]).includes(field)
  );
  if (unknown !== undefined) {
    throw unknownNameError("VALIDATION_ERROR", {
      kind: "field",
      name: unknown,
      choices: [...ENTRY_FIELDS],
    });
  }
}

/** `entries.find`: a page of entries, its cursor the offset of the next one. */
function findEntries(
  input: unknown,
  entries: readonly StoredEntry[]
): OperationOutcome {
  const query = FIND_INPUT.parse(input);
  checkCollection(query.collection);
  checkFields(query.fields);
  const offset = query.after === undefined ? 0 : Number(query.after);
  const limit = query.limit ?? 20;
  const page = entries.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    result: {
      collection: query.collection,
      items: page.map(entry => shown(entry, query.fields)),
    },
    page: {
      next: nextOffset < entries.length ? String(nextOffset) : null,
      limit,
      total: entries.length,
    },
  };
}

/** `entries.get`: one entry with every field. */
function getEntry(
  input: unknown,
  entries: readonly StoredEntry[]
): OperationOutcome {
  const query = z
    .object({ collection: z.string(), id: z.string() })
    .parse(input);
  checkCollection(query.collection);
  const entry = entries.find(candidate => candidate.id === query.id);
  if (!entry) throw NextlyError.notFound();
  return { result: shown(entry, undefined) };
}

/** Runs a fixture operation the way the operation engine would hand it to the adapter. */
export async function runFixture(
  operation: AgentOperation,
  input: unknown,
  options: FixtureRunOptions = {}
): Promise<OperationOutcome> {
  if (options.fail !== undefined) throw options.fail;
  const entries = options.entries ?? fixtureEntries(3);
  if (operation.id === "entries.find") return findEntries(input, entries);
  if (operation.id === "entries.get") return getEntry(input, entries);
  const { id } = z.object({ id: z.string() }).parse(input);
  return { result: { id, done: true } };
}

/** Every fixture operation, in a fixed order. */
export const FIXTURE_OPERATIONS: readonly AgentOperation[] = [
  FIND_ENTRIES,
  GET_ENTRY,
  ...Object.values(KIND_OPERATIONS),
  RENAMED,
  ...NOT_SERVED,
];

/** A source over `operations`, named by the fixture map, running the fixture store. */
export function fixtureSource(
  operations: readonly AgentOperation[] = FIXTURE_OPERATIONS,
  runOptions: FixtureRunOptions = {}
): OperationSource<FixtureCaller> {
  return {
    operations,
    toolNameOf: operation =>
      FIXTURE_NAMES.get(operation.id) ?? operation.id.replace(/\./g, "_"),
    run: (operation, input) => runFixture(operation, input, runOptions),
  };
}

/** The fixture chat door's tools. */
export function fixtureToolSet(
  runOptions: FixtureRunOptions = {}
): ToolSet<FixtureCaller> {
  return buildToolSet(fixtureSource(FIXTURE_OPERATIONS, runOptions), {
    door: "chat",
    table: FIXTURE_TABLE,
  });
}

/** What a test logger saw. */
export interface LoggedLine {
  readonly message: string;
  readonly context: Record<string, unknown>;
}

/**
 * An SDK client connected over an in-memory transport to a server that
 * serves `toolSet` for one caller. The caller defaults to one fixture person
 * allowed every tool.
 */
export async function connectedClient(
  toolSet: ToolSet<FixtureCaller>,
  binding: Partial<ToolBinding<FixtureCaller>> = {}
): Promise<{
  client: Client;
  logged: LoggedLine[];
  close: () => Promise<void>;
}> {
  const logged: LoggedLine[] = [];
  const server = new Server(
    { name: "fixture", version: "0.0.0" },
    { capabilities: {} }
  );
  toolSet.serve(server, {
    caller: { person: "sara" },
    adminOrigin: "https://site.example",
    logger: { error: (message, context) => logged.push({ message, context }) },
    ...binding,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "fixture-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    logged,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The JSON in an answer's fenced data block, parsed. */
export function fencedData(text: string): unknown {
  const match =
    /Data \(the same as the structured content, as JSON\):\n\n(`{3,})json\n([\s\S]*?)\n\1$/.exec(
      text
    );
  if (!match) throw new Error("The answer has no fenced data block");
  return JSON.parse(match[2] ?? "");
}
