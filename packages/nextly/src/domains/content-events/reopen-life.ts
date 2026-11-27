/**
 * Re-open the life a deletion ended: the document it recorded the deletion
 * of is back, under its id, so its earlier events, and the deletion itself,
 * are its current life again.
 *
 * A deletion stamps every event of the life it ends with its own id, and is
 * itself stored as one that ends its subject (`recordContentEvent`). History
 * reads the current life as the events with no stamp, and retention removes
 * a stamped life once its deletion is older than the activity log's window.
 * Re-opening clears exactly that deletion's stamps and its ending flag, so
 * the document's history reads as one life, the deletion and the restore in
 * it, and retention leaves it as it leaves any live document's. Any other
 * life of the same id, ended by another deletion, is untouched.
 *
 * Used by a restore from the trash, on its own transaction.
 *
 * @module domains/content-events/reopen-life
 */
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { CONTENT_EVENTS_TABLE } from "../../schemas/content-events";

export async function reopenEndedLife(
  tx: Pick<TransactionContext, "update">,
  deletionEventId: string
): Promise<void> {
  // The deletion first stops ending its subject, so retention never finds it
  // as an ended life between the two statements.
  await tx.update(
    CONTENT_EVENTS_TABLE,
    { endsSubject: false },
    { and: [{ column: "id", op: "=", value: deletionEventId }] }
  );
  await tx.update(
    CONTENT_EVENTS_TABLE,
    { endedBy: null },
    { and: [{ column: "endedBy", op: "=", value: deletionEventId }] }
  );
}
