import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch } from "@/lib/branch-scope";
import { addMonths, audit } from "@/lib/identifiers";

function parseMonths(s: any, fallback = 3): number {
  const n = Number(s);
  if (n > 0) return Math.round(n);
  const str = String(s || "");
  const m = str.match(/(\d+)\s*month/i);
  if (m) return Number(m[1]);
  if (/year/i.test(str)) {
    const y = str.match(/(\d+)\s*year/i);
    return (y ? Number(y[1]) : 1) * 12;
  }
  return fallback;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const scope = scopeFromAuth(auth);
  const { searchParams } = new URL(req.url);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  const where: any = {};
  if (scope.branches !== null) where.branch = { in: scope.branches };
  else if (requested.branch) where.branch = requested.branch;
  const batches = await prisma.batch.findMany({ where, orderBy: { startDate: "asc" } });
  return NextResponse.json(
    batches.map((b) => ({ ...b, availableSeats: Math.max(0, b.seats - b.filled) })),
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const months = parseMonths(body.durationMonths ?? body.duration, 3);
  const startDate = body.startDate ? new Date(body.startDate) : new Date();
  const data: any = {
    name: body.name ? String(body.name).trim().slice(0, 120) : null,
    course: String(body.course || "SI"),
    medium: String(body.medium || "Telugu"),
    mode: String(body.mode || "Residential"),
    branch: body.branch ? String(body.branch) : null,
    slot: body.slot ? String(body.slot).trim().slice(0, 80) : null,
    days: body.days ? String(body.days).trim().slice(0, 80) : null,
    startDate,
    endDate: body.endDate ? new Date(body.endDate) : addMonths(startDate, months),
    seats: Math.max(1, Number(body.seats ?? body.capacity ?? 40)),
    filled: Math.max(0, Number(body.filled ?? body.enrollment ?? 0)),
    duration: String(body.duration || `${months} Months`),
    durationMonths: months,
    status: body.status === "closed" ? "closed" : "open",
    isActive: body.isActive === undefined ? true : !!body.isActive,
    note: String(body.note || "").slice(0, 300),
  };
  if (data.filled > data.seats) return NextResponse.json({ error: "Enrollment cannot exceed capacity" }, { status: 400 });
  let item;
  if (body.id) {
    // Never silently shrink below current enrollment
    const existing = await prisma.batch.findUnique({ where: { id: body.id } });
    if (!existing) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    if (data.seats < existing.filled) return NextResponse.json({ error: `Capacity cannot go below current enrollment (${existing.filled})` }, { status: 400 });
    item = await prisma.batch.update({ where: { id: body.id }, data });
  } else {
    item = await prisma.batch.create({ data: { ...data, id: `BATCH-${Date.now()}` } });
  }
  await audit("batch", item.id, String(auth.session.username || "admin"), body.id ? "batch_updated" : "batch_created", item.name || item.course);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const used = await prisma.admission.count({ where: { batchId: id, status: "approved" } });
  if (used > 0) return NextResponse.json({ error: `Cannot delete — ${used} approved student(s) linked` }, { status: 400 });
  await prisma.batch.delete({ where: { id } });
  await audit("batch", id, String(auth.session.username || "admin"), "batch_deleted");
  return NextResponse.json({ ok: true });
}
