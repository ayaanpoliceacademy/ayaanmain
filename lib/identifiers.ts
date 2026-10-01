import { prisma } from "@/lib/prisma";

function pad(n: number, len = 6) {
  return String(n).padStart(len, "0");
}

// Atomic yearly sequence via upsert increment. Keyed per year so numbers reset yearly.
export async function nextSeq(kind: "app" | "stu" | "rcp" | "did"): Promise<{ year: number; seq: number }> {
  const year = new Date().getFullYear();
  const key = `${kind}:${year}`;
  const rec = await prisma.counter.upsert({
    where: { key },
    update: { seq: { increment: 1 } },
    create: { key, seq: 1 },
  });
  return { year, seq: rec.seq };
}

export async function newApplicationId() {
  const { year, seq } = await nextSeq("app");
  return `AYN-APP-${year}-${pad(seq)}`;
}

export async function newStudentId() {
  const { year, seq } = await nextSeq("stu");
  return `AYN-STU-${year}-${pad(seq)}`;
}

export async function newReceiptNo() {
  const { year, seq } = await nextSeq("rcp");
  return `AYN-RCP-${year}-${pad(seq)}`;
}

export async function newDigitalIdNo() {
  const { year, seq } = await nextSeq("did");
  return `AYN-DID-${year}-${pad(seq)}`;
}

export async function audit(entity: string, entityId: string, actor: string, action: string, note?: string) {
  try {
    await prisma.auditLog.create({ data: { entity, entityId, actor, action, note: note || null } });
  } catch {}
}

// Admin activity logs are kept for 6 months, then pruned.
// Called opportunistically (a few times a day) so no cron worker is required.
const RETENTION_DAYS = 183; // ~6 months
let lastPrune = 0;
export async function pruneAuditLogs(force = false) {
  const now = Date.now();
  if (!force && now - lastPrune < 6 * 60 * 60 * 1000) return { deleted: 0, skipped: true };
  lastPrune = now;
  try {
    const cutoff = new Date(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const res = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return { deleted: res.count, skipped: false, retentionDays: RETENTION_DAYS };
  } catch {
    return { deleted: 0, skipped: true };
  }
}

export const AUDIT_RETENTION_DAYS = RETENTION_DAYS;

// Due status derived from outstanding + due date (spec §15)
export type DueStatus = "Paid" | "Not Due" | "Due Today" | "Due Soon" | "Overdue";
export function dueStatus(outstanding: number, dueDate: Date | string | null): DueStatus {
  if (outstanding <= 0) return "Paid";
  if (!dueDate) return "Not Due";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(dueDate).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (due < startOfToday) return "Overdue";
  if (due < startOfToday + day) return "Due Today";
  if (due < startOfToday + 7 * day) return "Due Soon";
  return "Not Due";
}

// Add months calendar-aware (Oct 1 + 3mo = Jan 1; end date displayed inclusive handled by callers)
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp month overflow (e.g. Jan 31 + 1mo)
  if (d.getDate() < day) d.setDate(0);
  return d;
}
