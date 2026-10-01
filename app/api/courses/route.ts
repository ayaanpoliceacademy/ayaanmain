import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Masters are read-mostly: let the Vercel edge cache them so repeat loads skip the DB entirely
const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

export async function GET() {
  try {
    const courses = await prisma.course.findMany({
      include: { syllabus: true },
      orderBy: { slug: "asc" },
    });
    if (courses.length === 0) {
      // Fallback to hardcoded if DB empty
      const { courseDetails } = await import("@/data/courseDetails");
      return NextResponse.json(courseDetails, { headers: { "Cache-Control": CACHE } });
    }
    // Transform to match frontend shape
    const transformed = courses.map((c) => ({
      slug: c.slug,
      title: c.title,
      tag: c.tag,
      desc: c.desc,
      duration: c.duration,
      fee: c.fee,
      image: (c as any).image || null,
      eligibility: c.eligibility,
      ageLimit: c.ageLimit,
      notificationDate: c.notificationDate,
      prerequisites: c.prerequisites,
      highlights: c.highlights,
      medium: c.mediums,
      mode: c.modes,
      syllabus: c.syllabus.map((s) => ({ subject: s.subject, topics: s.topics })),
    }));
    return NextResponse.json(transformed, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    const { courseDetails } = await import("@/data/courseDetails");
    return NextResponse.json(courseDetails, { headers: { "Cache-Control": CACHE } });
  }
}
