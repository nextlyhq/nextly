/**
 * Every arm a `cva` configuration declares is an arm its published type
 * accepts, and no other.
 *
 * Each `*Variants` export is annotated, because `isolatedDeclarations` needs
 * its type written down. An annotation can say less than the function does:
 * `cva` returns a function accepting every arm in its map, and that function
 * stays assignable to a hand-written type that lists fewer, so a new arm would
 * work at runtime while the published type went on refusing it. The
 * annotations are `VariantsFn<typeof MAP>` over the map the call is given
 * (`variants.ts`); this file checks the result against the map itself.
 *
 * `Arms` is cva's own reading of a map (`ConfigVariants`, which it does not
 * export): each key optional, its arms by name, and `"true"`/`"false"` arms as
 * a boolean.
 */
import type { VariantProps } from "class-variance-authority";
import { expectTypeOf } from "vitest";

import type { ALERT_VARIANT_MAP, alertVariants } from "../components/alert";
import type { AVATAR_VARIANT_MAP, avatarVariants } from "../components/avatar";
import type { BADGE_VARIANT_MAP, badgeVariants } from "../components/badge";
import type { BUTTON_VARIANT_MAP, buttonVariants } from "../components/button";
import type { CARD_VARIANT_MAP, cardVariants } from "../components/card";
import type {
  DIALOG_CONTENT_VARIANT_MAP,
  dialogContentVariants,
} from "../components/dialog";
import type { INPUT_VARIANT_MAP, inputVariants } from "../components/input";
import type {
  PROGRESS_VARIANT_MAP,
  progressVariants,
} from "../components/progress";
import type {
  SELECT_TRIGGER_VARIANT_MAP,
  selectTriggerVariants,
} from "../components/select";
import type { SHEET_VARIANT_MAP, sheetVariants } from "../components/sheet";
import type {
  SPINNER_VARIANT_MAP,
  spinnerVariants,
} from "../components/spinner";
import type {
  TABS_LIST_VARIANT_MAP,
  TABS_TRIGGER_VARIANT_MAP,
  tabsListVariants,
  tabsTriggerVariants,
} from "../components/tabs";

type StringToBoolean<T> = T extends "true" | "false" ? boolean : T;

/** What a variants map lets a caller pass, read from the map alone. */
type Arms<M> = {
  [K in keyof M]?: StringToBoolean<keyof M[K]> | null | undefined;
};

// One assertion over every function, keyed by name, so a failure names the
// function whose published type and map disagree.
expectTypeOf<{
  alertVariants: VariantProps<typeof alertVariants>;
  avatarVariants: VariantProps<typeof avatarVariants>;
  badgeVariants: VariantProps<typeof badgeVariants>;
  buttonVariants: VariantProps<typeof buttonVariants>;
  cardVariants: VariantProps<typeof cardVariants>;
  dialogContentVariants: VariantProps<typeof dialogContentVariants>;
  inputVariants: VariantProps<typeof inputVariants>;
  progressVariants: VariantProps<typeof progressVariants>;
  selectTriggerVariants: VariantProps<typeof selectTriggerVariants>;
  sheetVariants: VariantProps<typeof sheetVariants>;
  spinnerVariants: VariantProps<typeof spinnerVariants>;
  tabsListVariants: VariantProps<typeof tabsListVariants>;
  tabsTriggerVariants: VariantProps<typeof tabsTriggerVariants>;
}>().toEqualTypeOf<{
  alertVariants: Arms<typeof ALERT_VARIANT_MAP>;
  avatarVariants: Arms<typeof AVATAR_VARIANT_MAP>;
  badgeVariants: Arms<typeof BADGE_VARIANT_MAP>;
  buttonVariants: Arms<typeof BUTTON_VARIANT_MAP>;
  cardVariants: Arms<typeof CARD_VARIANT_MAP>;
  dialogContentVariants: Arms<typeof DIALOG_CONTENT_VARIANT_MAP>;
  inputVariants: Arms<typeof INPUT_VARIANT_MAP>;
  progressVariants: Arms<typeof PROGRESS_VARIANT_MAP>;
  selectTriggerVariants: Arms<typeof SELECT_TRIGGER_VARIANT_MAP>;
  sheetVariants: Arms<typeof SHEET_VARIANT_MAP>;
  spinnerVariants: Arms<typeof SPINNER_VARIANT_MAP>;
  tabsListVariants: Arms<typeof TABS_LIST_VARIANT_MAP>;
  tabsTriggerVariants: Arms<typeof TABS_TRIGGER_VARIANT_MAP>;
}>();
