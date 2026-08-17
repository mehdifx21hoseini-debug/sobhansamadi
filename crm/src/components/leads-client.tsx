"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Download, Phone, PhoneOff, Clock, Users } from "lucide-react";
import { useLeadStore } from "@/lib/store";
import { LeadStatus } from "@/lib/types";
import { StatusBadge } from "@/components/status-badge";
import { exportLeadsToCsv } from "@/lib/export";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

const filterTabs: { label: string; value: LeadStatus | "همه" }[] = [
  { label: "همه", value: "همه" },
  { label: "پاسخ‌داده‌نشده", value: "پاسخ‌داده‌نشده" },
  { label: "تماس گرفته شد", value: "تماس گرفته شد" },
  { label: "پاسخ نداد", value: "پاسخ نداد" },
];

export function LeadsClient() {
  const leads = useLeadStore((s) => s.leads);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "همه">("همه");

  const counts = useMemo(() => {
    return {
      total: leads.length,
      pending: leads.filter((l) => l.status === "پاسخ‌داده‌نشده").length,
      called: leads.filter((l) => l.status === "تماس گرفته شد").length,
      noAnswer: leads.filter((l) => l.status === "پاسخ نداد").length,
    };
  }, [leads]);

  const filtered = useMemo(() => {
    return leads
      .filter((l) => (statusFilter === "همه" ? true : l.status === statusFilter))
      .filter((l) =>
        query.trim()
          ? l.fullName.includes(query.trim()) || l.phone.includes(query.trim())
          : true
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [leads, statusFilter, query]);

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-xl font-bold text-slate-900">لیدهای مشاوره</h1>
        <p className="text-sm text-slate-500">
          افرادی که از طریق ربات تلگرام درخواست مشاوره ثبت کرده‌اند.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Users} label="کل لیدها" value={counts.total} tone="slate" />
        <StatCard icon={Clock} label="پاسخ‌داده‌نشده" value={counts.pending} tone="amber" />
        <StatCard icon={Phone} label="تماس گرفته شد" value={counts.called} tone="emerald" />
        <StatCard icon={PhoneOff} label="پاسخ نداد" value={counts.noAnswer} tone="rose" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
        <div className="flex flex-wrap gap-1.5 bg-white p-1 rounded-lg border border-slate-200 w-fit">
          {filterTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                statusFilter === tab.value
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجوی نام یا شماره..."
              className="w-56 rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <button
            onClick={() => exportLeadsToCsv(filtered)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            خروجی Excel
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-right text-xs text-slate-500">
              <th className="px-4 py-3 font-medium">نام</th>
              <th className="px-4 py-3 font-medium">شماره تماس</th>
              <th className="px-4 py-3 font-medium">سطح علمی</th>
              <th className="px-4 py-3 font-medium">ساعت مناسب تماس</th>
              <th className="px-4 py-3 font-medium">وضعیت</th>
              <th className="px-4 py-3 font-medium">ثبت‌شده</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((lead) => (
              <tr
                key={lead.id}
                className="border-b border-slate-50 last:border-0 hover:bg-slate-50/70 cursor-pointer"
              >
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-slate-800 hover:text-indigo-600">
                    {lead.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600 tabular-nums" dir="ltr">
                  {lead.phone}
                </td>
                <td className="px-4 py-3 text-slate-600">{lead.level}</td>
                <td className="px-4 py-3 text-slate-600">{lead.preferredTime}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={lead.status} />
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {formatRelativeTime(lead.createdAt)}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
                  موردی یافت نشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "rose";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-50 text-amber-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div>
        <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
        <p className="text-xs text-slate-500 leading-tight">{label}</p>
      </div>
    </div>
  );
}
