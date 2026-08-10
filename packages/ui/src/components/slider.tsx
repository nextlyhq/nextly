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
 * - An empty name does not count as a name: `aria-label=""` is reported the same as a missing one,
 *   because the accessible name computes to nothing either way
 *
 * **An empty value array renders nothing.** A slider over no values is not a state this control
 * can represent: an empty `defaultValue` falls back to `min`, and an empty `value` — which a
 * controlled caller owns and this component must not overwrite — renders no control at all,
 * rather than a thumb that carries no value and cannot be moved.
 *
 * **Sizing**: a horizontal slider fills its container's width. A VERTICAL one carries a default
 * height instead of filling, because `height: 100%` inside an auto-height parent collapses to a
 * track with no length. Override it with an ordinary `className` — `h-64` for a longer control,
 * `h-full` for the fill-the-parent behaviour.
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
export type SliderProps = Omit<
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>,
  // The wrapper always supplies a track and at least one thumb, and Radix's
  // Slot accepts exactly one composable child — so `asChild` here throws at
  // render. Excluded from the type rather than left to fail at runtime.
  "asChild"
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
 *
 * An EMPTY array floors to one rather than to zero. Zero thumbs is a track with nothing focusable
 * in it: no `slider` role, no keyboard target, and no pointer target either, because Radix routes
 * a track click to the nearest thumb. A control that cannot be operated at all is a worse outcome
 * than one showing a fallback, and the empty array is reported separately.
 */
function thumbCount(
  value: readonly number[] | undefined,
  defaultValue: readonly number[] | undefined
): number {
  return Math.max(1, value?.length ?? defaultValue?.length ?? 1);
}

/**
 * Whether a naming attribute actually carries a name.
 *
 * A present-but-empty `aria-label` is the case a presence check misses: the attribute is there, so
 * every `!== undefined` test says the thumb is named, while the accessible name computes to the
 * empty string and assistive technology announces a bare number. It arises from ordinary code —
 * `aria-label={field.label}` before the label loads, or a template over an absent value.
 *
 * The check is deliberately shallow for `aria-labelledby`: whether the referenced element exists
 * and holds text is a property of a document this component cannot see at render, so an id that
 * resolves to nothing still passes here. This catches the empty STRING, which is the case that is
 * both common and knowable.
 */
