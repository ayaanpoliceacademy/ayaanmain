import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
async function findSessionByToken(token: string) {
  const hashed = hashToken(token);
  let s = await prisma.session.findUnique({ where: { token: hashed } });
  if (s) return s;
  // Fallback for legacy plaintext tokens (migration)
  s = await prisma.session.findUnique({ where: { token } });
  if (s) {
    // Migrate to hashed on read
    try { await prisma.session.update({ where: { token }, data: { token: hashed } }); } catch {}
    return { ...s, token: hashed };
  }
  return null;
}
async function deleteSessionByToken(token: string) {
  const hashed = hashToken(token);
  try { await prisma.session.delete({ where: { token: hashed } }); return; } catch {}
  try { await prisma.session.delete({ where: { token } }); } catch {}
}

const ROLE_DEFAULT_TABS: Record<string, string[]> = {
  super_admin: ["dashboard", "store", "orders", "alumni", "leads", "payments", "students", "finance", "dues", "expenses", "admissions", "rag", "batches", "masters", "banner", "fees", "admins", "carousel", "email"],
  finance: ["dashboard", "payments", "finance", "dues", "expenses", "orders", "fees"],
  admissions: ["dashboard", "admissions", "leads", "students", "alumni"],
};

// Map API sub-path to admin tab for permission check
const PATH_TAB_MAP: Record<string, string> = {
  batches: "batches",
  banner: "banner",
  admissions: "admissions",
  "admission-payments": "admissions",
  alumni: "alumni",
  leads: "leads",
  students: "students",
  payments: "payments",
  expenses: "expenses",
  fees: "fees",
  orders: "orders",
  store: "store",
  rag: "rag",
  durations: "masters",
  mediums: "masters",
  branches: "masters",
  addons: "masters",
  dues: "dues",
  "fee-payments": "finance",
  installments: "finance",
  finance: "finance",
  audit: "dashboard",
  receipts: "dues",
  admins: "admins",
  users: "admins",
  carousel: "carousel",
  email: "email",
};

export function getAllowedTabsForAdmin(admin: { role: string; permissions?: string[] | null }): string[] {
  if (admin.permissions && admin.permissions.length > 0) return admin.permissions;
  return ROLE_DEFAULT_TABS[admin.role] || [];
}

function tabForRequest(req: NextRequest): string | null {
  try {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // /api/admin/<resource>
    const idx = parts.indexOf("admin");
    if (idx >= 0 && parts[idx + 1]) {
      const raw = parts[idx + 1].toLowerCase();
      return PATH_TAB_MAP[raw] || raw;
    }
  } catch {}
  return null;
}

export async function requireAdminSession(req: NextRequest, allowedRoles?: string[]): Promise<{ session: any; admin?: any; error?: NextResponse }> {
  const token = req.cookies.get("ayaan_session")?.value;
  if (!token) return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const session = await findSessionByToken(token);
  if (!session || session.expiresAt < new Date()) {
    if (session) await deleteSessionByToken(token);
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.role === "student") {
    return { session: null, error: NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 }) };
  }
  // Fetch admin record for permission checks and active/mustChangePassword
  let admin: any = null;
  try {
    admin = await prisma.admin.findFirst({
      where: {
        OR: [{ username: session.username }, { email: session.username }, { id: session.userId }],
      },
    });
    // Fallback by email derived from usernameToEmail? try case-insensitive
    if (!admin && session.username && session.username.includes("@")) {
      admin = await prisma.admin.findUnique({ where: { email: session.username.toLowerCase() } });
    }
  } catch {}
  if (admin) {
    if (admin.isActive === false) {
      return { session: null, error: NextResponse.json({ error: "Account deactivated — contact super admin" }, { status: 403 }) };
    }
    // Enforce mustChangePassword — only change-password and logout allowed
    if (admin.mustChangePassword) {
      try {
        const url = new URL(req.url);
        const isChange = url.pathname.includes("/change-password") || url.pathname.includes("/auth/"); // allow auth change?
        const isLogout = req.method === "DELETE";
        if (!isChange && !isLogout && !url.pathname.endsWith("/change-password") && !url.pathname.includes("change-password")) {
          // Allow GET /api/admin/login to check status, but block other admin APIs
          const isLoginCheck = url.pathname.endsWith("/admin/login") && req.method === "GET";
          if (!isLoginCheck) return { session: null, error: NextResponse.json({ error: "Password change required" }, { status: 403 }) };
        }
      } catch {}
    }
    const allowedTabs = getAllowedTabsForAdmin(admin);
    // If route requires specific tab permission and admin has explicit permissions, enforce it
    const requiredTab = tabForRequest(req);
    // Strict block for admins tab — only super_admin role, no permissions bypass
    if (requiredTab === "admins" && session.role !== "super_admin") {
      return { session: null, error: NextResponse.json({ error: "Forbidden: super_admin only" }, { status: 403 }) };
    }
    if (requiredTab && admin.permissions && admin.permissions.length > 0) {
      if (!allowedTabs.includes(requiredTab) && admin.role !== "super_admin") {
        // Allow dashboard for all
        if (requiredTab !== "dashboard") {
          return { session: null, error: NextResponse.json({ error: `Forbidden: No access to ${requiredTab}` }, { status: 403 }) };
        }
      }
    }
    // Attach admin to session for downstream use
    (session as any).admin = admin;
    (session as any).allowedTabs = allowedTabs;
  } else {
    // No admin found but session exists — could be orphan, revoke
    // If allowedRoles requires super_admin and we can't verify admin, deny
    if (allowedRoles && allowedRoles.includes("super_admin") && allowedRoles.length === 1) {
      return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    // If admin has custom permissions that grant access to the required tab, allow even if role not in allowedRoles
    // Except for admins tab which is strictly super_admin
    const requiredTab = tabForRequest(req);
    if (requiredTab === "admins") return { session: null, error: NextResponse.json({ error: "Forbidden: super_admin only" }, { status: 403 }) };
    if (admin && admin.permissions && admin.permissions.length > 0) {
      if (requiredTab && getAllowedTabsForAdmin(admin).includes(requiredTab)) {
        return { session, admin, error: undefined };
      }
    }
    return { session: null, error: NextResponse.json({ error: "Forbidden: Insufficient permissions" }, { status: 403 }) };
  }
  return { session, admin, error: undefined };
}

export async function requireStudentSession(req: NextRequest): Promise<{ session: any; error?: NextResponse }> {
  const token = req.cookies.get("ayaan_session")?.value;
  if (!token) return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const session = await findSessionByToken(token);
  if (!session || session.expiresAt < new Date() || session.role !== "student") {
    if (session) await deleteSessionByToken(token);
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // Enforce isActive and mustChangePassword
  try {
    const user = await prisma.user.findFirst({ where: { OR: [{ id: session.userId }, { email: session.username }] } });
    if (user) {
      if (user.isActive === false) return { session: null, error: NextResponse.json({ error: "Account deactivated" }, { status: 403 }) };
      if (user.mustChangePassword) {
        const url = new URL(req.url);
        const isChange = url.pathname.includes("change-password");
        const isLoginCheck = url.pathname.endsWith("/auth/login") || url.pathname.endsWith("/auth/me");
        const isLogout = req.method === "DELETE";
        if (!isChange && !isLoginCheck && !isLogout) return { session: null, error: NextResponse.json({ error: "Password change required" }, { status: 403 }) };
      }
    }
  } catch {}
  return { session, error: undefined };
}