/**
 * The form provider contract, as a provider plugin compiles against it.
 *
 * Type-level claims only: the page builder's receiver tests what is done with
 * a provider at run time. What is held here is that a provider written from
 * this subpath alone type-checks, that the reader it is handed goes straight
 * into `ctx.services` as its options, and that the outcome union keeps its
 * kinds apart.
 */
import { expectTypeOf } from "vitest";

import type { ServiceOpts } from "@nextlyhq/plugin-sdk";
import type {
  FormAcceptResult,
  FormAccess,
  FormDescription,
  FormFieldKind,
  FormProvider,
  FormProviderService,
  FormUnavailable,
} from "@nextlyhq/plugin-sdk/blocks";

// A provider written against the subpath alone.
const provider = {
  id: "acme-forms",
  label: "Acme forms",
  list: async () => [{ ref: "contact", title: "Contact", state: "published" }],
  describe: async (ref: string): Promise<FormDescription | FormUnavailable> =>
    ref === "contact"
      ? {
          ref,
          title: "Contact",
          fields: [{ name: "email", label: "Email", kind: "email" }],
          submitText: "Send",
          afterSending: { kind: "message", message: "Thanks." },
          encoding: "urlencoded",
        }
      : { unavailable: "missing" },
  accept: async (): Promise<FormAcceptResult> => ({ kind: "sent" }),
} satisfies FormProvider;
expectTypeOf(provider).toExtend<FormProvider>();

// The service's one method takes a provider.
expectTypeOf<FormProviderService["register"]>()
  .parameter(0)
  .toEqualTypeOf<FormProvider>();

// Whom a provider reads as is handed to `ctx.services` unchanged.
expectTypeOf<FormAccess>().toExtend<ServiceOpts>();

// The outcome's kinds, each its own case.
expectTypeOf<FormAcceptResult["kind"]>().toEqualTypeOf<
  "sent" | "invalid" | "closed" | "failed"
>();

// A described field is one of the plain HTML controls, and nothing else.
expectTypeOf<"colour">().not.toExtend<FormFieldKind>();
expectTypeOf<"email">().toExtend<FormFieldKind>();
