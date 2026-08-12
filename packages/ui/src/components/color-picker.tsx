"use client";

import { Pipette } from "lucide-react";
import * as React from "react";

import {
  hsvToRgb,
  hueAt,
  huePosition,
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
      setHsva(toHsva(color));
    }
  }, [color, rendered, showAlpha]);

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

  const handle = surfacePointFor(hsva.s, hsva.v);
  const hueOnly = toHex(hsvToRgb({ h: hsva.h, s: 1, v: 1 }));

  const pickFromScreen = async (): Promise<void> => {
    const ctor = (window as unknown as Record<string, unknown>).EyeDropper as
      | (new () => EyeDropperLike)
      | undefined;
    if (!ctor) return;
    try {
      const { sRGBHex } = await new ctor().open();
      const parsed = parseHex(sRGBHex);
      if (parsed) commit({ ...rgbToHsv(parsed), a: hsva.a });
    } catch {
      // The user dismissed the picker. Not an error, and nothing to report.
    }
  };

  return (
    <div className={cn("w-64 space-y-3", className)}>
      <div
        ref={surfaceRef}
        role="application"
        aria-label="Saturation and brightness"
        className="relative h-40 w-full cursor-crosshair rounded-md"
        style={{
          backgroundColor: hueOnly,
          backgroundImage:
            "linear-gradient(to right, #fff, transparent), linear-gradient(to top, #000, transparent)",
        }}
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
          className="border-background pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm ring-1 ring-black/30"
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
        max={359}
        step={1}
        value={Math.round(huePosition(hsva.h) * 360) % 360}
        onChange={event =>
          commit({ ...hsva, h: hueAt(+event.target.value / 360) })
        }
        className="h-3 w-full cursor-pointer appearance-none rounded-full"
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
            className="h-3 w-full cursor-pointer appearance-none rounded-full"
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
          onChange={event => {
            const text = event.target.value;
            setDraftHex(text);
            const parsed = parseHex(text);
            // Only a value that IS a colour is published. A field mid-typing is
            // the ordinary state of one, and reporting `#ab` as a colour would
            // repaint the surface black under the person typing it.
            if (parsed) {
              setHsva({ ...rgbToHsv(parsed), a: parsed.alpha });
              onColorChange(toHex(parsed, showAlpha ? parsed.alpha : 1));
            }
          }}
          onBlur={() => setDraftHex(null)}
        />
        {eyeDropperSupported() && (
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
                  if (parsed) commit({ ...rgbToHsv(parsed), a: parsed.alpha });
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
