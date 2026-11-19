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

import { Code, Pencil } from "@admin/components/icons";
import { ROUTES, withQuery } from "@admin/constants/routes";
import { useEmailTemplates } from "@admin/hooks/queries/useEmailTemplates";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";
import type { TemplateFormat } from "@admin/services/emailTemplateApi";

import { isMessage } from "./messages-model";

type StartFrom = "blank" | "copy";

/**
 * Where the editor opens for a new email with these choices. A copy keeps the
 * format of the email it copies; a blank one says how it is made when it is
 * written (coded is the editor's own start).
 */
export function createRouteFor(
  name: string,
  copyOf: string | null,
  format: TemplateFormat = "code"
): string {
  return withQuery(ROUTES.EMAIL_MESSAGES_CREATE, {
    name: name.trim() || undefined,
    duplicate: copyOf ?? undefined,
    format: copyOf === null && format === "written" ? "written" : undefined,
  });
}

/** The two ways an email is made, as the question offers them. */
const HOW: ReadonlyArray<{
  format: TemplateFormat;
  title: string;
  hint: string;
  Icon: typeof Code;
}> = [
  {
    format: "written",
    title: "Write it",
    hint: "Headings, text, buttons, images and lists. Variables are chips. The look comes from your brand settings.",
    Icon: Pencil,
  },
  {
    format: "code",
    title: "Code it",
    hint: "HTML with Liquid, in the code editor. Full control over the markup.",
    Icon: Code,
  },
];

/**
 * The questions a new email starts with: its name, and whether it starts
 * blank or from a copy of an existing email. The editor opens with the
 * answers filled in.
 *
 * A blank email also asks how it is made: written in blocks or coded, with
 * neither chosen for the person. A copy keeps the format of the email it
 * copies.
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
  const howId = useId();
  const [name, setName] = useState("");
  const [startFrom, setStartFrom] = useState<StartFrom>("blank");
  const [copyOf, setCopyOf] = useState<string | null>(null);
  const [how, setHow] = useState<TemplateFormat | null>(null);
  const { data: templates = [] } = useEmailTemplates({ enabled: open });
  const emails = templates.filter(isMessage);

  const ready =
    name.trim().length > 0 &&
    (startFrom === "blank" ? how !== null : copyOf !== null);

  const create = () => {
    if (!ready) return;
    navigateTo(
      createRouteFor(name, startFrom === "copy" ? copyOf : null, how ?? "code")
    );
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

          {startFrom === "blank" ? (
            <div className="space-y-1.5">
              <Label id={howId}>How do you want to make it?</Label>
              <div
                role="radiogroup"
                aria-labelledby={howId}
                className="grid gap-2"
              >
                {HOW.map(({ format, title, hint, Icon }) => (
                  <button
                    key={format}
                    type="button"
                    role="radio"
                    aria-checked={how === format}
                    onClick={() => setHow(format)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border-2 p-3 text-left",
                      how === format ? "border-foreground" : "border-border"
                    )}
                  >
                    <span className="rounded-md bg-muted p-2">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span>
                      <span className="block text-sm font-medium">{title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                A coded email can&apos;t be turned into blocks.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              A copy is made the way its email is: written or coded.
            </p>
          )}

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
