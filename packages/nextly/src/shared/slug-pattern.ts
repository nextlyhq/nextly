/**
 * The one shape a slug takes: a lowercase letter, then lowercase letters,
 * numbers, hyphens and underscores. Length: 1-50 chars, checked where a slug is
 * named.
 *
 * A module of its own, importing nothing, so code that reaches the browser
 * (the widget settings knobs) reads the same rule the schema validator applies.
 *
 * @module shared/slug-pattern
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9_-]*$/;
