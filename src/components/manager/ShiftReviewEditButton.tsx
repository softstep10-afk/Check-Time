"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { ShiftEditDialog } from "@/components/manager/ShiftEditDialog";
import type { ManagerSession } from "@/lib/manager-types";

type ShiftReviewEditButtonProps = {
  session: ManagerSession;
  projects: { id: string; name: string }[];
};

/**
 * Owner/finance-only "edit" affordance for a flagged shift in the dashboard
 * review queue. Hosts the shared ShiftEditDialog (edit mode) so the owner goes
 * one click from signal to fix; on save it refreshes the server component so
 * the (now recomputed) shift drops out of the queue if it no longer flags.
 *
 * Finance gating is done by the parent — this button is only rendered when the
 * viewer has finance access, mirroring the TeamMemberPage edit affordance.
 */
export function ShiftReviewEditButton({ session, projects }: ShiftReviewEditButtonProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] border border-[var(--border-default)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)]"
        onClick={() => setOpen(true)}
      >
        {t("shiftEdit.edit")}
      </button>
      {open && (
        <ShiftEditDialog
          mode="edit"
          session={session}
          workerId={session.profileId}
          workerName={session.profileName}
          projects={projects}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
