/**
 * The AI contract on a booted site, on PostgreSQL. The suite is
 * `ai-contract-suite.ts`: its header says what is pinned and why each
 * dialect runs in a file of its own.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { describeAIContract } from "./ai-contract-suite";

describeAIContract("postgresql");
