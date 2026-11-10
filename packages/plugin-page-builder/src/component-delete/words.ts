/**
 * What the component delete says, in one place, so the dialog, the routes and
 * the guards word each refusal alike.
 *
 * @module component-delete/words
 */
import type { LeftDocumentReason } from "./contract";

/** Why a document was left, in words an author can act on. */
export function leftWords(reason: LeftDocumentReason): string {
  switch (reason) {
    case "refused":
      return "Its copy can't be turned into plain blocks without breaking a locked area or a setting that needs the component.";
    case "pending-draft":
      return "It has unpublished changes. Publish or discard them, then try again.";
    case "not-permitted":
      return "You don't have permission to change it.";
    case "unreadable":
      return "It couldn't be read to the end, so whether it uses the component can't be told.";
    case "unaddressable":
      return "Its copy sits where it can't be changed automatically, such as inside a repeater. Remove the component there by hand.";
    case "changed":
      return "It kept changing while its copy was being converted. Try again when nobody is editing it.";
    case "write-refused":
      return "Saving the converted copy was refused by the document's own rules.";
    case "layout":
      return "A Layout uses the component. Choose a different component in that Layout first.";
  }
}

/** The envelope's message for each answer. */
export const MESSAGES = {
  none: "Nothing uses this component, so it can be deleted.",
  used: "Deleting this component turns each copy into plain blocks first.",
  refused: "This component can't be deleted yet.",
  running:
    "The copies are being turned into plain blocks. Keep this open while they are updated. Closing pauses, and you can resume later.",
  partlyDone:
    "Some copies couldn't be turned into plain blocks, so the component was kept. Fix the documents listed, then delete it again.",
  done: "The component was deleted. Its copies are plain blocks now.",
  idle: "This component isn't being deleted.",
  counting: "Still checking where this component is used…",
} as const;

/** A second person starting a delete somebody else is running. */
export const SOMEONE_ELSE_IS_DELETING =
  "Someone else is deleting this component. Try again once they have finished.";

/** Any delete of a component except the delete action's own last step. */
export const DELETE_THROUGH_THE_ACTION =
  "Components are deleted with Delete component, which turns their copies into plain blocks first. Use it instead.";

/** A delete of a component inside a batch or another transaction. */
export const NOT_IN_A_BATCH =
  "Components can't be deleted as part of a batch. Delete each one with Delete component.";

/**
 * Unpublishing a component documents place, naming the ones the person may
 * read and counting the rest.
 */
export function unpublishRefusal(found: {
  readonly titles: readonly string[];
  readonly others: number;
  /** Whether the documents found are all there are. */
  readonly whole: boolean;
}): string {
  const total = found.titles.length + found.others;
  if (total === 0) {
    return "This component can't be unpublished yet: whether any page uses it couldn't be confirmed. Try again later, or delete it with Delete component, which turns any copies into plain blocks.";
  }
  const listed = found.titles.map(title => `"${title}"`);
  if (found.others > 0) {
    listed.push(
      `${String(found.others)} ${found.others === 1 ? "other" : "others"}`
    );
  }
  const count = `${found.whole ? "" : "at least "}${String(total)} ${
    total === 1 ? "document uses" : "documents use"
  } it`;
  return `This component can't be unpublished because ${count}: ${joined(listed)}. They would show a gap where it was. Remove it from them first, or delete it with Delete component, which turns its copies into plain blocks.`;
}

/** "a", "a and b", "a, b and c". */
function joined(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}
