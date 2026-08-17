"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, LayoutDashboard, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "لیدها", icon: Users },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5 bg-brand-600 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 text-white">
          <GraduationCap className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">CRM آکادمی</p>
          <p className="text-xs text-white/70 leading-tight">مدیریت لیدهای مشاوره</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-50 text-brand-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-slate-100">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
            م.ح
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">مشاور فروش</p>
            <p className="text-xs text-slate-400 truncate">پشتیبان مجموعه</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
