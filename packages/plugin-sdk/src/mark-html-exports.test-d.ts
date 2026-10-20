/**
 * Type-level test: marked email HTML is re-exported from the SDK boundary as
 * the `nextly` root's own declarations, not copies. Checked by `tsc --noEmit`
 * (check-types). `TrustedHtml` is nominal, so a copied class would fail the
 * assignments below in both directions.
 */
import type {
  EmailTemplateData as RootTemplateData,
  markHtml as rootMarkHtml,
  TrustedHtml as RootTrustedHtml,
} from "nextly";

import type {
  EmailTemplateData,
  markHtml,
  TrustedHtml,
} from "@nextlyhq/plugin-sdk";

/** `Exact<A, B>` is `false` when the two types differ in either direction. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

declare function assertType<T extends true>(proof: T): void;

assertType<Exact<typeof markHtml, typeof rootMarkHtml>>(true);
assertType<Exact<TrustedHtml, RootTrustedHtml>>(true);
assertType<Exact<EmailTemplateData, RootTemplateData>>(true);

// A mark is template data.
declare const marked: TrustedHtml;
const _data: EmailTemplateData = { body: marked, name: "Dana" };
void _data;

/**
 * Every public member of a mark, without its private field. A mapped type
 * keeps only the public keys, so this is the closest copy code could write:
 * if `TrustedHtml` lost its brand, it would be assignable and this would fail.
 */
type Lookalike = { [K in keyof TrustedHtml]: TrustedHtml[K] };
assertType<Exact<[Lookalike] extends [TrustedHtml] ? true : false, false>>(
  true
);
