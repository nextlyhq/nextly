/**
 * What a plugin's tab at an edit page's place is handed: everything a place's
 * tab is (the place's `context` and `entry`, `setBadge`, and `setLeftOut`,
 * which leaves the tab out of the row where it does not apply), the document
 * form it writes through, and the lock a side panel section is told, at a
 * collection entry and a Single alike; and what a tab's count is made of.
 *
 * Every assertion is one the checker evaluates; none rests on
 * `@ts-expect-error`.
 */
import { expectTypeOf } from "vitest";

import type {
  DocumentLockGates,
  DocumentTabProps,
  PlaceTabBadge,
  PlaceTabProps,
} from "@nextlyhq/plugin-sdk/admin";

/** The tab's props at the place whose context is `Context`. */
type TabAt<Context> = Extract<DocumentTabProps, { context: Context }>;

expectTypeOf<{
  lock: DocumentTabProps["documentLock"];
  setBadge: PlaceTabProps["setBadge"];
  setLeftOut: PlaceTabProps["setLeftOut"];
  badge: PlaceTabBadge;
  atEntry: keyof TabAt<{ collection: string; entryId: string | null }>;
  atSingle: keyof TabAt<{ single: string }>;
}>().toEqualTypeOf<{
  lock: DocumentLockGates;
  setBadge: (badge: PlaceTabBadge | null) => void;
  setLeftOut: (leftOut: boolean) => void;
  badge: { count: number; label: string; tone?: "neutral" | "attention" };
  atEntry:
    | "context"
    | "entry"
    | "setBadge"
    | "setLeftOut"
    | "control"
    | "documentLock";
  atSingle:
    | "context"
    | "entry"
    | "setBadge"
    | "setLeftOut"
    | "control"
    | "documentLock";
}>();

// The form's own control, typed by the form library, never widened away.
expectTypeOf<DocumentTabProps["control"]>().not.toBeAny();
