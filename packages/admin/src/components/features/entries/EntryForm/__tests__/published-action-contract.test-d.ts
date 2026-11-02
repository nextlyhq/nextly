/**
 * The action types `@nextlyhq/admin` publishes to a plugin's document view.
 *
 * The editor's own header has one more placement, the arrow beside the
 * primary action, and a plugin handling the published placements
 * exhaustively must not stop compiling because of it. These pin the
 * published union exactly, where the package root exports it.
 */
import { expectTypeOf } from "vitest";

import type {
  ActionPlacement,
  DocumentAction,
  DocumentActions,
} from "@admin/index";

type Published = "primary" | "toolbar" | "menu";

expectTypeOf<ActionPlacement>().toEqualTypeOf<Published>();
expectTypeOf<DocumentAction["placement"]>().toEqualTypeOf<Published>();
expectTypeOf<
  DocumentActions["actions"][number]["placement"]
>().toEqualTypeOf<Published>();
