import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter } from "@/lib/branch-scope";

// Receipts ledger: one row per collected payment, with the student, course, date paid,
// amount, method and any attached payment-proof screenshot.
// Returns a flat array (existing consumers depend on that) with enriched fields.
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const admissionId = searchParams.get("admissionId") || "";
  const studentId = searchParams.get("studentId") || "";
  const method = searchParams.get("method") || "";
  const course = searchParams.get("course") || "";
  const requestedBranch = searchParams.get("branch") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const includeLegacy = searchParams.get("legacy") === "1";
  const q = (searchParams.get("q") || "").toLowerCase();

  // Campus scoping
  const scope = scopeFromAuth(auth);
  const branchFilter = resolveBranchFilter(scope, requestedBranch);
  if (branchFilter.error) return NextResponse.json({ error: branchFilter.error }, { status: 403 });
  const branch = branchFilter.branch || "";

  const where: any = {};
  if (admissionId) where.admissionId = admissionId;
  if (studentId) where.studentId = studentId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }

  const list = await prisma.receipt.findMany({
    where,
    include: { feePayment: { include: { allocations: { include: { installment: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const admIds = Array.from(new Set(list.map((r) => r.admissionId).filter(Boolean)));
  const stuIds = Array.from(new Set(list.map((r) => r.studentId).filter((x): x is string => typeof x === "string" && x.length > 0)));
  const [adms, users] = await Promise.all([
    admIds.length > 0
      ? prisma.admission.findMany({ where: { id: { in: admIds } }, select: { id: true, name: true, phone: true, email: true, course: true, branch: true, medium: true, mode: true, batchName: true, applicantStudentId: true, applicationId: true } })
      : Promise.resolve([]),
    stuIds.length > 0
      ? prisma.user.findMany({ where: { id: { in: stuIds } }, select: { id: true, name: true, phone: true, email: true, course: true, branch: true, studentId: true } })
      : Promise.resolve([]),
  ]);
  const admById = new Map(adms.map((a: any) => [a.id, a]));
  const stuById = new Map(users.map((u: any) => [u.id, u]));

  const rows: any[] = list.map((r: any) => {
    const a = admById.get(r.admissionId) || null;
    const u = r.studentId ? stuById.get(r.studentId) || null : null;
    return {
      id: r.id,
      receiptNo: r.receiptNo,
      amount: r.amount,
      createdAt: r.createdAt,
      admissionId: r.admissionId,
      studentId: r.studentId,
      // date paid == receipt issue time
      datePaid: r.createdAt,
      method: r.feePayment?.method || "",
      transactionId: r.feePayment?.transactionId || "",
      screenshot: r.feePayment?.screenshot || null,
      note: r.feePayment?.note || "",
      status: r.feePayment?.status || "acknowledged",
      studentName: u?.name || a?.name || "",
      studentPhone: u?.phone || a?.phone || "",
      studentEmail: u?.email || a?.email || "",
      studentCode: u?.studentId || a?.applicantStudentId || "",
      applicationId: a?.applicationId || "",
      course: a?.course || u?.course || "",
      branch: a?.branch || u?.branch || "",
      medium: a?.medium || "",
      mode: a?.mode || "",
      batchName: a?.batchName || "",
      allocations: (r.feePayment?.allocations || []).map((al: any) => ({ label: al.installment?.label || "", amount: al.amount, dueDate: al.installment?.dueDate || null })),
      // kept for ReceiptView
      feePayment: r.feePayment,
      src: "receipt",
    };
  });

  // Legacy manual payments (Payments tab) have no Receipt row — surface fully-paid ones on request
  if (includeLegacy) {
    const legacy = await prisma.payment.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
    for (const p of legacy) {
      const outstanding = Math.max(0, Number(p.amount || 0) - Number(p.paidAmount || 0));
      rows.push({
        id: p.id,
        receiptNo: null,
        amount: Number(p.paidAmount || 0),
        createdAt: p.createdAt,
        datePaid: p.createdAt,
        admissionId: p.admissionId,
        studentId: p.studentId,
        method: p.paymentMethod,
        transactionId: p.transactionId || "",
        screenshot: p.screenshot || null,
        note: "",
        status: p.status,
        studentName: p.name,
        studentPhone: p.phone,
        studentEmail: p.email,
        studentCode: "",
        applicationId: "",
        course: p.course,
        branch: p.branch || "",
        medium: p.medium,
        mode: p.mode,
        batchName: "",
        allocations: [],
        feePayment: null,
        src: "legacy",
        outstanding,
      });
    }
  }

  const scoped = scope.branches === null ? rows : rows.filter((r: any) => scope.branches!.some((b) => String(b).trim().toLowerCase() === String(r.branch || "").trim().toLowerCase()));

  const filtered = scoped.filter((r) => {
    if (method && String(r.method).toLowerCase() !== method.toLowerCase()) return false;
    if (course && String(r.course).toLowerCase() !== course.toLowerCase()) return false;
    if (branch && String(r.branch).toLowerCase() !== branch.toLowerCase()) return false;
    if (!q) return true;
    const hay = `${r.receiptNo || ""} ${r.studentName} ${r.studentPhone} ${r.studentEmail} ${r.studentCode} ${r.applicationId} ${r.course} ${r.branch} ${r.batchName} ${r.method} ${r.transactionId}`.toLowerCase();
    return hay.includes(q);
  });

  return NextResponse.json(filtered, { headers: { "Cache-Control": "no-store" } });
}