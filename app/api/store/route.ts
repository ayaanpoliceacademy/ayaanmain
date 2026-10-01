import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await prisma.storeItem.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(items, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}