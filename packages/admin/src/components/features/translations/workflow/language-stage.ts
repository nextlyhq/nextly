/**
 * A language's stage in the workflow that holds publishing, said beside its
 * status: the status says what readers see, the stage what the language waits
 * for.
 *
 * @module components/features/translations/workflow/language-stage
 */

/**
 * The status and the stage on one line, or the status alone where the language
 * stands in no stage: none is attached, or nothing of it waits to go live.
 */
export function statusWithStage(
  status: string,
  stage: string | undefined
): string {
  const named = stage?.trim() ?? "";
  return named === "" ? status : `${status} · ${named}`;
}
