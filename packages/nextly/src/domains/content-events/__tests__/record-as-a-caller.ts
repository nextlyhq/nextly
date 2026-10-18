/**
 * Write one content event as a caller writes one: in a transaction of its
 * own, with the deleted-people check read on that transaction under the
 * shared lock, so a test records through the same path a feature will.
 */
import { getDialectTables } from "../../../database/index";
import type { TestDialect, TestNextly } from "../../../plugins/test-nextly";
import { rowLockServer } from "../../audit/audit-log-writer";
import {
  principalDigestTablesOf,
  readPrincipalDigests,
  type PrincipalDigestDb,
} from "../../audit/principal-digest";
import { recordContentEvent, type ContentEventInput } from "../record";

/** Record `input` on `nextly`'s database, sealing the digest key with `secrets`. */
export function recordAsACaller(
  nextly: TestNextly,
  dialect: TestDialect,
  input: ContentEventInput,
  secrets: readonly string[]
): Promise<{ id: string }> {
  return nextly.adapter.transaction(async tx => {
    const principals = await readPrincipalDigests(
      tx.getDrizzle<PrincipalDigestDb>(),
      rowLockServer(nextly.adapter, dialect),
      principalDigestTablesOf(getDialectTables(dialect)),
      "shared",
      secrets
    );
    return recordContentEvent(tx, input, { principals });
  });
}
