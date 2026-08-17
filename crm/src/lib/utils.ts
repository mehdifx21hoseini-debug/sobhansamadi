import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "همین الان";
  if (diffMins < 60) return `${diffMins} دقیقه پیش`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ساعت پیش`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "دیروز";
  return `${diffDays} روز پیش`;
}
