import { LeadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Phone, PhoneOff, Clock } from "lucide-react";

const config: Record<LeadStatus, { className: string; icon: typeof Phone }> = {
  "پاسخ‌داده‌نشده": {
    className: "bg-amber-50 text-amber-700 ring-amber-600/20",
    icon: Clock,
  },
  "تماس گرفته شد": {
    className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
    icon: Phone,
  },
  "پاسخ نداد": {
    className: "bg-rose-50 text-rose-700 ring-rose-600/20",
    icon: PhoneOff,
  },
};

export function StatusBadge({ status }: { status: LeadStatus }) {
  const { className, icon: Icon } = config[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}
