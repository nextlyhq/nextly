import * as React from "react";

import { usePersistedState } from "@admin/hooks/usePersistedState";

export type MediaAction =
  | { type: "CREATE_FOLDER"; parentId?: string }
  | { type: "EDIT_FOLDER"; folderId: string }
  | { type: "DELETE_FOLDER"; folderId: string; folderName: string };

interface MediaContextType {
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  /**
   * Whether the folder tree renders in the media sub-sidebar. Purely a
   * show/hide of the tree: inline folder navigation on the page (breadcrumbs
   * + current level's folders) is always present, so hiding the tree never
   * relocates folder navigation.
   */
  isFolderTreeVisible: boolean;
  setIsFolderTreeVisible: (visible: boolean) => void;
  pendingAction: MediaAction | null;
  triggerAction: (action: MediaAction | null) => void;
}

const MediaContext = React.createContext<MediaContextType | undefined>(
  undefined
);

const FOLDER_TREE_STORAGE_KEY = "nextly:admin:media:folder-tree";

const isStoredFlag = (value: string): value is "1" | "0" =>
  value === "1" || value === "0";

export function MediaProvider({ children }: { children: React.ReactNode }) {
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(
    null
  );
  const [treeFlag, setTreeFlag] = usePersistedState<"1" | "0">(
    FOLDER_TREE_STORAGE_KEY,
    "1",
    isStoredFlag
  );
  const [pendingAction, setPendingAction] = React.useState<MediaAction | null>(
    null
  );

  const triggerAction = React.useCallback((action: MediaAction | null) => {
    setPendingAction(action);
  }, []);

  const setIsFolderTreeVisible = React.useCallback(
    (visible: boolean) => {
      setTreeFlag(visible ? "1" : "0");
    },
    [setTreeFlag]
  );

  const isFolderTreeVisible = treeFlag === "1";

  const value = React.useMemo(
    () => ({
      activeFolderId,
      setActiveFolderId,
      isFolderTreeVisible,
      setIsFolderTreeVisible,
      pendingAction,
      triggerAction,
    }),
    [
      activeFolderId,
      isFolderTreeVisible,
      setIsFolderTreeVisible,
      pendingAction,
      triggerAction,
    ]
  );

  return (
    <MediaContext.Provider value={value}>{children}</MediaContext.Provider>
  );
}

export function useMediaContext() {
  const context = React.useContext(MediaContext);
  if (context === undefined) {
    throw new Error("useMediaContext must be used within a MediaProvider");
  }
  return context;
}
