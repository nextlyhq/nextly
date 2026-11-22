/**
 * The plugin SDK's form description and the one the Form block draws are
 * the same shape: every description a provider can give is one the block
 * can draw, and every field of the block's own is one the receiver checks.
 *
 * A type-level test, because the two packages cannot import each other (the
 * block library knows no plugin SDK), and only the compiler can say a new
 * field on one side is missing on the other. Written as assignments the
 * checker evaluates, not `@ts-expect-error`, which would pass on any error
 * or none.
 *
 * @module forms/form-drawing-agreement.test-d
 */
import type {
  FormDrawing,
  FormFieldDrawing,
  FormUnavailableDrawing,
} from "@nextlyhq/blocks-react";
import type {
  FormDescription,
  FormFieldDescription,
  FormUnavailable,
} from "@nextlyhq/plugin-sdk/blocks";

/** True when `A` is assignable to `B`. */
type Assignable<A, B> = [A] extends [B] ? true : false;

/** A provider's description, drawn by the block. */
export const describedIsDrawn: Assignable<FormDescription, FormDrawing> = true;
export const unavailableIsDrawn: Assignable<
  FormUnavailable,
  FormUnavailableDrawing
> = true;

/** The block's fields, checked by the receiver as a provider's are. */
export const drawnIsChecked: Assignable<
  FormFieldDrawing,
  FormFieldDescription
> = true;
export const checkedIsDrawn: Assignable<
  FormFieldDescription,
  FormFieldDrawing
> = true;
