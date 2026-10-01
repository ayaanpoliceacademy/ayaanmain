import { prisma } from "@/lib/prisma";
import { matchFeeRow, matchCourseRows, fallbackFee, type FeeRow } from "@/lib/fees";

// Server-side authoritative fee resolution.
// Loads the (tiny) FeeConfig table once and matches case-insensitively, instead of up to 4
// exact-match findUnique round trips — fewer queries and no slug/title case mismatch.
// If there is no row for the course at all, it retries against the closest configured
// course so a naming variant (e.g. "Group 1" vs "Groups") still prices correctly.
export async function resolveFee(course: string, mode: string, duration?: string, medium?: string, branch?: string): Promise<number> {
  try {
    const rows = (await prisma.feeConfig.findMany({
      select: { course: true, mode: true, duration: true, medium: true, branch: true, amount: true },
    })) as FeeRow[];
    const hit = matchFeeRow(rows, course, mode, duration, medium, branch);
    if (hit) return Number(hit.amount);

    const loose = matchCourseRows(rows, course);
    if (loose.length > 0) {
      const alt = matchFeeRow(loose, course, mode, duration, medium, branch);
      if (alt) return Number(alt.amount);
    }
  } catch {}
  return fallbackFee(course, mode);
}