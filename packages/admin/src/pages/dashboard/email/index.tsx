"use client";

import { Button } from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import { EmailHubLayout } from "@admin/components/features/email-hub/EmailHubLayout";
import { CreateEmailDialog } from "@admin/components/features/email-hub/messages/CreateEmailDialog";
import { MessagesList } from "@admin/components/features/email-hub/messages/MessagesList";
import { Plus } from "@admin/components/icons";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import {
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_READ_PERMISSIONS,
  holdsAny,
  visibleEmailHubTabs,
} from "@admin/constants/email-hub";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { replaceTo } from "@admin/lib/navigation";

/**
 * The Email hub's landing page, Messages: every email the site sends.
 *
 * The hub's rail entry leads here, so a reader who may see the hub but not
 * its emails (only its providers, say) is taken on to the first tab they may
 * see rather than shown a list the server would refuse.
 */
export default function EmailMessagesPage() {
  const { hasPermission, hasAnswer } = useCurrentUserPermissions();
  const [creating, setCreating] = useState(false);
  const canRead = holdsAny(hasPermission, EMAIL_TEMPLATE_READ_PERMISSIONS);
  const canCreate = holdsAny(hasPermission, EMAIL_TEMPLATE_CREATE_PERMISSIONS);
  const firstTab = visibleEmailHubTabs(hasPermission)[0];

  useEffect(() => {
    if (hasAnswer && !canRead && firstTab) replaceTo(firstTab.href);
  }, [hasAnswer, canRead, firstTab]);

  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <EmailHubLayout
        tab="messages"
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New email
            </Button>
          ) : undefined
        }
      >
        {hasAnswer && canRead ? <MessagesList /> : null}
      </EmailHubLayout>
      <CreateEmailDialog open={creating} onOpenChange={setCreating} />
    </QueryErrorBoundary>
  );
}
