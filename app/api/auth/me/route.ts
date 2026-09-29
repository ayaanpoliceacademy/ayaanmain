import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/auth-helpers";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("ayaan_session")?.value;
  if (!token) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  // Sessions are stored hashed (see /api/auth/login) — hash first, fall back to legacy plaintext
  const hashed = hashToken(token);
  let session = await prisma.session.findUnique({ where: { token: hashed } });
  if (!session) session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } });
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
  if (session.role !== "student") {
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  const where: any = { email: user.email };
  if (user.admissionId) where.OR = [{ id: user.admissionId }, { email: user.email }];
  const admission = await prisma.admission.findFirst({ where });
  return NextResponse.json({ authenticated: true, mustChangePassword: !!user.mustChangePassword, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, course: user.course, medium: user.medium, mode: user.mode, studentId: user.studentId, digitalIdNo: user.digitalIdNo, digitalIdValidFrom: user.digitalIdValidFrom, digitalIdValidUntil: user.digitalIdValidUntil, digitalIdStatus: user.digitalIdStatus, createdAt: user.createdAt.toISOString() }, admission }, { headers: { "Cache-Control": "no-store" } });
}