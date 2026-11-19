/**
 * Upload a font file: the editor beside the Fonts tab that adds one face from
 * a file on the author's computer.
 *
 * The weight and style are asked for rather than read from the file, because
 * getting them wrong is silent: a face declaring 400 for a bold file loads and
 * matches nothing the author meant.
 *
 * NOT a `<form>`, and that is deliberate. The panel is rendered inside the
 * entry editor, whose fields sit in one, and HTML forbids a form inside a
 * form; a submit raised in here would bubble to the entry's handler and save
 * the page. Enter in a text field still uploads, by handling the keystroke
 * here, and a composing (IME) keystroke is left alone.
 *
 * @module font-upload-editor
 */
import { Button, Checkbox, Input } from "@nextlyhq/ui";
import type * as React from "react";
import { useId, useRef, useState } from "react";

import { ChoiceMenu } from "./font-choice-menu";
import { weightName } from "./font-library";

/** A font file and the descriptors an author states for it. */
export interface FontFaceUpload {
  file: File;
  family: string;
  /** `400`, `700`, or a variable range such as `100 900`. */
  weight: string;
  /** `normal` or `italic`. */
  style: string;
}

type WeightChoice =
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "900"
  | "variable";

const WEIGHTS: ReadonlyArray<readonly [WeightChoice, string]> = [
  ...(
    ["100", "200", "300", "400", "500", "600", "700", "800", "900"] as const
  ).map(weight => [weight, weightName(Number(weight))] as const),
  ["variable", "Variable (a range)"],
];

/** What an author is told about a weight or range that cannot be stored. */
const WEIGHT_PROBLEM =
  "Choose a weight, or a range with the lighter weight first.";

/**
 * The family a filename suggests, as a starting point the author can correct:
 * `Inter-BoldItalic.woff2` is `Inter`.
 */
function familyFromFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return (stem.split(/[-_]/)[0] ?? stem).trim();
}

/** A weight from 1 to 1000 written as plain digits, or nothing. */
function weightNumber(value: string): number | undefined {
  if (!/^\d{1,4}$/.test(value.trim())) return undefined;
  const number = Number(value);
  return number >= 1 && number <= 1000 ? number : undefined;
}

/** The weight descriptor the choice stands for, or nothing when unusable. */
function weightOf(
  choice: WeightChoice,
  from: string,
  to: string
): string | undefined {
  if (choice !== "variable") return choice;
  const low = weightNumber(from);
  const high = weightNumber(to);
  if (low === undefined || high === undefined || low > high) return undefined;
  return low === high ? String(low) : `${String(low)} ${String(high)}`;
}

