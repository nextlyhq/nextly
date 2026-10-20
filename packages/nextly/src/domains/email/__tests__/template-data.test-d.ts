import type {
  EmailTemplateData,
  PreviewEmailTemplateArgs,
  SendTemplateEmailArgs,
} from "../../../direct-api/types/email";
import type {
  EmailTemplateData as RootTemplateData,
  markHtml as rootMarkHtml,
  TrustedHtml as RootTrustedHtml,
} from "../../../index";
import type { markHtml, TrustedHtml } from "../services/liquid-engine";

// Compile-time half of what a template's data may be and who may mark HTML.
// In a `.test-d.ts` because tsconfig excludes `.test.ts` files from the type
// check, which would leave type-level assertions checked by nothing;
// `pnpm check-types` compiles this one. Each assertion is evaluated by the
// checker rather than written as a call under `@ts-expect-error`, which would
// stay green for any error on that line.

type Assignable<A, B> = [A] extends [B] ? true : false;
declare function assertType<T extends true>(proof: T): void;
declare function refuteType<T extends false>(proof: T): void;

/** What a commerce email is sent with: nested objects, a list of them, numbers and yes/no. */
type OrderData = {
  order: {
    number: number;
    paid: boolean;
    balance_due: number;
    lines: Array<{ quantity: number; title: string; total: string }>;
    note: string | null;
  };
};

// Lists and objects are accepted on every send surface that is typed here.
assertType<Assignable<OrderData, EmailTemplateData>>(true);
assertType<
  Assignable<OrderData, NonNullable<SendTemplateEmailArgs["variables"]>>
>(true);
assertType<
  Assignable<OrderData, NonNullable<PreviewEmailTemplateArgs["data"]>>
>(true);

// Marked HTML is accepted where code passes it.
assertType<Assignable<{ body: TrustedHtml }, EmailTemplateData>>(true);
assertType<Assignable<ReturnType<typeof markHtml>, TrustedHtml>>(true);

// Only code makes a mark: nothing shaped like one is one, and the class
// cannot be constructed from outside.
refuteType<Assignable<{ html: string }, TrustedHtml>>(false);
refuteType<Assignable<{ html: string; toString(): string }, TrustedHtml>>(
  false
);
refuteType<Assignable<typeof TrustedHtml, new (html: string) => TrustedHtml>>(
  false
);

// The same, from the package root, where plugins import them.
assertType<Assignable<ReturnType<typeof rootMarkHtml>, RootTrustedHtml>>(true);
assertType<Assignable<OrderData, RootTemplateData>>(true);
