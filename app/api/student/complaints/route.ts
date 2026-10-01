import { NextRequest, NextResponse } from "next/server";
import { requireStudentSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/identifiers";
import { sendEmail, tplComplaintReceived } from "@/lib/email";

const CATEGORIES = ["general", "fees", "attendance", "exam", "hostel", "staff", "website", "other"];

// Student complaint box — create a new message to the admin, or list own threads.
export async function GET(req: NextRequest) {
  const auth = await requireStudentSession(req);
  if (auth.error) return auth.error;
  const user = await prisma.user.findUnique({ where: { id: auth.session.userId }, select: { id: true, name: true, email: true, phone: true, branch: true, studentId: true } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const list = await prisma.complaint.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireStudentSession(req);
  if (auth.error) return auth.error;
  const user = await prisma.user.findUnique({ where: { id: auth.session.userId }, select: { id: true, name: true, email: true, phone: true, branch: true, studentId: true, isActive: true } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (user.isActive === false) return NextResponse.json({ error: "Account deactivated" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject || "").trim().slice(0, 150);
  const message = String(body.message || "").trim().slice(0, 4000);
  const category = CATEGORIES.includes(String(body.category || "").toLowerCase()) ? String(body.category).toLowerCase() : "general";
  const priority = ["low", "normal", "high"].includes(String(body.priority || "").toLowerCase()) ? String(body.priority).toLowerCase() : "normal";

  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (message.length < 10) return NextResponse.json({ error: "Please describe your issue in at least 10 characters" }, { status: 400 });

  // Basic flood guard: max 5 open complaints at a time
  const open = await prisma.complaint.count({ where: { userId: user.id, status: { in: ["open", "in_progress"] } } });
  if (open >= 5) return NextResponse.json({ error: "You already have 5 open complaints. Please wait for a reply before adding more." }, { status: 429 });

  const item = await prisma.complaint.create({
    data: {
      userId: user.id,
      studentName: user.name,
      email: user.email,
      phone: user.phone || null,
      studentCode: user.studentId || null,
      branch: user.branch || null,
      category,
      subject,
      message,
      priority,
    },
  });

  await audit("complaint", item.id, user.email, "complaint_submitted", `${category}: ${subject}`);

  // Notify admins by email (fire-and-forget — never blocks the response)
  try {
    const admins = await prisma.admin.findMany({ where: { isActive: true, role: { in: ["super_admin", "admissions"] } }, select: { email: true } });
    const targets = admins.filter((a) => a.email).map((a) => a.email);
    if (targets.length > 0) {
      const tpl = tplComplaintReceived({ studentName: user.name, studentCode: user.studentId || "", category, subject, message, branch: user.branch || "" });
      await sendEmail({ to: targets.join(","), subject: tpl.subject, html: tpl.html }).catch(() => {});
    }
  } catch {}

  return NextResponse.json({ ok: true, complaint: item }, { status: 201 });
}
