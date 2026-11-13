/**
 * One short dialog that creates a collection, Single or field group.
 *
 * @module components/features/schema-builder/new-entity/NewEntityDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { BUILDER_KIND_NOUN, type BuilderConfig } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

type Props = {
  open: boolean;
  config: BuilderConfig;
  onCancel: () => void;
  onCreate: (values: BuilderSettingsValues) => void;
};

export function NewEntityDialog({
  open,
  config,
  onCancel,
}: Props): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {BUILDER_KIND_NOUN[config.kind]}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel}>Cancel</Button>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
