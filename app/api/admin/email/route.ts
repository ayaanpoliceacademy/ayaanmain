import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { sendEmail, sendBulk } from "@/lib/email";

export const dynamic = "force-dynamic";

// GET — check SMTP config + preview counts for bulk filters
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const configured = !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "";
  const course = searchParams.get("course") || "";
  const branch = searchParams.get("branch") || "";
  const status = searchParams.get("status") || "";
  let count = 0;
  if (type === "admissions") {
    const where: any = {};
    if (course) where.course = course;
    if (branch) where.branch = branch;
    if (status) where.status = status;
    count = await prisma.admission.count({ where });
  } else if (type === "users") {
    const where: any = {};
    if (course) where.course = course;
    if (branch) where.branch = branch;
    count = await prisma.user.count({ where });
  } else if (type === "leads") {
    const where: any = {};
    if (status) where.status = status;
    count = await prisma.lead.count({ where });
  }
  return NextResponse.json({ configured, count, smtpHost: process.env.SMTP_HOST || null, smtpFrom: process.env.SMTP_FROM || process.env.SMTP_USER || null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { to, subject, html, text, bulk, cc, bcc, template } = body;

  if (!subject || !String(subject).trim()) return NextResponse.json({ error: "subject required" }, { status: 400 });
  if (!html || !String(html).trim()) return NextResponse.json({ error: "html required" }, { status: 400 });

  const actor = String(auth.session.username || auth.session.name || "admin");

  // Bulk mode — send to filtered admissions/users/leads
  if (bulk) {
    const type = String(bulk.type || "admissions").toLowerCase(); // admissions | users | leads
    const filter = bulk.filter || {};
    let recipients: string[] = [];
    if (type === "admissions") {
      const where: any = {};
      if (filter.course) where.course = String(filter.course);
      if (filter.branch) where.branch = String(filter.branch);
      if (filter.status) where.status = String(filter.status);
      if (filter.courseType) where.courseType = String(filter.courseType);
      if (filter.medium) where.medium = String(filter.medium);
      const rows = await prisma.admission.findMany({ where, select: { email: true }, take: 2000 });
      recipients = Array.from(new Set(rows.map((r) => r.email).filter(Boolean) as string[]));
    } else if (type === "users") {
      const where: any = {};
      if (filter.course) where.course = String(filter.course);
      if (filter.branch) where.branch = String(filter.branch);
      if (filter.isActive !== undefined) where.isActive = !!filter.isActive;
      const rows = await prisma.user.findMany({ where, select: { email: true }, take: 2000 });
      recipients = Array.from(new Set(rows.map((r) => r.email).filter(Boolean) as string[]));
    } else if (type === "leads") {
      // leads don't have email field consistently? Use phone? But spec says email to users — leads have no email, skip
      return NextResponse.json({ error: "leads have no email — use admissions or users" }, { status: 400 });
    } else {
      return NextResponse.json({ error: 'bulk.type must be admissions or users' }, { status: 400 });
    }
    if (recipients.length === 0) return NextResponse.json({ error: "No recipients match filter" }, { status: 400 });
    const result = await sendBulk(recipients, String(subject).trim(), String(html), { cc, bcc });
    await prisma.auditLog.create({ data: { entity: "email", entityId: `bulk:${type}`, actor, action: "email_bulk", note: `subject: ${String(subject).slice(0,120)} • to ${recipients.length} ${type} • sent ${result.sent} failed ${result.failed}` } }).catch(()=>{});
    return NextResponse.json({ ...result, recipients: recipients.length });
  }

  // Single / comma-separated mode
  const rawTo = Array.isArray(to) ? to : String(to || "").split(",").map((s: string) => s.trim()).filter(Boolean);
  if (rawTo.length === 0) return NextResponse.json({ error: "to required (comma-separated emails or array)" }, { status: 400 });
  // basic email validation
  const bad = rawTo.filter((e: string) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (bad.length > 0) return NextResponse.json({ error: `Invalid emails: ${bad.join(", ")}` }, { status: 400 });

  if (rawTo.length === 1) {
    const r = await sendEmail({ to: rawTo[0], subject: String(subject).trim(), html: String(html), text, cc, bcc });
    await prisma.auditLog.create({ data: { entity: "email", entityId: rawTo[0], actor, action: "email_single", note: `subject: ${String(subject).slice(0,120)} • ${r.ok ? "sent" : r.error}` } }).catch(()=>{});
    if (!r.ok && !r.skipped) return NextResponse.json({ error: r.error || "Send failed" }, { status: 500 });
    return NextResponse.json({ ok: r.ok, skipped: r.skipped, id: r.id, error: r.error });
  }

  const result = await sendBulk(rawTo, String(subject).trim(), String(html), { cc, bcc });
  await prisma.auditLog.create({ data: { entity: "email", entityId: rawTo.join(","), actor, action: "email_bulk_manual", note: `subject: ${String(subject).slice(0,120)} • sent ${result.sent} failed ${result.failed}` } }).catch(()=>{});
  return NextResponse.json({ ...result });
}
