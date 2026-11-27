/**
 * The adapter: a door's MCP tools, built once from the operations marked for
 * agents, and served per request for one caller.
 *
 * `buildToolSet` runs when the door starts. It names every tool, gives it a
 * title, a description, its input and output JSON Schemas and its four hints,
 * and checks the names against the adapter's table; any problem stops the
 * door from starting, naming the tool. Nothing about a tool's definition is
 * computed again.
 *
 * `serve` runs per request. It binds the caller, filters the prebuilt list to
 * the tools the caller may use, and answers `tools/list` and `tools/call` on
 * the protocol library's `Server`. A tool the caller may not use is refused
 * exactly as one that doesn't exist. Old names of renamed tools are accepted
 * but never listed.
 *
 * @module tool-set
 * @experimental
 */
import {
  ProtocolError,
  ProtocolErrorCode,
  type CallToolResult,
  type Server,
  type Tool,
} from "@modelcontextprotocol/server";
import { NextlyError } from "nextly/errors";

import {
  answerText,
  conciseCut,
  MAX_ANSWER_CHARACTERS,
  type AnswerContext,
} from "./answers";
import { decodeCursor, encodeCursor } from "./cursors";
import {
  errorAnswer,
  nearestNames,
  newRequestId,
  type ToolLogger,
} from "./errors";
import { hintsFor, type ToolHints } from "./hints";
import {
  nameMapOf,
  startUpRefusal,
  TOOL_TABLE,
  type ResolvedName,
  type ToolTableRow,
} from "./names";
import type {
  AgentOperation,
  Door,
  OperationOutcome,
  OperationSource,
  SchemaResult,
} from "./operation";
import {
  AFTER_KEY,
  DEFAULT_PAGE_SIZE,
  FORMAT_KEY,
  FORMATS,
  LIMIT_KEY,
  MAX_PAGE_SIZE,
  PAGE_KEY,
  propertiesOf,
  toolSchemas,
  type AnswerFormat,
} from "./schemas";

/** The most elements (array entries and object keys) one call's arguments may hold. */
export const DEFAULT_MAX_INPUT_ELEMENTS = 10_000;

/** One tool as the door serves it, built once. */
export interface ServedTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: ToolHints;
  /** Whether it pages, taking `limit` and `after` and answering with `page`. */
  readonly paged: boolean;
  /** The old names it still answers to, unlisted. */
  readonly oldNames: readonly string[];
  readonly operation: AgentOperation;
  /** The tool's entry in `tools/list`, the same object for every request. */
  readonly definition: Tool;
}

/** What a door decides when it builds its tools. */
export interface ToolSetOptions {
  /** The door these tools are for; only operations that run on it are served. */
  readonly door: Door;
  /** The adapter's table; the package's own unless a test gives another. */
  readonly table?: readonly ToolTableRow[];
  /** The most elements one call's arguments may hold. */
  readonly maxInputElements?: number;
}

/** What one request binds: who is calling, and what they may use. */
export interface ToolBinding<Caller> {
  readonly caller: Caller;
  /**
   * Whether this caller may use `operation`. Leaving it out allows every
   * served tool; the operation engine still checks permission on each run.
   */
  allows?(operation: AgentOperation): boolean;
  /** The site's address, such as `https://example.com`, for admin links. */
  readonly adminOrigin?: string;
  readonly logger: ToolLogger;
  /** This request's ID; a fresh one per call when left out. */
  requestId?(): string;
}

/** A door's tools, built once. */
export interface ToolSet<Caller> {
  readonly door: Door;
  /** Every tool the door serves, in the order the operations were given. */
  readonly tools: readonly ServedTool[];
  /**
   * Answers `tools/list` and `tools/call` on `server` for one caller. Call it
   * before the server connects; it declares the tools capability.
   */
  serve(server: Server, binding: ToolBinding<Caller>): void;
}

/** Whether `operation` is marked for agents and runs on `door`. */
function servedOn(operation: AgentOperation, door: Door): boolean {
  return operation.chatExposed && operation.doors.includes(door);
}

/** The operation's summary without a closing full stop, as a title. */
function titleOf(operation: AgentOperation): string {
  return operation.summary.replace(/\.\s*$/, "");
}

