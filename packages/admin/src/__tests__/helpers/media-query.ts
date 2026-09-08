/**
 * Make jsdom answer a media query, for a test whose subject is the window.
 *
 * The global stub in `setup.ts` answers "no match" to everything, which exists
 * so components that merely CALL `matchMedia` while mounting do not die. A test
 * whose subject is the answer itself has to state one, or it asserts against
 * the stub's default and passes for a reason that has nothing to do with the
 * property — which the setup file says in as many words for system theme, and
 * is equally true of anything keyed on the window's size.
 *
 * `matches` is returned for EVERY query rather than per pattern. A helper that
 * matched on the query string would need the caller to restate the breakpoint
 * a component owns, which is the same number in two places; callers here have
 * one query each, so the distinction has nowhere to hide a defect.
 *
 * @module __tests__/helpers/media-query
 */
import { vi } from "vitest";

/** Answer every media query with `matches`, for the current test. */
export function answerMediaQueries(matches: boolean): void {
  window.matchMedia = vi.fn((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}