function hasAccessibleName(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
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
      orientation = "horizontal",
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref
  ) => {
    // Radix captures an uncontrolled value array ONCE, at mount. Recomputing
    // the count from a later `defaultValue` would drop a thumb while Radix
    // still stores its value — an endpoint the user can no longer reach and
    // nothing reports. Controlled sliders keep deriving from `value`, which is
    // the prop Radix itself follows.
    const initialUncontrolledCount = React.useRef(
      thumbCount(undefined, defaultValue)
    ).current;
    // Both sources are already at least one: an empty controlled value returns before this is
    // used, and `thumbCount` floors the uncontrolled side.
    const count = value?.length ?? initialUncontrolledCount;

    // An empty array asks for a slider over no values, which is not a state this control can
    // represent. The two cases differ in how far they can be repaired, so they are handled
    // separately rather than with one blanket rule.
    //
    // UNCONTROLLED is fully repairable: an empty `defaultValue` is forwarded as absent, and Radix
    // then applies its own `[min]` default. Substituting the vendor's default is exactly what an
    // omitted prop would have done, so nothing downstream can tell the difference.
    //
    // CONTROLLED is NOT repairable, so the control renders NOTHING. Substituting a value would
    // either flip to uncontrolled — handing Radix ownership of state the caller believes it holds
    // — or show a number the caller's state does not contain, which then never reconciles.
    // Emitting a thumb anyway is worse than either: Radix resolves a track click through
    // `getClosestValueIndex`, which returns -1 for an empty array and so writes nowhere. That
    // thumb carries no `aria-valuenow`, cannot be dragged and cannot be moved by a key — a
    // `slider` role that looks operable and is not, which is the one outcome worse than absence.
    const isEmptyDefault =
      defaultValue !== undefined && defaultValue.length === 0;
    const isEmptyControlled = value !== undefined && value.length === 0;
    devWarnOnce(
      !isEmptyDefault && !isEmptyControlled,
      "Slider: `value`/`defaultValue` must hold one number per thumb, and an empty array " +
        "holds none — the control has nothing to slide. An empty `defaultValue` falls back to " +
        "`min`; an empty `value` renders nothing at all, because a controlled slider cannot be " +
        "given a value without taking state the caller owns. Render nothing until the value is " +
        "loaded rather than passing `[]`."
    );
    // Placed after the warning so the defect is always reported, and after every hook so the
    // early return cannot change the order they are called in.
    if (isEmptyControlled) return null;
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
    // Every thumb needs a name from somewhere: its own entry, or — for a
    // single thumb only — the root's. A one-thumb slider with neither was
    // previously exempt from this check, which is the same silent failure the
    // check exists to report.
    const isNamed = (index: number): boolean => {
      const own = thumbs?.[index];
      if (hasAccessibleName(own?.["aria-label"])) return true;
      if (hasAccessibleName(own?.["aria-labelledby"])) return true;
      return (
        count === 1 &&
        (hasAccessibleName(ariaLabel) || hasAccessibleName(ariaLabelledBy))
      );
    };
    devWarnOnce(
      Array.from({ length: count }).every((_, i) => isNamed(i)),
      "Slider: every thumb needs an accessible name. A single thumb may take " +
        "it from the root's `aria-label`/`aria-labelledby`; a range needs one " +
        "`thumbs` entry per thumb, because the root's name is not inherited " +
        "and two thumbs sharing one name are announced identically."
    );

    const ariaFor = (index: number): SliderThumbProps => {
      const supplied = thumbs?.[index] ?? {};
      // An empty naming attribute is dropped rather than forwarded. Emitting `aria-label=""`
      // states a name and supplies none, which reads to a name computation as a deliberate
      // choice; omitting the attribute at least leaves the element honestly unnamed.
      const ownLabel = hasAccessibleName(supplied["aria-label"])
        ? supplied["aria-label"]
        : undefined;
      const ownLabelledBy = hasAccessibleName(supplied["aria-labelledby"])
        ? supplied["aria-labelledby"]
        : undefined;
      if (count !== 1) {
        return {
          ...supplied,
          "aria-label": ownLabel,
          "aria-labelledby": ownLabelledBy,
        };
      }
      // The two naming attributes are ALTERNATIVES, not independent slots, so
      // the fallback is all-or-nothing. Filling each one separately can emit a
      // thumb `aria-label` alongside a root `aria-labelledby`, and since
      // accessible-name computation prefers `aria-labelledby`, the caller's
      // explicit per-thumb name would lose to the root's without saying so.
      const namesItself = ownLabel !== undefined || ownLabelledBy !== undefined;
      return {
        "aria-label": namesItself ? ownLabel : ariaLabel,
        "aria-labelledby": namesItself ? ownLabelledBy : ariaLabelledBy,
        "aria-valuetext": supplied["aria-valuetext"],
        "aria-describedby": supplied["aria-describedby"],
      };
    };

    // Orientation is a prop, so the branch belongs in JavaScript rather than in a
    // `data-[orientation=vertical]:` variant. A variant compiles to an attribute selector, which
    // outranks the plain utility a caller passes in `className` — `h-48` would lose to the
    // wrapper's own height and the override would fail silently. Plain classes also let
    // tailwind-merge do the job it is here for: same property, caller wins.
    const isVertical = orientation === "vertical";

    return (
      // `aria-label`/`aria-labelledby` are destructured out above rather than
      // spread here: left on the root they would be a second, roleless copy
      // of a name only the thumb is read for.
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          "relative flex touch-none select-none items-center",
          // WCAG 2.5.8 wants a 24px target. Padding alone does not reach it: the
          // thumb is absolutely positioned, so the cross-axis size is the 6px
          // track plus the padding — 22px with `py-2`. An explicit minimum
          // states the target rather than leaving it to arithmetic that moves
          // whenever the track thickness does.
          isVertical
            ? // A vertical slider needs a LENGTH, and it cannot inherit one:
              // `h-full` inside an auto-height parent resolves to zero, leaving
              // a control with no track to drag along. A concrete default is
              // usable everywhere and, being a plain utility, is replaced by a
              // caller's own `h-*` — including `h-full`, for the fill-the-parent
              // case this default gives up.
              "h-44 min-w-6 flex-col px-2"
            : "min-h-6 w-full py-2",
          "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className
        )}
        orientation={orientation}
        value={value}
        // An empty array is forwarded as absent so Radix applies its own `[min]`
        // default; a populated one is passed through untouched.
        defaultValue={isEmptyDefault ? undefined : defaultValue}
        {...props}
      >
        <SliderPrimitive.Track
          className={cn(
            "bg-secondary relative grow overflow-hidden rounded-full",
            isVertical ? "h-full w-1.5" : "h-1.5 w-full"
          )}
        >
          <SliderPrimitive.Range
            className={cn(
              "bg-primary absolute",
              isVertical ? "w-full" : "h-full"
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
