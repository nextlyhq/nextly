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

// A mark is template data; a plain object shaped like one is not a mark.
declare const marked: TrustedHtml;
const _data: EmailTemplateData = { body: marked, name: "Dana" };
void _data;
// @ts-expect-error only `markHtml` makes a TrustedHtml
const _forged: TrustedHtml = { html: "<b>x</b>" };
void _forged;
