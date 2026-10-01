import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const list = await prisma.duration.findMany({ where: { active: true }, orderBy: { months: "asc" } });
    return NextResponse.json(list, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json([], { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  }
}
