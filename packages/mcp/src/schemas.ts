/**
 * A tool's input and output JSON Schemas, made once from its operation's
 * schemas when the door starts.
 *
 * Two things are added to what the operation declares:
 *
 * - every tool takes `format` (`concise`, the default, or `detailed`), which
 *   decides how much of the result an answer carries;
 * - a list tool (one whose input takes `limit` and `after`, the operation
 *   list's paging words) answers with `page` beside its result, holding the
 *   cursor for the next page.
 *
 * @module schemas
 * @experimental
 */
import type { AgentOperation } from "./operation";

/** The JSON Schema dialect tools are described in, the protocol's default. */
export const JSON_SCHEMA_TARGET = "draft-2020-12";

/** The input property that picks how much an answer carries. */
export const FORMAT_KEY = "format";

/** The two answer formats; the first is the default. */
export const FORMATS: readonly ["concise", "detailed"] = [
  "concise",
  "detailed",
] as const;

export type AnswerFormat = (typeof FORMATS)[number];

/** The input properties that make a tool a list tool. */
export const LIMIT_KEY = "limit";
export const AFTER_KEY = "after";

/** The output property a list tool's page travels in. */
export const PAGE_KEY = "page";

/** The page size when a call names none, and the most a call may ask for. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

type JsonSchema = Readonly<Record<string, unknown>>;

const FORMAT_PROPERTY: JsonSchema = {
  type: "string",
  enum: [...FORMATS],
  default: "concise",
  description:
    "How much the answer carries: `concise` (the default) gives the fields that identify each item; `detailed` gives every field.",
};

const LIMIT_PROPERTY: JsonSchema = {
  type: "integer",
  minimum: 1,
  maximum: MAX_PAGE_SIZE,
  default: DEFAULT_PAGE_SIZE,
  description: `How many items one page holds: ${DEFAULT_PAGE_SIZE} unless given, at most ${MAX_PAGE_SIZE}.`,
};

const AFTER_PROPERTY: JsonSchema = {
  type: "string",
  description:
    "The `page.next` cursor from the previous answer, to get the page after it. Send it with the same other inputs as the call that returned it.",
};

const PAGE_PROPERTY: JsonSchema = {
  type: "object",
  description:
    "Where the list stands. `next` is the cursor for the next page (send it back as `after`), or null on the last page.",
  properties: {
    next: { type: ["string", "null"] },
    limit: { type: "integer" },
    total: { type: "integer" },
    truncated: { type: "boolean" },
  },
  required: ["next", "limit"],
  additionalProperties: false,
};

/** A tool's two schemas, and whether it pages. */
export interface ToolSchemas {
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly paged: boolean;
}

/** A frozen copy, so a schema handed to every request can't be changed by one. */
function frozen<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(entry => frozen<unknown>(entry))) as T;
  }
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = frozen<unknown>(entry);
    }
    return Object.freeze(copy) as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The properties of an object schema, or `undefined` when it has none to read. */
export function propertiesOf(
  schema: JsonSchema
): Readonly<Record<string, JsonSchema>> | undefined {
  const properties = schema.properties;
  if (!isRecord(properties)) return undefined;
  const out: Record<string, JsonSchema> = {};
  for (const [key, entry] of Object.entries(properties)) {
    if (isRecord(entry)) out[key] = entry;
  }
  return out;
}

/** Whether `schema` describes an object (by its `type`, or with no type at all). */
function describesObject(schema: JsonSchema): boolean {
  return schema.type === undefined || schema.type === "object";
}

/**
 * The tool's schemas for `operation`, or the problems that stop it being
 * served. `name` only labels the problems.
 */
export function toolSchemas(
  name: string,
  operation: AgentOperation
): ToolSchemas | { readonly problems: readonly string[] } {
  const label = `The tool "${name}" (operation "${operation.id}")`;
  const describe = (side: "input" | "output"): JsonSchema | string => {
    const converter = operation[side]["~standard"].jsonSchema;
    if (!converter) {
      return `${label}: its ${side} schema can't describe itself as JSON Schema; declare it with a library that implements ~standard.jsonSchema (Zod 4.2 or later)`;
    }
    try {
      return converter[side]({ target: JSON_SCHEMA_TARGET });
    } catch {
      return `${label}: its ${side} schema failed to convert to JSON Schema`;
    }
  };
  const input = describe("input");
  const output = describe("output");
  const problems: string[] = [];
  if (typeof input === "string") problems.push(input);
  if (typeof output === "string") problems.push(output);
  if (typeof input === "string" || typeof output === "string") {
    return { problems };
  }

  const inputProperties = propertiesOf(input);
  if (!describesObject(input) || !inputProperties) {
    problems.push(
      `${label}: its input schema is not an object with properties`
    );
    return { problems };
  }
  if (FORMAT_KEY in inputProperties) {
    problems.push(
      `${label}: its input already has a "${FORMAT_KEY}" property, which the adapter adds to every tool`
    );
  }
  const paged = LIMIT_KEY in inputProperties && AFTER_KEY in inputProperties;
  const outputProperties = propertiesOf(output);
  if (paged) {
    if (!describesObject(output) || !outputProperties) {
      problems.push(
        `${label}: it pages, so its output must be an object with properties to carry "${PAGE_KEY}"`
      );
    } else if (PAGE_KEY in outputProperties) {
      problems.push(
        `${label}: its output already has a "${PAGE_KEY}" property, which the adapter adds to every list`
      );
    }
  }
  if (problems.length > 0) return { problems };

  const toolInput: Record<string, unknown> = {
    ...input,
    type: "object",
    properties: {
      ...inputProperties,
      ...(paged
        ? {
            [LIMIT_KEY]: { ...inputProperties[LIMIT_KEY], ...LIMIT_PROPERTY },
            [AFTER_KEY]: { ...inputProperties[AFTER_KEY], ...AFTER_PROPERTY },
          }
        : {}),
      [FORMAT_KEY]: FORMAT_PROPERTY,
    },
  };
  const toolOutput: Record<string, unknown> =
    paged && outputProperties
      ? {
          ...output,
          type: "object",
          properties: { ...outputProperties, [PAGE_KEY]: PAGE_PROPERTY },
        }
      : { ...output };
  return { input: frozen(toolInput), output: frozen(toolOutput), paged };
}
