import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const slides = await prisma.carouselSlide.findMany({ where: { active: true }, orderBy: { order: "asc" } });
    if (slides.length === 0) return NextResponse.json([], { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
    return NextResponse.json(slides, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json([], { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  }
}
