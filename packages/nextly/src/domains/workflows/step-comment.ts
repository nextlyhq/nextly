/**
 * The longest comment a step keeps: the record of content events' note limit. One constant for
 * the step that refuses a longer one and for the notice that keeps a request for changes' comment,
 * so the notice never refuses what the step accepted.
 *
 * @module domains/workflows/step-comment
 */
export const MAX_STEP_COMMENT_LENGTH = 4000;
