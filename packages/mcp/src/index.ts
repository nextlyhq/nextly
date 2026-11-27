/**
 * `@nextlyhq/mcp`: turns the operations marked for agents into Model Context
 * Protocol tools. Every MCP door uses it, so both serve the same tools from
 * the same adapter: build a door's tools once with `buildToolSet`, then call
 * `serve` on each request's server with the caller.
 *
 * @module @nextlyhq/mcp
 * @experimental
 */
export type {
  AgentOperation,
  DescribedSchema,
  Door,
  OperationEffects,
  OperationOutcome,
  OperationPage,
  OperationSource,
  RiskLevel,
  SchemaResult,
  ToolNameAlias,
} from "./operation";
export {
  buildToolSet,
  DEFAULT_MAX_INPUT_ELEMENTS,
  type ServedTool,
  type ToolBinding,
  type ToolSet,
  type ToolSetOptions,
} from "./tool-set";
export {
  MAX_TOOL_NAME_LENGTH,
  TOOL_TABLE,
  toolNameProblem,
  type ToolTableRow,
} from "./names";
export { hintsFor, type ToolHints } from "./hints";
export { MAX_ANSWER_CHARACTERS } from "./answers";
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type AnswerFormat } from "./schemas";
export type { ToolLogger, UnknownNameData } from "./errors";
export { toolListSnapshot } from "./snapshot";
