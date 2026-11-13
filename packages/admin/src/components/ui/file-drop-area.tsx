"use client";

/**
 * The admin's drop area: a dashed target a file is dragged onto, or pressed
 * to choose one. `DropTarget` is how it looks in each state, which the Media
 * library's upload area draws too, so every place that takes a file looks
 * the same; `FileDropArea` is that target with its own drop handling, for a
 * screen that reads a file rather than uploading it to the library, such as
 * a plugin's import. Through `@nextlyhq/plugin-sdk/admin` a plugin draws the
 * same.
 *
 * The target is one `role="button"`: Enter or Space opens the chooser, and
 * the hint inside it is plain text, since a nested button inside a button is
 * invalid markup. The hidden file input sits beside it for the same reason.
 *
 * @module components/ui/file-drop-area
 */

import { useId, type JSX, type ReactNode } from "react";
import { useDropzone, type DropzoneState } from "react-dropzone";

import { AlertTriangle, Upload } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

/** How the target is drawn: at rest, with files over it, or refusing them. */
export type DropTargetState = "default" | "active" | "reject";

/** What `DropTarget` draws, beside the drop handling its caller owns. */
export interface DropTargetProps {
  state: DropTargetState;
  /** The target's own props, from the caller's drop handling. */
  rootProps: ReturnType<DropzoneState["getRootProps"]>;
  /** The hidden file input's props, from the same. */
  inputProps: ReturnType<DropzoneState["getInputProps"]>;
  /** Opens the file chooser. */
  open: () => void;
  /** What the target is, for a screen reader: what pressing it does. */
  label: string;
  /** The line at rest. */
  title: ReactNode;
  /** The browse hint under it, at rest. */
  hint?: ReactNode;
  /** The line while files are over it. */
  activeTitle?: ReactNode;
  /** The line while it refuses what is over it. */
  rejectTitle?: ReactNode;
  /** What it takes, such as the types and the size, said before a drop. */
  description?: ReactNode;
  /** Above the title, such as the folder an upload goes to. */
  eyebrow?: ReactNode;
  className?: string;
}

const BORDERS: Record<DropTargetState, string> = {
  // At rest a full-strength border on hover, more visible than the resting one.
  default: "border-2 border-dashed border-border hover:border-primary",
  active: "border-2 border-dashed border-primary",
  reject: "border-2 border-dashed border-destructive",
};

// Token colours (bg-card) so both light and dark modes resolve correctly.
const BACKGROUNDS: Record<DropTargetState, string> = {
  default: "bg-card",
  active: "bg-primary/5 dark:bg-primary/5",
  reject: "bg-danger-surface",
};

/** The icon square's colour in each state. */
const SQUARES: Record<DropTargetState, string> = {
  default:
    "bg-primary/20 dark:bg-primary/30 group-hover:bg-primary/30 dark:group-hover:bg-primary/40",
  active: "bg-primary/20 dark:bg-primary/25",
  reject: "bg-danger-surface",
};

/** The drop target as the admin draws it, in each of its states. */
export function DropTarget({
  state,
  rootProps,
  inputProps,
  open,
  label,
  title,
  hint,
  activeTitle = "Drop files here...",
  rejectTitle = "These files can't be taken here",
  description,
  eyebrow,
  className,
}: DropTargetProps): JSX.Element {
  const descriptionId = useId();
  return (
    <>
      {/* Beside the target, not in it: a control inside a button is nested
          interaction, which assistive technology can't reach. */}
      <input {...inputProps} aria-hidden="true" tabIndex={-1} />
      <div
        {...rootProps}
        onClick={open}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            open();
          }
        }}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-md transition-all duration-200 group",
          BORDERS[state],
          BACKGROUNDS[state],
          "min-h-48 md:min-h-56 py-16 px-8",
          "cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
          className
        )}
        role="button"
        aria-label={label}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={0}
      >
        <DropIcon state={state} />
        <div className="flex flex-col items-center gap-0.5 text-center">
          {eyebrow}
          <DropLines
            state={state}
            title={title}
            hint={hint}
            activeTitle={activeTitle}
            rejectTitle={rejectTitle}
          />
          {description === undefined ? null : (
            <p
              id={descriptionId}
              className="mt-2 text-xs text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** The target's icon in its square, in the state's colour. */
function DropIcon({ state }: { state: DropTargetState }): JSX.Element {
  const Icon = state === "reject" ? AlertTriangle : Upload;
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md mb-5 transition-all duration-200",
        "w-16 h-16",
        SQUARES[state]
      )}
    >
      <Icon
        className={cn(
          state === "reject" ? "text-destructive" : "text-primary",
          "h-7 w-7 transition-colors duration-200"
        )}
      />
    </div>
  );
}

/** The target's words: its title and hint at rest, else the state's line. */
function DropLines({
  state,
  title,
  hint,
  activeTitle,
  rejectTitle,
}: Pick<
  DropTargetProps,
  "state" | "title" | "hint" | "activeTitle" | "rejectTitle"
>): JSX.Element {
  if (state !== "default") {
    return (
      <p className="text-sm font-semibold text-foreground">
        {state === "active" ? activeTitle : rejectTitle}
      </p>
    );
  }
  return (
    <>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint === undefined ? null : (
        <span className="mt-1 text-sm font-medium text-primary underline underline-offset-2">
          {hint}
        </span>
      )}
    </>
  );
}

/** @experimental */
export interface FileDropAreaProps {
  /** The files dropped or chosen; the caller judges whether it can use them. */
  onFiles: (files: File[]) => void;
  /** What the chooser offers, as an input's `accept`: `.xml,.csv`. */
  accept?: string;
  /** Whether more than one file may be dropped or chosen at once. */
  multiple?: boolean;
  disabled?: boolean;
  /** What the target is, for a screen reader: what pressing it does. */
  label: string;
  /** The line at rest. */
  title: ReactNode;
  /** The browse hint under it. */
  hint?: ReactNode;
  /** What it takes, said before a drop. */
  description?: ReactNode;
  className?: string;
}

/**
 * A drop area for a file the screen reads itself, rather than uploads to the
 * media library: drag one on it or press it to choose one, and it is handed
 * to `onFiles` as it is. What the file must be, and what happens when it is
 * not, is the caller's to say.
 *
 * @experimental
 */
export function FileDropArea({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  label,
  title,
  hint,
  description,
  className,
}: FileDropAreaProps): JSX.Element {
  // `noClick` and `noKeyboard`: the target opens the chooser itself, through
  // `open`, so a press is handled once. The drag callbacks are stated as
  // `undefined` because react-dropzone's option types ask for them against
  // the React 19 types; the hook handles drags itself.
  const { getRootProps, getInputProps, isDragActive, isDragReject, open } =
    useDropzone({
      multiple,
      disabled,
      noClick: true,
      noKeyboard: true,
      onDrop: accepted => {
        if (accepted.length > 0) onFiles(accepted);
      },
      onDragEnter: undefined,
      onDragOver: undefined,
      onDragLeave: undefined,
    });
  return (
    <DropTarget
      state={isDragReject ? "reject" : isDragActive ? "active" : "default"}
      rootProps={getRootProps()}
      inputProps={getInputProps(accept === undefined ? {} : { accept })}
      open={open}
      label={label}
      title={title}
      {...(hint === undefined ? {} : { hint })}
      activeTitle="Drop the file here..."
      rejectTitle="This can't be taken here"
      {...(description === undefined ? {} : { description })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
