/**
 * A host can no longer state a spacing model in `pageBuilder({ siteStyle })`:
 * the option left the type, so a configuration still setting it fails type
 * checking (an untyped host gets one warning at start instead; see
 * `plugin-spacing-removal.test`).
 *
 * Written as assignments the checker EVALUATES rather than as
 * `@ts-expect-error`, which would also pass on an unrelated error on the same
 * line, or on none once the rejection stopped happening.
 *
 * `.test-d.ts` rather than `.test.ts`: test files are in no TypeScript program
 * in this package, so only this form is checked.
 *
 * @module site-style-options.test-d
 */
import type { pageBuilder } from "./plugin";
import type { SiteStyleData } from "./site-style";

/** True when `T` declares the key `K`. */
type Declares<T, K extends PropertyKey> = K extends keyof T ? true : false;

type SiteStyleOption = NonNullable<
  NonNullable<Parameters<typeof pageBuilder>[0]>["siteStyle"]
>;

/** Neither the option a host passes nor the site style it resolves to. */
const optionHasNoSpacingMode: Declares<SiteStyleOption, "spacingMode"> = false;
const styleHasNoSpacingMode: Declares<SiteStyleData, "spacingMode"> = false;

/**
 * The positive control: `Declares` answering `false` for everything would
 * satisfy both lines above, so a key the option does declare comes out true.
 */
const optionStillHasTokens: Declares<SiteStyleOption, "tokens"> = true;

export { optionHasNoSpacingMode, optionStillHasTokens, styleHasNoSpacingMode };
