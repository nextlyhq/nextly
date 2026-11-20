/**
 * `SanitizedNextlyConfig.perLanguageStorage` stays a required boolean in the published type, read
 * through both entry points that export it (`nextly` and `nextly/config`). The setting no longer
 * chooses a layout, but a consumer that assigns the sanitized value to a boolean, or hands it to
 * an API taking one, must keep compiling: widening it to `boolean | undefined` is the regression
 * this file catches. Compiled by `pnpm check-types`.
 */
import type { SanitizedNextlyConfig as FromConfig } from "../config";
import type { SanitizedNextlyConfig as FromRoot } from "../index";

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

assertType<Exact<FromRoot["perLanguageStorage"], boolean>>(true);
assertType<Exact<FromConfig["perLanguageStorage"], boolean>>(true);
