import { prisma } from "@/lib/prisma";
import { matchFeeRow, fallbackFee, type FeeRow } from "@/lib/fees";

// Server-side authoritative fee resolution.
// Loads the (tiny) FeeConfig table once and matches case-insensitively, instead of up to 4
// exact-match findUnique round trips — fewer queries and no slug/title case mismatch.
export async function resolveFee(course: string, mode: string, duration?: string, medium?: string, branch?: string): Promise<number> {
  try {
    const rows = (await prisma.feeConfig.findMany({
      select: { course: true, mode: true, duration: true, medium: true, branch: true, amount: true },
    })) as FeeRow[];
    const hit = matchFeeRow(rows, course, mode, duration, medium, branch);
    if (hit) return Number(hit.amount);
  } catch {}
  return fallbackFee(course, mode);
}