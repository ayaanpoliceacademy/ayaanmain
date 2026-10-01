import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { audit, dueStatus } from "@/lib/identifiers";
import { scopeFromAuth, canActOn, forbidBranch, resolveBranchFilter } from "@/lib/branch-scope";

function withDue(i: any) {
  const outstanding = Math.max(0, i.originalAmount - (i.paidAmount || 0));
  return { ...i, outstanding, dueStatus: dueStatus(outstanding, i.dueDate) };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
const admissionId = searchParams.get("admissionId") || "";
  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  const where: any = {};
  if (admissionId) where.admissionId = admissionId;
  if (scope.branches !== null) where.admission = { branch: { in: scope.branches } };
  const list = await prisma.installment.findMany({ where, orderBy: [{ admissionId: "asc" }, { seq: "asc" }] });
  return NextResponse.json(list.map(withDue), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || "admin");
  const body = await req.json();
  const { admissionId, label, amount, dueDate, notes } = body;
  if (!admissionId || !amount || !dueDate) return NextResponse.json({ error: "admissionId, amount, dueDate required" }, { status: 400 });
const adm = await prisma.admission.findUnique({ where: { id: String(admissionId) } });
  if (!adm || adm.status !== "approved") return NextResponse.json({ error: "Admission must be approved" }, { status: 400 });
  if (!canActOn(scopeFromAuth(auth), adm.branch)) return forbidBranch(adm.branch);
  const maxSeq = await prisma.installment.aggregate({ where: { admissionId: adm.id }, _max: { seq: true } });
  const seq = (maxSeq._max.seq || 0) + 1;
  const item = await prisma.installment.create({
    data: {
      admissionId: adm.id,
      studentId: adm.studentId,
      seq,
      label: label ? String(label).trim().slice(0, 80) : `Installment ${seq}`,
      originalAmount: Math.max(1, Math.round(Number(amount))),
      dueDate: new Date(dueDate),
      notes: notes ? String(notes).slice(0, 500) : null,
    },
  });
  await audit("installment", item.id, actor, "installment_created", `${item.label} ₹${item.originalAmount} due ${dueDate}`);
  return NextResponse.json(withDue(item));
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || "admin");
  const body = await req.json();
  const { id, label, amount, notes, dueDate, reason } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
const inst = await prisma.installment.findUnique({ where: { id } });
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  {
    const own = await prisma.admission.findUnique({ where: { id: inst.admissionId }, select: { branch: true } });
    if (!canActOn(scopeFromAuth(auth), own?.branch)) return forbidBranch(own?.branch);
  }

  const data: any = {};
  if (label !== undefined) data.label = String(label).trim().slice(0, 80);
  if (notes !== undefined) data.notes = notes ? String(notes).slice(0, 500) : null;
  if (amount !== undefined) {
    const amt = Math.max(1, Math.round(Number(amount)));
    if (amt < (inst.paidAmount || 0)) {
      return NextResponse.json({ error: `Cannot reduce below already-paid ₹${inst.paidAmount}` }, { status: 400 });
    }
    data.originalAmount = amt;
    data.status = inst.paidAmount >= amt ? "paid" : inst.paidAmount > 0 ? "partial" : "pending";
  }
  if (dueDate) {
    const newDue = new Date(dueDate);
    if (isNaN(newDue.getTime())) return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
    // Preserve history — never overwrite silently
    await prisma.dueDateHistory.create({
      data: { installmentId: id, prevDue: inst.dueDate, newDue, updatedBy: actor, reason: reason ? String(reason).slice(0, 500) : null },
    });
    data.dueDate = newDue;
    await audit("installment", id, actor, "due_date_changed", `${inst.dueDate.toISOString().slice(0, 10)} → ${dueDate}${reason ? ` — ${reason}` : ""}`);
  }
  const updated = await prisma.installment.update({ where: { id }, data });
  if (label !== undefined || amount !== undefined) {
    await audit("installment", id, actor, "installment_updated", JSON.stringify({ label, amount }));
  }
  return NextResponse.json(withDue(updated));
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
const allocs = await prisma.paymentAllocation.count({ where: { installmentId: id } });
  if (allocs > 0) return NextResponse.json({ error: "Cannot delete — allocations exist" }, { status: 400 });
  const inst = await prisma.installment.findUnique({ where: { id } });
  if (!inst) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((inst.paidAmount || 0) > 0) return NextResponse.json({ error: "Cannot delete — payments recorded" }, { status: 400 });
  await prisma.installment.delete({ where: { id } });
  await audit("installment", id, String(auth.session.username || "admin"), "installment_deleted", inst.label);
  return NextResponse.json({ ok: true });
}
