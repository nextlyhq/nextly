/**
 * `asWritten` takes off exactly the comments a schema-lock holder sends in front of a statement,
 * and nothing a caller wrote: the tests that judge statements by how they start rely on both.
 */
import { describe, expect, it } from "vitest";

import { unitComment } from "../../domains/schema/pipeline/lock-statement-unit";

import { asWritten } from "./statement-as-written";

const CLAIM =
  "/* nextly-lock:build-host:4242#5f0c1e2a-0000-4000-8000-000000000000 */ ";

describe("asWritten", () => {
  it.each([
    ["the claim alone", `${CLAIM}ALTER TABLE t ADD COLUMN c integer`],
    [
      "the claim and a file's name",
      `${CLAIM}${unitComment("0007_late value.sql")}ALTER TABLE t ADD COLUMN c integer`,
    ],
    [
      "the claim and a command's name",
      `${CLAIM}${unitComment("Schema Builder: collection update")}ALTER TABLE t ADD COLUMN c integer`,
    ],
  ])("removes %s", (_, sent) => {
    expect(asWritten(sent)).toBe("ALTER TABLE t ADD COLUMN c integer");
  });

  it.each([
    ["an unmarked statement", "ALTER TABLE t ADD COLUMN c integer"],
    ["a statement's own leading line break", "\n  CREATE TABLE t (id integer)"],
    ["an optimizer hint", "/*+ MAX_EXECUTION_TIME(1000) */ SELECT 1"],
    ["a MySQL executable comment", "/*!40101 SET NAMES utf8mb4 */"],
    [
      "a comment of the caller's own",
      "/* keep */ ALTER TABLE t ADD COLUMN c integer",
    ],
  ])("keeps %s as written", (_, statement) => {
    expect(asWritten(statement)).toBe(statement);
  });

  it("keeps a caller's own comment that follows the lock's", () => {
    expect(asWritten(`${CLAIM}/* keep */ SELECT 1`)).toBe(
      "/* keep */ SELECT 1"
    );
  });
});
