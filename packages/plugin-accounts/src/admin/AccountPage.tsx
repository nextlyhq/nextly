"use client";

import {
  apiErrorMessage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Stack,
  usePluginRoute,
  usePluginRouteMutation,
  type PluginRouteRead,
} from "@nextlyhq/plugin-sdk/admin";
import { useState, type JSX } from "react";

import {
  adminPageHref,
  PLUGIN_NAME,
  STAFF_API_PATH,
  type StaffAccountBody,
  type StaffAccountDetail,
  type StaffAction,
} from "../admin-contract";

import { AccountStates, formatWhen } from "./parts";

/** What the admin hands a plugin page: the query of its address among them. */
export interface AccountPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

/** How each action is offered, and what staff are told before they confirm it. */
const ACTION_TEXT: Record<
  StaffAction,
  { label: string; explains: string; danger: boolean }
> = {
  deactivate: {
    label: "Deactivate",
    explains:
      "The account is signed out everywhere, its links and codes stop working, and it cannot sign in until it is reactivated.",
    danger: true,
  },
  reactivate: {
    label: "Reactivate",
    explains: "The account can sign in again with its password.",
    danger: false,
  },
  "end-sessions": {
    label: "End sessions",
    explains:
      "The account is signed out on every device. Links already emailed to it keep working.",
    danger: false,
  },
  "resend-verification": {
    label: "Resend verification",
    explains:
      "A new verification email goes to the address. The code in the earlier one stops working.",
    danger: false,
  },
  "send-reset": {
    label: "Send reset link",
    explains:
      "A single-use link to choose a new password goes to the address. Nobody else sees it.",
    danger: false,
  },
  delete: {
    label: "Delete account",
    explains:
      "The account and its sessions are removed for good, and the address is told. This cannot be undone.",
    danger: true,
  },
};

/**
 * The actions that apply to an account as it stands, in the order they are
 * offered: the server refuses the others anyway.
 */
export function actionsFor(
  account: Pick<StaffAccountDetail, "active" | "verified">
): StaffAction[] {
  return [
    account.active ? "deactivate" : "reactivate",
    "end-sessions",
    ...(account.active && !account.verified
      ? (["resend-verification"] as const)
      : []),
    ...(account.active ? (["send-reset"] as const) : []),
    "delete",
  ];
}

/** The account's route, for a read or an action on it. */
function accountPath(accountId: string): string {
  return `${STAFF_API_PATH}/${encodeURIComponent(accountId)}`;
}

/** The first value of a query parameter, or the empty string. */
function firstOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * An account's page, for staff who hold read-accounts: its address, name
 * and states, and, for staff who also hold manage-accounts, what may be done
 * to it. Staff never see or set a password here.
 */
export function AccountPage({ searchParams }: AccountPageProps): JSX.Element {
  const accountId = firstOf(searchParams?.id);
  const [deleted, setDeleted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const read = usePluginRoute<StaffAccountBody>({
    plugin: PLUGIN_NAME,
    path: accountPath(accountId),
    enabled: accountId !== "" && !deleted,
    staleTime: 0,
  });

  const done = (action: StaffAction, message: string) => {
    setNotice(message);
    if (action === "delete") setDeleted(true);
  };

  return (
    <Stack gap={6} className="p-6">
      <a href={adminPageHref("list")} className="text-sm text-primary">
        All accounts
      </a>
      {notice === null ? null : (
        <p role="status" className="text-sm text-foreground">
          {notice}
        </p>
      )}
      {deleted ? null : (
        <AccountBody accountId={accountId} read={read} onDone={done} />
      )}
    </Stack>
  );
}

function AccountBody({
  accountId,
  read,
  onDone,
}: {
  accountId: string;
  read: PluginRouteRead<StaffAccountBody>;
  onDone: (action: StaffAction, message: string) => void;
}) {
  if (accountId === "")
    return <p className="text-sm text-foreground">No account is named.</p>;
  if (read.pending)
    return <p className="text-sm text-muted-foreground">Loading account…</p>;
  if (read.error !== null || read.data === undefined)
    return (
      <p role="alert" className="text-sm text-foreground">
        {apiErrorMessage(read.error, "The account could not be read.")}
      </p>
    );
  const { account, canManage } = read.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{account.name}</CardTitle>
        <CardDescription>{account.address}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap={6}>
          <AccountStates account={account} />
          <Details account={account} />
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {actionsFor(account).map(action => (
                <ActionButton
                  key={action}
                  accountId={account.id}
                  action={action}
                  onDone={onDone}
                />
              ))}
            </div>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

function Details({ account }: { account: StaffAccountDetail }) {
  const rows: Array<[string, string]> = [
    ["Created", formatWhen(account.createdAt)],
    ["Last sign-in", formatWhen(account.lastSignedInAt, "Never")],
    [
      "Verified",
      account.verifiedAt === null
        ? "Not yet"
        : `${formatWhen(account.verifiedAt)}${account.verifiedBy === null ? "" : ` (by ${account.verifiedBy})`}`,
    ],
    ["Password changed", formatWhen(account.passwordChangedAt, "Never")],
    ["Reset required since", formatWhen(account.resetRequiredAt)],
    ["Deactivated", formatWhen(account.deactivatedAt)],
    ["Live sessions", String(account.liveSessions)],
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="flex flex-col gap-1">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One action: a button that asks for confirmation, then sends it. */
function ActionButton({
  accountId,
  action,
  onDone,
}: {
  accountId: string;
  action: StaffAction;
  onDone: (action: StaffAction, message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const text = ACTION_TEXT[action];
  const writer = usePluginRouteMutation<undefined, { message: string }>({
    plugin: PLUGIN_NAME,
    path: `${accountPath(accountId)}/${action}`,
    // The account's page reads it again, with its new state.
    invalidates: [accountPath(accountId)],
  });

  const confirm = async () => {
    const answered = await writer.write();
    if (answered === undefined) return;
    setOpen(false);
    onDone(action, answered.message);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={text.danger ? "destructive" : "outline"} size="sm">
          {text.label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{text.label}?</DialogTitle>
          <DialogDescription>{text.explains}</DialogDescription>
        </DialogHeader>
        {writer.error === null ? null : (
          <p role="alert" className="text-sm text-foreground">
            {apiErrorMessage(writer.error, "That did not work.")}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            variant={text.danger ? "destructive" : "default"}
            disabled={writer.pending}
            onClick={() => void confirm()}
          >
            {text.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
