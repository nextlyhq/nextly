import { useMediaContext } from "../../../context/providers/MediaProvider";
import { FolderTreeView } from "../../features/media-library/FolderTreeView";

export function MediaSidebarContent() {
  const { activeFolderId, setActiveFolderId, triggerAction } =
    useMediaContext();

  return (
    <div className="h-full flex flex-col">
      <FolderTreeView
        activeFolderId={activeFolderId}
        onFolderSelect={setActiveFolderId}
        onCreateFolder={parentId =>
          triggerAction({ type: "CREATE_FOLDER", parentId })
        }
        onEditFolder={folderId =>
          triggerAction({ type: "EDIT_FOLDER", folderId })
        }
        onDeleteFolder={(folderId, folderName) =>
          triggerAction({ type: "DELETE_FOLDER", folderId, folderName })
        }
        className="border-r-0 h-full"
      />
    </div>
  );
}
