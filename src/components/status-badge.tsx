import { cn, sessionStatusLabel } from "@/lib/format";
import type { SessionStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: SessionStatus | string }) {
  const tone =
    status === "live"
      ? "bg-lime text-ink"
      : status === "finished"
        ? "bg-ink text-paper"
        : status === "ready"
          ? "bg-gold/90 text-ink"
          : "bg-paper-2 text-ink/70";
  return (
    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>
      {sessionStatusLabel(status)}
    </span>
  );
}
