/**
 * Core's operations, one registration line per group.
 *
 * Each group lives in its own folder beside this file
 * (`core/<group>/`, such as `core/migrations/`), exports its declarations as
 * one array, and is spread in here on one line. The levels table in
 * `../__tests__/levels-table.ts` holds a row for every operation listed here,
 * so adding one without stating its level, effects and doors fails the tests.
 *
 * Empty until today's commands move onto the list: nothing people run is
 * built from it yet.
 *
 * @module operations/core
 * @experimental
 */
import type { OperationDefinition } from "../definition";

export const CORE_OPERATIONS: readonly OperationDefinition[] = [];
