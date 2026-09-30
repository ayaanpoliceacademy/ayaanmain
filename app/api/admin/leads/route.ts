import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isPhone, sanitizeText, ALLOWED_LEAD_STATUS } from "@/lib/validators";
import { audit } from "@/lib/identifiers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 2000 });
  return NextResponse.json(leads, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const body = await req.json();

  // bulk import: body is array or { leads: [] }
  if (Array.isArray(body) || Array.isArray(body.leads)) {
    const arr = Array.isArray(body) ? body : body.leads;
    const created: any[] = [];
    for (const item of arr) {
      if (!item.name || !item.phone) continue;
      if (!isPhone(String(item.phone))) continue;
      const phone = String(item.phone).trim();
      // dedup by phone
      const existing = await prisma.lead.findFirst({ where: { phone } });
      if (existing) continue;
      const st = String(item.status || "new").trim();
      const status = (ALLOWED_LEAD_STATUS as readonly string[]).includes(st) ? st : "new";
      const lead = await prisma.lead.create({
        data: {
          name: sanitizeText(String(item.name), 100),
          phone,
          course: sanitizeText(String(item.course || ""), 50),
          medium: sanitizeText(String(item.medium || ""), 20),
          mode: sanitizeText(String(item.mode || ""), 20),
          batchId: item.batchId || null,
          status,
          notes: item.notes ? sanitizeText(String(item.notes), 1000) : null,
          freeText: item.freeText ? sanitizeText(String(item.freeText), 2000) : null,
          employeeName: item.employeeName ? sanitizeText(String(item.employeeName), 100) : null,
          dueDate: item.dueDate ? new Date(item.dueDate) : null,
          lastActionAt: new Date(),
        },
      });
      created.push(lead);
    }
    if (created.length > 0) await audit("lead", "bulk", auth.session.username || auth.session.userId, "bulk_import", `Imported ${created.length} leads`);
    return NextResponse.json({ ok: true, imported: created.length, leads: created });
  }

  const { id, status, notes, freeText, employeeName, dueDate } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: any = {};
  if (status !== undefined) {
    const st = String(status).trim();
    if (!(ALLOWED_LEAD_STATUS as readonly string[]).includes(st)) return NextResponse.json({ error: `Invalid status — allowed: ${ALLOWED_LEAD_STATUS.join(", ")}` }, { status: 400 });
    data.status = st;
  }
  if (notes !== undefined) data.notes = notes ? sanitizeText(String(notes), 1000) : null;
  if (freeText !== undefined) data.freeText = freeText ? sanitizeText(String(freeText), 2000) : null;
  if (employeeName !== undefined) data.employeeName = employeeName ? sanitizeText(String(employeeName), 100) : null;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  // always bump lastActionAt when any field changes
  data.lastActionAt = new Date();

  await prisma.lead.update({ where: { id }, data });
  await audit("lead", id, auth.session.username || auth.session.userId, "update", `status:${data.status || "-"}`);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.lead.delete({ where: { id } });
  await audit("lead", id, auth.session.username || auth.session.userId, "delete", "Lead deleted");
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, name, phone, course, medium, mode, batchId, status, notes, freeText, employeeName, dueDate } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const data: any = {};
  if (name !== undefined) data.name = sanitizeText(String(name), 100);
  if (phone !== undefined) {
    const ph = String(phone).trim();
    if (!isPhone(ph)) return NextResponse.json({ error: "Invalid phone — 10 digits required" }, { status: 400 });
    data.phone = ph;
  }
  if (course !== undefined) data.course = sanitizeText(String(course), 50);
  if (medium !== undefined) data.medium = sanitizeText(String(medium), 20);
  if (mode !== undefined) data.mode = sanitizeText(String(mode), 20);
  if (batchId !== undefined) data.batchId = batchId || null;
  if (status !== undefined) {
    const st = String(status).trim();
    if (!(ALLOWED_LEAD_STATUS as readonly string[]).includes(st)) return NextResponse.json({ error: `Invalid status` }, { status: 400 });
    data.status = st;
  }
  if (notes !== undefined) data.notes = notes ? sanitizeText(String(notes), 1000) : null;
  if (freeText !== undefined) data.freeText = freeText ? sanitizeText(String(freeText), 2000) : null;
  if (employeeName !== undefined) data.employeeName = employeeName ? sanitizeText(String(employeeName), 100) : null;
  if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  data.lastActionAt = new Date();
  const updated = await prisma.lead.update({ where: { id }, data });
  await audit("lead", id, auth.session.username || auth.session.userId, "update_put", JSON.stringify(Object.keys(data)));
  return NextResponse.json(updated);
}
