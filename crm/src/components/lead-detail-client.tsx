"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Phone,
  PhoneOff,
  Send,
  BookOpen,
  Clock3,
  MessageSquareText,
  StickyNote,
} from "lucide-react";
import { useLeadStore } from "@/lib/store";
import { StatusBadge } from "@/components/status-badge";
import { REGISTRATION_MESSAGE_TEMPLATE } from "@/lib/mock-data";
import { formatRelativeTime, cn } from "@/lib/utils";

export function LeadDetailClient({ leadId }: { leadId: string }) {
  const lead = useLeadStore((s) => s.leads.find((l) => l.id === leadId));
  const allMessages = useLeadStore((s) => s.messages);
  const messages = useMemo(
    () => allMessages.filter((m) => m.leadId === leadId),
    [allMessages, leadId]
  );
  const setStatus = useLeadStore((s) => s.setStatus);
  const setNote = useLeadStore((s) => s.setNote);
  const sendRegistrationMessage = useLeadStore((s) => s.sendRegistrationMessage);

  const [note, setNoteDraft] = useState(lead?.note ?? "");
  const [messageDraft, setMessageDraft] = useState("");
  const [showComposer, setShowComposer] = useState(false);

  const prefilledMessage = useMemo(() => {
    if (!lead) return "";
    return REGISTRATION_MESSAGE_TEMPLATE.replace("{نام}", lead.fullName.split(" ")[0]);
  }, [lead]);

  if (!lead) {
    return (
      <div className="p-8 max-w-3xl mx-auto text-center text-slate-500">
        لید موردنظر پیدا نشد.
        <div className="mt-4">
          <Link href="/" className="text-indigo-600 text-sm font-medium">
            بازگشت به لیست
          </Link>
        </div>
      </div>
    );
  }

  const openComposer = () => {
    setMessageDraft(prefilledMessage);
    setShowComposer(true);
  };

  const handleSend = () => {
    sendRegistrationMessage(lead.id, messageDraft);
    setShowComposer(false);
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-5"
      >
        <ArrowRight className="h-4 w-4" />
        بازگشت به لیست لیدها
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main workspace */}
        <div className="lg:col-span-2 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h1 className="text-lg font-bold text-slate-900">{lead.fullName}</h1>
                <p className="text-sm text-slate-500 mt-0.5" dir="ltr">
                  {lead.phone}
                </p>
              </div>
              <StatusBadge status={lead.status} />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setStatus(lead.id, "تماس گرفته شد")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors",
                  lead.status === "تماس گرفته شد"
                    ? "bg-emerald-600 text-white"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                )}
              >
                <Phone className="h-4 w-4" />
                تماس گرفته شد
              </button>
              <button
                onClick={() => setStatus(lead.id, "پاسخ نداد")}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors",
                  lead.status === "پاسخ نداد"
                    ? "bg-rose-600 text-white"
                    : "bg-rose-50 text-rose-700 hover:bg-rose-100"
                )}
              >
                <PhoneOff className="h-4 w-4" />
                پاسخ نداد
              </button>
            </div>
          </div>

          {/* Registration info from bot */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4 text-slate-800">
              <BookOpen className="h-4.5 w-4.5 text-indigo-600" />
              <h2 className="text-sm font-semibold">اطلاعات ثبت‌شده در ربات تلگرام</h2>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <InfoRow label="سطح علمی" value={lead.level} />
              <InfoRow label="ساعت مناسب تماس" value={lead.preferredTime} />
              <div className="sm:col-span-2">
                <dt className="text-xs text-slate-400 mb-1">سوال / موضوع مشاوره</dt>
                <dd className="text-slate-700 leading-relaxed">{lead.topic}</dd>
              </div>
            </dl>
          </div>

          {/* Registration message */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-800">
                <Send className="h-4.5 w-4.5 text-indigo-600" />
                <h2 className="text-sm font-semibold">ارسال شرایط ثبت‌نام</h2>
              </div>
              {!showComposer && (
                <button
                  onClick={openComposer}
                  className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                >
                  {lead.registrationSent ? "ارسال مجدد" : "ارسال پیام"}
                </button>
              )}
            </div>

            {showComposer ? (
              <div className="space-y-3">
                <textarea
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 leading-relaxed"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSend}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                  >
                    ارسال به تلگرام
                  </button>
                  <button
                    onClick={() => setShowComposer(false)}
                    className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    انصراف
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  در نسخه فعلی، ارسال پیام به‌صورت نمایشی ثبت می‌شود. اتصال واقعی به تلگرام از طریق n8n در آینده اضافه خواهد شد.
                </p>
              </div>
            ) : messages.length > 0 ? (
              <div className="space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="whitespace-pre-line text-slate-700">{m.text}</p>
                    <p className="mt-2 text-xs text-slate-400">
                      ارسال شد · {formatRelativeTime(m.sentAt)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">هنوز پیامی برای این لید ارسال نشده است.</p>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3 text-slate-800">
              <Clock3 className="h-4.5 w-4.5 text-indigo-600" />
              <h2 className="text-sm font-semibold">وضعیت</h2>
            </div>
            <div className="space-y-2.5 text-sm">
              <InfoRow label="شناسه لید" value={lead.id} mono />
              <InfoRow label="تاریخ ثبت" value={formatRelativeTime(lead.createdAt)} />
              <InfoRow
                label="ارسال شرایط ثبت‌نام"
                value={lead.registrationSent ? "ارسال شده" : "ارسال نشده"}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3 text-slate-800">
              <StickyNote className="h-4.5 w-4.5 text-indigo-600" />
              <h2 className="text-sm font-semibold">یادداشت داخلی</h2>
            </div>
            <textarea
              value={note}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => setNote(lead.id, note)}
              rows={5}
              placeholder="مثلاً: با رضا تماس گرفتم، علاقه‌مند بود..."
              className="w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 leading-relaxed"
            />
            <p className="mt-2 text-xs text-slate-400 flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5" />
              این یادداشت فقط برای تیم داخلی است و برای فرد ارسال نمی‌شود.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-slate-400 shrink-0">{label}</dt>
      <dd className={cn("text-slate-700 text-left truncate", mono && "font-mono text-xs")}>
        {value}
      </dd>
    </div>
  );
}
