/**
 * UI Constants
 *
 * Centralized UI-related magic numbers for consistent behavior across components.
 */

export const UI = {
  /** Timeout for copy-to-clipboard feedback indicators (ms) */
  COPY_FEEDBACK_TIMEOUT_MS: 2000,

  /** Default debounce delay for search inputs (ms) */
  SEARCH_DEBOUNCE_MS: 300,

  /** Delay before programmatic focus operations (ms) */
  FOCUS_DELAY_MS: 300,

  /**
   * Pause that ends an edit of the preview's custom width (ms).
   *
   * The preview frame is a live iframe of the site, so every committed width
   * re-lays-out a whole page. Typing `768` after clearing the box emits `7`,
   * `76`, `768` — three layouts, two of them at widths the author never meant —
   * so the width is taken once they stop typing rather than per keystroke.
   * Matched to `SEARCH_DEBOUNCE_MS` because it answers the same question about
   * a person: have they finished.
   */
  PREVIEW_WIDTH_DEBOUNCE_MS: 300,
} as const;
