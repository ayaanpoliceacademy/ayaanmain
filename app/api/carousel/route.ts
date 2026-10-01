import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Carousel is admin-managed content: a delete must be visible on the public site
// immediately. No CDN caching here (it previously held deleted slides for ~5 min
// via s-maxage/stale-while-revalidate, which is what made deletions look ignored).
const NO_CACHE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    const slides = await prisma.carouselSlide.findMany({
      where: { active: true },
      orderBy: { order: "asc" },
      select: {
        id: true, image: true, badge: true, title: true, highlight: true,
        desc: true, ctaLabel: true, ctaHref: true, cta2Label: true, cta2Href: true,
        accent: true, order: true, active: true,
      },
    });
    return NextResponse.json(slides, { headers: NO_CACHE });
  } catch {
    // Signal failure explicitly so the client can fall back instead of
    // treating an error as "admin deleted everything".
    return NextResponse.json({ error: "carousel unavailable" }, { status: 503, headers: NO_CACHE });
  }
}
