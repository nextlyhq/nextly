import type { cva } from "class-variance-authority";

/**
 * The function `cva` returns for the variants map `T`: each variant's arms, and
 * `class` or `className`.
 *
 * Every `*Variants` export is annotated with this over the very object its `cva`
 * call is given (`VariantsFn<typeof BUTTON_VARIANT_MAP>`), so the published type
 * is read from the configuration rather than restated beside it. An arm added to
 * a map reaches the type with no second edit; a hand-written union would go on
 * accepting the old set while the function accepted the new one.
 * `variants.test-d.ts` checks each one against its map.
 */
export type VariantsFn<T> = ReturnType<typeof cva<T>>;
