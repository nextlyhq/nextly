/**
 * The facts an operation must declare are required by its type, so a
 * declaration that leaves one out does not compile. The checker evaluates
 * each assertion below; a field made optional, or a new required field,
 * fails the equality by name.
 */
import { expectTypeOf } from "vitest";
import { z } from "zod";

import {
  defineOperation,
  type OperationDefinition,
  type OperationRun,
} from "../definition";

/** The keys of `T` that a value must have. */
type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

/** The keys of `T` a value may leave out. */
type OptionalKeys<T> = Exclude<keyof T, RequiredKeys<T>>;

expectTypeOf<RequiredKeys<OperationDefinition>>().toEqualTypeOf<
  | "id"
  | "command"
  | "aliases"
  | "summary"
  | "description"
  | "input"
  | "output"
  | "level"
  | "effects"
  | "doors"
  | "permission"
  | "dryRun"
  | "long"
  | "examples"
  | "exitCodes"
  | "source"
  | "stability"
>();

// Off unless declared, or only present to replace a derived value.
expectTypeOf<OptionalKeys<OperationDefinition>>().toEqualTypeOf<
  "alwaysAllow" | "raise" | "chatExposed" | "toolName" | "docs"
>();

// Each effect is required too.
expectTypeOf<RequiredKeys<OperationDefinition["effects"]>>().toEqualTypeOf<
  "destroys" | "idempotent" | "outside" | "spendsAi"
>();

// At least one example: an empty list is not one.
expectTypeOf<readonly []>().not.toExtend<OperationDefinition["examples"]>();

// The schemas type the rest of the declaration: an example is the input as
// written, and a raise rule reads the input as parsed.
const update = defineOperation({
  id: "content.update",
  command: ["content", "update"],
  aliases: [],
  summary: "Update entries",
  description: "Saves changes to entries as drafts.",
  input: z.object({ ids: z.array(z.string()), limit: z.number().default(20) }),
  output: z.object({ updated: z.number() }),
  level: "draft",
  raise: [{ when: "more than 25", level: "change", applies: ({ input }) => input.ids.length > 25 }],
  effects: { destroys: true, idempotent: true, outside: false, spendsAi: false },
  doors: ["local"],
  permission: { kind: "permission", name: "update-posts" },
  dryRun: true,
  long: false,
  examples: [{ summary: "One entry", input: { ids: ["1"] } }],
  exitCodes: [],
  source: { kind: "core" },
  stability: "experimental",
});
expectTypeOf(update.examples[0].input).toEqualTypeOf<{ ids: string[]; limit?: number | undefined }>();
expectTypeOf<Parameters<NonNullable<typeof update.raise>[number]["applies"]>[0]>().toEqualTypeOf<
  OperationRun<{ ids: string[]; limit: number }>
>();

// A typed declaration fits in the list's untyped one.
expectTypeOf(update).toExtend<OperationDefinition>();
