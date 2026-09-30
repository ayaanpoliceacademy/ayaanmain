import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { dueStatus } from "@/lib/identifiers";

// Due Payments dashboard: installments joined with admission/student, filterable
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const due = searchParams.get("due") || "all"; // all, today, soon, overdue, notdue
  const status = searchParams.get("status") || "all"; // all, pending, partial, paid
  const branch = searchParams.get("branch") || "";
  const course = searchParams.get("course") || "";
  const batch = searchParams.get("batch") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const q = (searchParams.get("q") || "").toLowerCase();

  const installments = await prisma.installment.findMany({ orderBy: [{ dueDate: "asc" }], take: 500 });
  if (installments.length === 0) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });

  const admIds = Array.from(new Set(installments.map((i) => i.admissionId)));
  const admissions = await prisma.admission.findMany({ where: { id: { in: admIds } }, select: { id: true, applicationId: true, applicantStudentId: true, name: true, email: true, phone: true, course: true, branch: true, batchId: true, batchName: true, studentId: true, finalFee: true, totalFee: true } });
  const admById: Record<string, (typeof admissions)[number]> = {};
  for (const a of admissions) admById[a.id] = a;
  // Batch-load students (no N+1)
  const stuIds = Array.from(new Set(admissions.map((a) => String(a.studentId || "")).filter(Boolean)));
  const stuList = stuIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: stuIds } }, select: { id: true, name: true, phone: true, email: true } }) : [];
  const stuById: Record<string, (typeof stuList)[number]> = {};
  for (const u of stuList) stuById[u.id] = u;

  const rows = [];
  for (const i of installments) {
    const a = admById[i.admissionId];
    if (!a) continue;
    if (branch && a.branch !== branch) continue;
    if (course && a.course !== course) continue;
    if (batch && (a.batchId !== batch && a.batchName !== batch)) continue;
    if (status !== "all" && i.status !== status) continue;
    if (from && new Date(i.dueDate) < new Date(from)) continue;
    if (to && new Date(i.dueDate) > new Date(to + "T23:59:59")) continue;
    const outstanding = Math.max(0, i.originalAmount - (i.paidAmount || 0));
    const ds = dueStatus(outstanding, i.dueDate);
    if (due === "today" && ds !== "Due Today") continue;
    if (due === "soon" && ds !== "Due Soon") continue;
    if (due === "overdue" && ds !== "Overdue") continue;
    if (due === "notdue" && ds !== "Not Due") continue;
    const user = a.studentId ? stuById[a.studentId] || null : null;
    const row = {
      installment: { ...i, outstanding, dueStatus: ds },
      admission: { id: a.id, applicationId: a.applicationId, studentId: a.applicantStudentId, course: a.course, branch: a.branch, batchName: a.batchName, finalFee: a.finalFee ?? a.totalFee },
      student: user ? { id: user.id, name: user.name, phone: user.phone, email: user.email } : { name: a.name, phone: a.phone, email: a.email },
    };
    if (q) {
      const hay = `${row.student.name} ${row.student.phone} ${row.student.email} ${row.admission.applicationId || ""} ${row.admission.studentId || ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push(row);
  }
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}
