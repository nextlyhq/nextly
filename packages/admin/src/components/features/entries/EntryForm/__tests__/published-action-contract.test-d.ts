/**
 * The action types the admin publishes to a plugin's document view, through
 * `@nextlyhq/admin/kit` and the SDK that re-exports it.
 *
 * The editor's own header has one more placement, the arrow beside the
 * primary action, and a plugin handling the published placements
 * exhaustively must not stop compiling because of it. These pin the
 * published union exactly, where the kit entry exports it.
 */
import { expectTypeOf } from "vitest";

import type {
  ActionPlacement,
  DocumentAction,
  DocumentActions,
} from "@admin/kit";

type Published = "primary" | "toolbar" | "menu";

expectTypeOf<ActionPlacement>().toEqualTypeOf<Published>();
expectTypeOf<DocumentAction["placement"]>().toEqualTypeOf<Published>();
expectTypeOf<
  DocumentActions["actions"][number]["placement"]
>().toEqualTypeOf<Published>();
