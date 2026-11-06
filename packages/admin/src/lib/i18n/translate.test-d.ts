import { expectTypeOf } from "vitest";

import type { MessageKey, ParamsFor } from "./translate";

// A key from the English catalog is a message key.
expectTypeOf<"nextly.errors.page.title">().toMatchTypeOf<MessageKey>();

// A misspelled key is not.
expectTypeOf<"nextly.errors.page.titel">().not.toMatchTypeOf<MessageKey>();

// A string's `{name}` placeholders are the parameters a call must give, and
// a string with none takes none.
expectTypeOf<
  ParamsFor<"Welcome, {name}. You have {count} drafts.">
>().toEqualTypeOf<[params: Record<"name" | "count", string | number>]>();
expectTypeOf<ParamsFor<"Reload page">>().toEqualTypeOf<[]>();

// A parameter named wrongly is not the parameter the string asks for.
expectTypeOf<{ nmae: string }>().not.toMatchTypeOf<
  ParamsFor<"Welcome, {name}.">[0]
>();
