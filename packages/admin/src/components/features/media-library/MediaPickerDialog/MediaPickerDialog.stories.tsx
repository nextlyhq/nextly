import { Button } from "@revnixhq/ui";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { MediaPickerDialog } from "./index";

const meta = {
  title: "Components/Media Library/MediaPickerDialog",
  component: MediaPickerDialog,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A reusable dialog for selecting media from the media library. Supports single-select and multi-select modes, with integrated upload functionality. Features search, filtering, sorting, and drag-and-drop upload within the dialog.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta<typeof MediaPickerDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Single-select mode - perfect for featured images or single media selection.
 * Only one item can be selected at a time.
 */
export const SingleSelect: Story = {
  args: {
    mode: "single",
    open: false,
    onOpenChange: () => {},
    onSelect: () => {},
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <div className="space-y-4">
        <Button onClick={() => setOpen(true)}>Open Single-Select Dialog</Button>

        {selected && (
          <div className="rounded border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Selected media ID: <strong>{selected}</strong>
            </p>
          </div>
        )}

        <MediaPickerDialog
          mode="single"
          open={open}
          onOpenChange={setOpen}
          onSelect={media => {
            if (media.length > 0) {
              setSelected(media[0].id);
              setOpen(false);
            }
          }}
        />
      </div>
    );
  },
};

/**
 * Multi-select mode - perfect for galleries or multiple media selection.
 * Multiple items can be selected at once.
 */
export const MultiSelect: Story = {
  args: {
    mode: "multi",
    open: false,
    onOpenChange: () => {},
    onSelect: () => {},
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([]);

    return (
      <div className="space-y-4">
        <Button onClick={() => setOpen(true)}>Open Multi-Select Dialog</Button>

        {selected.length > 0 && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium">
              Selected {selected.length} items:
            </p>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {selected.map(id => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </div>
        )}

        <MediaPickerDialog
          mode="multi"
          open={open}
          onOpenChange={setOpen}
          onSelect={media => {
            setSelected(media.map(m => m.id));
            setOpen(false);
          }}
        />
      </div>
    );
  },
};

/**
 * Image-only mode - restricts selection and upload to images only.
 * The dialog title changes to "Select Image" automatically.
 */
export const ImageOnly: Story = {
  args: {
    mode: "single",
    open: false,
    onOpenChange: () => {},
    onSelect: () => {},
    accept: "image/*",
    title: "Select Image",
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <div className="space-y-4">
        <Button onClick={() => setOpen(true)}>Select Image</Button>

        {selected && (
          <div className="rounded border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Selected image ID: <strong>{selected}</strong>
            </p>
          </div>
        )}

        <MediaPickerDialog
          mode="single"
          open={open}
          onOpenChange={setOpen}
          onSelect={media => {
            if (media.length > 0) {
              setSelected(media[0].id);
              setOpen(false);
            }
          }}
          accept="image/*"
          title="Select Image"
        />
      </div>
    );
  },
};

/**
 * With pre-selected items - shows how to pass initial selection.
 * Useful for editing existing content that already has media attached.
 */
export const WithPreselection: Story = {
  args: {
    mode: "multi",
    open: false,
    onOpenChange: () => {},
    onSelect: () => {},
    initialSelectedIds: new Set(["existing-id-1", "existing-id-2"]),
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string[]>([
      "existing-id-1",
      "existing-id-2",
    ]);

    return (
      <div className="space-y-4">
        <Button onClick={() => setOpen(true)}>
          Edit Selection ({selected.length} items)
        </Button>

        {selected.length > 0 && (
          <div className="rounded border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium">
              Currently selected {selected.length} items:
            </p>
            <ul className="list-inside list-disc text-sm text-muted-foreground">
              {selected.map(id => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </div>
        )}

        <MediaPickerDialog
          mode="multi"
          open={open}
          onOpenChange={setOpen}
          onSelect={media => {
            setSelected(media.map(m => m.id));
            setOpen(false);
          }}
          initialSelectedIds={new Set(selected)}
        />
      </div>
    );
  },
};

/**
 * Custom title - shows how to customize the dialog title.
 */
export const CustomTitle: Story = {
  args: {
    mode: "single",
    open: false,
    onOpenChange: () => {},
    onSelect: () => {},
    title: "Select Featured Image",
    accept: "image/*",
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);

    return (
      <div className="space-y-4">
        <Button onClick={() => setOpen(true)}>Select Featured Image</Button>

        {selected && (
          <div className="rounded border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">
              Featured image ID: <strong>{selected}</strong>
            </p>
          </div>
        )}

        <MediaPickerDialog
          mode="single"
          open={open}
          onOpenChange={setOpen}
          onSelect={media => {
            if (media.length > 0) {
              setSelected(media[0].id);
              setOpen(false);
            }
          }}
          title="Select Featured Image"
          accept="image/*"
        />
      </div>
    );
  },
};
