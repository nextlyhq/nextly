import { useCan } from "@admin/hooks/useCan";

import { bulkMoveSteps } from "./bulk-workflow-moves";
import type { CollectionForColumns } from "./EntryTableColumns";

/** Which bulk actions the entry list offers on a collection. */
export interface EntryBulkActions {
  delete: boolean;
  publish: boolean;
  unpublish: boolean;
  /**
   * Whether the workflow's moves (Submit for review, Assign…, Send back…) are offered: on a
   * collection a workflow holds, to a reader who may edit its entries or may take, on THIS
   * collection, a step the list takes in bulk (its one submit or send-back step). Which move each
   * document takes is the server's to judge, each refusal named.
   */
  workflowMoves: boolean;
  /**
   * Whether any of them is offered, and so whether rows can be selected at
   * all: a selection with nothing to do with it is a control that leads
   * nowhere.
   */
  any: boolean;
}

/**
 * The bulk actions the current user may use on `collection`, each as the
 * server answers its permission. Publish and unpublish exist only on a
 * collection with the built-in Draft / Published lifecycle (`status: true`),
 * so a permission for them on any other collection offers nothing.
 *
 * One answer for the table's checkboxes, its row Delete, the bulk bar and the
 * list's keyboard shortcuts, so none of them offers what another withholds.
 * The slug is empty without a collection, which no permission matches, so the
 * hooks stay unconditional and the answer is "nothing".
 */
export function useEntryBulkActions(
  collection:
    | Pick<
        CollectionForColumns,
        "slug" | "status" | "removedFromCode" | "disableDelete" | "workflow"
      >
    | undefined
): EntryBulkActions {
  const slug = collection?.slug ?? "";
  const hasStatus = collection?.status === true;
  // A collection removed from code refuses every write to its entries, so no
  // permission offers one here.
  const writable = collection?.removedFromCode !== true;
  const canDelete = useCan(`delete-${slug}`);
  const canPublish = useCan(`publish-${slug}`);
  const canUnpublish = useCan(`unpublish-${slug}`);
  const canUpdate = useCan(`update-${slug}`);
  // Whether the reader may take, on THIS collection, a step the list takes in bulk: one who reviews
  // it but does not edit it. A step's action is spelled as stored (`sign-off` → `sign-off-posts`),
  // so a reviewer of another collection only holds none here. Two fixed asks, one per bulk step;
  // an empty slug matches no permission.
  const steps = collection?.workflow?.steps ?? [];
  const bulkSteps = bulkMoveSteps(steps);
  const permissionOf = (name: string | undefined) => {
    const action = steps.find(step => step.name === name)?.action;
    return action !== undefined && slug !== "" ? `${action}-${slug}` : "";
  };
  const submitsHere = useCan(permissionOf(bulkSteps.submit));
  const sendsBackHere = useCan(permissionOf(bulkSteps.sendBack));
  const reviewsHere = submitsHere || sendsBackHere;

  // A collection deleted through an action of its own (a plugin's) is offered
  // no Delete here: the server would refuse it, and that action is offered
  // beside the row instead.
  const deletable = collection?.disableDelete !== true;

  const offered = {
    delete: writable && deletable && slug !== "" && canDelete,
    publish: writable && hasStatus && canPublish,
    unpublish: writable && hasStatus && canUnpublish,
    workflowMoves:
      writable &&
      slug !== "" &&
      Boolean(collection?.workflow) &&
      (canUpdate || reviewsHere),
  };
  return {
    ...offered,
    any:
      offered.delete ||
      offered.publish ||
      offered.unpublish ||
      offered.workflowMoves,
  };
}
