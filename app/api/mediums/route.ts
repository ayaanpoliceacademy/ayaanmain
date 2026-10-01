import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FALLBACK = ["Telugu", "English"];

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await prisma.medium.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    if (list.length === 0) return NextResponse.json(FALLBACK.map((name) => ({ name })), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
    return NextResponse.json(list, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json(FALLBACK.map((name) => ({ name })), { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  }
}
