/**
 * What the admin says about a collection or Single removed from code: that it
 * is no longer in the configuration, that it can be read but not changed, and
 * the next step for where its retirement stands.
 *
 * Words only, so the navigation's mark, the list screen and the editor say the
 * same thing from one place, and a test can read them without rendering.
 *
 * @module components/features/entries/removed-from-code-notice
 */

import type {
  RemovedFromCodeMark,
  RemovedFromCodeState,
} from "@admin/types/removed-from-code";

/** One piece of a sentence: plain text, or a command or file set as code. */
export type NoticePart = string | { code: string };

export interface RemovedFromCodeNoticeText {
  /** Names the entity and says it is no longer in the configuration. */
  summary: string;
  /** The next step for its state, commands and files marked as code. */
  step: readonly NoticePart[];
}

export interface RemovedEntity {
  kind: "collection" | "single";
  /** The name a reader knows it by. */
  label: string;
  slug: string;
}

/** Whether the server marked this entity removed from code. */
export function isRemovedFromCode(
  entity: RemovedFromCodeMark | null | undefined
): boolean {
  return entity?.removedFromCode === true;
}

/** Whether a removed entity's main table is gone, so its entries cannot be read either. */
export function removedEntityHasNoTable(
  entity: RemovedFromCodeMark | null | undefined
): boolean {
  return (
    isRemovedFromCode(entity) &&
    entity?.removedFromCodeState?.state === "half-retired"
  );
}

/** The step a state names. */
function stepFor(state: RemovedFromCodeState | undefined): NoticePart[] {
  switch (state?.state) {
    case "not-dropped":
      return [
        "To retire it, run ",
        { code: "nextly migrate:create" },
        ", then ",
        { code: "nextly migrate" },
        ". To keep it, declare it again in ",
        { code: "nextly.config.ts" },
        ".",
      ];
    case "drop-pending":
      return [
        "A migration that retires it is written but not applied yet. Run ",
        { code: "nextly migrate" },
        " to apply ",
        { code: state.migration },
        ".",
      ];
    case "half-retired":
      return [
        "An earlier release left it part-retired: a migration dropped its table, and some of its records remain. Run ",
        { code: "nextly prune" },
        ", which lists what remains.",
      ];
    default:
      return [
        "Run ",
        { code: "nextly migrate:status" },
        " to see where its retirement stands.",
      ];
  }
}

/** The notice for `entity` in `state`. */
export function removedFromCodeNotice(
  entity: RemovedEntity,
  state: RemovedFromCodeState | undefined
): RemovedFromCodeNoticeText {
  const noun = entity.kind === "single" ? "Single" : "collection";
  const readable = removedEntityHasNoTable({
    removedFromCode: true,
    ...(state === undefined ? {} : { removedFromCodeState: state }),
  })
    ? ""
    : entity.kind === "single"
      ? " It can be read, but not changed."
      : " Its entries can be read, but not changed.";
  return {
    summary:
      `“${entity.label}” is no longer in the configuration: nextly.config.ts ` +
      `does not declare the ${noun} “${entity.slug}”.${readable}`,
    step: stepFor(state),
  };
}

/** The notice as one plain sentence, for a tooltip or an accessible description. */
export function noticeAsText(notice: RemovedFromCodeNoticeText): string {
  const step = notice.step
    .map(part => (typeof part === "string" ? part : part.code))
    .join("");
  return `Removed from code. ${notice.summary} ${step}`;
}