/** One tool's definition, built once, or the problems that stop it being served. */
function servedTool(
  name: string,
  operation: AgentOperation
): ServedTool | { readonly problems: readonly string[] } {
  const schemas = toolSchemas(name, operation);
  if ("problems" in schemas) return schemas;
  const title = titleOf(operation);
  const annotations = Object.freeze(hintsFor(operation));
  const definition: Tool = Object.freeze({
    name,
    title,
    description: operation.description,
    inputSchema: schemas.input as Tool["inputSchema"],
    outputSchema: schemas.output,
    annotations,
  });
  return Object.freeze({
    name,
    title,
    description: operation.description,
    inputSchema: schemas.input,
    outputSchema: schemas.output,
    annotations,
    paged: schemas.paged,
    oldNames: Object.freeze(
      (operation.toolNameAliases ?? []).map(alias => alias.name)
    ),
    operation,
    definition,
  });
}

/** How many elements `value` holds, counting past `max` no further. */
function elementCount(value: unknown, max: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    const children: unknown[] = Array.isArray(node)
      ? node
      : Object.keys(node).map(key => (node as Record<string, unknown>)[key]);
    for (const child of children) {
      count++;
      if (count > max) return count;
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return count;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A validation refusal for one input, in core's validation shape. */
function inputRefusal(path: string, message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path, code: "INVALID_INPUT", message }],
  });
}

/** Standard Schema issues as core's validation refusal. */
function issuesRefusal(
  issues: Extract<SchemaResult, { issues: unknown }>["issues"]
): NextlyError {
  return NextlyError.validation({
    errors: issues.map(issue => ({
      path: (issue.path ?? [])
        .map(part => String(typeof part === "object" ? part.key : part))
        .join("."),
      code: "INVALID",
      message: issue.message.endsWith(".")
        ? issue.message
        : `${issue.message}.`,
    })),
  });
}

/** What the call's arguments ask of the adapter, and what goes to the operation. */
interface PreparedCall {
  readonly input: Readonly<Record<string, unknown>>;
  /**
   * The inputs as the caller sent them, before the operation's schema parsed
   * them: what a cursor is fingerprinted on, both when it is handed out and
   * when it comes back, so defaults a schema fills in can't make the two
   * differ.
   */
  readonly query: Readonly<Record<string, unknown>>;
  readonly format: AnswerFormat;
  readonly limit?: number;
}

/** A call refused before its operation runs, with the names to suggest. */
interface RefusedCall {
  readonly refused: NextlyError;
  readonly suggestions?: readonly string[];
}

function isRefused(value: object): value is RefusedCall {
  return "refused" in value;
}

/** The refusal for arguments that are too large or not an object, if they are. */
function shapeRefusal(
  args: unknown,
  maxElements: number
): RefusedCall | undefined {
  if (elementCount(args, maxElements) > maxElements) {
    return {
      refused: new NextlyError({
        code: "PAYLOAD_TOO_LARGE",
        publicMessage: `The arguments hold more than ${maxElements} elements, the most one call may send.`,
      }),
    };
  }
  if (args !== undefined && !isRecord(args)) {
    return { refused: inputRefusal("", "The arguments must be an object.") };
  }
  return undefined;
}

/** The refusal for an input the tool doesn't take, with the close names it does. */
function unknownKeyRefusal(
  tool: ServedTool,
  raw: Readonly<Record<string, unknown>>
): RefusedCall | undefined {
  if (tool.inputSchema.additionalProperties !== false) return undefined;
  const known = Object.keys(propertiesOf(tool.inputSchema) ?? {});
  const unknownKey = Object.keys(raw).find(key => !known.includes(key));
  if (unknownKey === undefined) return undefined;
  return {
    refused: NextlyError.validation({
      errors: [
        {
          path: unknownKey,
          code: "UNKNOWN_KEY",
          message: "This tool takes no input by this name.",
        },
      ],
    }),
    suggestions: nearestNames(unknownKey, known),
  };
}

/** The answer format the call asks for, the default when it names none. */
function formatOf(
  raw: Readonly<Record<string, unknown>>
): AnswerFormat | RefusedCall {
  const format = raw[FORMAT_KEY] ?? FORMATS[0];
  return format === "concise" || format === "detailed"
    ? format
    : { refused: inputRefusal(FORMAT_KEY, 'Must be "concise" or "detailed".') };
}

/** The page size the call asks for, the default when it names none. */
function limitOf(
  input: Readonly<Record<string, unknown>>
): number | RefusedCall {
  const asked = input[LIMIT_KEY] ?? DEFAULT_PAGE_SIZE;
  const valid =
    typeof asked === "number" &&
    Number.isInteger(asked) &&
    asked >= 1 &&
    asked <= MAX_PAGE_SIZE;
  return valid
    ? asked
    : {
        refused: inputRefusal(
          LIMIT_KEY,
          `Must be a whole number from 1 to ${MAX_PAGE_SIZE}.`
        ),
      };
}

/**
 * The operation's own cursor inside the call's `after`, or `undefined` when
 * the call sent none.
 */
