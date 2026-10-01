import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { audit } from "@/lib/identifiers";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch } from "@/lib/branch-scope";

const MAX_RECIPIENTS = 2000;

function smtpStatus() {
  const host = process.env.SMTP_HOST || "";
  const user = process.env.SMTP_USER || "";
  const from = process.env.SMTP_FROM || user;
  return { configured: Boolean(host && user), host, user: user ? user.replace(/^(.{2}).*(@.*)$/, "$1***$2") : "", from };
}

// Resolve the recipient list for a bulk send. `type` is "admissions" (applicants)
// or "users" (enrolled students).
async function resolveRecipients(type: string, filter: any, scopeBranches: string[] | null) {
  if (type === "users") {
    const where: any = { isActive: { not: false } };
    if (filter?.course) where.course = filter.course;
    if (filter?.branch) where.branch = filter.branch;
    if (scopeBranches !== null) where.branch = { in: [...scopeBranches, ""] };
    const users = await prisma.user.findMany({ where, select: { email: true, name: true }, take: MAX_RECIPIENTS });
    return users.filter((u) => !!u.email);
  }
  const where: any = {};
  if (filter?.status) where.status = filter.status;
  if (filter?.course) where.course = filter.course;
  if (filter?.branch) where.branch = filter.branch;
  if (scopeBranches !== null) where.branch = { in: [...scopeBranches, ""] };
  const adms = await prisma.admission.findMany({ where, select: { email: true, name: true }, take: MAX_RECIPIENTS });
  return adms.filter((a) => !!a.email);
}

// GET — SMTP status + how many recipients a filter would hit
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "admissions";

  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });

  const filter = {
    course: searchParams.get("course") || undefined,
    branch: requested.branch || searchParams.get("branch") || undefined,
    status: searchParams.get("status") || undefined,
  };
  const recipients = await resolveRecipients(type, filter, scope.branches);
  return NextResponse.json({ ...smtpStatus(), count: recipients.length, type, filter }, { headers: { "Cache-Control": "no-store" } });
}

// POST — single send, SMTP test, or bulk send
export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || auth.session.userId || "admin");
  const body = await req.json().catch(() => ({}));
  const { to, subject, html, bulk } = body;

  const subjectText = String(subject || "").trim();
  if (!subjectText) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (subjectText.length > 200) return NextResponse.json({ error: "Subject too long (max 200)" }, { status: 400 });
  const bodyHtml = String(html || "").trim();
  if (!bodyHtml) return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  if (bodyHtml.length > 200000) return NextResponse.json({ error: "Message too large (max 200KB)" }, { status: 400 });

  const status = smtpStatus();

  // ---- Single / test send ----
  if (!bulk) {
    const addr = String(to || "").trim();
    if (!addr || !addr.includes("@")) return NextResponse.json({ error: "Valid 'to' email required" }, { status: 400 });
    if (!status.configured) {
      await audit("email", addr.slice(0, 120), actor, "email_send_skipped", `${subjectText} (SMTP not configured)`);
      return NextResponse.json({ ok: true, skipped: true, id: null, reason: "SMTP not configured — logged only" });
    }
    try {
      const info: any = await sendEmail({ to: addr, subject: subjectText, html: bodyHtml });
      await audit("email", addr.slice(0, 120), actor, "email_sent", subjectText);
      return NextResponse.json({ ok: true, id: info?.messageId || null, skipped: false });
    } catch (e: any) {
      await audit("email", addr.slice(0, 120), actor, "email_failed", `${subjectText} — ${e?.message?.slice(0, 120) || "error"}`);
      return NextResponse.json({ error: e?.message || "Send failed" }, { status: 502 });
    }
  }

  // ---- Bulk send ----
  const scope = scopeFromAuth(auth);
  const filter = bulk?.filter || {};
  // A campus admin cannot blast another campus by passing a branch they don't own
  if (filter.branch && !canActOn(scope, filter.branch)) return forbidBranch(filter.branch);

  const recipients = await resolveRecipients(String(bulk.type || "admissions"), filter, scope.branches);
  if (recipients.length === 0) return NextResponse.json({ error: "No recipients match those filters" }, { status: 400 });
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (${recipients.length}). Narrow the filters.` }, { status: 400 });
  }

  if (!status.configured) {
    await audit("email", String(bulk.type || "admissions"), actor, "email_bulk_skipped", `${subjectText} to ${recipients.length} recipients (SMTP not configured)`);
    return NextResponse.json({ ok: true, skipped: true, recipients: recipients.length, sent: 0, failed: 0, reason: "SMTP not configured — logged only" });
  }

  // Sequential with a small gap so a shared mailbox is not flagged as spam
  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const r of recipients) {
    try {
      await sendEmail({ to: r.email, subject: subjectText, html: bodyHtml });
      sent += 1;
    } catch (e: any) {
      failed += 1;
      if (failures.length < 5) failures.push(`${r.email}: ${e?.message?.slice(0, 60) || "error"}`);
    }
  }

  const summary = `${subjectText} -> ${sent}/${recipients.length} sent, ${failed} failed [${bulk.type || "admissions"}${filter.course ? `, course:${filter.course}` : ""}${filter.branch ? `, campus:${filter.branch}` : ""}]`;
  await audit("email", String(bulk.type || "admissions"), actor, "email_bulk_sent", summary);

  return NextResponse.json({
    ok: true,
    skipped: false,
    recipients: recipients.length,
    sent,
    failed,
    error: failures.length > 0 ? `First failures: ${failures.join(" | ")}` : undefined,
  });
}
