import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public: active add-ons applicable to a course (empty courses[] = all courses)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const course = searchParams.get("course") || "";
    const all = await prisma.addon.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    const list = all.filter((a) => a.courses.length === 0 || (course && a.courses.includes(course)));
    return NextResponse.json(list, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json([], { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  }
}