function cursorOf(
  tool: ServedTool,
  input: Readonly<Record<string, unknown>>
): { readonly next: string } | RefusedCall | undefined {
  const after = input[AFTER_KEY];
  if (after === undefined) return undefined;
  if (typeof after !== "string") {
    return {
      refused: inputRefusal(
        AFTER_KEY,
        "Must be the `page.next` cursor from an earlier answer."
      ),
    };
  }
  const decoded = decodeCursor(after, tool.name, input);
  if (!("problem" in decoded)) return decoded;
  return {
    refused: inputRefusal(
      AFTER_KEY,
      `The cursor ${decoded.problem}; send \`page.next\` from the previous answer of this tool, with the same other inputs.`
    ),
  };
}

/** For a list tool, the call's page size set and its cursor unwrapped, or the refusal. */
function paging(
  tool: ServedTool,
  input: Record<string, unknown>
): { readonly limit?: number } | RefusedCall {
  if (!tool.paged) return {};
  const limit = limitOf(input);
  if (typeof limit !== "number") return limit;
  input[LIMIT_KEY] = limit;
  const cursor = cursorOf(tool, input);
  if (cursor && isRefused(cursor)) return cursor;
  if (cursor) input[AFTER_KEY] = cursor.next;
  return { limit };
}

/** The call's arguments checked and split, or why they were refused. */
async function prepareCall(
  tool: ServedTool,
  args: unknown,
  maxElements: number
): Promise<PreparedCall | RefusedCall> {
  const shape = shapeRefusal(args, maxElements);
  if (shape) return shape;
  const raw: Readonly<Record<string, unknown>> = isRecord(args) ? args : {};
  const unknownKey = unknownKeyRefusal(tool, raw);
  if (unknownKey) return unknownKey;
  const format = formatOf(raw);
  if (typeof format !== "string") return format;
  const input: Record<string, unknown> = { ...raw };
  delete input[FORMAT_KEY];
  const page = paging(tool, input);
  if (isRefused(page)) return page;
  const checked = await tool.operation.input["~standard"].validate(input);
  if (checked.issues) return { refused: issuesRefusal(checked.issues) };
  return {
    input: isRecord(checked.value) ? checked.value : input,
    query: input,
    format,
    ...page,
  };
}

/**
 * Whether `result` meets the operation's own output schema. One that doesn't
 * is a defect: logged by where it failed, never by its values, and answered
 * as an internal error rather than sent on.
 */
async function resultIsValid(
  tool: ServedTool,
  result: unknown,
  logger: ToolLogger,
  requestId: string
): Promise<boolean> {
  const checked = await tool.operation.output["~standard"].validate(result);
  if (!checked.issues) return true;
  logger.error(
    "@nextlyhq/mcp: an operation's result failed its output schema",
    {
      requestId,
      tool: tool.name,
      operation: tool.operation.id,
      paths: checked.issues.map(issue =>
        (issue.path ?? []).map(String).join(".")
      ),
    }
  );
  return false;
}

/**
 * The data an answer carries: the concise cut when that format was asked for
 * (the full result whenever the cut would not pass the operation's schema),
 * with a list tool's page beside it.
 */
async function answerData(
  tool: ServedTool,
  outcome: OperationOutcome,
  prepared: PreparedCall
): Promise<unknown> {
  let data: unknown = outcome.result;
  if (prepared.format === "concise") {
    const cut = conciseCut(outcome.result, tool.outputSchema);
    const checked = await tool.operation.output["~standard"].validate(cut);
    if (!checked.issues) data = cut;
  }
  if (!tool.paged || !isRecord(data)) return data;
  const page = outcome.page;
  const next = page?.next ?? null;
  return {
    ...data,
    [PAGE_KEY]: {
      next:
        next === null ? null : encodeCursor(tool.name, prepared.query, next),
      limit: page?.limit ?? prepared.limit ?? DEFAULT_PAGE_SIZE,
      ...(page?.total === undefined ? {} : { total: page.total }),
      ...(page?.truncated === undefined ? {} : { truncated: page.truncated }),
    },
  };
}

/** What the Markdown answer needs besides the data. */
function answerContext(
  tool: ServedTool,
  format: AnswerFormat,
  adminOrigin: string | undefined,
  resolved: ResolvedName
): AnswerContext {
  const renamed =
    resolved.renamedFrom === undefined
      ? undefined
      : {
          from: resolved.renamedFrom,
          to: resolved.name,
          removableFrom: resolved.removableFrom ?? "",
        };
  return {
    title: tool.title,
    format,
    ...(adminOrigin === undefined ? {} : { adminOrigin }),
    ...(renamed ? { renamed } : {}),
  };
}

