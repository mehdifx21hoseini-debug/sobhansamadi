"use client";

import { create } from "zustand";
import { Lead, LeadStatus, MessageLogEntry } from "./types";
import { initialLeads } from "./mock-data";

interface LeadStore {
  leads: Lead[];
  messages: MessageLogEntry[];
  setStatus: (leadId: string, status: LeadStatus) => void;
  setNote: (leadId: string, note: string) => void;
  sendRegistrationMessage: (leadId: string, text: string) => void;
}

export const useLeadStore = create<LeadStore>((set) => ({
  leads: initialLeads,
  messages: [],
  setStatus: (leadId, status) =>
    set((state) => ({
      leads: state.leads.map((lead) =>
        lead.id === leadId ? { ...lead, status } : lead
      ),
    })),
  setNote: (leadId, note) =>
    set((state) => ({
      leads: state.leads.map((lead) =>
        lead.id === leadId ? { ...lead, note } : lead
      ),
    })),
  sendRegistrationMessage: (leadId, text) =>
    set((state) => ({
      leads: state.leads.map((lead) =>
        lead.id === leadId ? { ...lead, registrationSent: true } : lead
      ),
      messages: [
        ...state.messages,
        {
          id: `M-${Date.now()}`,
          leadId,
          text,
          sentAt: new Date().toISOString(),
        },
      ],
    })),
}));
