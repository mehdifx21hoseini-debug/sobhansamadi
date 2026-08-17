export type LeadStatus = "پاسخ‌داده‌نشده" | "تماس گرفته شد" | "پاسخ نداد";

export interface Lead {
  id: string;
  fullName: string;
  phone: string;
  level: string; // سطح علمی
  topic: string; // سوال / موضوع مشاوره
  preferredTime: string; // ساعت مناسب تماس
  status: LeadStatus;
  createdAt: string; // ISO date
  registrationSent: boolean;
  note?: string;
}

export interface MessageLogEntry {
  id: string;
  leadId: string;
  text: string;
  sentAt: string;
}
