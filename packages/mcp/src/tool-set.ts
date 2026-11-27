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
  buildNameMap,
  TOOL_TABLE,
  type NameMap,
  type ResolvedName,
  type ToolTableRow,
} from "./names";
import type {
  AgentOperation,
  Door,
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
  const problems: string[] = [];
  const named = source.operations
    .filter(operation => servedOn(operation, options.door))
    .map(operation => ({ name: source.toolNameOf(operation), operation }));

  let names: NameMap | undefined;
  try {
    names = buildNameMap(named, options.table ?? TOOL_TABLE);
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    const listed = error.logContext?.problems;
    problems.push(
      ...(Array.isArray(listed) ? listed.map(String) : [error.publicMessage])
    );
  }

  const tools: ServedTool[] = [];
  for (const { name, operation } of named) {
    const schemas = toolSchemas(name, operation);
    if ("problems" in schemas) {
      problems.push(...schemas.problems);
      continue;
    }
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
    tools.push(
      Object.freeze({
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
      })
    );
  }

  if (problems.length > 0 || !names) {
    // Refused at start-up the way core refuses an operation list with a
    // problem, so a door never starts serving a tool nobody reviewed.
    throw NextlyError.invalidInput({
      message: [
        `The MCP tool list can't be built: ${problems.length === 1 ? "a problem" : `${problems.length} problems`}.`,
        ...problems.map(problem => `- ${problem}`),
      ].join("\n"),
      logContext: { problems },
    });
  }
  const nameMap = names;
  const byName = new Map(tools.map(tool => [tool.name, tool]));

  /** The call's arguments checked and split, or why they were refused. */
  async function prepare(
    tool: ServedTool,
    args: unknown
  ): Promise<PreparedCall | RefusedCall> {
    if (elementCount(args, maxInputElements) > maxInputElements) {
      return {
        refused: new NextlyError({
          code: "PAYLOAD_TOO_LARGE",
          publicMessage: `The arguments hold more than ${maxInputElements} elements, the most one call may send.`,
        }),
      };
    }
    if (args !== undefined && !isRecord(args)) {
      return { refused: inputRefusal("", "The arguments must be an object.") };
    }
    const raw: Readonly<Record<string, unknown>> = args ?? {};
    const properties = propertiesOf(tool.inputSchema) ?? {};
    if (tool.inputSchema.additionalProperties === false) {
      const unknownKey = Object.keys(raw).find(key => !(key in properties));
      if (unknownKey !== undefined) {
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
          suggestions: nearestNames(unknownKey, Object.keys(properties)),
        };
      }
    }
    const format = raw[FORMAT_KEY] ?? FORMATS[0];
    if (format !== "concise" && format !== "detailed") {
      return {
        refused: inputRefusal(FORMAT_KEY, 'Must be "concise" or "detailed".'),
      };
    }
    const input: Record<string, unknown> = { ...raw };
    delete input[FORMAT_KEY];
    let limit: number | undefined;
    if (tool.paged) {
      const asked = input[LIMIT_KEY] ?? DEFAULT_PAGE_SIZE;
      if (
        typeof asked !== "number" ||
        !Number.isInteger(asked) ||
        asked < 1 ||
        asked > MAX_PAGE_SIZE
      ) {
        return {
          refused: inputRefusal(
            LIMIT_KEY,
            `Must be a whole number from 1 to ${MAX_PAGE_SIZE}.`
          ),
        };
      }
      limit = asked;
      input[LIMIT_KEY] = asked;
      const after = input[AFTER_KEY];
      if (after !== undefined) {
        if (typeof after !== "string") {
          return {
            refused: inputRefusal(
              AFTER_KEY,
              "Must be the `page.next` cursor from an earlier answer."
            ),
          };
        }
        const decoded = decodeCursor(after, tool.name, input);
        if ("problem" in decoded) {
          return {
            refused: inputRefusal(
              AFTER_KEY,
              `The cursor ${decoded.problem}; send \`page.next\` from the previous answer of this tool, with the same other inputs.`
            ),
          };
        }
        input[AFTER_KEY] = decoded.next;
      }
    }
    const checked = await tool.operation.input["~standard"].validate(input);
    if (checked.issues) return { refused: issuesRefusal(checked.issues) };
    return {
      input: isRecord(checked.value) ? checked.value : input,
      query: input,
      format,
      ...(limit === undefined ? {} : { limit }),
    };
  }

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
    let prepared: PreparedCall | RefusedCall;
    try {
      prepared = await prepare(tool, args);
    } catch (error) {
      // A schema library that throws instead of answering with issues.
      return refuse(error);
    }
    if ("refused" in prepared) {
      return refuse(prepared.refused, {
        ...(prepared.suggestions ? { suggestions: prepared.suggestions } : {}),
      });
    }

    try {
      const outcome = await source.run(
        tool.operation,
        prepared.input,
        binding.caller
      );
      const checked = await tool.operation.output["~standard"].validate(
        outcome.result
      );
      if (checked.issues) {
        // The operation answered outside its own schema: a defect, logged
        // and answered as an internal error, never sent on.
        binding.logger.error(
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
        return refuse(NextlyError.internal());
      }
      let data: unknown = outcome.result;
      if (prepared.format === "concise") {
        const cut = conciseCut(outcome.result, tool.outputSchema);
        const cutChecked =
          await tool.operation.output["~standard"].validate(cut);
        // The cut keeps every required field, so it passes; if an unusual
        // schema still refuses it, the full result is answered instead.
        if (!cutChecked.issues) data = cut;
      }
      if (tool.paged && isRecord(data)) {
        const page = outcome.page;
        data = {
          ...data,
          [PAGE_KEY]: {
            next:
              page && page.next !== null
                ? encodeCursor(tool.name, prepared.query, page.next)
                : null,
            limit: page?.limit ?? prepared.limit ?? DEFAULT_PAGE_SIZE,
            ...(page?.total === undefined ? {} : { total: page.total }),
            ...(page?.truncated === undefined
              ? {}
              : { truncated: page.truncated }),
          },
        };
      }
      const context: AnswerContext = {
        title: tool.title,
        format: prepared.format,
        ...(binding.adminOrigin === undefined
          ? {}
          : { adminOrigin: binding.adminOrigin }),
        ...(resolved.renamedFrom === undefined
          ? {}
          : {
              renamed: {
                from: resolved.renamedFrom,
                to: resolved.name,
                removableFrom: resolved.removableFrom ?? "",
              },
            }),
      };
      const text = answerText(data, context);
      if (text.length > MAX_ANSWER_CHARACTERS) {
        return refuse(
          new NextlyError({
            code: "PAYLOAD_TOO_LARGE",
            publicMessage: `The answer would be longer than ${MAX_ANSWER_CHARACTERS} characters, so none of it was sent.`,
          }),
          {
            next: `Ask for less: name fewer fields with \`fields\`, set a smaller \`${LIMIT_KEY}\`, add a filter, or use \`format: "concise"\`, then call again.`,
          }
        );
      }
      const result: CallToolResult = {
        content: [{ type: "text", text }],
        ...(isRecord(data) ? { structuredContent: { ...data } } : {}),
      };
      return server.projectCallToolResult(result, tool.outputSchema);
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
