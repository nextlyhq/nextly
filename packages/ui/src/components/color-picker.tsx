"use client";

import { Pipette } from "lucide-react";
import * as React from "react";

import type { Rgba } from "../lib/color";
import {
  hsvToRgb,
  hueAt,
  hueSliderValue,
  parseHex,
  pointOnSurface,
  rgbToHsv,
  saturationValueAt,
  surfacePointFor,
  toHex,
} from "../lib/color";
import { cn } from "../lib/utils";

import { Button } from "./button";
import { Input } from "./input";

/**
 * One preset a host offers.
 *
 * `color` is what the swatch is PAINTED with. `value` is what `onSwatchSelect`
 * hands back, unread by this component — a host storing design tokens puts its
 * own token reference there and receives it unchanged, so choosing a swatch
 * never resolves a token into the colour it currently happens to be. Without
 * that, re-theming stops moving the values that pointed at it.
 *
 * @experimental
 */
export interface ColorSwatch<TValue = string> {
  id: string;
  label: string;
  color: string;
  value?: TValue;
}

/**
 * Props for ColorPicker.
 * @experimental
 */
export interface ColorPickerProps<TValue = string> {
  /** The colour shown on the surface, as hex. */
  color: string;
  /** A colour was chosen by editing — surface, hue, alpha or the hex field. */
  onColorChange: (color: string) => void;
  /** Presets. Painted from `color`, returned by `value`. */
  swatches?: ColorSwatch<TValue>[];
  /**
   * A preset was chosen. Separate from `onColorChange` because only the host
   * can say what a swatch MEANS: the two are different events, and collapsing
   * them is what loses a token reference.
   */
  onSwatchSelect?: (swatch: ColorSwatch<TValue>) => void;
  /**
   * Recently used colours. Owned by the host, never by this component — the
   * admin scopes them per user, and a component writing `localStorage` at
   * render is unusable on a server and untestable without a DOM.
   */
  recentColors?: string[];
  /** Alpha channel. Off by default: most call sites want an opaque colour. */
  showAlpha?: boolean;
  className?: string;
}

/** The picker's own working state, kept in HSV so a drag does not lose hue. */
interface Hsva {
  h: number;
  s: number;
  v: number;
  a: number;
}

function toHsva(hex: string): Hsva {
  const parsed = parseHex(hex);
  if (!parsed) return { h: 0, s: 0, v: 0, a: 1 };
  const { r, g, b, alpha } = parsed;
  return { ...rgbToHsv({ r, g, b }), a: alpha };
}

function toHexString(hsva: Hsva, withAlpha: boolean): string {
  return toHex(hsvToRgb(hsva), withAlpha ? hsva.a : 1);
}

/** The last step of the hue strip. Kept beside the input it sizes. */
const HUE_MAX = 359;

/**
 * A parsed colour as picker state, keeping the hue the surface already sits on
 * when the new colour has none of its own.
 *
 * Grey and black carry no hue, so `rgbToHsv` reports its documented fallback of
 * 0. Storing that discards where the user was: typing black while editing a
 * blue and then raising saturation returns RED. While saturation is 0 the
 * retained hue is invisible, so keeping it costs nothing and is the only thing
 * that makes the surface recoverable.
 */
function hsvaFrom(color: Rgba, alpha: number, currentHue: number): Hsva {
  const hsv = rgbToHsv(color);
  return { ...hsv, h: hsv.s === 0 ? currentHue : hsv.h, a: alpha };
}

/**
 * A range input drawn by this component rather than by the browser.
 *
 * `appearance-none` removes the platform track, so every slider carrying it
 * owes a background of its own — one that does not is not a subtle styling
 * miss, it is an invisible control.
 */
const SLIDER = "h-3 w-full cursor-pointer appearance-none rounded-full";

/**
 * The grey chequerboard that makes transparency legible.
 *
 * Fixed greys, deliberately, where the rest of this package uses theme tokens:
 * this is the standard rendering of "nothing here", and a chequerboard that
 * changed colour with the theme would read as part of the colour being edited.
 *
 * design-lint-ok: fixed greys are the point here; see above.
 */
const CHECKERBOARD = "repeating-conic-gradient(#c8c8c8 0% 25%, #ffffff 0% 50%)";

