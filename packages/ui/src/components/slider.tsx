/**
 * Slider
 *
 * A value chosen by dragging along a track, built on `@radix-ui/react-slider`. An inspector is
 * full of bounded numeric properties — opacity, blur radius, letter spacing, a colour's alpha —
 * and each one is a value where the useful question is "more or less?" rather than "what number?".
 *
 * **Why a library rather than a range input**: `<input type="range">` is keyboard-accessible and
 * nearly unstyleable, and it cannot express two thumbs. The parts that are genuinely hard are the
 * ones a hand-rolled version gets wrong quietly — pointer capture that survives the cursor leaving
 * the element, step rounding that does not accumulate floating-point drift, right-to-left
 * direction, and the ARIA slider pattern for each thumb independently. Radix implements all of
 * them and is already this kit's primitive vendor, so it adds no new dependency shape.
 *
 * **A slider is for magnitude, not precision.** Anything a person needs to type exactly wants a
 * number input beside it; the slider is the coarse control and the input is the fine one. Pairing
 * them is the caller's composition, deliberately: this kit does not decide that every slider earns
 * a spinbox next to it.
 *
 * **Controlled and uncontrolled both work**, following Radix: pass `value` with `onValueChange` to
 * control it, or `defaultValue` to let it own its state. `value` is an ARRAY even for a single
 * thumb — that is what makes a range slider the same component rather than a second one, and it is
 * the most common thing to get wrong on first use.
 *
 * **Commit on `onValueCommit`, not `onValueChange`**, whenever the write is expensive. The first
 * fires once the drag settles; the second fires continuously while the pointer moves. Recompiling
 * a stylesheet or writing to a server on every frame of a drag is the same mistake
 * `ResizablePanelGroup` documents for layout persistence.
 *
 * **Design specifications**:
 * - Track: 1.5 units thick, `bg-secondary`, fully rounded
 * - Range: the filled portion, `bg-primary`
 * - Thumb: 4x4, `border-primary` on `bg-background`, so it reads against both track halves
 * - Focus: `focus-visible` ring on the thumb, which is the focusable element
 * - Disabled: 50% opacity and `pointer-events-none`, matching the kit's other inputs
 *
 * **Accessibility**:
 * - Each thumb is a `slider` with `aria-valuenow`/`aria-valuemin`/`aria-valuemax` from Radix
 * - Arrow keys step, PageUp/PageDown jump, Home/End go to the bounds
 * - A name is REQUIRED and not defaulted: an unlabelled slider announces only a number, and
 *   this kit cannot invent a name that would be honest. The name lands on the THUMB, which is
 *   what takes focus — `aria-label` on the root is inherited by nothing
 * - A RANGE needs `thumbLabels`, one per thumb: two thumbs sharing the root's name are
 *   announced identically, so nothing says which end is held
 * - The root is padded so the target clears the 24px minimum (WCAG 2.5.8); the 16px thumb on a
 *   6px track does not on its own
 *
 * @example
 * ```tsx
 * // Single value, controlled, committing only when the drag settles
 * <Slider
 *   aria-label="Opacity"
 *   value={[opacity]}
 *   min={0}
 *   max={100}
 *   step={1}
 *   onValueChange={([next]) => setPreview(next)}
 *   onValueCommit={([next]) => save(next)}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Two thumbs: the same component, because `value` was always an array.
 * // A range needs `thumbLabels` — the root's name is not inherited, and two
 * // thumbs sharing one name are announced identically.
 * <Slider
 *   defaultValue={[25, 75]}
 *   thumbLabels={["Minimum size", "Maximum size"]}
 * />
 * ```
 *
 * @module components/slider
 */
"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * The slider's props, mirroring the Radix root.
 *
 * @experimental
 */
export type SliderProps = React.ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> & {
  /**
   * An accessible name per thumb, in value order.
   *
   * Required for a RANGE, and the reason this prop exists: the focusable
   * element is the thumb, not the root, and a name on the root is not
   * inherited. Two thumbs named only by their shared root are announced
   * identically, so nothing tells a screen-reader user which end they are
   * holding. A single thumb falls back to the root's `aria-label`, so the
   * one-thumb API stays as documented.
   */
  thumbLabels?: readonly string[];
};

/**
 * One thumb per value, derived from whichever of `value`/`defaultValue` is present.
 *
 * Radix renders only as many thumbs as it is given children, so a range slider whose caller
 * supplied two values but one thumb would silently drop the second — the value would still be in
 * state, and no thumb would be able to reach it.
 */
function thumbCount(
  value: readonly number[] | undefined,
  defaultValue: readonly number[] | undefined
): number {
  return value?.length ?? defaultValue?.length ?? 1;
}

/**
 * A bounded numeric value chosen by dragging.
 *
 * @experimental
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  SliderProps
>(
  (
    {
      className,
      value,
      defaultValue,
      thumbLabels,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref
  ) => {
    const count = thumbCount(value, defaultValue);
    // The name goes on the THUMB, which is what carries the `slider` role and
    // takes focus. Left on the root it is announced by nothing.
    const nameFor = (index: number): string | undefined =>
      thumbLabels?.[index] ?? (count === 1 ? ariaLabel : undefined);

    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          "relative flex w-full touch-none select-none items-center",
          "py-2 data-[orientation=vertical]:px-2 data-[orientation=vertical]:py-0",
          // A 16px thumb on a 6px track is under the 24px minimum target size
          // (WCAG 2.5.8), and on touch the difference between "grabbed the thumb"
          // and "missed the control" is exactly this padding.

          "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-auto",
          "data-[orientation=vertical]:flex-col",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className
        )}
        value={value}
        defaultValue={defaultValue}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            "bg-secondary relative grow overflow-hidden rounded-full",
            "h-1.5 w-full",
            "data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
          )}
        >
          <SliderPrimitive.Range
            className={cn(
              "bg-primary absolute",
              "h-full data-[orientation=vertical]:h-auto data-[orientation=vertical]:w-full"
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: count }, (_, i) => (
          <SliderPrimitive.Thumb
            key={i}
            aria-label={nameFor(i)}
            // Only meaningful for the single-thumb case: a range's thumbs need
            // distinct names, which an id shared by both cannot give them.
            aria-labelledby={count === 1 ? ariaLabelledBy : undefined}
            className={cn(
              "border-primary bg-background block h-4 w-4 rounded-full border-2",
              "ring-offset-background transition-colors",
              "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
              "focus-visible:ring-offset-2",
              "disabled:pointer-events-none disabled:opacity-50"
            )}
          />
        ))}
      </SliderPrimitive.Root>
    );
  }
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
