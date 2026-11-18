import { z } from 'zod';

export const WelinkReminderSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  waitHours: z.number().int().min(1).max(24).default(4),
  keywords: z.array(z.string().trim().min(1).max(30)).max(20).default([]),
}).default({ enabled: false, waitHours: 4, keywords: [] });
export type WelinkReminderSettings = z.infer<typeof WelinkReminderSettingsSchema>;
export interface WelinkMessage {
  id: string; conversation: string; conversationName: string; group: boolean;
  sender: string; mine: boolean; atMe: boolean; at: number; text: string;
}
export interface WelinkMessageReminder {
  id: string; kind: 'awaiting' | 'commitment' | 'keyword'; title: string;
  source: WelinkMessage; due?: string;
}
export interface WelinkMessageStatus {
  syncing: boolean; lastSuccessAt: number | null; error: string; partial: boolean;
  account: string; conversations: number; messages: number; reminders: WelinkMessageReminder[];
}