/** Whether this browser can sample a colour from the screen. */
function eyeDropperSupported(): boolean {
  // Chromium only. Feature-detected rather than assumed: constructing it where
  // it does not exist throws, and a picker that throws on click is worse than
  // one without the button.
  return typeof window !== "undefined" && "EyeDropper" in window;
}

interface EyeDropperLike {
  open: () => Promise<{ sRGBHex: string }>;
}

/**
 * A colour control: a saturation square, a hue strip, optional alpha, a hex
 * field, and any presets the host supplies.
 *
 * Deliberately knows nothing about design tokens. A swatch carries an opaque
 * `value` this component never reads and hands back untouched, so a host can
 * store a token reference and keep it. That is what lets one component serve
 * both a plain colour field and a token-aware surface without either learning
 * about the other.
 *
 * @experimental
 *
 * @example
 * ```tsx
 * <ColorPicker
 *   color={color}
 *   onColorChange={setColor}
 *   swatches={tokens.map(t => ({ id: t.name, label: t.name, color: t.value, value: { $token: t.name } }))}
 *   onSwatchSelect={s => store(s.value)}
 * />
 * ```
 */
export function ColorPicker<TValue = string>({
  color,
  onColorChange,
  swatches = [],
  onSwatchSelect,
  recentColors = [],
  showAlpha = false,
  className,
}: ColorPickerProps<TValue>) {
  const fieldId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const [hsva, setHsva] = React.useState<Hsva>(() => toHsva(color));
  // What the hex field shows while it is being typed into. A half-typed value
  // is not a colour, and reformatting it on every keystroke moves the caret.
  const [draftHex, setDraftHex] = React.useState<string | null>(null);

  // Re-seeded when the host supplies a colour this picker did not produce.
  // Comparing the RENDERED hex rather than the prop avoids a loop: the same
  // colour has several spellings, and `#FFF` arriving back as `#ffffff` would
  // otherwise reset the surface on every change.
  const rendered = toHexString(hsva, showAlpha);
  React.useEffect(() => {
    const incoming = parseHex(color);
    if (
      incoming &&
      toHex(incoming, showAlpha ? incoming.alpha : 1) !== rendered
    ) {
      // Same hue retention as the other entry points: a host that pushes a grey
      // in must not silently move the surface's hue to red. Read from the
      // updater rather than from `hsva`, so the effect does not re-run on a
      // hue change it is not interested in.
      setHsva(prev => hsvaFrom(incoming, incoming.alpha, prev.h));
    }
  }, [color, rendered, showAlpha]);

  /*
   * A typed colour is reported when the author FINISHES it, never per
   * keystroke.
   *
   * `parseHex` accepts 3, 4, 6 and 8 digits, so a PREFIX of a valid colour is
   * itself a valid colour: typing `#123456` passes through `#123` and `#1234`
   * on the way. Reporting each of those made the last one stick whenever the
   * author paused or the surface went away — `#12345` left the host holding
   * `#11223344`, a colour nobody typed, silently replacing the stored one.
   *
   * So the field holds a draft and this is the only thing that publishes it:
   * Enter, and leaving the field. Dragging is untouched and still reports
   * continuously, which is what its coalescing exists for — a drag has no
   * finish to wait for, and typing does.
   *
   * DISMISSAL IS NOT A FINISH, deliberately. Escape means cancel, so a draft
   * dying with the surface is the conventional answer rather than a loss; and
   * clicking away moves focus out of the field first, so that path commits
   * through the blur below. Reporting from an unmount instead would arrive
   * after a host that coalesces a gesture on close has already decided what to
   * write, which is a value published into nothing.
   */
  const commitDraft = (): void => {
    const text = draftHex;
    // NOTHING TYPED, nothing to report. Reading the field's value instead would
    // publish the colour already on screen every time focus merely passed
    // through — a save for an edit nobody made, and a second one for an edit
    // already reported by Enter.
    if (text === null) return;
    setDraftHex(null);
    const parsed = parseHex(text);
    // An unfinishable draft is DISCARDED rather than reported. The field
    // returns to the colour that is actually stored, so what is shown and what
    // is saved agree — which they did not when a stale intermediate stood in
    // for the text on screen.
    if (!parsed) return;
    setHsva(prev => hsvaFrom(parsed, parsed.alpha, prev.h));
    onColorChange(toHex(parsed, showAlpha ? parsed.alpha : 1));
  };

  /*
   * A press OUTSIDE is a finish, and it is the one a blur cannot catch.
   *
   * Measured rather than assumed: a dismissable layer runs from the outside
   * `pointerdown` and unmounts this content there, so the focus change that
   * would have produced a blur never happens and a complete typed colour was
   * lost with no report at all. A test driving `blur` directly cannot see that
   * — the blur is the thing in question — so the case that proves it presses
   * outside for real.
   *
   * CAPTURE, because the ordering is the whole point: a capture listener on the
   * document runs before the dismiss layer's own, so the value is reported
   * while this is still mounted. Reporting from an unmount instead was tried
   * and removed — a host that coalesces a picker gesture on close has already
   * decided what to write by then.
   *
   * Escape is untouched and still cancels: it dismisses without a pointer, so
   * nothing here runs and the draft dies with the surface, which is what a
   * cancel means.
   */
  const latestCommit = React.useRef(commitDraft);
  React.useEffect(() => {
    latestCommit.current = commitDraft;
  });
  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null) return;
      const target = event.target;
      // A press INSIDE is not a dismissal — a swatch, a slider, the field
      // itself — and committing there would report a draft the press is about
      // to replace.
      if (target instanceof Node && root.contains(target)) return;
      latestCommit.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const commit = (next: Hsva): void => {
    setHsva(next);
    setDraftHex(null);
    onColorChange(toHexString(next, showAlpha));
  };

  const trackPointer = (event: React.PointerEvent<HTMLDivElement>): void => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    const { s, v } = saturationValueAt(
      pointOnSurface(event.clientX, event.clientY, rect)
    );
    commit({ ...hsva, s, v });
  };

  // Routed through the surface mapping instead of clamping here, so the keys
  // and the pointer cannot disagree about where the edges are.
  const nudge = (ds: number, dv: number): void => {
    const { s, v } = saturationValueAt(
      surfacePointFor(hsva.s + ds, hsva.v + dv)
    );
    commit({ ...hsva, s, v });
  };

  const handleSurfaceKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Shift takes the coarse step, matching what the arrow keys do on the
    // sliders beside it.
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (!move) return;
    // Arrow keys would otherwise scroll the page under the control.
    event.preventDefault();
    nudge(move[0], move[1]);
  };

  // Resolved after mount, never during render. Reading `window` while rendering
  // makes the server omit this button and the first client render add it, which
  // React 19 treats as a hydration failure and repairs by discarding the whole
  // picker subtree.
  const [canPickFromScreen, setCanPickFromScreen] = React.useState(false);
  React.useEffect(() => {
    setCanPickFromScreen(eyeDropperSupported());
  }, []);

  const handle = surfacePointFor(hsva.s, hsva.v);
  const hueOnly = toHex(hsvToRgb({ h: hsva.h, s: 1, v: 1 }));

  const pickFromScreen = async (): Promise<void> => {
    const ctor = (window as unknown as Record<string, unknown>).EyeDropper as
      | (new () => EyeDropperLike)
      | undefined;
    if (!ctor) return;
    let sampled: string;
    try {
      sampled = (await new ctor().open()).sRGBHex;
    } catch {
      // The user dismissed the picker. Not an error, and nothing to report.
      // Scoped to `open()` alone: with the commit inside this block, a host
      // whose `onColorChange` throws — a failing save, a rejected validation —
      // was reported as a dismissal and swallowed, while the picker had
      // already moved. Every other edit path lets that reach the host, and so
      // does this one now.
      return;
    }
    const parsed = parseHex(sampled);
    // The screen's alpha is not meaningful, so the picker keeps its own.
    if (parsed) commit(hsvaFrom(parsed, hsva.a, hsva.h));
  };

  return (
    <div ref={rootRef} className={cn("w-64 space-y-3", className)}>
      <div
        ref={surfaceRef}
        role="application"
        tabIndex={0}
        // The values are in the name because `role="application"` carries no
        // value semantics of its own, and without them a screen reader
        // announces a region that can be driven but never says where it is.
        aria-label={`Saturation and brightness: ${Math.round(hsva.s * 100)}% saturation, ${Math.round(hsva.v * 100)}% brightness. Arrow keys adjust.`}
        className="ring-offset-background focus-visible:ring-ring relative h-40 w-full cursor-crosshair touch-none rounded-md focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        style={{
          backgroundColor: hueOnly,
          // Value on TOP of saturation. CSS paints the first layer nearest the
          // viewer, so the reverse order lets the opaque white end of the
          // saturation ramp cover the black end of the value ramp: the
          // bottom-left corner displays white while selecting black.
          backgroundImage:
            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
        }}
        onKeyDown={handleSurfaceKey}
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          trackPointer(event);
        }}
        onPointerMove={event => {
          if (event.buttons === 1) trackPointer(event);
        }}
      >
        <span
          aria-hidden="true"
          // A fixed white ring inside a black one, not theme tokens: this
          // handle sits on an arbitrary colour the user is choosing, not on a
          // themed surface, so it has to stay visible against both ends of the
          // square. `border-background` resolved to black in dark mode and
          // vanished against the square's own black lower edge.
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm ring-1 ring-black/60"
          style={{ left: `${handle.x * 100}%`, top: `${handle.y * 100}%` }}
        />
      </div>

      <label className="sr-only" htmlFor={`${fieldId}-hue`}>
        Hue
      </label>
      <input
        id={`${fieldId}-hue`}
        type="range"
        min={0}
        max={HUE_MAX}
        step={1}
        value={hueSliderValue(hsva.h, HUE_MAX)}
        onChange={event =>
          commit({ ...hsva, h: hueAt(+event.target.value / (HUE_MAX + 1)) })
        }
        className={SLIDER}
        // design-lint-ok: the hue strip renders the colour wheel itself, so its
        // stops are the control's data rather than theming.
        style={{
          backgroundImage:
            "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
      />

      {showAlpha && (
        <>
          <label className="sr-only" htmlFor={`${fieldId}-alpha`}>
            Opacity
          </label>
          <input
            id={`${fieldId}-alpha`}
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsva.a * 100)}
            onChange={event =>
              commit({ ...hsva, a: +event.target.value / 100 })
            }
            className={SLIDER}
            style={{
              // The ramp runs to the colour being edited, over a chequerboard,
              // so the track shows what the slider actually controls. Without
              // any background this rendered as a blank 12px strip whose only
              // label was screen-reader-only.
              backgroundImage: `linear-gradient(to right, transparent, ${toHexString({ ...hsva, a: 1 }, false)}), ${CHECKERBOARD}`,
              backgroundSize: "100% 100%, 8px 8px",
            }}
          />
        </>
      )}

      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`${fieldId}-hex`}>
          Hex colour
        </label>
        <Input
          id={`${fieldId}-hex`}
          className="font-mono"
          value={draftHex ?? rendered}
          /*
           * A keystroke moves the DRAFT and nothing else — not the surface, not
           * the host. Moving the surface here would also fight the re-seeding
           * effect above, which compares the rendered hex against the host's
           * prop and would pull a half-typed value straight back.
           */
          onChange={event => setDraftHex(event.target.value)}
          onKeyDown={event => {
            if (event.key !== "Enter") return;
            // Kept off the surrounding form, which may have a submit of its own:
            // finishing a colour is not submitting whatever contains it.
            event.preventDefault();
            commitDraft();
          }}
          onBlur={() => commitDraft()}
        />
        {canPickFromScreen && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Pick a colour from the screen"
            onClick={() => void pickFromScreen()}
          >
            <Pipette className="size-4" />
          </Button>
        )}
      </div>

      {swatches.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs">Presets</p>
          <div className="flex flex-wrap gap-1">
            {swatches.map(swatch => (
              <button
                key={swatch.id}
                type="button"
                title={swatch.label}
                aria-label={swatch.label}
                className="size-6 rounded border shadow-sm"
                style={{ backgroundColor: swatch.color }}
                onClick={() => onSwatchSelect?.(swatch)}
              />
            ))}
          </div>
        </div>
      )}

      {recentColors.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1 text-xs">Recent</p>
          <div className="flex flex-wrap gap-1">
            {recentColors.map(recent => (
              <button
                key={recent}
                type="button"
                title={recent}
                aria-label={recent}
                className="size-6 rounded border shadow-sm"
                style={{ backgroundColor: recent }}
                onClick={() => {
                  const parsed = parseHex(recent);
                  if (parsed) commit(hsvaFrom(parsed, parsed.alpha, hsva.h));
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
