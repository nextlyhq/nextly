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

/**
 * Where the toaster's bottom edge sits, as a custom property on the document
 * root. The toaster reads it with its own default as the fallback, so toasts
 * stay in their usual corner until something else claims that corner: the
 * media library's upload tray sets it to clear itself while it is open, and
 * removes it when it closes, so a toast appears above the tray, not over it.
 */
export const TOAST_OFFSET_BOTTOM_PROPERTY = "--nx-toast-offset-bottom";
