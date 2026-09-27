import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const list = await prisma.course.findMany({ orderBy: { title: "asc" } });
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, slug, title, tag, desc, duration, fee, eligibility, ageLimit, notificationDate, prerequisites, highlights, mediums, modes, image } = body;
  if (!slug || !String(slug).trim()) return NextResponse.json({ error: "slug required (e.g., si)" }, { status: 400 });
  if (!title || !String(title).trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
  const data: any = {
    slug: String(slug).trim().toLowerCase().replace(/\s+/g, "-"),
    title: String(title).trim(),
    tag: String(tag || "").trim(),
    desc: String(desc || "").trim(),
    duration: String(duration || "").trim(),
    fee: String(fee || "").trim(),
    eligibility: String(eligibility || "").trim(),
    ageLimit: String(ageLimit || "").trim(),
    notificationDate: String(notificationDate || "").trim(),
    prerequisites: Array.isArray(prerequisites) ? prerequisites.map((s: string) => String(s).trim()).filter(Boolean) : String(prerequisites || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    highlights: Array.isArray(highlights) ? highlights.map((s: string) => String(s).trim()).filter(Boolean) : String(highlights || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    mediums: Array.isArray(mediums) ? mediums.map((s: string) => String(s).trim()).filter(Boolean) : String(mediums || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    modes: Array.isArray(modes) ? modes.map((s: string) => String(s).trim()).filter(Boolean) : String(modes || "").split(",").map((s: string) => s.trim()).filter(Boolean),
    image: image ? String(image).trim() : null,
  };
  try {
    if (id) {
      const updated = await prisma.course.update({ where: { id }, data });
      return NextResponse.json(updated);
    }
    const created = await prisma.course.create({ data });
    return NextResponse.json(created);
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "A course with this slug already exists" }, { status: 400 });
    throw e;
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  const usedByBatches = await prisma.batch.count({ where: { course: course.slug } });
  const usedByBatches2 = await prisma.batch.count({ where: { course: course.title } });
  if (usedByBatches > 0 || usedByBatches2 > 0) return NextResponse.json({ error: `Cannot delete — ${usedByBatches + usedByBatches2} batch(es) use this course` }, { status: 400 });
  const usedByAdmissions = await prisma.admission.count({ where: { course: course.slug } });
  const usedByAdmissions2 = await prisma.admission.count({ where: { course: course.title } });
  if (usedByAdmissions > 0 || usedByAdmissions2 > 0) return NextResponse.json({ error: `Cannot delete — admissions use this course` }, { status: 400 });
  await prisma.syllabusItem.deleteMany({ where: { courseId: id } });
  await prisma.course.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
