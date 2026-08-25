/**
 * Tailwind CSS preset for @nextlyhq/ui components.
 *
 * Defines the CSS custom property contract that all UI components expect.
 * Consumers must provide the actual CSS variable values in their stylesheets.
 *
 * Usage (Tailwind v3, ESM):
 *   // tailwind.config.ts
 *   import uiPreset from "@nextlyhq/ui/tailwind-preset";
 *   export default { presets: [uiPreset], ... };
 *
 * Usage (Tailwind v3, CommonJS):
 *   // tailwind.config.js
 *   const { uiPreset } = require("@nextlyhq/ui/tailwind-preset");
 *   module.exports = { presets: [uiPreset], ... };
 *
 * Usage (Tailwind v4 with @config):
 *   Consumers define the equivalent @theme tokens in their CSS.
 *   This file serves as the reference contract.
 *
 * Scope: tokens and the utilities derived from them, and nothing else. The
 * component classes the library writes into its own markup — `.nx-page-shell`,
 * `.nx-bleed`, `.nx-form-section-rows` — are CSS rules rather than token
 * mappings, and they ship in `theme.css` for every consumer alike. Restating
 * one of them here would express a single decision in two places that agree
 * until one of them is edited, and would still leave the others missing; the
 * boundary holds for all of them or it holds for none. `theme.css` is
 * therefore required alongside this preset, not an alternative to it, and
 * `tailwind-preset.test.ts` fails if a component selector reappears here.
 */
/**
 * The numbered shade scale for a color, mixed from its base the same way the v4
 * `@theme` block does, so v3 preset consumers get the same utilities the
 * components emit (`bg-destructive-700`, `bg-primary-500`, `border-primary-300`).
 *
 * Named for the derivation rather than for one caller: the status colors, the
 * primary and the accent all use it, and `@theme` derives all five identically.
 */
const tintScale = (base: string): Record<number, string> => ({
  50: `color-mix(in srgb, var(${base}), white 95%)`,
  100: `color-mix(in srgb, var(${base}), white 90%)`,
  200: `color-mix(in srgb, var(${base}), white 70%)`,
  300: `color-mix(in srgb, var(${base}), white 50%)`,
  400: `color-mix(in srgb, var(${base}), white 30%)`,
  500: `var(${base})`,
  600: `color-mix(in srgb, var(${base}), black 10%)`,
  700: `color-mix(in srgb, var(${base}), black 30%)`,
  800: `color-mix(in srgb, var(${base}), black 50%)`,
  900: `color-mix(in srgb, var(${base}), black 70%)`,
  950: `color-mix(in srgb, var(${base}), black 85%)`,
});

/** @experimental */
const uiPreset = {
  theme: {
    extend: {
      colors: {
        // The modal scrim. Mapped here as well as in the v4 `@theme` block,
        // because this preset is the documented Tailwind v3 path and reads
        // none of that: without these two, `bg-overlay` generates no rule at
        // all and every backdrop is transparent rather than merely unthemed.
        overlay: "var(--nx-overlay)",
        "overlay-soft": "var(--nx-overlay-soft)",
        "overlay-strong": "var(--nx-overlay-strong)",
        border: {
          DEFAULT: "var(--nx-border)",
          subtle: "var(--nx-border-subtle)",
          strong: "var(--nx-border-strong)",
        },
        input: "var(--nx-input)",
        // The boundary of a control that draws no fill of its own -- an
        // unchecked checkbox, radio or switch. Separate from `input` because
        // that one is the field border weight, which sits below the 3:1
        // non-text minimum by design.
        "control-border": "var(--nx-control-border)",
        ring: "var(--nx-ring)",
        background: "var(--nx-background)",
        foreground: "var(--nx-foreground)",
        primary: {
          DEFAULT: "var(--nx-primary)",
          foreground: "var(--nx-primary-foreground)",
          ...tintScale("--nx-primary"),
        },
        secondary: {
          DEFAULT: "var(--nx-secondary)",
          foreground: "var(--nx-secondary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--nx-destructive)",
          // Saturated fill for solid buttons, distinct from the text-tuned base.
          solid: "var(--nx-destructive-solid)",
          foreground: "var(--nx-destructive-foreground)",
          ...tintScale("--nx-destructive"),
        },
        success: {
          DEFAULT: "var(--nx-success)",
          solid: "var(--nx-success-solid)",
          foreground: "var(--nx-success-foreground)",
          ...tintScale("--nx-success"),
        },
        warning: {
          DEFAULT: "var(--nx-warning)",
          foreground: "var(--nx-warning-foreground)",
          ...tintScale("--nx-warning"),
        },
        muted: {
          DEFAULT: "var(--nx-muted)",
          foreground: "var(--nx-muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--nx-accent)",
          foreground: "var(--nx-accent-foreground)",
          ...tintScale("--nx-accent"),
        },
        // The editor's highlight mark, and the syntax colors, so authored
        // content and code blocks theme like everything else.
        highlight: {
          DEFAULT: "var(--nx-highlight)",
          foreground: "var(--nx-highlight-foreground)",
        },
        code: {
          bg: "var(--nx-code-bg)",
          fg: "var(--nx-code-fg)",
          comment: "var(--nx-code-comment)",
          keyword: "var(--nx-code-keyword)",
          string: "var(--nx-code-string)",
          number: "var(--nx-code-number)",
          function: "var(--nx-code-function)",
          operator: "var(--nx-code-operator)",
          punctuation: "var(--nx-code-punctuation)",
          variable: "var(--nx-code-variable)",
          tag: "var(--nx-code-tag)",
          deleted: "var(--nx-code-deleted)",
          inserted: "var(--nx-code-inserted)",
        },
        // `sidebar` and `sidebar-background` are the same value under two
        // names, and `sidebar-accent` and `sidebar-accent-background` likewise.
        // Both pairs exist in the v4 block and both spellings are in use, so
        // dropping either here would leave a live utility generating nothing.
        sidebar: {
          DEFAULT: "var(--nx-sidebar-background)",
          background: "var(--nx-sidebar-background)",
          foreground: "var(--nx-sidebar-foreground)",
          primary: "var(--nx-sidebar-primary)",
          "primary-foreground": "var(--nx-sidebar-primary-foreground)",
          accent: "var(--nx-sidebar-accent)",
          "accent-background": "var(--nx-sidebar-accent)",
          "accent-foreground": "var(--nx-sidebar-accent-foreground)",
          border: "var(--nx-sidebar-border)",
          ring: "var(--nx-sidebar-ring)",
        },
        popover: {
          DEFAULT: "var(--nx-popover)",
          foreground: "var(--nx-popover-foreground)",
        },
        card: {
          DEFAULT: "var(--nx-card)",
          foreground: "var(--nx-card-foreground)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.3s cubic-bezier(0.87, 0, 0.13, 1)",
        "accordion-up": "accordion-up 0.3s cubic-bezier(0.87, 0, 0.13, 1)",
      },
    },
  },
};

// Exported both ways on purpose. CommonJS cannot represent a default-only
// module without `module.exports =`, which makes the emitted declarations
// disagree with the runtime shape (attw's FalseExportDefault); a named export
// alongside it keeps `require()` and `import` consistent and typed.
export { uiPreset };
export default uiPreset;
