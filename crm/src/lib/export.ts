import { Lead } from "./types";

export function exportLeadsToCsv(leads: Lead[]) {
  const headers = ["نام", "شماره تماس", "سطح علمی", "وضعیت", "تاریخ ثبت"];
  const rows = leads.map((l) => [
    l.fullName,
    l.phone,
    l.level,
    l.status,
    new Date(l.createdAt).toLocaleDateString("fa-IR"),
  ]);

  const csvContent =
    "﻿" +
    [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `لیدها-${new Date().toLocaleDateString("fa-IR")}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
