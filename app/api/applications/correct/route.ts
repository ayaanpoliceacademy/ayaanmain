import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadDataUrl } from "@/lib/storage";
import { audit, addMonths } from "@/lib/identifiers";

// Token-based applicant correction — no login (applicants have no portal access).
// GET ?token= → limited application fields. POST {token, fields...} → update + resubmit (status → pending).
export const dynamic = "force-dynamic";

function publicView(a: any) {
  return {
    applicationId: a.applicationId,
    name: a.name,
    fatherName: a.fatherName,
    phone: a.phone,
    email: a.email,
    address: a.address,
    reference: a.reference,
    aadharCardNumber: a.aadharCardNumber || "",
    branch: a.branch,
    course: a.course,
    courseType: a.courseType,
    medium: a.medium,
    mode: a.mode,
    batchId: a.batchId,
    batchName: a.batchName,
    photo: a.photo,
    status: a.status,
    clarificationNote: a.clarificationNote,
    totalFee: a.totalFee,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token") || "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  const a = await prisma.admission.findUnique({ where: { clarificationToken: token } });
  if (!a) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (a.status !== "clarification_required") {
    return NextResponse.json({ error: `Application is ${a.status} — no correction needed`, status: 400 });
  }
  return NextResponse.json(publicView(a), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, name, fatherName, phone, address, reference, aadharCardNumber, branch, course, courseType, medium, mode, batchId, photo, addonIds } = body;
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  const a = await prisma.admission.findUnique({ where: { clarificationToken: token } });
  if (!a) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  if (a.status !== "clarification_required") {
    return NextResponse.json({ error: `Application is ${a.status} — cannot resubmit` }, { status: 400 });
  }

  const data: any = {};
  if (name !== undefined) data.name = String(name).trim();
  if (fatherName !== undefined) data.fatherName = String(fatherName).trim();
  if (phone !== undefined) {
    if (!/^[0-9]{10}$/.test(String(phone).trim())) return NextResponse.json({ error: "phone must be 10 digits" }, { status: 400 });
    data.phone = String(phone).trim();
  }
  if (address !== undefined) data.address = String(address).trim();
  if (reference !== undefined) data.reference = String(reference || "").trim();
  if (aadharCardNumber !== undefined) {
    if (!/^[0-9]{12}$/.test(String(aadharCardNumber).trim())) return NextResponse.json({ error: "Aadhar must be 12 digits" }, { status: 400 });
    data.aadharCardNumber = String(aadharCardNumber).trim();
  }
  if (branch !== undefined) data.branch = String(branch).trim();
  if (course !== undefined) data.course = String(course);
  if (courseType !== undefined) data.courseType = String(courseType);
  if (medium !== undefined) data.medium = String(medium);
  if (mode !== undefined) data.mode = String(mode);
  if (photo) {
    try {
      data.photo = await uploadDataUrl("applicant-photos", String(photo), "photo");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Photo upload failed" }, { status: 400 });
    }
  }
  if (batchId !== undefined) {
    if (batchId) {
      const batch = await prisma.batch.findUnique({ where: { id: String(batchId) } });
      if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 400 });
      if (!batch.isActive || batch.status !== "open") return NextResponse.json({ error: "Batch is not active" }, { status: 400 });
      if (batch.filled >= batch.seats) return NextResponse.json({ error: "Batch is full" }, { status: 400 });
      data.batchId = batch.id;
      data.batchName = batch.name || `${batch.course} • ${batch.slot || batch.mode}`;
      data.admissionStartDate = new Date(batch.startDate);
      if (a.durationMonths) data.courseEndDate = addMonths(new Date(batch.startDate), a.durationMonths);
    } else {
      data.batchId = null;
      data.batchName = null;
    }
  }
  if (Array.isArray(addonIds)) {
    const addons = await prisma.addon.findMany({ where: { id: { in: addonIds.map(String) } } });
    if (addons.length !== addonIds.length) return NextResponse.json({ error: "Invalid add-on" }, { status: 400 });
    const courseKey = String(data.course || a.course);
    for (const ad of addons) {
      if (!ad.active) return NextResponse.json({ error: `Add-on ${ad.name} unavailable` }, { status: 400 });
      if (ad.courses.length > 0 && !ad.courses.includes(courseKey)) {
        return NextResponse.json({ error: `Add-on ${ad.name} not applicable` }, { status: 400 });
      }
    }
    await prisma.applicationAddon.deleteMany({ where: { admissionId: a.id } });
    await prisma.applicationAddon.createMany({
      data: addons.map((ad) => ({ admissionId: a.id, addonId: ad.id, name: ad.name, fee: ad.fee })),
    });
    const addonFees = addons.reduce((s, x) => s + x.fee, 0);
    data.addonFees = addonFees;
    data.totalFee = (a.amount || 0) + addonFees - (a.discount || 0);
    data.balanceDue = Math.max(0, data.totalFee - (a.payingNow || 0));
  }

  data.status = "pending";
  data.clarificationNote = null;
  const updated = await prisma.admission.update({ where: { id: a.id }, data });
  await audit("admission", a.id, a.email, "application_resubmitted", "Applicant corrected details");
  return NextResponse.json({ ok: true, applicationId: a.applicationId });
}