/** The refusal for an answer over the cap, which says how to ask for less. */
const ANSWER_TOO_LARGE = {
  publicMessage: `The answer would be longer than ${MAX_ANSWER_CHARACTERS} characters, so none of it was sent.`,
  next: `Ask for less: name fewer fields with \`fields\`, set a smaller \`${LIMIT_KEY}\`, add a filter, or use \`format: "concise"\`, then call again.`,
};

/**
 * Builds a door's tools from `source`, once. Throws (`INVALID_INPUT`) with
 * every problem found when any tool can't be served: no row in the table, a
 * bad name, a schema that can't describe itself.
 */
export function buildToolSet<Caller>(
  source: OperationSource<Caller>,
  options: ToolSetOptions
): ToolSet<Caller> {
  const maxInputElements =
    options.maxInputElements ?? DEFAULT_MAX_INPUT_ELEMENTS;
  const named = source.operations
    .filter(operation => servedOn(operation, options.door))
    .map(operation => ({ name: source.toolNameOf(operation), operation }));

  const names = nameMapOf(named, options.table ?? TOOL_TABLE);
  const problems = [...names.problems];
  const tools: ServedTool[] = [];
  for (const { name, operation } of named) {
    const tool = servedTool(name, operation);
    if ("problems" in tool) problems.push(...tool.problems);
    else tools.push(tool);
  }
  if (problems.length > 0) throw startUpRefusal(problems);
  const nameMap = names.map;
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  /** Runs `tool` for `binding`'s caller and answers, or answers the refusal. */
  async function call(
    server: Server,
    binding: ToolBinding<Caller>,
    resolved: ResolvedName,
    tool: ServedTool,
    args: unknown
  ): Promise<CallToolResult> {
    const requestId = binding.requestId?.() ?? newRequestId();
    const refuse = (
      error: unknown,
      extra: {
        readonly next?: string;
        readonly suggestions?: readonly string[];
      } = {}
    ): CallToolResult =>
      errorAnswer(error, {
        requestId,
        logger: binding.logger,
        tool: tool.name,
        ...extra,
      });
    try {
      const prepared = await prepareCall(tool, args, maxInputElements);
      if (isRefused(prepared)) {
        return refuse(prepared.refused, {
          ...(prepared.suggestions
            ? { suggestions: prepared.suggestions }
            : {}),
        });
      }
      const outcome = await source.run(
        tool.operation,
        prepared.input,
        binding.caller
      );
      if (
        !(await resultIsValid(tool, outcome.result, binding.logger, requestId))
      ) {
        return refuse(NextlyError.internal());
      }
      const data = await answerData(tool, outcome, prepared);
      const text = answerText(
        data,
        answerContext(tool, prepared.format, binding.adminOrigin, resolved)
      );
      if (text.length > MAX_ANSWER_CHARACTERS) {
        return refuse(
          new NextlyError({
            code: "PAYLOAD_TOO_LARGE",
            publicMessage: ANSWER_TOO_LARGE.publicMessage,
          }),
          { next: ANSWER_TOO_LARGE.next }
        );
      }
      return server.projectCallToolResult(
        {
          content: [{ type: "text", text }],
          ...(isRecord(data) ? { structuredContent: { ...data } } : {}),
        },
        tool.outputSchema
      );
    } catch (error) {
      return refuse(error);
    }
  }

  return Object.freeze({
    door: options.door,
    tools: Object.freeze(tools),
    serve(server: Server, binding: ToolBinding<Caller>): void {
      // Filtered once for this request: the definitions themselves are the
      // ones built at start-up.
      const visible = tools.filter(
        tool => binding.allows?.(tool.operation) ?? true
      );
      const visibleNames = new Set(visible.map(tool => tool.name));
      server.registerCapabilities({ tools: { listChanged: false } });
      server.setRequestHandler("tools/list", () => ({
        tools: visible.map(tool => tool.definition),
      }));
      server.setRequestHandler("tools/call", async request => {
        const resolved = nameMap.resolve(request.params.name);
        const tool = resolved ? byName.get(resolved.name) : undefined;
        if (!resolved || !tool || !visibleNames.has(tool.name)) {
          // One answer for a tool that doesn't exist and one this caller may
          // not use, so a refusal tells nobody what else the door serves.
          const close = nearestNames(request.params.name, [...visibleNames]);
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            close.length > 0
              ? `Unknown tool. Close names you may use: ${close.join(", ")}. Call tools/list for every tool you may use.`
              : "Unknown tool. Call tools/list for every tool you may use."
          );
        }
        return call(server, binding, resolved, tool, request.params.arguments);
      });
    },
  });
}
