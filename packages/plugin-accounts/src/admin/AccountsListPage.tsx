"use client";

import {
  apiErrorMessage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  usePluginRoute,
  type PluginRouteRead,
} from "@nextlyhq/plugin-sdk/admin";
import { useState, type FormEvent, type JSX } from "react";

import {
  ACCOUNT_STATES,
  adminPageHref,
  PLUGIN_NAME,
  STAFF_API_PATH,
  type AccountState,
  type StaffAccountsListBody,
} from "../admin-contract";

import { AccountStates, formatWhen } from "./parts";

/** How many accounts a page of the list shows. */
const PER_PAGE = 25;

/** The filter that lists every account. */
const ANY_STATE = "any";

const STATE_LABELS: Record<AccountState, string> = {
  verified: "Verified",
  unverified: "Unverified",
  active: "Active",
  deactivated: "Deactivated",
  "reset-required": "Reset required",
};

/** The list route's path for a search, a state and a page. */
export function listPath(
  search: string,
  state: AccountState | undefined,
  page: number
): string {
  const query = new URLSearchParams();
  if (search !== "") query.set("search", search);
  if (state !== undefined) query.set("state", state);
  query.set("page", String(page));
  query.set("perPage", String(PER_PAGE));
  return `${STAFF_API_PATH}?${query.toString()}`;
}

function isAccountState(value: string): value is AccountState {
  return (ACCOUNT_STATES as readonly string[]).includes(value);
}

/**
 * The list of the site's accounts, for staff who hold read-accounts:
 * searched by address or name, filtered by state, newest first, a page at a
 * time. Every name and address is drawn as text, never as markup.
 */
export function AccountsListPage(): JSX.Element {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<AccountState | undefined>(undefined);
  const [page, setPage] = useState(1);
  const read = usePluginRoute<StaffAccountsListBody>({
    plugin: PLUGIN_NAME,
    path: listPath(search, state, page),
    // Staff act on accounts elsewhere, so every visit reads the list afresh.
    staleTime: 0,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(draft.trim());
    setPage(1);
  };
  const filter = (value: string) => {
    setState(isAccountState(value) ? value : undefined);
    setPage(1);
  };

  return (
    <Stack gap={6} className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            The site&apos;s own accounts: visitors who signed up, never staff.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Stack gap={4}>
            <form
              role="search"
              onSubmit={submit}
              className="flex flex-wrap items-end gap-3"
            >
              <Stack gap={1}>
                <Label htmlFor="accounts-search">Address or name</Label>
                <Input
                  id="accounts-search"
                  type="search"
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  maxLength={320}
                />
              </Stack>
              <Stack gap={1}>
                <Label htmlFor="accounts-state">State</Label>
                <Select value={state ?? ANY_STATE} onValueChange={filter}>
                  <SelectTrigger id="accounts-state">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_STATE}>Any state</SelectItem>
                    {ACCOUNT_STATES.map(value => (
                      <SelectItem key={value} value={value}>
                        {STATE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Stack>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <ListBody read={read} />
            <Pager
              page={page}
              hasPrev={read.data?.meta.hasPrev ?? false}
              hasNext={read.data?.meta.hasNext ?? false}
              onPage={setPage}
            />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

/** The table, or what stands in for it while it loads, fails or is empty. */
function ListBody({ read }: { read: PluginRouteRead<StaffAccountsListBody> }) {
  if (read.pending)
    return <p className="text-sm text-muted-foreground">Loading accounts…</p>;
  if (read.error !== null)
    return (
      <p role="alert" className="text-sm text-foreground">
        {apiErrorMessage(read.error, "The accounts could not be read.")}
      </p>
    );
  const items = read.data?.items ?? [];
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No account matches.</p>;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="px-3 py-2 font-medium">Name</th>
          <th className="px-3 py-2 font-medium">Address</th>
          <th className="px-3 py-2 font-medium">State</th>
          <th className="px-3 py-2 font-medium">Created</th>
          <th className="px-3 py-2 font-medium">Last sign-in</th>
        </tr>
      </thead>
      <tbody>
        {items.map(account => (
          <tr key={account.id} className="border-b border-border">
            <td className="px-3 py-2">
              <a
                href={adminPageHref("account", account.id)}
                className="font-medium text-primary"
              >
                {account.name}
              </a>
            </td>
            <td className="px-3 py-2 text-foreground">{account.address}</td>
            <td className="px-3 py-2">
              <AccountStates account={account} />
            </td>
            <td className="px-3 py-2 text-muted-foreground">
              {formatWhen(account.createdAt)}
            </td>
            <td className="px-3 py-2 text-muted-foreground">
              {formatWhen(account.lastSignedInAt, "Never")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Pager({
  page,
  hasPrev,
  hasNext,
  onPage,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav aria-label="Pages" className="flex items-center justify-between">
      <Button
        variant="outline"
        size="sm"
        disabled={!hasPrev}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">Page {page}</span>
      <Button
        variant="outline"
        size="sm"
        disabled={!hasNext}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}
