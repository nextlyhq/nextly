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
 * - A RANGE needs `thumbs`, one entry per thumb: two thumbs sharing the root's name are
 *   announced identically, so nothing says which end is held
 * - `aria-valuetext` and `aria-describedby` belong on `thumbs` too — like the name, they are
 *   read from the thumb and inherited from nothing
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
 *   // The number alone does not say what it means; this is what gets spoken.
 *   thumbs={[{ "aria-valuetext": `${opacity} percent` }]}
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
 *   thumbs={[
 *     { "aria-label": "Minimum size" },
 *     { "aria-label": "Maximum size" },
 *   ]}
 * />
 * ```
 *
 * @module components/slider
 */
"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { devWarnOnce } from "../lib/dev-warn";
import { cn } from "../lib/utils";

/**
 * The assistive-technology attributes a single thumb can carry.
 *
 * @experimental
 */
export interface SliderThumbProps {
  /** The thumb's accessible name. */
  "aria-label"?: string;
  /** An element naming the thumb, when the name is already on screen. */
  "aria-labelledby"?: string;
  /**
   * What the value MEANS, when the number alone does not say it — "40
   * percent", "Medium". Announced in place of the raw number.
   */
  "aria-valuetext"?: string;
  /** An element carrying help text for this thumb. */
  "aria-describedby"?: string;
}

/**
 * The slider's props, mirroring the Radix root.
 *
 * @experimental
 */
export type SliderProps = React.ComponentPropsWithoutRef<
  typeof SliderPrimitive.Root
> & {
  /**
   * Assistive-technology attributes per thumb, in value order.
   *
   * The reason this exists at all: the focusable element with the `slider`
   * role is the THUMB, and none of these attributes are inherited from the
   * root. Anything a caller puts on the root is therefore announced by
   * nothing, and the thumbs are generated internally so they cannot be
   * reached any other way.
   *
   * Deliberately a curated set rather than the thumb's full prop type. This
   * is the surface assistive technology reads; opening it to arbitrary props
   * would let a caller replace the class names or the role the control
   * depends on, and every escape hatch in a design system eventually gets
   * used that way.
   *
   * Required for a RANGE: two thumbs sharing one name are announced
   * identically, so nothing says which end is held. A single thumb falls back
   * to the root's `aria-label`/`aria-labelledby`, so the one-thumb API stays
   * as documented.
   */
  thumbs?: readonly SliderThumbProps[];
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
      thumbs,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref
  ) => {
    const count = thumbCount(value, defaultValue);
    // Everything assistive technology reads goes on the THUMB, which is what
    // carries the `slider` role and takes focus. Left on the root it is
    // announced by nothing.
    //
    // The single-thumb fallback keeps the documented one-thumb API working:
    // with one thumb the root's name is unambiguous, so it is forwarded. A
    // range has no such fallback — one name cannot distinguish two ends.
    // The requirement TypeScript cannot express: how many thumbs there are is
    // the length of an array, so nothing at compile time can insist a range
    // names both of its ends. Unmet, it fails silently — the control renders
    // and is unusable with a screen reader.
    devWarnOnce(
      count === 1 ||
        Array.from({ length: count }).every(
          (_, i) =>
            thumbs?.[i]?.["aria-label"] ?? thumbs?.[i]?.["aria-labelledby"]
        ),
      "Slider: a range needs one `thumbs` entry per thumb with an accessible " +
        "name. The root's name is not inherited by the thumbs, and two thumbs " +
        "sharing one name are announced identically, so nothing says which " +
        "end is held."
    );

    const ariaFor = (index: number): SliderThumbProps => {
      const supplied = thumbs?.[index] ?? {};
      if (count !== 1) return supplied;
      return {
        "aria-label": supplied["aria-label"] ?? ariaLabel,
        "aria-labelledby": supplied["aria-labelledby"] ?? ariaLabelledBy,
        "aria-valuetext": supplied["aria-valuetext"],
        "aria-describedby": supplied["aria-describedby"],
      };
    };

    return (
      // `aria-label`/`aria-labelledby` are destructured out above rather than
      // spread here: left on the root they would be a second, roleless copy
      // of a name only the thumb is read for.
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
            {...ariaFor(i)}
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
