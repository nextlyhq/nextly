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
} as const;
