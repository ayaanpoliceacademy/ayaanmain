import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { newReceiptNo, audit } from "@/lib/identifiers";
import { sendEmail, tplPaymentAck } from "@/lib/email";

async function refreshInstallment(tx: any, installmentId: string) {
  const allocs = await tx.paymentAllocation.findMany({ where: { installmentId } });
  const paid = allocs.reduce((s: number, a: any) => s + a.amount, 0);
  const inst = await tx.installment.findUnique({ where: { id: installmentId } });
  if (!inst) return;
  await tx.installment.update({
    where: { id: installmentId },
    data: { paidAmount: paid, status: paid >= inst.originalAmount ? "paid" : paid > 0 ? "partial" : "pending" },
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";
  const admissionId = searchParams.get("admissionId") || "";
  const q = (searchParams.get("q") || "").toLowerCase();
  const where: any = {};
  if (status && status !== "all") where.status = status;
  if (admissionId) where.admissionId = admissionId;
  const list = await prisma.feePayment.findMany({
    where,
    include: { allocations: { include: { installment: true } }, receipt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const filtered = q
    ? list.filter((p) => `${p.transactionId || ""} ${p.receiptNo || ""}`.toLowerCase().includes(q))
    : list;
  return NextResponse.json(filtered, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || "admin");
  const body = await req.json();
  const { id, action, allocations, note } = body;
  if (!id || !action) return NextResponse.json({ error: "id and action required" }, { status: 400 });

  const payment = await prisma.feePayment.findUnique({ where: { id }, include: { allocations: true } });
  if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

  // ---- Acknowledge + allocate ----
  if (action === "acknowledge") {
    if (payment.status === "acknowledged") return NextResponse.json({ error: "Already acknowledged" }, { status: 400 });
    if (!Array.isArray(allocations) || allocations.length === 0) {
      return NextResponse.json({ error: "allocations required [{installmentId, amount}]" }, { status: 400 });
    }
    const rows = allocations.map((a: any) => ({ installmentId: String(a.installmentId), amount: Math.round(Number(a.amount)) }));
    if (rows.some((r) => !r.installmentId || !r.amount || r.amount <= 0)) {
      return NextResponse.json({ error: "Each allocation needs installmentId and amount > 0" }, { status: 400 });
    }
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    if (sum !== payment.amount) {
      return NextResponse.json({ error: `Allocation total ₹${sum} must equal payment ₹${payment.amount}` }, { status: 400 });
    }
    // All installments must belong to same admission + have room
    const insts = await prisma.installment.findMany({ where: { id: { in: rows.map((r) => r.installmentId) } } });
    if (insts.length !== rows.length) return NextResponse.json({ error: "Invalid installment" }, { status: 400 });
    for (const r of rows) {
      const inst = insts.find((x) => x.id === r.installmentId)!;
      if (inst.admissionId !== payment.admissionId) return NextResponse.json({ error: "Installment belongs to another admission" }, { status: 400 });
      const room = inst.originalAmount - (inst.paidAmount || 0);
      if (r.amount > room) return NextResponse.json({ error: `${inst.label}: only ₹${room} outstanding` }, { status: 400 });
    }

    const receiptNo = await newReceiptNo();
    await prisma.$transaction(async (tx) => {
      await tx.feePayment.update({ where: { id }, data: { status: "acknowledged", receiptNo } });
      await tx.paymentAllocation.createMany({ data: rows.map((r) => ({ feePaymentId: id, installmentId: r.installmentId, amount: r.amount })) });
      for (const r of rows) await refreshInstallment(tx, r.installmentId);
      await tx.receipt.create({
        data: { receiptNo, feePaymentId: id, admissionId: payment.admissionId, studentId: payment.studentId, amount: payment.amount },
      });
    });
    await audit("payment", id, actor, "payment_acknowledged", `Receipt ${receiptNo}; ` + rows.map((r) => `${r.installmentId}:₹${r.amount}`).join(", "));
    try {
      const adm = await prisma.admission.findUnique({ where: { id: payment.admissionId } });
      if (adm) { const tpl = tplPaymentAck(adm, payment, "acknowledged"); sendEmail({ to: adm.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); }
    } catch {}
    const updated = await prisma.feePayment.findUnique({ where: { id }, include: { allocations: { include: { installment: true } }, receipt: true } });
    return NextResponse.json({ ok: true, receiptNo, payment: updated });
  }

  // ---- Reject (does NOT touch outstanding) ----
  if (action === "reject") {
    if (payment.status === "acknowledged") return NextResponse.json({ error: "Already acknowledged — cannot reject" }, { status: 400 });
    await prisma.feePayment.update({ where: { id }, data: { status: "rejected", note: note ? String(note).slice(0, 500) : payment.note } });
    await audit("payment", id, actor, "payment_rejected", note || "");
    try {
      const adm = await prisma.admission.findUnique({ where: { id: payment.admissionId } });
      if (adm) { const tpl = tplPaymentAck(adm, payment, "rejected", note); sendEmail({ to: adm.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); }
    } catch {}
    return NextResponse.json({ ok: true });
  }

  // ---- Reallocate (audit logged) ----
  if (action === "reallocate") {
    if (payment.status !== "acknowledged") return NextResponse.json({ error: "Only acknowledged payments can be reallocated" }, { status: 400 });
    if (!Array.isArray(allocations) || allocations.length === 0) return NextResponse.json({ error: "allocations required" }, { status: 400 });
    const rows = allocations.map((a: any) => ({ installmentId: String(a.installmentId), amount: Math.round(Number(a.amount)) }));
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    if (sum !== payment.amount) return NextResponse.json({ error: `Allocation total must equal payment ₹${payment.amount}` }, { status: 400 });
    const oldIds = payment.allocations.map((a) => a.installmentId);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAllocation.deleteMany({ where: { feePaymentId: id } });
        // refresh old installments first (frees room), then validate + create
        for (const oid of oldIds) await refreshInstallment(tx, oid);
        const insts = await tx.installment.findMany({ where: { id: { in: rows.map((r) => r.installmentId) } } });
        if (insts.length !== rows.length) throw new Error("Invalid installment");
        for (const r of rows) {
          const inst = insts.find((x) => x.id === r.installmentId)!;
          if (inst.admissionId !== payment.admissionId) throw new Error("Installment belongs to another admission");
          const room = inst.originalAmount - (inst.paidAmount || 0);
          if (r.amount > room) throw new Error(`${inst.label}: only ₹${room} outstanding`);
        }
        await tx.paymentAllocation.createMany({ data: rows.map((r) => ({ feePaymentId: id, installmentId: r.installmentId, amount: r.amount })) });
        const touch: string[] = [];
        for (const x of [...oldIds, ...rows.map((r) => r.installmentId)]) if (touch.indexOf(x) === -1) touch.push(x);
        for (const iid of touch) await refreshInstallment(tx, iid);
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Reallocation failed — no changes applied" }, { status: 400 });
    }
    await audit("payment", id, actor, "payment_reallocated", rows.map((r) => `${r.installmentId}:₹${r.amount}`).join(", "));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
