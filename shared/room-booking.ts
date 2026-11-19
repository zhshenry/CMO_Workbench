import { z } from 'zod';

const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const roomPlanSchema = z.object({
  title: z.string().trim().min(1).max(150), start: z.string().regex(time), duration: z.number().int().min(30).max(720),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), rooms: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
  openTime: z.string().regex(time), advanceDays: z.number().int().min(1).max(30),
}).strict().refine(plan => {
  const [h, m] = plan.start.split(':').map(Number);
  return h * 60 + m + plan.duration <= 1440;
}, '预约结束时间不能跨天。');
export type RoomPlan = z.infer<typeof roomPlanSchema>;
export const roomCommandSchema = z.enum(['login', 'read-rooms', 'test', 'once', 'start', 'pause']);
export type RoomCommand = z.infer<typeof roomCommandSchema>;
export interface RoomBookingState {
  executable: string;
  directory: string;
  connected: boolean;
  running: boolean;
  armed: boolean;
  mode?: string;
  loginState?: string;
  needsLogin: boolean;
  advancedDays: boolean;
  operation?: string;
  serverTime?: string;
  nextOpen?: string;
  targetDate?: string;
  plan?: RoomPlan;
  roomNames: string[];
  roomReadError?: string;
  history: { day: string; time: string; room: string; state: string; detail: string; title: string }[];
  logs: string;
  error?: string;
}
export interface RoomBookingBridge {
  state(): Promise<RoomBookingState>;
  chooseExecutable(): Promise<RoomBookingState>;
  chooseDirectory(): Promise<RoomBookingState>;
  connect(): Promise<RoomBookingState>;
  save(plan: RoomPlan): Promise<RoomBookingState>;
  command(command: RoomCommand): Promise<RoomBookingState>;
}
