import { cn } from "@/lib/utils";
import { APPT_STATUS_LABEL, LAB_STATUS_LABEL, VISIT_STATUS_LABEL } from "@/lib/data";

const TONE: Record<string, string> = {
  scheduled: "bg-secondary text-secondary-foreground border-primary/20",
  checked_in: "bg-primary/10 text-primary border-primary/30",
  waiting: "bg-warning/20 text-warning-foreground border-warning/40",
  requested: "bg-warning/20 text-warning-foreground border-warning/40",
  in_consultation: "bg-primary/10 text-primary border-primary/30",
  collected: "bg-primary/10 text-primary border-primary/30",
  processing: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-primary/10 text-primary border-primary/30",
  awaiting_lab: "bg-accent text-accent-foreground border-accent",
  resulted: "bg-accent text-accent-foreground border-accent",
  completed: "bg-success/15 text-success border-success/30",
  verified: "bg-success/15 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  no_show: "bg-muted text-muted-foreground border-border",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  urgent: "bg-destructive text-destructive-foreground border-destructive",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[status] ?? "bg-muted")}>
      {label ?? VISIT_STATUS_LABEL[status] ?? LAB_STATUS_LABEL[status] ?? APPT_STATUS_LABEL[status] ?? status.replace("_", " ")}
    </span>
  );
}
