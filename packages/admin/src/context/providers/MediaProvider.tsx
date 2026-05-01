import * as React from "react";

export type MediaAction =
  | { type: "CREATE_FOLDER"; parentId?: string }
  | { type: "EDIT_FOLDER"; folderId: string }
  | { type: "DELETE_FOLDER"; folderId: string; folderName: string };

interface MediaContextType {
  activeFolderId: string | null;
  setActiveFolderId: (id: string | null) => void;
  folderViewMode: "sidebar" | "grid";
  setFolderViewMode: (mode: "sidebar" | "grid") => void;
  pendingAction: MediaAction | null;
  triggerAction: (action: MediaAction | null) => void;
}

const MediaContext = React.createContext<MediaContextType | undefined>(
  undefined
);

export function MediaProvider({ children }: { children: React.ReactNode }) {
  const [activeFolderId, setActiveFolderId] = React.useState<string | null>(
    null
  );
  const [folderViewMode, setFolderViewMode] = React.useState<
    "sidebar" | "grid"
  >("sidebar");
  const [pendingAction, setPendingAction] = React.useState<MediaAction | null>(
    null
  );

  const triggerAction = React.useCallback((action: MediaAction | null) => {
    setPendingAction(action);
  }, []);

  const value = React.useMemo(
    () => ({
      activeFolderId,
      setActiveFolderId,
      folderViewMode,
      setFolderViewMode,
      pendingAction,
      triggerAction,
    }),
    [activeFolderId, folderViewMode, pendingAction, triggerAction]
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
