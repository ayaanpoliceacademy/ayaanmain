import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fallbackList } from "@/lib/fees";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const fees = await prisma.feeConfig.findMany({ orderBy: [{ course: "asc" }, { mode: "asc" }, { duration: "asc" }, { medium: "asc" }, { branch: "asc" }] });
    if (fees.length === 0) return NextResponse.json(fallbackList(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
    return NextResponse.json(fees.map((f) => ({ course: f.course, mode: f.mode, duration: f.duration, medium: f.medium, branch: f.branch, amount: f.amount, id: f.id, updatedAt: f.updatedAt })), {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json(fallbackList(), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  }
}
