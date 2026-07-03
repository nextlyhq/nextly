/**
 * Shared contract for every inspector control (spec §9). A control is a controlled
 * input: it receives the current value + an onChange, plus optional field metadata
 * (options/placeholder) and a token palette. Controls are registered into the control
 * registry by a string `type` and rendered generically by `renderControl`.
 */
import type { ContentField } from "../content/contentFields";

export interface TokenOption {
  /** Token id, e.g. "color.primary" (stored as { token }). */
  name: string;
  label: string;
  /** A CSS value used only for the swatch preview. */
  preview: string;
}

export interface ControlProps {
  value: unknown;
  onChange: (value: unknown) => void;
  label?: string;
  /** Present for Content-tab controls (options, placeholder, etc.). */
  field?: ContentField;
  /** Optional design-token palette for color/spacing controls. */
  tokens?: TokenOption[];
}

export type ControlComponent = (props: ControlProps) => React.ReactNode;