/** The upload's state, its checks and its submit, apart from how it looks. */
function useUploadForm(
  onAddFace: (request: FontFaceUpload) => Promise<string | undefined>
) {
  const [file, setFile] = useState<File | null>(null);
  const [family, setFamily] = useState("");
  /*
   * Whether the family came from the author or from a filename. Emptiness
   * cannot answer it: a guess is replaced by a better guess when the file
   * changes, and what an author typed is theirs.
   */
  const [familyAuthored, setFamilyAuthored] = useState(false);
  const [weight, setWeight] = useState<WeightChoice>("400");
  const [from, setFrom] = useState("100");
  const [to, setTo] = useState("900");
  const [style, setStyle] = useState<"normal" | "italic">("normal");
  const [rights, setRights] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * The picker element itself. A file input is uncontrolled, and a browser
   * raises `change` only when the selection changes, so it is cleared by hand
   * after an upload: choosing the same file again is how a family gets its
   * italic.
   */
  const picker = useRef<HTMLInputElement | null>(null);

  const chooseFile = (chosen: File | null): void => {
    setFile(chosen);
    setError(null);
    if (chosen !== null && !familyAuthored) {
      setFamily(familyFromFilename(chosen.name));
    }
  };

  const typeFamily = (value: string): void => {
    setFamily(value);
    setFamilyAuthored(true);
  };

  const ready = file !== null && family.trim() !== "" && rights && !busy;

  /** Everything back to a fresh start; the cut too, or a kept `700 Italic`
   *  would be applied to the next file by default, and the rights. */
  const clear = (): void => {
    setFile(null);
    if (picker.current !== null) picker.current.value = "";
    setFamily("");
    setFamilyAuthored(false);
    setWeight("400");
    // The range too: the next variable file's bounds are its own.
    setFrom("100");
    setTo("900");
    setStyle("normal");
    // The rights are the next file's to confirm, not carried from this one.
    setRights(false);
  };

  const submit = async (): Promise<void> => {
    if (!ready) return;
    const descriptor = weightOf(weight, from, to);
    if (descriptor === undefined) {
      setError(WEIGHT_PROBLEM);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const refusal = await onAddFace({
        file,
        family: family.trim(),
        weight: descriptor,
        style,
      });
      // A refusal leaves everything where the author left it.
      if (refusal === undefined) clear();
      else setError(refusal);
    } finally {
      setBusy(false);
    }
  };

  /** Enter uploads; a composing keystroke belongs to the IME. */
  const uploadOnEnter = (event: React.KeyboardEvent): void => {
    if (event.key !== "Enter") return;
    const native = event.nativeEvent;
    if (native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    void submit();
  };

  return {
    file,
    family,
    weight,
    from,
    to,
    style,
    rights,
    error,
    busy,
    ready,
    picker,
    chooseFile,
    typeFamily,
    setWeight,
    setFrom,
    setTo,
    setStyle,
    setRights,
    submit,
    uploadOnEnter,
  };
}

type UploadForm = ReturnType<typeof useUploadForm>;

export function FontUploadEditor({
  onAddFace,
  acceptFiles,
}: {
  onAddFace: (request: FontFaceUpload) => Promise<string | undefined>;
  acceptFiles?: string;
}): React.JSX.Element {
  const ids = useId();
  const form = useUploadForm(onAddFace);
  return (
    <div className="nx-vars-editor__body nx-fonts-upload">
      <h3 className="nx-fonts__editor-title">Upload a font file</h3>
      <FileField ids={ids} form={form} acceptFiles={acceptFiles} />
      <div className="nx-vars-editor__field">
        <label className="nx-vars-editor__label" htmlFor={`${ids}-family`}>
          Family
        </label>
        <Input
          id={`${ids}-family`}
          value={form.family}
          placeholder="Inter"
          disabled={form.busy}
          onChange={event => form.typeFamily(event.target.value)}
          onKeyDown={form.uploadOnEnter}
        />
      </div>
      <WeightField ids={ids} form={form} />
      <StyleField ids={ids} form={form} />
      <div className="nx-fonts__check">
        <Checkbox
          id={`${ids}-rights`}
          checked={form.rights}
          disabled={form.busy}
          onCheckedChange={checked => form.setRights(checked === true)}
        />
        <label htmlFor={`${ids}-rights`}>
          I have the right to use this font on the web
        </label>
      </div>
      {form.error === null ? null : (
        <p className="nx-vars-editor__issue" role="alert">
          {form.error}
        </p>
      )}
      <div className="nx-vars-editor__actions">
        {/* `type="button"`: inside the entry's form a button defaults to submit. */}
        <Button
          type="button"
          size="sm"
          className="nx-vars-editor__button"
          disabled={!form.ready}
          onClick={() => void form.submit()}
        >
          {form.busy ? "Uploading\u2026" : "Upload"}
        </Button>
      </div>
    </div>
  );
}

/** The file: the admin's button opens the hidden native picker. */
function FileField({
  ids,
  form,
  acceptFiles,
}: {
  ids: string;
  form: UploadForm;
  acceptFiles: string | undefined;
}): React.JSX.Element {
  const { file } = form;
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label">File</span>
      <div className="nx-fonts-upload__file">
        <input
          ref={form.picker}
          className="nx-fonts-upload__input"
          type="file"
          accept={acceptFiles}
          aria-label="Font file"
          // Out of the accessibility tree: "Choose file" is the control.
          aria-hidden="true"
          tabIndex={-1}
          onChange={event => form.chooseFile(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="nx-vars-editor__button"
          aria-describedby={`${ids}-file-name`}
          disabled={form.busy}
          onClick={() => form.picker.current?.click()}
        >
          Choose file
        </Button>
        <span className="nx-fonts-upload__name" id={`${ids}-file-name`}>
          {file === null
            ? "No file chosen"
            : `${file.name} \u00b7 ${String(Math.round(file.size / 1024))} KB`}
        </span>
      </div>
      <span className="nx-fonts__hint">.woff2 or .woff</span>
    </div>
  );
}

/** The weight: one of the nine, or a range for a variable file. */
function WeightField({
  ids,
  form,
}: {
  ids: string;
  form: UploadForm;
}): React.JSX.Element {
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label" aria-hidden="true">
        Weight
      </span>
      <ChoiceMenu
        label="Weight"
        value={form.weight}
        options={WEIGHTS}
        onChange={form.setWeight}
        disabled={form.busy}
      />
      {form.weight === "variable" ? (
        <div className="nx-fonts-upload__range">
          <label className="nx-fonts__hint" htmlFor={`${ids}-from`}>
            From
          </label>
          <Input
            id={`${ids}-from`}
            inputMode="numeric"
            value={form.from}
            disabled={form.busy}
            onChange={event => form.setFrom(event.target.value)}
            onKeyDown={form.uploadOnEnter}
          />
          <label className="nx-fonts__hint" htmlFor={`${ids}-to`}>
            To
          </label>
          <Input
            id={`${ids}-to`}
            inputMode="numeric"
            value={form.to}
            disabled={form.busy}
            onChange={event => form.setTo(event.target.value)}
            onKeyDown={form.uploadOnEnter}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The style: Normal or Italic, as a segmented pair. */
function StyleField({
  ids,
  form,
}: {
  ids: string;
  form: UploadForm;
}): React.JSX.Element {
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label" id={`${ids}-style`}>
        Style
      </span>
      <div
        className="nx-vars__seg"
        role="group"
        aria-labelledby={`${ids}-style`}
      >
        {(["normal", "italic"] as const).map(candidate => (
          <button
            key={candidate}
            type="button"
            aria-pressed={form.style === candidate}
            disabled={form.busy}
            onClick={() => form.setStyle(candidate)}
          >
            {candidate === "normal" ? "Normal" : "Italic"}
          </button>
        ))}
      </div>
    </div>
  );
}
