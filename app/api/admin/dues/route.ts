import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { dueStatus } from "@/lib/identifiers";
import { scopeFromAuth, resolveBranchFilter } from "@/lib/branch-scope";

// Due Payments dashboard.
//
// Dues are RECEIVABLE-driven, not installment-driven: every approved admission contributes
// its locked fee, minus acknowledged payments. Installments (when a schedule exists) only
// break that balance into dated rows. This guarantees a student who paid 10,000 of 35,000
// keeps showing the 25,000 balance even with no/deleted schedule, and never disappears.
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due") || "all"; // all, today, soon, overdue, notdue
  const status = searchParams.get("status") || "all"; // all, pending, partial, paid
  const scope = searchParams.get("scope") || "outstanding"; // outstanding, all
  const requestedBranch = searchParams.get("branch") || "";
  const course = searchParams.get("course") || "";
  const batch = searchParams.get("batch") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const q = (searchParams.get("q") || "").toLowerCase();

  // Campus scoping: clamp to the admin's assigned campuses before any query runs
  const campus = scopeFromAuth(auth);
  const branchFilter = resolveBranchFilter(campus, requestedBranch);
  if (branchFilter.error) return NextResponse.json({ error: branchFilter.error }, { status: 403 });
  const branch = branchFilter.branch || "";

  const [admissions, installments, acked, legacy] = await Promise.all([
    prisma.admission.findMany({
      where: { status: "approved", ...(campus.branches === null ? {} : { branch: { in: campus.branches } }) },
      select: {
        id: true, applicationId: true, applicantStudentId: true, studentId: true,
        name: true, email: true, phone: true, course: true, branch: true,
        batchId: true, batchName: true, finalFee: true, totalFee: true, feeAmount: true,
        amount: true, dueDate: true, admissionStartDate: true, courseEndDate: true, approvedAt: true,
      },
      orderBy: { approvedAt: "desc" },
      take: 5000,
    }),
    prisma.installment.findMany({ orderBy: [{ dueDate: "asc" }], take: 20000 }),
    prisma.feePayment.findMany({ where: { status: "acknowledged" }, select: { admissionId: true, amount: true }, take: 20000 }),
    prisma.payment.findMany({
      select: { id: true, studentId: true, name: true, phone: true, email: true, course: true, branch: true, medium: true, mode: true, amount: true, paidAmount: true, dueDate: true, status: true },
      where: campus.branches === null ? {} : { branch: { in: campus.branches } },
      take: 5000,
    }),
  ]);

  // Batch indexes (no N+1)
  const instByAdm = new Map<string, any[]>();
  for (const i of installments) {
    const arr = instByAdm.get(i.admissionId) || [];
    arr.push(i);
    instByAdm.set(i.admissionId, arr);
  }
  const ackedByAdm = new Map<string, number>();
  for (const p of acked) ackedByAdm.set(p.admissionId, (ackedByAdm.get(p.admissionId) || 0) + Number(p.amount || 0));

  const stuIds = Array.from(new Set([...admissions.map((a) => String(a.studentId || "")), ...legacy.map((p) => String(p.studentId || ""))].filter(Boolean)));
  const stuList = stuIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: stuIds } }, select: { id: true, name: true, phone: true, email: true } })
    : [];
  const stuById = new Map(stuList.map((u: any) => [u.id, u]));

  const rows: any[] = [];

  for (const a of admissions) {
    const fee = Number(a.finalFee ?? a.totalFee ?? a.feeAmount ?? a.amount ?? 0);
    if (fee <= 0) continue;
    const paidTotal = ackedByAdm.get(a.id) || 0;
    const balanceTotal = Math.max(0, fee - paidTotal);
    const insts = (instByAdm.get(a.id) || []).slice().sort((x, y) => x.seq - y.seq);
    const fallbackDue = a.dueDate || a.admissionStartDate || a.courseEndDate || a.approvedAt || null;
    const user = a.studentId ? stuById.get(a.studentId) || null : null;

    const ctx = {
      admission: {
        id: a.id,
        applicationId: a.applicationId,
        studentId: a.applicantStudentId,
        course: a.course,
        branch: a.branch,
        batchName: a.batchName,
        batchId: a.batchId,
        finalFee: fee,
        paidTotal,
        balanceTotal,
      },
      student: user ? { id: user.id, name: user.name, phone: user.phone, email: user.email } : { name: a.name, phone: a.phone, email: a.email },
    };

    const emit = (o: any) => {
      rows.push({ ...o, admission: ctx.admission, student: ctx.student });
    };

    if (insts.length === 0) {
      // No schedule: one synthetic balance row so the receivable is never hidden
      const outstanding = balanceTotal;
      emit({
        key: `bal-${a.id}`,
        kind: "balance",
        installment: {
          id: `bal-${a.id}`,
          label: "Full Fee Balance",
          seq: 0,
          originalAmount: fee,
          paidAmount: paidTotal,
          outstanding,
          dueDate: fallbackDue,
          dueStatus: dueStatus(outstanding, fallbackDue),
          status: outstanding <= 0 ? "paid" : paidTotal > 0 ? "partial" : "pending",
          notes: "No installment schedule — set one from Student Workspace",
        },
      });
      continue;
    }

    for (const i of insts) {
      const outstanding = Math.max(0, i.originalAmount - (i.paidAmount || 0));
      emit({
        key: i.id,
        kind: "scheduled",
        installment: {
          ...i,
          outstanding,
          dueStatus: dueStatus(outstanding, i.dueDate),
        },
      });
    }

    // Schedule does not cover the full fee -> surface the remainder instead of hiding it
    const schedTotal = insts.reduce((s, i) => s + i.originalAmount, 0);
    const gap = fee - schedTotal;
    if (gap > 0) {
      emit({
        key: `gap-${a.id}`,
        kind: "unscheduled",
        installment: {
          id: `gap-${a.id}`,
          label: "Unscheduled Balance",
          seq: 99,
          originalAmount: gap,
          paidAmount: 0,
          outstanding: gap,
          dueDate: fallbackDue,
          dueStatus: dueStatus(gap, fallbackDue),
          status: "pending",
          notes: "Fee exceeds the installment schedule — add an installment",
        },
      });
    }
  }

  // Legacy manual fee ledger (admin Payments tab) still carries its own receivables
  for (const p of legacy) {
    const fee = Number(p.amount || 0);
    const paid = Number(p.paidAmount || 0);
    const outstanding = Math.max(0, fee - paid);
    if (outstanding <= 0 && scope === "outstanding") continue;
    const user = p.studentId ? stuById.get(p.studentId) || null : null;
    rows.push({
      key: p.id,
      kind: "legacy",
      installment: {
        id: p.id,
        label: "Manual Fee Entry",
        seq: 0,
        originalAmount: fee,
        paidAmount: paid,
        outstanding,
        dueDate: p.dueDate,
        dueStatus: dueStatus(outstanding, p.dueDate),
        status: outstanding <= 0 ? "paid" : paid > 0 ? "partial" : "pending",
        notes: "Recorded from Payments tab",
      },
      admission: {
        id: p.id,
        applicationId: "",
        studentId: "",
        course: p.course,
        branch: user?.branch || "",
        batchName: "",
        batchId: "",
        finalFee: fee,
        paidTotal: paid,
        balanceTotal: outstanding,
      },
      student: user ? { id: user.id, name: user.name, phone: user.phone, email: user.email } : { name: p.name, phone: p.phone, email: p.email },
    });
  }

  // Filters
  let filtered = rows;
  if (scope === "outstanding") filtered = filtered.filter((r) => Number(r.installment.outstanding) > 0);
  filtered = filtered.filter((r) => {
    const a = r.admission;
    if (branch && a.branch !== branch) return false;
    if (course && a.course !== course) return false;
    if (batch && a.batchId !== batch && a.batchName !== batch) return false;
    if (status !== "all" && r.installment.status !== status) return false;
    if (from && r.installment.dueDate && new Date(r.installment.dueDate) < new Date(from)) return false;
    if (to && r.installment.dueDate && new Date(r.installment.dueDate) > new Date(`${to}T23:59:59`)) return false;
    const ds = r.installment.dueStatus;
    if (due === "today" && ds !== "Due Today") return false;
    if (due === "soon" && ds !== "Due Soon") return false;
    if (due === "overdue" && ds !== "Overdue") return false;
    if (due === "notdue" && ds !== "Not Due") return false;
    if (q) {
      const hay = `${r.student.name} ${r.student.phone || ""} ${r.student.email || ""} ${a.applicationId || ""} ${a.studentId || ""} ${a.course} ${a.branch} ${a.batchName || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    const da = a.installment.dueDate ? new Date(a.installment.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.installment.dueDate ? new Date(b.installment.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
    return da - db;
  });

  const totals = filtered.reduce(
    (t: any, r: any) => {
      const o = Number(r.installment.outstanding || 0);
      t.outstanding += o;
      t.feeTotal += Number(r.installment.originalAmount || 0);
      t.paidTotal += Number(r.installment.paidAmount || 0);
      if (r.installment.dueStatus === "Overdue") t.overdue += o;
      if (r.installment.dueStatus === "Due Soon") t.dueSoon += o;
      if (r.installment.dueStatus === "Due Today") t.dueToday += o;
      if (r.installment.status === "pending") t.pendingCount += 1;
      if (r.installment.status === "partial") t.partialCount += 1;
      return t;
    },
    { outstanding: 0, feeTotal: 0, paidTotal: 0, overdue: 0, dueSoon: 0, dueToday: 0, pendingCount: 0, partialCount: 0, rows: 0, students: 0 },
  );
  totals.rows = filtered.length;
  totals.students = new Set(filtered.map((r: any) => r.admission.id)).size;

  return NextResponse.json({ rows: filtered, totals }, { headers: { "Cache-Control": "no-store" } });
}