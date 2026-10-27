"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useId, useState } from "react";

import { Code } from "@admin/components/icons";
import { ROUTES, withQuery } from "@admin/constants/routes";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { navigateTo } from "@admin/lib/navigation";

import { isMessage } from "./messages-model";

type StartFrom = "blank" | "copy";

/** Where the editor opens for a new email with these choices. */
export function createRouteFor(name: string, copyOf: string | null): string {
  return withQuery(ROUTES.EMAIL_MESSAGES_CREATE, {
    name: name.trim() || undefined,
    duplicate: copyOf ?? undefined,
  });
}

/**
 * The questions a new email starts with: its name, and whether it starts
 * blank or from a copy of an existing email. The editor opens with the
 * answers filled in.
 *
 * It also says how the email is made. Only Code is offered until Write mode
 * ships, and saying so here keeps the question where it will be asked.
 */
export function CreateEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const nameId = useId();
  const copyId = useId();
  const [name, setName] = useState("");
  const [startFrom, setStartFrom] = useState<StartFrom>("blank");
  const [copyOf, setCopyOf] = useState<string | null>(null);
  const { data: templates = [] } = useEmailTemplates({ enabled: open });
  const emails = templates.filter(isMessage);

  const ready =
    name.trim().length > 0 && (startFrom === "blank" || copyOf !== null);

  const create = () => {
    if (!ready) return;
    navigateTo(createRouteFor(name, startFrom === "copy" ? copyOf : null));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New email</DialogTitle>
          <DialogDescription>
            Name it, then choose where it starts.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={event => {
            event.preventDefault();
            create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="For example: Back-in-stock alert"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Only your team sees it. You can change it later.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Start from</Label>
            <Tabs
              value={startFrom}
              onValueChange={value => setStartFrom(value as StartFrom)}
            >
              <TabsList aria-label="Start from">
                <TabsTrigger value="blank">Blank</TabsTrigger>
                <TabsTrigger value="copy">A copy of an email</TabsTrigger>
              </TabsList>
            </Tabs>
            {startFrom === "copy" && (
              <div className="space-y-1.5 pt-2">
                <Label htmlFor={copyId}>Email to copy</Label>
                <Select value={copyOf ?? undefined} onValueChange={setCopyOf}>
                  <SelectTrigger id={copyId}>
                    <SelectValue placeholder="Choose an email" />
                  </SelectTrigger>
                  <SelectContent>
                    {emails.map(email => (
                      <SelectItem key={email.id} value={email.id}>
                        {email.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>How do you want to make it?</Label>
            <div className="flex items-start gap-3 rounded-lg border-2 border-foreground p-3">
              <span className="rounded-md bg-muted p-2">
                <Code className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-medium">Code it</div>
                <p className="text-xs text-muted-foreground">
                  HTML with Liquid, in the code editor. Full control over the
                  markup.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Create email
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
