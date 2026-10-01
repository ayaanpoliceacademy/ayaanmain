import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter, allowedBranches } from "@/lib/branch-scope";

// Campus-wise AR/AP for the super admin.
// AR (receivable) is derived the same way Dues does: locked admission fee minus
// acknowledged payments, so these numbers always agree with the Dues tab.
// AP (payable) comes from expenses tagged to each campus.
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;

  const scope = scopeFromAuth(auth);
  const { searchParams } = new URL(req.url);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  const only = requested.branch ? [requested.branch] : null;

  const branchWhere = scope.branches === null ? (only ? { branch: { in: only } } : {}) : { branch: { in: scope.branches } };
  // A ?branch= drill-down must narrow every input, not just admissions
  const narrowWhere = (f: string) => (scope.branches !== null ? { branch: { in: scope.branches } } : only ? { branch: { in: only } } : {});

  const [admissions, acked, installments, expenses, batches, legacyPayments, branchRows] = await Promise.all([
    prisma.admission.findMany({
      where: { status: "approved", ...branchWhere },
      select: { id: true, branch: true, finalFee: true, totalFee: true, feeAmount: true, amount: true },
      take: 5000,
    }),
    prisma.feePayment.findMany({ where: { status: "acknowledged" }, select: { admissionId: true, amount: true }, take: 20000 }),
    prisma.installment.findMany({ select: { admissionId: true, originalAmount: true, paidAmount: true }, take: 20000 }),
    prisma.expense.findMany({ where: narrowWhere("branch"), select: { branch: true, amount: true, status: true }, take: 5000 }),
    prisma.batch.findMany({ where: branchWhere, select: { branch: true, seats: true, filled: true, status: true }, take: 5000 }),
    prisma.payment.findMany({ where: narrowWhere("branch"), select: { branch: true, amount: true, paidAmount: true }, take: 5000 }),
    prisma.branch.findMany({ where: only ? { name: { in: only } } : {}, select: { name: true }, take: 500 }),
  ]);

  const ackedByAdm = new Map<string, number>();
  for (const p of acked) ackedByAdm.set(p.admissionId, (ackedByAdm.get(p.admissionId) || 0) + Number(p.amount || 0));
  const instByAdm = new Map<string, { orig: number; paid: number }[]>();
  for (const i of installments) {
    const arr = instByAdm.get(i.admissionId) || [];
    arr.push({ orig: Number(i.originalAmount || 0), paid: Number(i.paidAmount || 0) });
    instByAdm.set(i.admissionId, arr);
  }

  const key = (b: unknown) => String(b ?? "").trim() || "Unassigned";
  type Acc = { branch: string; admissions: number; receivable: number; collected: number; outstanding: number; overdue: number; seats: number; filled: number; batches: number; payable: number; paidAp: number; pendingAp: number; pendingApproval: number; legacyReceivable: number; legacyCollected: number };
  const map = new Map<string, Acc>();
  const bucket = (b: unknown): Acc => {
    const k = key(b);
    let a = map.get(k);
    if (!a) {
      a = { branch: k, admissions: 0, receivable: 0, collected: 0, outstanding: 0, overdue: 0, seats: 0, filled: 0, batches: 0, payable: 0, paidAp: 0, pendingAp: 0, pendingApproval: 0, legacyReceivable: 0, legacyCollected: 0 };
      map.set(k, a);
    }
    return a;
  };

  // Seed from the Branch master so empty campuses still show a row
  for (const b of branchRows) bucket(b.name);

  for (const a of admissions) {
    const acc = bucket(a.branch);
    const fee = Number(a.finalFee ?? a.totalFee ?? a.feeAmount ?? a.amount ?? 0);
    if (fee <= 0) continue;
    acc.admissions += 1;
    const paid = ackedByAdm.get(a.id) || 0;
    acc.collected += paid;
    const insts = instByAdm.get(a.id) || [];
    let outstanding: number;
    if (insts.length > 0) {
      outstanding = insts.reduce((s, i) => s + Math.max(0, i.orig - i.paid), 0);
      // Schedule may not cover the full fee — surface the gap as receivable
      const sched = insts.reduce((s, i) => s + i.orig, 0);
      if (sched < fee) outstanding += fee - sched;
    } else {
      outstanding = Math.max(0, fee - paid);
    }
    acc.receivable += fee;
    acc.outstanding += outstanding;
  }

  for (const e of expenses) {
    const acc = bucket(e.branch);
    const amt = Number(e.amount || 0);
    if (e.status === "approved" || e.status === "paid") {
      acc.payable += amt;
      if (e.status === "paid") acc.paidAp += amt;
      else acc.pendingAp += amt;
    } else if (e.status === "pending") {
      acc.pendingApproval += amt;
    }
  }

  for (const b of batches) {
    const acc = bucket(b.branch);
    acc.seats += Number(b.seats || 0);
    acc.filled += Number(b.filled || 0);
    acc.batches += 1;
  }

  for (const p of legacyPayments) {
    const acc = bucket(p.branch);
    acc.legacyReceivable += Number(p.amount || 0);
    acc.legacyCollected += Number(p.paidAmount || 0);
  }

  const rows = Array.from(map.values())
    .map((r) => ({ ...r, net: r.collected - r.payable, fillRate: r.seats > 0 ? Math.round((r.filled / r.seats) * 100) : 0 }))
    .filter((r) => (scope.branches === null ? true : scope.branches!.some((b) => b.toLowerCase() === r.branch.toLowerCase())))
    .filter((r) => (only ? only.some((b) => b.toLowerCase() === r.branch.toLowerCase()) : true))
    .sort((a, b) => b.receivable - a.receivable);

  const totals = rows.reduce(
    (t, r) => {
      t.admissions += r.admissions; t.receivable += r.receivable; t.collected += r.collected;
      t.outstanding += r.outstanding; t.payable += r.payable; t.paidAp += r.paidAp;
      t.pendingAp += r.pendingAp; t.pendingApproval += r.pendingApproval;
      t.seats += r.seats; t.filled += r.filled;
      return t;
    },
    { admissions: 0, receivable: 0, collected: 0, outstanding: 0, payable: 0, paidAp: 0, pendingAp: 0, pendingApproval: 0, seats: 0, filled: 0 },
  );

  return NextResponse.json(
    {
      rows,
      totals: { ...totals, net: totals.collected - totals.payable },
      scope: { campuses: allowedBranches(scope), label: scope.branches === null ? "All campuses" : scope.branches.join(", ") },
      canSeeAll: scope.branches === null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}