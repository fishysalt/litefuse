import { Pause, Play, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { ConfirmDialog } from "@/src/components/ui/confirm-dialog";
import { OverviewSelectionBar } from "@/src/features/evals/v2/components/OverviewSelectionBar/OverviewSelectionBar";

export function RulesOverviewSelectionBarView({
  selectedCount,
  hasWriteAccess,
  statusChangePending,
  deletePending,
  deleteDialogOpen,
  onClear,
  onEnable,
  onDisable,
  onDelete,
  onDeleteDialogOpenChange,
  onConfirmDelete,
}: {
  selectedCount: number;
  hasWriteAccess: boolean;
  statusChangePending: boolean;
  deletePending: boolean;
  deleteDialogOpen: boolean;
  onClear: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <OverviewSelectionBar selectedCount={selectedCount} onClear={onClear}>
        {/* Bulk enable/disable/delete all need `evaluationRule:CUD`. Read-only
            roles keep the selection (so they can see what they picked) but are
            not offered an action that the server would reject. */}
        {hasWriteAccess ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={statusChangePending}
              onClick={onEnable}
            >
              <Play className="mr-2 h-4 w-4" /> Enable
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={statusChangePending}
              onClick={onDisable}
            >
              <Pause className="mr-2 h-4 w-4" /> Disable
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          </>
        ) : null}
      </OverviewSelectionBar>
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        title="Delete evaluation rules?"
        description={`This permanently deletes ${selectedCount} rule${selectedCount === 1 ? "" : "s"} and its evaluator assignments.`}
        confirmLabel="Delete"
        loading={deletePending}
        onConfirm={onConfirmDelete}
      />
    </>
  );
}
