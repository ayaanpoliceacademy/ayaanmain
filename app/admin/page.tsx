"use client";
import { useEffect, useState } from "react";
import AuthForgotPassword from "@/components/AuthForgotPassword";
import { DonutChart, GroupedBarChart, CHART_COLORS } from "@/components/Charts";
import ReceiptView from "@/components/ReceiptView";
import { FALLBACK_FEE as FEE_FALLBACK } from "@/lib/fees";

type Tab = "dashboard" | "rag" | "batches" | "banner" | "admissions" | "payments" | "students" | "finance" | "leads" | "alumni" | "store" | "fees" | "expenses" | "orders" | "dues" | "masters" | "admins" | "carousel" | "email";
type Role = "super_admin" | "finance" | "admissions";

const roleTabs: Record<Role, Tab[]> = {
  super_admin: ["dashboard", "store", "orders", "alumni", "leads", "payments", "students", "finance", "dues", "expenses", "admissions", "rag", "batches", "masters", "banner", "fees", "admins", "carousel"],
  finance: ["dashboard", "payments", "finance", "dues", "expenses", "orders", "fees"],
  admissions: ["dashboard", "admissions", "leads", "students", "alumni"],
};

const allTabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "store", label: "Store Stock" },
  { id: "orders", label: "Orders" },
  { id: "alumni", label: "Alumni" },
  { id: "leads", label: "Leads" },
  { id: "payments", label: "Payments" },
  { id: "students", label: "Students" },
  { id: "finance", label: "AR / AP" },
  { id: "dues", label: "Dues & Receipts" },
  { id: "expenses", label: "Expense Tracker" },
  { id: "admissions", label: "Admissions" },
  { id: "rag", label: "RAG" },
  { id: "batches", label: "Batches" },
  { id: "masters", label: "Masters" },
  { id: "banner", label: "Banner" },
  { id: "fees", label: "Fee Config" },
  { id: "admins", label: "Admins" },
  { id: "carousel", label: "Carousel" },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [auth, setAuth] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role>("super_admin");
  const [authUser, setAuthUser] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [otpMode, setOtpMode] = useState(false);
  const [otpEmail, setOtpEmail] = useState("sunil@drep.in");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [newOrders, setNewOrders] = useState(0);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeErr, setChangeErr] = useState("");
  const [changeOk, setChangeOk] = useState("");

  const allowedTabs = permissions && permissions.length > 0 ? (permissions as Tab[]) : (roleTabs[role] || roleTabs.super_admin);

  useEffect(() => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    fetch("/api/admin/login", { credentials: "same-origin",  signal: ctl.signal, cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setAuth(!!d.authenticated);
        if (d.role) setRole(d.role as Role);
        if (d.user) setAuthUser(d.user);
        if (d.permissions) setPermissions(d.permissions);
        else if (d.role) setPermissions(null);
        if (d.mustChangePassword) setMustChange(true);
        if (d.authenticated && d.role) {
          const eff = d.permissions && d.permissions.length > 0 ? (d.permissions as Tab[]) : (roleTabs[d.role as Role] || roleTabs.super_admin);
          if (!eff.includes(tab)) setTab(eff[0] || "dashboard");
        }
      })
      .catch(() => setAuth(false))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctl.abort(); };
  }, []);

  useEffect(() => {
    if (!auth) return;
    if (role !== "super_admin" && role !== "finance") return;
    const poll = () => {
      fetch("/api/admin/orders", { credentials: "same-origin",  cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setNewOrders(Number(d.newCount || 0)))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [auth, role, tab]);

  const doLogin = async () => {
    setLoginErr("");
    const r = await fetch("/api/admin/login", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: pass }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      setAuth(true);
      const newRole = (data.role as Role) || "super_admin";
      setRole(newRole);
      setAuthUser(data.name || user);
      if (data.permissions) setPermissions(data.permissions);
      else setPermissions(null);
      if (data.mustChangePassword) setMustChange(true);
      else setMustChange(false);
      const eff = data.permissions && data.permissions.length > 0 ? (data.permissions as Tab[]) : (roleTabs[newRole] || roleTabs.super_admin);
      setTab(eff[0] || "dashboard");
      try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
    } else setLoginErr(data.error || "Invalid username or password");
  };
  const doLogout = async () => {
    await fetch("/api/admin/login", { credentials: "same-origin",  method: "DELETE" });
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAuth(false);
    setRole("super_admin");
    setPermissions(null);
    setMustChange(false);
    try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
  };

  const sendAdminOtp = async () => {
    setLoginErr("");
    if (!otpEmail.trim() || !otpEmail.includes("@")) return setLoginErr("Valid email required");
    setOtpLoading(true);
    const r = await fetch("/api/admin/send-otp", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: otpEmail.trim().toLowerCase() }) });
    const d = await r.json().catch(() => ({}));
    setOtpLoading(false);
    if (r.ok) { setOtpSent(true); setLoginErr(""); alert(d.message || "OTP sent to sunil@drep.in"); }
    else setLoginErr(d.error || "Failed to send OTP");
  };
  const doAdminChange = async () => {
    setChangeErr("");
    setChangeOk("");
    if (!oldPass || !newPass || !confirmPass) return setChangeErr("All fields required");
    if (newPass.length < 6) return setChangeErr("New password min 6 chars");
    if (newPass !== confirmPass) return setChangeErr("New passwords do not match");
    if (oldPass === newPass) return setChangeErr("New password must differ");
    setChanging(true);
    const r = await fetch("/api/admin/change-password", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass }) });
    const d = await r.json().catch(() => ({}));
    setChanging(false);
    if (r.ok) {
      setChangeOk("Password changed — you can now access the console");
      setMustChange(false);
      setOldPass(""); setNewPass(""); setConfirmPass("");
    } else setChangeErr(d.error || "Failed to change password");
  };

  const verifyAdminOtp = async () => {
    setLoginErr("");
    if (!otp.trim()) return setLoginErr("OTP required");
    setOtpLoading(true);
    const r = await fetch("/api/admin/verify-otp", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: otpEmail.trim().toLowerCase(), token: otp.trim() }) });
    const d = await r.json().catch(() => ({}));
    setOtpLoading(false);
    if (r.ok) {
      setAuth(true);
      const newRole = (d.role as Role) || "super_admin";
      setRole(newRole);
      setAuthUser(d.name || otpEmail);
      if (d.permissions) setPermissions(d.permissions);
      else setPermissions(null);
      if (d.mustChangePassword) setMustChange(true);
      const eff = d.permissions && d.permissions.length > 0 ? (d.permissions as Tab[]) : (roleTabs[newRole] || roleTabs.super_admin);
      setTab(eff[0] || "dashboard");
    } else setLoginErr(d.error || "Invalid OTP");
  };

  if (auth === null) return <div className="min-h-screen grid place-items-center text-slate-500">Loading…</div>;

  if (!auth) {
    return (
      <>
        <div className="min-h-screen bg-slate-50 grid place-items-center p-4">
          <div className="card p-8 w-full max-w-md">
            <div className="w-12 h-12 rounded-2xl bg-navy-900 text-white grid place-items-center font-bold">A</div>
            <h1 className="mt-4 font-display font-bold text-xl text-navy-900">Ayaan Admin</h1>
            <p className="text-sm text-slate-500">Sign in — role-based access</p>
            <div className="mt-6 grid gap-3">
              {!otpMode ? (
                <>
                  <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Email" className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" type="password" onKeyDown={(e) => e.key === "Enter" && doLogin()} className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  {loginErr && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{loginErr}</div>}
                  <button onClick={doLogin} className="btn-primary justify-center">Sign In →</button>
                  <div className="flex gap-2">
                    <button onClick={() => setShowForgot(true)} className="flex-1 text-xs text-slate-600 hover:text-sky-700 hover:underline text-center py-2">Forgot password?</button>
                    <span className="text-slate-300 py-2">•</span>
                    <button onClick={() => { setOtpMode(true); setLoginErr(""); setOtpSent(false); }} className="flex-1 text-xs font-semibold text-navy-900 hover:text-sky-700 hover:underline text-center py-2">Login with OTP → Secured</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
                    <div className="text-xs font-bold text-sky-800">Secured Admin OTP Layer</div>
                    <div className="text-xs text-sky-700 mt-1">OTP will be sent to <b>sunil@drep.in</b> only (as per secured layer). Valid 1 hour. Check inbox/spam.</div>
                  </div>
                  <input value={otpEmail} onChange={(e) => setOtpEmail(e.target.value)} placeholder="Email (sunil@drep.in)" className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  {!otpSent ? (
                    <button onClick={sendAdminOtp} disabled={otpLoading} className="btn-primary justify-center disabled:opacity-50">{otpLoading ? "Sending…" : "Send OTP to sunil@drep.in →"}</button>
                  ) : (
                    <>
                      <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Enter 6-digit OTP from email" inputMode="numeric" maxLength={8} className="px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-sky-500" />
                      {loginErr && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{loginErr}</div>}
                      <button onClick={verifyAdminOtp} disabled={otpLoading} className="btn-primary justify-center disabled:opacity-50">{otpLoading ? "Verifying…" : "Verify OTP & Login →"}</button>
                      <button onClick={sendAdminOtp} disabled={otpLoading} className="text-xs text-sky-700 hover:underline text-center">Resend OTP</button>
                    </>
                  )}
                  {loginErr && !otpSent && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{loginErr}</div>}
                  <button onClick={() => { setOtpMode(false); setOtpSent(false); setLoginErr(""); }} className="text-xs text-slate-600 hover:text-slate-800 hover:underline text-center">← Back to password login</button>
                </>
              )}
            </div>
          </div>
        </div>
        {showForgot && <AuthForgotPassword onClose={() => setShowForgot(false)} defaultEmail={user} />}
      </>
    );
  }

  const visibleTabs = allTabs.filter((t) => allowedTabs.includes(t.id));

  if (mustChange) {
    return (
      <div className="min-h-screen bg-slate-50 grid place-items-center p-4">
        <div className="card p-8 w-full max-w-md">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white grid place-items-center font-bold">!</div>
          <h1 className="mt-4 font-display font-bold text-xl text-navy-900">Change Password Required</h1>
          <p className="text-sm text-slate-500 mt-1">You must change your password on first login before accessing the console.</p>
          <div className="mt-6 grid gap-3">
            <input value={oldPass} onChange={(e) => setOldPass(e.target.value)} placeholder="Current / Temporary Password" type="password" className="px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <input value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="New Password (min 6 chars)" type="password" className="px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            <input value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} placeholder="Confirm New Password" type="password" onKeyDown={(e) => e.key === "Enter" && doAdminChange()} className="px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            {changeErr && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{changeErr}</div>}
            {changeOk && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">{changeOk}</div>}
            <button onClick={doAdminChange} disabled={changing} className="btn-primary justify-center disabled:opacity-50">{changing ? "Updating…" : "Update Password & Continue →"}</button>
            <button onClick={doLogout} className="text-xs text-slate-500 hover:underline text-center">Logout</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-900 text-white grid place-items-center font-bold">A</div>
            <div>
              <div className="font-display font-bold text-navy-900 leading-none">AYAAN ADMIN</div>
              <div className="text-xs text-slate-500 capitalize">{role.replace("_", " ")} • {authUser}</div>
            </div>
            <span className={`ml-2 px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${role === "super_admin" ? "bg-navy-900 text-white border-navy-900" : role === "finance" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-sky-50 border-sky-200 text-sky-700"}`}>{role.replace("_", " ")}</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/" className="px-4 py-2 rounded-full border border-slate-200 text-sm hover:bg-slate-50">View Site →</a>
            <button onClick={doLogout} className="px-4 py-2 rounded-full bg-navy-900 text-white text-sm">Logout</button>
          </div>
        </div>
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 flex gap-2 pb-3 flex-wrap">
          {visibleTabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as Tab)} className={`px-3 py-2 rounded-full text-xs sm:text-sm font-medium border transition relative ${tab === t.id ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {t.label}
              {t.id === "orders" && newOrders > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold grid place-items-center border-2 border-white">{newOrders}</span>
              )}
            </button>
          ))}
        </div>
        {allowedTabs.length < allTabs.length && (
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">Limited access — {role} ({allowedTabs.join(", ")}) {permissions && permissions.length > 0 ? "• custom permissions" : ""}</div>
          </div>
        )}
      </header>

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {tab === "dashboard" && <DashboardTab onOrders={() => setTab("orders")} />}
        {tab === "store" && <StoreStockTab />}
        {tab === "alumni" && <AlumniTab />}
        {tab === "leads" && <LeadsTab />}
        {tab === "payments" && <PaymentsTab />}
        {tab === "students" && <StudentsTab />}
        {tab === "finance" && <FinanceTab />}
        {tab === "admissions" && <AdmissionsTab />}
        {tab === "rag" && <RagTab />}
        {tab === "batches" && <BatchesTab />}
        {tab === "banner" && <BannerTab />}
        {tab === "fees" && <FeeConfigTab />}
        {tab === "expenses" && <ExpenseTrackerTab />}
        {tab === "orders" && <OrdersTab />}
        {tab === "dues" && <DuesTab />}
        {tab === "masters" && <MastersTab />}
        {tab === "admins" && <AdminsTab />}
        {tab === "carousel" && <CarouselTab />}
        {tab === "email" && <EmailTab />}
      </main>
    </div>
  );
}

function RagTab() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ id: "", category: "General", keywords: "", en: "", hi: "", te: "", source: "Admin" });

  const load = () => fetch("/api/admin/rag", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.en && !form.hi && !form.te) return alert("At least one language required");
    const r = await fetch("/api/admin/rag", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setForm({ id: "", category: "General", keywords: "", en: "", hi: "", te: "", source: "Admin" }); setEditing(null); load(); }
    else alert("Failed");
  };
  const del = async (id: string) => {
    if (!confirm(`Delete ${id}?`)) return;
    await fetch(`/api/admin/rag?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  const filtered = list.filter((x) => !q || `${x.id} ${x.category} ${x.en}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 card p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-navy-900">RAG Documents • {list.length}</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-40" />
        </div>
        <div className="mt-4 grid gap-3 max-h-[70vh] overflow-auto pr-1">
          {filtered.map((x) => (
            <div key={x.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 hover:bg-white transition">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-navy-900">{x.id} <span className="text-xs font-normal text-slate-500">• {x.category}</span></div>
                  <div className="text-xs text-slate-500 mt-1">Keywords: {Array.isArray(x.keywords) ? x.keywords.join(", ") : x.keywords}</div>
                  <div className="text-sm text-slate-700 mt-2 line-clamp-2">{x.en}</div>
                  <div className="text-xs text-slate-500 mt-1">{x.source}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(x.id); setForm({ id: x.id, category: x.category, keywords: Array.isArray(x.keywords) ? x.keywords.join(", ") : x.keywords, en: x.en, hi: x.hi, te: x.te, source: x.source }); }} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50">Edit</button>
                  <button onClick={() => del(x.id)} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700 hover:bg-red-100">Delete</button>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No documents. Add one →</div>}
        </div>
      </div>

      <div className="lg:col-span-5 card p-6 h-fit sticky top-[88px]">
        <h3 className="font-semibold text-navy-900">{editing ? `Edit: ${editing}` : "Add / Update Document"}</h3>
        <p className="text-xs text-slate-500">Bot answers in EN/HI/TE from these chunks. Use keywords for retrieval.</p>
        <div className="mt-4 grid gap-3">
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="id (e.g., fees, hostel-policy)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Source (e.g., Academy → Facilities)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="Keywords, comma separated (si, fees, hostel)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <textarea value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} placeholder="English answer *" rows={3} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <textarea value={form.hi} onChange={(e) => setForm({ ...form, hi: e.target.value })} placeholder="Hindi (hi) — हिंदी में" rows={3} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <textarea value={form.te} onChange={(e) => setForm({ ...form, te: e.target.value })} placeholder="Telugu (te) — తెలుగులో" rows={3} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 btn-primary justify-center">{editing ? "Update" : "Add"} Document</button>
            <button onClick={() => { setEditing(null); setForm({ id: "", category: "General", keywords: "", en: "", hi: "", te: "", source: "Admin" }); }} className="px-4 py-2.5 rounded-full border border-slate-200 text-sm">Clear</button>
          </div>
          <div className="text-xs text-slate-400">Tip: keep each doc focused (one topic). Bot picks top 2 by keyword overlap.</div>
        </div>
      </div>
    </div>
  );
}

const EMPTY_BATCH = { id: "", name: "", course: "SI", medium: "Telugu", mode: "Residential", branch: "Warangal", slot: "", days: "", startDate: "2026-10-01", endDate: "", seats: 40, filled: 0, duration: "3 Months", durationMonths: 3, status: "open", isActive: true, note: "" };

function BatchesTab() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ ...EMPTY_BATCH });
  const [editing, setEditing] = useState<string | null>(null);
  const [courseOptions, setCourseOptions] = useState<string[]>(["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC"]);
  const [mediumOptions, setMediumOptions] = useState<string[]>(["Telugu", "English"]);
  const [branchOptions, setBranchOptions] = useState<string[]>(["Warangal", "Hyderabad", "Hanamkonda", "Bollikunta (Residential)"]);

  const load = () => fetch("/api/admin/batches", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const slug = String(c.slug || "").trim();
          const title: string = String(c.title || "").trim();
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          if (slug) return slug.toUpperCase().replace(/-/g, " ");
          return title;
        }).filter(Boolean);
        const uniq = Array.from(new Set(opts));
        if (uniq.length > 0) setCourseOptions(uniq);
      }
    }).catch(() => {});
    fetch("/api/mediums").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) {
        const names = d.map((m: any) => String(m.name || m)).filter(Boolean);
        if (names.length > 0) setMediumOptions(names);
      }
    }).catch(() => {});
    fetch("/api/branches").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) {
        const names = d.map((b: any) => String(b.name || b)).filter(Boolean);
        if (names.length > 0) setBranchOptions(names);
      }
    }).catch(() => {});
  }, []);
  const filtered = list.filter((b: any) => {
    if (!q) return true;
    const qq = q.toLowerCase();
    return [b.name, b.course, b.medium, b.mode, b.branch, b.slot, b.days, b.status, b.duration].join(" ").toLowerCase().includes(qq);
  });

  const save = async () => {
    const r = await fetch("/api/admin/batches", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setForm({ ...EMPTY_BATCH }); setEditing(null); load(); }
    else alert(d.error || "Failed");
  };
  const del = async (id: string) => {
    if (!confirm(`Delete batch ${id}?`)) return;
    const r = await fetch(`/api/admin/batches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) load();
    else alert(d.error || "Failed");
  };
  const toForm = (b: any) => ({
    id: b.id, name: b.name || "", course: b.course, medium: b.medium, mode: b.mode, branch: b.branch || "Warangal",
    slot: b.slot || "", days: b.days || "",
    startDate: b.startDate ? new Date(b.startDate).toISOString().slice(0, 10) : "",
    endDate: b.endDate ? new Date(b.endDate).toISOString().slice(0, 10) : "",
    seats: b.seats, filled: b.filled, duration: b.duration, durationMonths: b.durationMonths || 3,
    status: b.status, isActive: b.isActive !== false, note: b.note || "",
  });

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 card p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-navy-900">Batches • {filtered.length}/{list.length} <span className="font-normal text-slate-500">— academic groups students join</span></h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search batch, course, branch…" className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white min-w-[180px]" />
        </div>
        <div className="mt-4 grid gap-3 max-h-[75vh] overflow-auto pr-1">
          {filtered.length === 0 ? <div className="text-sm text-slate-500 text-center py-8">No batches match.</div> : filtered.map((b) => (
            <div key={b.id} className="p-4 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-navy-900">{b.name || `${b.course} Batch`} <span className={`ml-2 text-xs px-2 py-1 rounded-full border ${b.isActive !== false && b.status === "open" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-600"}`}>{b.isActive === false ? "inactive" : b.status}</span></div>
                  <div className="text-xs text-slate-600 mt-1">{b.course} • {b.medium} • {b.mode}{b.branch ? ` • ${b.branch}` : ""}{b.slot ? ` • ${b.slot}` : ""}{b.days ? ` • ${b.days}` : ""}</div>
                  <div className="text-xs text-slate-600 mt-1">
                    {new Date(b.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    {b.endDate ? ` → ${new Date(b.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""} • {b.duration}
                  </div>
                  <div className="text-xs mt-1 font-medium text-navy-900">Capacity {b.seats} • Enrolled {b.filled} • <span className={b.seats - b.filled > 0 ? "text-emerald-700" : "text-red-600"}>{Math.max(0, b.seats - b.filled)} seats left</span></div>
                  {b.note && <div className="text-xs text-slate-500 mt-1">{b.note}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(b.id); setForm(toForm(b)); }} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs">Edit</button>
                  <button onClick={() => del(b.id)} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">Delete</button>
                </div>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No batches yet. Add one →</div>}
        </div>
      </div>

      <div className="lg:col-span-5 card p-6 h-fit sticky top-[88px]">
        <h3 className="font-semibold text-navy-900">{editing ? `Edit: ${editing}` : "Add Batch"}</h3>
        <p className="text-xs text-slate-500">Batch = Course + Duration + Branch + Slot + Dates + Capacity. End date auto-fills from duration.</p>
        <div className="mt-4 grid gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Batch name * (e.g., October 2026 Morning Batch)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid grid-cols-3 gap-2">
            <select value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{mediumOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Residential</option><option>Offline</option><option>Online</option></select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <input value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} placeholder="Slot (e.g., Morning 6-9 AM)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} placeholder="Days (e.g., Mon–Sat)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-500">Start Date *</label><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
            <div><label className="text-xs text-slate-500">End Date (auto)</label><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-xs text-slate-500">Capacity *</label><input type="number" min={1} value={form.seats} onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Enrolled</label><input type="number" min={0} value={form.filled} onChange={(e) => setForm({ ...form, filled: Number(e.target.value) })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Duration (months)</label><input type="number" min={1} value={form.durationMonths} onChange={(e) => setForm({ ...form, durationMonths: Number(e.target.value), duration: `${e.target.value} Months` })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="Duration label" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option value="open">open</option><option value="closed">closed</option></select>
            <label className="flex items-center gap-2 text-sm px-3"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active</label>
          </div>
          <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Note" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 btn-primary justify-center">{editing ? "Update" : "Add"} Batch</button>
            <button onClick={() => { setEditing(null); setForm({ ...EMPTY_BATCH }); }} className="px-4 py-2.5 rounded-full border border-slate-200 text-sm">Clear</button>
          </div>
          <div className="text-xs text-slate-400">Capacity can't drop below enrollment. Deleting a batch with approved students is blocked.</div>
        </div>
      </div>
    </div>
  );
}

function AdmissionsTab() {
  const [list, setList] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "clarification_required" | "discount_pending" | "approved" | "rejected">("pending");
  const [q, setQ] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [splits, setSplits] = useState<Record<string, any[]>>({});
  const [openPay, setOpenPay] = useState<Record<string, boolean>>({});
  const [clarNote, setClarNote] = useState<Record<string, string>>({});
  const [discAmt, setDiscAmt] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState<Record<string, string>>({});
  const [role, setRole] = useState("super_admin");
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [courseOptions, setCourseOptions] = useState<string[]>([]);
  const load = () => fetch("/api/admin/admissions", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/admin/login", { credentials: "same-origin" }).then((r) => r.json()).then((d) => d.role && setRole(d.role)).catch(() => {});
    fetch("/api/branches").then((r) => r.json()).then((d) => Array.isArray(d) && setBranchOptions(d.map((b: any) => b.name))).catch(() => {});
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const title: string = String(c.title || "");
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          return String(c.slug || title).trim();
        }).filter(Boolean);
        setCourseOptions(Array.from(new Set(opts)));
      }
    }).catch(() => {});
  }, []);
  const isSuper = role === "super_admin";
  const togglePay = async (id: string) => {
    const next = !openPay[id];
    setOpenPay({ ...openPay, [id]: next });
    if (next && !splits[id]) {
      const r = await fetch(`/api/admin/admission-payments?admissionId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const d = await r.json().catch(() => []);
      if (Array.isArray(d)) setSplits({ ...splits, [id]: d });
    }
  };
  const act = async (id: string, action: string, extra: any = {}) => {
    const r = await fetch("/api/admin/admissions", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (action === "approve") alert(`Approved! Student ${data.studentId} created — login ${data.user.email} / Ayaan@1234 (must change on first login)`);
      else alert(data.locked === true || data.locked === false ? `${action} done` : `${action} done`);
      load();
    } else alert(data.error || "Failed");
  };
  const printForm = (a: any) => {
    const fmtDate = (d: any) => { try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" }); } catch { return String(d || "—"); } };
    const aadhar = a.aadharCardNumber ? String(a.aadharCardNumber).replace(/(.{4})/g, "$1 ").trim() : "—";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Admission Form — ${a.applicationId || a.id}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Inter,system-ui,Arial,sans-serif; margin:0; padding:24px; color:#0f172a; -webkit-print-color-adjust:exact; print-color-adjust:exact}
      .header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
      .header h1{margin:0;font-size:20px;letter-spacing:0.04em}.header h1 span{color:#0369a1} .sub{font-size:11px;color:#64748b;margin-top:2px}
      .badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;background:#0f172a;color:#fff;letter-spacing:0.06em}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px} .card{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#f8fafc}
      .card h3{margin:0 0 8px;font-size:12px;letter-spacing:0.06em;color:#475569;text-transform:uppercase}
      .row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #e2e8f0;font-size:13px} .row:last-child{border:none} .k{color:#64748b} .v{font-weight:600;text-align:right;max-width:60%;word-break:break-word}
      .photo{width:96px;height:96px;border-radius:12px;object-fit:cover;border:1px solid #e2e8f0;background:#fff}
      .footer{margin-top:18px;display:flex;justify-content:space-between;gap:16px;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:12px}
      .sig{margin-top:28px;display:flex;justify-content:space-between;gap:24px} .sig div{flex:1;border-top:1px solid #0f172a;padding-top:6px;font-size:11px;text-align:center;color:#334155}
      @media print{ body{padding:12px} .no-print{display:none} }
    </style></head><body>
      <div class="header">
        <div><h1>AYAAN <span>INSTITUTE</span></h1><div class="sub">Ayaan Group of Competitive Institutions • Est. 2016 • Dilsukhnagar • Hanamkonda • Bollikunta (Residential) • +91 88866 67222</div></div>
        <div style="text-align:right"><div class="badge">${a.applicationId || a.id}</div><div class="sub" style="margin-top:6px">Status: <b>${String(a.status || "").replace(/_/g," ")}</b> • ${fmtDate(a.createdAt)}</div></div>
      </div>
      <div class="grid">
        <div class="card"><h3>Applicant</h3>
          <div class="row"><span class="k">Name</span><span class="v">${a.name || "—"} ${a.fatherName ? "S/o " + a.fatherName : ""}</span></div>
          <div class="row"><span class="k">Email • Phone</span><span class="v">${a.email || "—"} • ${a.phone || "—"}</span></div>
          <div class="row"><span class="k">Aadhar</span><span class="v" style="letter-spacing:0.12em">${aadhar}</span></div>
          <div class="row"><span class="k">Address</span><span class="v">${(a.address || "—").replace(/</g,"&lt;")}</span></div>
          ${a.reference ? `<div class="row"><span class="k">Reference</span><span class="v">${String(a.reference).replace(/</g,"&lt;")}</span></div>` : ""}
          ${a.photo ? `<div class="row"><span class="k">Photo</span><span class="v"><a href="${a.photo}" target="_blank" style="color:#0369a1">View</a></span></div>` : ""}
        </div>
        <div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
          ${a.photo ? `<img src="${a.photo}" class="photo" alt="Applicant photo"/>` : `<div style="width:96px;height:96px;border-radius:12px;background:#e2e8f0;display:grid;place-items:center;font-size:11px;color:#64748b">No Photo</div>`}
          <div style="font-size:11px;color:#475569;text-align:center">${a.name || ""}<br/><span style="color:#94a3b8">${a.course || ""} • ${a.branch || ""}</span></div>
          <div style="font-size:11px;padding:6px 10px;border-radius:999px;background:#fff;border:1px solid #e2e8f0">${a.batchName || a.batchId || "No batch yet"}</div>
        </div>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h3>Academic</h3>
          <div class="row"><span class="k">Course</span><span class="v">${a.course || "—"} ${a.courseType ? "• " + a.courseType : ""}</span></div>
          <div class="row"><span class="k">Medium • Mode</span><span class="v">${a.medium || "—"} • ${a.mode || "—"}</span></div>
          <div class="row"><span class="k">Branch</span><span class="v">${a.branch || "—"}</span></div>
          <div class="row"><span class="k">Duration</span><span class="v">${a.durationName || "—"} ${a.durationMonths ? "(" + a.durationMonths + " months)" : ""}</span></div>
          <div class="row"><span class="k">Batch</span><span class="v">${a.batchName || "—"} ${a.batchId ? "(" + a.batchId + ")" : ""}</span></div>
          <div class="row"><span class="k">Period</span><span class="v">${a.admissionStartDate ? fmtDate(a.admissionStartDate) : "—"} → ${a.courseEndDate ? fmtDate(a.courseEndDate) : "—"}</span></div>
        </div>
        <div class="card"><h3>Fee & Payment</h3>
          <div class="row"><span class="k">Base Fee</span><span class="v">₹${Number(a.amount || 0).toLocaleString("en-IN")}</span></div>
          <div class="row"><span class="k">Add-ons</span><span class="v">₹${Number(a.addonFees || 0).toLocaleString("en-IN")}</span></div>
          ${a.discount ? `<div class="row"><span class="k">Discount ${a.discountStatus ? "(" + a.discountStatus + ")" : ""}</span><span class="v">- ₹${Number(a.discount).toLocaleString("en-IN")}</span></div>` : ""}
          <div class="row"><span class="k">Total Fee</span><span class="v">₹${Number(a.totalFee || 0).toLocaleString("en-IN")} ${a.feeLocked ? " (locked)" : ""}</span></div>
          <div class="row"><span class="k">Paid Now</span><span class="v">₹${Number(a.payingNow || 0).toLocaleString("en-IN")} via ${a.paymentMethod || "—"} ${a.transactionId ? "(" + a.transactionId + ")" : ""}</span></div>
          <div class="row"><span class="k">Balance Due</span><span class="v" style="color:${Number(a.balanceDue||0)>0 ? "#dc2626" : "#059669"}">₹${Number(a.balanceDue || 0).toLocaleString("en-IN")}</span></div>
          <div class="row"><span class="k">Final Fee</span><span class="v">${a.finalFee != null ? "₹" + Number(a.finalFee).toLocaleString("en-IN") : "—"}</span></div>
        </div>
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h3>IDs & Status</h3>
          <div class="row"><span class="k">Application ID</span><span class="v">${a.applicationId || "—"}</span></div>
          <div class="row"><span class="k">Applicant Student ID</span><span class="v">${a.applicantStudentId || "—"}</span></div>
          <div class="row"><span class="k">Status</span><span class="v">${String(a.status||"").replace(/_/g," ")}</span></div>
          ${a.approvedAt ? `<div class="row"><span class="k">Approved</span><span class="v">${fmtDate(a.approvedAt)}</span></div>` : ""}
          ${a.clarificationNote ? `<div class="row"><span class="k">Clarification</span><span class="v">${String(a.clarificationNote).replace(/</g,"&lt;")}</span></div>` : ""}
        </div>
        <div class="card"><h3>Contact & Reference</h3>
          <div class="row"><span class="k">Phone</span><span class="v">${a.phone || "—"}</span></div>
          <div class="row"><span class="k">Email</span><span class="v">${a.email || "—"}</span></div>
          <div class="row"><span class="k">Reference</span><span class="v">${a.reference || "—"}</span></div>
          <div class="row"><span class="k">Submitted</span><span class="v">${fmtDate(a.createdAt)} • ${a.id}</span></div>
        </div>
      </div>
      <div class="sig"><div>Applicant Signature</div><div>Authorized Signatory • Ayaan Institute</div><div>Date & Seal</div></div>
      <div class="footer"><span>Generated ${new Date().toLocaleString("en-IN")} • Ayaan Institute • This is a computer-generated admission form — print & keep for records.</span><span class="no-print"><button onclick="window.print()" style="padding:8px 14px;border-radius:999px;border:1px solid #0f172a;background:#0f172a;color:#fff;font-weight:600;cursor:pointer">Print / Save as PDF</button></span></div>
      <script>window.onload=()=>setTimeout(()=>window.print(), 300);<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return alert("Popup blocked — allow popups to print");
    w.document.open(); w.document.write(html); w.document.close();
  };
  const filtered = list.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (courseFilter !== "all" && String(a.course) !== courseFilter) return false;
    if (branchFilter !== "all" && String(a.branch) !== branchFilter) return false;
    if (q) {
      const qq = q.toLowerCase();
      const hay = [a.name, a.fatherName, a.phone, a.email, a.course, a.branch, a.medium, a.mode, a.applicationId, a.applicantStudentId, a.aadharCardNumber, a.address, a.reference, a.transactionId].join(" ").toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  });
  const statusPill = (s: string) =>
    s === "approved" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
    : s === "rejected" ? "bg-red-50 border-red-200 text-red-700"
    : s === "clarification_required" ? "bg-violet-50 border-violet-200 text-violet-700"
    : s === "discount_pending" ? "bg-sky-50 border-sky-200 text-sky-700"
    : "bg-amber-50 border-amber-200 text-amber-700";
  return (
    <div className="card p-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-navy-900">Applications & Admissions • {filtered.length}/{list.length}</h2>
          <div className="flex gap-1 flex-wrap">
            {(["all", "pending", "clarification_required", "discount_pending", "approved", "rejected"] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs border ${filter === f ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>{f === "all" ? `All (${list.length})` : `${f.replace(/_/g, " ")} (${list.filter((x) => x.status === f).length})`}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, course, Aadhar, App ID…" className="flex-1 min-w-[220px] px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white" />
          <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"><option value="all">All courses</option>{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"><option value="all">All branches</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          {(q || courseFilter !== "all" || branchFilter !== "all") && <button onClick={() => { setQ(""); setCourseFilter("all"); setBranchFilter("all"); }} className="text-xs text-slate-500 hover:underline">Clear</button>}
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {filtered.map((a) => (
          <div key={a.id} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm font-semibold text-navy-900">{a.name} {a.fatherName ? <span className="font-normal text-slate-600">S/o {a.fatherName}</span> : ""} • {a.phone} <span className="text-xs font-normal text-slate-500">• {a.email}</span></div>
                <div className="text-xs text-slate-600 mt-1">{a.course} {a.courseType ? `• ${a.courseType}` : ""} • {a.medium} • {a.mode} • {a.branch || "—"} {a.batchId ? `• ${a.batchId}` : ""}</div>
                <div className="text-xs text-slate-700 mt-1">🪪 Aadhar: <span className="font-mono tracking-widest">{a.aadharCardNumber ? String(a.aadharCardNumber).replace(/(.{4})/g, "$1 ").trim() : <span className="text-slate-400">— not provided (legacy)</span>}</span></div>
                {a.address && <div className="text-xs text-slate-500 mt-1">📍 {a.address} {a.reference ? `• Ref: ${a.reference}` : ""}</div>}
                <div className="text-xs mt-1 flex gap-2 items-center flex-wrap">
                  {a.applicationId && <span className="px-2 py-1 rounded-full bg-navy-900 text-white text-xs font-semibold">{a.applicationId}</span>}
                  {a.applicantStudentId && <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-xs font-semibold">{a.applicantStudentId}</span>}
                  <span className="capitalize px-2 py-1 rounded-full bg-white border text-xs">{a.paymentMethod}</span>
                  {a.amount && <span className="px-2 py-1 rounded-full bg-white border text-xs">₹{a.amount.toLocaleString("en-IN")}</span>}
                  {a.totalFee !== undefined && a.totalFee !== null && <span className="px-2 py-1 rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-xs">Due ₹{Number(a.totalFee).toLocaleString("en-IN")} • Paid ₹{Number(a.payingNow || 0).toLocaleString("en-IN")} • Bal ₹{Number(a.balanceDue || 0).toLocaleString("en-IN")}</span>}
                  {a.discountStatus && a.discountStatus !== "none" && <span className="px-2 py-1 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-xs">Discount {a.discountStatus}{a.discount ? `: ₹${Number(a.discount).toLocaleString("en-IN")}` : ""}{a.feeLocked ? " • locked" : ""}</span>}
                  {a.transactionId && <span className="text-slate-600">Txn: {a.transactionId}</span>}
                  <span className={`px-2 py-1 rounded-full text-xs border ${statusPill(a.status)}`}>{a.status.replace(/_/g, " ")}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {a.durationName ? `${a.durationName} • ` : ""}{a.batchName || ""}{a.admissionStartDate ? ` • Start ${new Date(a.admissionStartDate).toLocaleDateString("en-IN")}` : ""}{a.courseEndDate ? ` → End ${new Date(a.courseEndDate).toLocaleDateString("en-IN")}` : ""}
                </div>
                {a.clarificationNote && <div className="text-xs mt-1 px-2 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-800">Clarification: {a.clarificationNote}</div>}
                <div className="text-xs text-slate-400 mt-1">{new Date(a.createdAt).toLocaleString("en-IN")} • {a.id} • <button onClick={() => togglePay(a.id)} className="text-sky-700 hover:underline">{openPay[a.id] ? "Hide payment splits ▲" : "Payment splits ▼"}</button></div>
                {openPay[a.id] && (
                  <div className="mt-2 grid gap-1.5">
                    {(splits[a.id] || []).map((s: any) => (
                      <div key={s.id} className="text-xs p-2 rounded-lg bg-white border border-slate-200 flex flex-wrap gap-x-3 gap-y-1">
                        <b className="capitalize">{s.method}</b>
                        <span className="font-semibold">₹{Number(s.amount).toLocaleString("en-IN")}</span>
                        {s.transactionId && <span className="text-slate-500">Txn: {s.transactionId}</span>}
                        <span className="text-slate-400">{new Date(s.createdAt).toLocaleString("en-IN")}{s.recordedBy ? ` • by ${s.recordedBy}` : ""}</span>
                      </div>
                    ))}
                    {(splits[a.id] || []).length === 0 && <div className="text-xs text-slate-400">No split records (legacy admission).</div>}
                  </div>
                )}
              </div>
              <div className="shrink-0 flex flex-col gap-2 items-end">
                <button onClick={() => printForm(a)} className="px-3 py-1.5 rounded-full bg-navy-900 text-white text-xs font-medium hover:bg-navy-800">🖨️ Print / PDF</button>
                {a.screenshot && <a href={a.screenshot} target="_blank" className="text-xs text-sky-700 hover:underline"><img src={a.screenshot} alt="proof" className="w-20 h-14 object-cover rounded-lg border border-slate-200" /><div>View Proof</div></a>}
              </div>
            </div>
            {(a.status === "pending" || a.status === "clarification_required") && (
              <div className="mt-3 grid gap-2">
                <div className="flex gap-2 items-center flex-wrap">
                  <input value={clarNote[a.id] || ""} onChange={(e) => setClarNote({ ...clarNote, [a.id]: e.target.value })} placeholder="Clarification note for applicant…" className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                  <button onClick={() => { if (!clarNote[a.id]?.trim()) return alert("Enter clarification note"); act(a.id, "request_clarification", { note: clarNote[a.id] }); }} className="px-3 py-2 rounded-full bg-violet-600 text-white text-xs font-medium hover:bg-violet-700">Ask Clarification</button>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <input type="number" min={0} value={discAmt[a.id] || ""} onChange={(e) => setDiscAmt({ ...discAmt, [a.id]: e.target.value })} placeholder="Discount ₹" className="w-32 px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                  <button onClick={() => { if (!discAmt[a.id]) return alert("Enter discount amount"); act(a.id, "apply_discount", { discount: Number(discAmt[a.id]) }); }} className="px-3 py-2 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50">{isSuper ? "Apply Discount & Lock" : "Request Discount"}</button>
                  {a.discountStatus === "requested" && isSuper && (
                    <>
                      <button onClick={() => act(a.id, "approve_discount")} className="px-3 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold">Approve Discount (₹{Number(a.discount || 0).toLocaleString("en-IN")})</button>
                      <button onClick={() => act(a.id, "reject_discount")} className="px-3 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">Reject</button>
                    </>
                  )}
                </div>
                {a.status === "pending" && (
                  <div className="flex gap-2 items-center flex-wrap">
                    <input type="date" value={startDate[a.id] || ""} onChange={(e) => setStartDate({ ...startDate, [a.id]: e.target.value })} className="px-3 py-2 rounded-xl border border-slate-200 text-sm" title="Override admission start date (default: batch start)" />
                    <button onClick={() => act(a.id, "approve", startDate[a.id] ? { admissionStartDate: startDate[a.id] } : {})} className="px-4 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700">Approve → Student ID + Ayaan@1234</button>
                    <button onClick={() => act(a.id, "reject")} className="px-3 py-2 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50">Reject</button>
                  </div>
                )}
                <div className="text-[11px] text-slate-400">Approve: locks batch seat (capacity-checked), generates Student ID + Digital ID, creates login (email / Ayaan@1234, must-change), migrates splits, creates Installment 1.</div>
              </div>
            )}
            {a.status === "discount_pending" && (
              <div className="mt-3 flex gap-2 items-center flex-wrap">
                <span className="text-xs text-sky-700">Discount ₹{Number(a.discount || 0).toLocaleString("en-IN")} awaiting super_admin.</span>
                {isSuper && (
                  <>
                    <button onClick={() => act(a.id, "approve_discount")} className="px-3 py-2 rounded-full bg-emerald-600 text-white text-xs font-semibold">Approve & Lock</button>
                    <button onClick={() => act(a.id, "reject_discount")} className="px-3 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">Reject</button>
                  </>
                )}
              </div>
            )}
            {a.status === "approved" && <div className="mt-2 text-xs text-emerald-700">✓ Student {a.applicantStudentId || ""} — login {a.email} / initial password, must-change on first login</div>}
            {a.status === "rejected" && <button onClick={() => act(a.id, "pending")} className="mt-2 text-xs px-3 py-1 rounded-full bg-white border">Mark Pending</button>}
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No {filter} admissions</div>}
      </div>
    </div>
  );
}

function DashboardTab({ onOrders }: { onOrders?: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [newOrders, setNewOrders] = useState(0);
  useEffect(() => {
    Promise.all([fetch("/api/admin/payments", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null), fetch("/api/admin/expenses", { credentials: "same-origin" }).then((r) => r.json()).catch(() => []), fetch("/api/admin/admissions", { credentials: "same-origin" }).then((r) => r.json()).catch(() => []), fetch("/api/admin/orders", { credentials: "same-origin" }).then((r) => r.json()).catch(() => null)])
      .then(([pay, exp, adm, ord]) => {
        setExpenses(Array.isArray(exp) ? exp : []);
        if (ord && typeof ord.newCount === "number") setNewOrders(ord.newCount);
        if (pay?.totals) setStats({ pay, adm: Array.isArray(adm) ? adm : [] });
      });
  }, []);
  if (!stats) return <div className="text-sm text-slate-500">Loading dashboard…</div>;
  const { payments, totals } = stats.pay;
  const pendingAdmissions = stats.adm.filter((a: any) => a.status === "pending").length;
  // AR/AP: only approved/paid count toward payable; pending is awaiting super_admin
  const approvedExpenses = expenses.filter((e: any) => ["approved", "paid"].includes(e.status));
  const pendingExpenses = expenses.filter((e: any) => e.status === "pending");
  const totalPayable = approvedExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const paidPayable = expenses.filter((e: any) => e.status === "paid").reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
  const pendingPayable = totalPayable - paidPayable;
  const pendingApprovalTotal = pendingExpenses.reduce((s: number, e: any) => s + Number(e.amount || 0), 0);

  // ---- Reports & analytics ----
  const normMethod = (m: any) => {
    const v = String(m || "").toLowerCase();
    if (v === "cash") return "Cash";
    if (v === "upi") return "UPI";
    if (v === "bank") return "Bank Transfer";
    if (v === "razorpay") return "Razorpay";
    return "Other";
  };
  const methodMeta: Record<string, string> = {
    Cash: CHART_COLORS.emerald,
    UPI: CHART_COLORS.sky,
    "Bank Transfer": CHART_COLORS.navy,
    Razorpay: CHART_COLORS.violet,
    Other: CHART_COLORS.slate,
  };
  const methodAgg: Record<string, { amount: number; count: number }> = {};
  payments.forEach((p: any) => {
    const k = normMethod(p.paymentMethod);
    if (!methodAgg[k]) methodAgg[k] = { amount: 0, count: 0 };
    methodAgg[k].amount += Number(p.collected || 0);
    methodAgg[k].count += 1;
  });
  const methodSlices = Object.keys(methodAgg).map((k) => ({ label: k, value: methodAgg[k].amount, color: methodMeta[k] || CHART_COLORS.slate, count: methodAgg[k].count }));

  const courseAgg: Record<string, { receivable: number; collected: number }> = {};
  payments.forEach((p: any) => {
    const c = String(p.course || "Other");
    if (!courseAgg[c]) courseAgg[c] = { receivable: 0, collected: 0 };
    courseAgg[c].receivable += Number(p.receivable || 0);
    courseAgg[c].collected += Number(p.collected || 0);
  });
  const courseGroups = Object.keys(courseAgg)
    .sort((a, b) => courseAgg[b].receivable - courseAgg[a].receivable)
    .map((c) => ({
      label: c,
      bars: [
        { label: "Collected", value: courseAgg[c].collected, color: CHART_COLORS.emerald },
        { label: "Pending", value: Math.max(0, courseAgg[c].receivable - courseAgg[c].collected), color: CHART_COLORS.amber },
      ],
    }));

  const catPalette = [CHART_COLORS.navy, CHART_COLORS.sky, CHART_COLORS.amber, CHART_COLORS.emerald, CHART_COLORS.violet, CHART_COLORS.rose, CHART_COLORS.teal, CHART_COLORS.slate];
  const catAgg: Record<string, number> = {};
  approvedExpenses.forEach((e: any) => {
    const c = String(e.category || "General");
    catAgg[c] = (catAgg[c] || 0) + Number(e.amount || 0);
  });
  const catSlices = Object.keys(catAgg)
    .sort((a, b) => catAgg[b] - catAgg[a])
    .map((c, i) => ({ label: c, value: catAgg[c], color: catPalette[i % catPalette.length] }));

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: `${monthNames[d.getMonth()]}` });
  }
  const monthGroups = months.map((m) => {
    const coll = payments
      .filter((p: any) => {
        const d = new Date(p.createdAt);
        return `${d.getFullYear()}-${d.getMonth()}` === m.key;
      })
      .reduce((s: number, p: any) => s + Number(p.collected || 0), 0);
    const exp = approvedExpenses
      .filter((e: any) => {
        const d = new Date(e.expenseDate || e.createdAt);
        return `${d.getFullYear()}-${d.getMonth()}` === m.key;
      })
      .reduce((s: number, e: any) => s + Number(e.amount || 0), 0);
    return {
      label: m.label,
      bars: [
        { label: "Collected", value: coll, color: CHART_COLORS.emerald },
        { label: "Expenses", value: exp, color: CHART_COLORS.rose },
      ],
    };
  });
  return (
    <div className="grid gap-6">
      {newOrders > 0 && (
        <button onClick={onOrders} className="text-left p-4 rounded-2xl bg-red-50 border border-red-200 flex items-center gap-3 hover:bg-red-100/60 transition">
          <span className="w-10 h-10 rounded-full bg-red-600 text-white grid place-items-center font-bold shrink-0">{newOrders}</span>
          <span>
            <span className="block text-sm font-semibold text-red-800">🔔 {newOrders} new store order{newOrders > 1 ? "s" : ""} need{newOrders > 1 ? "" : "s"} attention</span>
            <span className="block text-xs text-red-600">Placed / payment confirmed — tap to open Orders →</span>
          </span>
        </button>
      )}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5"><div className="text-xs tracking-widest font-semibold text-sky-700">ACCOUNTS RECEIVABLE</div><div className="text-2xl font-bold text-navy-900 mt-1">₹{totals.totalReceivable.toLocaleString("en-IN")}</div><div className="text-xs text-slate-500">Total fees receivable • {totals.count} admissions</div><div className="mt-3 flex gap-2 text-xs"><span className="px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">Collected ₹{totals.totalCollected.toLocaleString("en-IN")}</span><span className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">Pending ₹{totals.totalPending.toLocaleString("en-IN")}</span></div></div>
        <div className="card p-5"><div className="text-xs tracking-widest font-semibold text-amber-700">ACCOUNTS PAYABLE</div><div className="text-2xl font-bold text-navy-900 mt-1">₹{totalPayable.toLocaleString("en-IN")}</div><div className="text-xs text-slate-500">{approvedExpenses.length} approved • {pendingExpenses.length} pending approval • ₹{pendingApprovalTotal.toLocaleString("en-IN")} awaiting super_admin</div><div className="mt-3 flex gap-2 text-xs"><span className="px-2 py-1 rounded-full bg-slate-100 border">Paid ₹{paidPayable.toLocaleString("en-IN")}</span><span className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">Due ₹{pendingPayable.toLocaleString("en-IN")}</span><span className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700">Pending Appr. ₹{pendingApprovalTotal.toLocaleString("en-IN")}</span></div></div>
        <div className="card p-5"><div className="text-xs tracking-widest font-semibold text-emerald-700">NET POSITION</div><div className={`text-2xl font-bold mt-1 ${totals.totalCollected - totalPayable >= 0 ? "text-emerald-700" : "text-red-600"}`}>₹{(totals.totalCollected - totalPayable).toLocaleString("en-IN")}</div><div className="text-xs text-slate-500">Collected - Payable</div><div className="mt-3 text-xs text-slate-500">Profitability at a glance</div></div>
        <div className="card p-5"><div className="text-xs tracking-widest font-semibold text-violet-700">STUDENTS & ADMISSIONS</div><div className="text-2xl font-bold text-navy-900 mt-1">{stats.pay.usersCount} <span className="text-sm font-normal text-slate-500">students</span></div><div className="text-xs text-slate-500">{pendingAdmissions} pending admissions • {payments.filter((p: any) => p.paymentMethod === "cash").length} cash</div><div className="mt-3 flex gap-2 text-xs"><span className="px-2 py-1 rounded-full bg-white border">UPI: {payments.filter((p: any) => p.paymentMethod === "upi").length}</span><span className="px-2 py-1 rounded-full bg-white border">Bank: {payments.filter((p: any) => p.paymentMethod === "bank").length}</span></div></div>
      </div>
      <div>
        <div className="text-xs tracking-widest font-semibold text-slate-500">REPORTS & ANALYTICS</div>
        <div className="mt-3 grid lg:grid-cols-2 gap-4">
          <div className="card p-5">
            <div className="font-semibold text-navy-900">Fee Collection by Method</div>
            <div className="text-xs text-slate-500 mt-1">Cash vs UPI vs Bank Transfer — collected amounts (counts in brackets)</div>
            <div className="mt-4"><DonutChart data={methodSlices} /></div>
          </div>
          <div className="card p-5">
            <div className="font-semibold text-navy-900">Expenses by Category</div>
            <div className="text-xs text-slate-500 mt-1">Approved + paid only — pending approval excluded</div>
            <div className="mt-4"><DonutChart data={catSlices} /></div>
          </div>
        </div>
        <div className="mt-4 card p-5">
          <div className="font-semibold text-navy-900">Student Fees by Course</div>
          <div className="text-xs text-slate-500 mt-1">Receivable split into collected vs pending per course</div>
          <div className="mt-4"><GroupedBarChart groups={courseGroups} /></div>
        </div>
        <div className="mt-4 card p-5">
          <div className="font-semibold text-navy-900">Collections vs Expenses — Last 6 Months</div>
          <div className="text-xs text-slate-500 mt-1">Collected fees vs approved + paid expenses per month</div>
          <div className="mt-4"><GroupedBarChart groups={monthGroups} height={180} /></div>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5"><div className="font-semibold text-navy-900">Recent Payments</div><div className="mt-3 grid gap-2">{payments.slice(0, 5).map((p: any) => (<div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50"><div><div className="text-sm font-medium text-navy-900">{p.student} • {p.course}</div><div className="text-xs text-slate-500">{p.paymentMethod} • {p.status} • ₹{p.amount.toLocaleString("en-IN")}</div></div><span className={`text-xs px-2 py-1 rounded-full border ${p.collected ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>{p.collected ? "Collected" : "Pending"}</span></div>))}{payments.length === 0 && <div className="text-sm text-slate-500">No payments yet</div>}</div></div>
        <div className="card p-5"><div className="font-semibold text-navy-900">Top Payables (AP)</div><div className="mt-3 grid gap-2">{expenses.slice(0, 5).map((e: any) => (<div key={e.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200"><div><div className="text-sm font-medium text-navy-900">{e.title}</div><div className="text-xs text-slate-500">{e.category} • {e.vendor} • Due {e.dueDate}</div></div><span className={`text-xs px-2 py-1 rounded-full border ${e.status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>₹{e.amount.toLocaleString("en-IN")} • {e.status}</span></div>))}{expenses.length === 0 && <div className="text-sm text-slate-500">No expenses</div>}</div></div>
      </div>
    </div>
  );
}

function PaymentsTab() {
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState<"all" | "collected" | "pending">("all");
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<string>("new");
  const [newPay, setNewPay] = useState({ name: "", phone: "", email: "", course: "SI", medium: "Telugu", mode: "Offline", amount: 0, paidAmount: 0, dueDate: "", paymentMethod: "cash", transactionId: "", password: "", fatherName: "", address: "", branch: "Warangal", courseType: "Regular" });
  const load = () => fetch("/api/admin/payments", { credentials: "same-origin" }).then((r) => r.json()).then((d) => setData(d)).catch(() => {});
  const loadStudents = () => fetch("/api/admin/students", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setStudents(d)).catch(() => {});
  useEffect(() => { load(); loadStudents(); }, []);
  useEffect(() => {
    if (selectedStudent === "new") {
      setNewPay({ name: "", phone: "", email: "", course: "SI", medium: "Telugu", mode: "Offline", amount: 0, paidAmount: 0, dueDate: "", paymentMethod: "cash", transactionId: "", password: "", fatherName: "", address: "", branch: "Warangal", courseType: "Regular" });
    } else {
      const s = students.find((x) => x.id === selectedStudent);
      if (s) setNewPay({ name: s.name, phone: s.phone, email: s.email, course: s.course, medium: s.medium, mode: s.mode, amount: 0, paidAmount: 0, dueDate: "", paymentMethod: "cash", transactionId: "", password: "", fatherName: s.fatherName || "", address: s.address || "", branch: s.branch || "Warangal", courseType: s.courseType || "Regular" });
    }
  }, [selectedStudent, students]);
  const create = async () => {
    if (!newPay.name.trim() || !newPay.phone.trim() || !newPay.email.trim() || !newPay.amount) return alert("Name, phone, email, amount required");
    if (selectedStudent === "new" && !newPay.password.trim()) {
      // for new student, password will be auto-generated if not provided, but require at least 6 if provided
      // allow auto generation
    }
    const payload: any = { ...newPay, studentId: selectedStudent, createStudent: selectedStudent === "new", password: newPay.password };
    const r = await fetch("/api/admin/payments", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (r.ok) {
      if (d.studentId && selectedStudent === "new") alert(`Payment added! Student created: ${d.generatedPassword ? `Password: ${d.generatedPassword}` : ""}. Check Students tab.`);
      setNewPay({ name: "", phone: "", email: "", course: "SI", medium: "Telugu", mode: "Offline", amount: 0, paidAmount: 0, dueDate: "", paymentMethod: "cash", transactionId: "", password: "", fatherName: "", address: "", branch: "Warangal", courseType: "Regular" }); setSelectedStudent("new"); setShowAdd(false); load(); loadStudents();
    } else alert(d.error || "Failed");
  };
  if (!data) return <div className="text-sm text-slate-500">Loading payments…</div>;
  const payments = data.payments.filter((p: any) => {
    const okFilter = filter === "all" || (filter === "collected" ? p.collected : !p.collected);
    const okQ = !q || `${p.student} ${p.email} ${p.phone} ${p.course} ${p.transactionId || ""}`.toLowerCase().includes(q.toLowerCase());
    return okFilter && okQ;
  });
  return (
    <div className="card p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="font-semibold text-navy-900">Payments • ₹{data.totals.totalCollected.toLocaleString("en-IN")} collected / ₹{data.totals.totalReceivable.toLocaleString("en-IN")} receivable</h2>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student, txn…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-32" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="px-3 py-2 rounded-full border border-slate-200 text-sm"><option value="all">All</option><option value="collected">Collected</option><option value="pending">Pending</option></select>
          <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 rounded-full bg-navy-900 text-white text-sm">{showAdd ? "Close" : "+ Add Payment"}</button>
        </div>
      </div>
      {showAdd && (
        <div className="mt-4 p-4 rounded-2xl border border-slate-200 bg-slate-50 grid gap-3">
          <div>
            <label className="text-xs font-medium text-slate-700">Student *</label>
            <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white">
              <option value="new">+ New Student — enter details below</option>
              {students.map((s: any) => (
                <option key={s.id} value={s.id}>{s.name} • {s.email} • {s.phone} • {s.course}</option>
              ))}
            </select>
            <div className="text-xs text-slate-500 mt-1">{selectedStudent === "new" ? "New student will be auto-created in Students tab (password required)" : "Existing student — payment will be linked, student auto-created if missing"}</div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <input value={newPay.name} onChange={(e) => setNewPay({ ...newPay, name: e.target.value })} placeholder="Student Name *" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={newPay.phone} onChange={(e) => setNewPay({ ...newPay, phone: e.target.value })} placeholder="Phone * (10 digits)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={newPay.email} onChange={(e) => setNewPay({ ...newPay, email: e.target.value })} placeholder="Email *" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          {selectedStudent === "new" && (
            <div className="grid sm:grid-cols-3 gap-2">
              <input value={newPay.fatherName} onChange={(e) => setNewPay({ ...newPay, fatherName: e.target.value })} placeholder="Father Name" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              <input value={newPay.address} onChange={(e) => setNewPay({ ...newPay, address: e.target.value })} placeholder="Address" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              <input value={newPay.password} onChange={(e) => setNewPay({ ...newPay, password: e.target.value })} placeholder="Password * (for new student, min 6)" type="password" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            </div>
          )}
          <div className="grid sm:grid-cols-4 gap-2">
            <select value={newPay.course} onChange={(e) => setNewPay({ ...newPay, course: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>SI</option><option>Constable</option><option>Groups</option><option>SSC GD</option><option>Defence</option><option>UPSC</option></select>
            <select value={newPay.medium} onChange={(e) => setNewPay({ ...newPay, medium: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Telugu</option><option>English</option></select>
            <select value={newPay.mode} onChange={(e) => setNewPay({ ...newPay, mode: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Residential</option><option>Offline</option><option>Online</option></select>
            <input type="number" value={newPay.amount} onChange={(e) => setNewPay({ ...newPay, amount: Number(e.target.value) })} placeholder="Amount * (₹)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div><label className="text-xs text-slate-500">Paid Amount (₹) — leave 0 for full</label><input type="number" value={newPay.paidAmount} onChange={(e) => setNewPay({ ...newPay, paidAmount: Number(e.target.value) })} placeholder="e.g., 10000" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Due Date (future dues)</label><input type="date" value={newPay.dueDate} onChange={(e) => setNewPay({ ...newPay, dueDate: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <select value={newPay.paymentMethod} onChange={(e) => setNewPay({ ...newPay, paymentMethod: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank Transfer</option></select>
            <input value={newPay.transactionId} onChange={(e) => setNewPay({ ...newPay, transactionId: e.target.value })} placeholder="Transaction ID (for UPI/Bank)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="text-xs text-slate-500">Balance = Amount - Paid. If Paid &lt; Amount, shows as future dues with due date.</div>
          <button onClick={create} className="btn-primary justify-center">Add Payment →</button>
        </div>
      )}
      <div className="mt-4 overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-slate-500 border-b"><th className="text-left py-2">Student</th><th className="text-left">Course</th><th className="text-left">Method</th><th className="text-left">Txn</th><th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th className="text-center">Due</th><th className="text-center">Status</th></tr></thead>
          <tbody>
            {payments.map((p: any) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-slate-50">
                <td className="py-3"><div className="font-medium text-navy-900">{p.student}</div><div className="text-xs text-slate-500">{p.email} • {p.phone}</div></td>
                <td>{p.course} • {p.mode}</td>
                <td className="capitalize">{p.paymentMethod} {p.screenshot ? "• 📎" : ""}</td>
                <td className="text-xs">{p.transactionId || "—"}</td>
                <td className="text-right font-medium">₹{p.amount.toLocaleString("en-IN")}</td>
                <td className="text-right text-emerald-700">₹{p.paidAmount.toLocaleString("en-IN")}</td>
                <td className={`text-right font-bold ${p.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>₹{p.balance.toLocaleString("en-IN")}</td>
                <td className="text-center text-xs">{p.dueDate ? new Date(p.dueDate).toLocaleDateString("en-IN") : "—"}</td>
                <td className="text-center"><span className={`px-2 py-1 rounded-full text-xs border ${p.balance === 0 ? "bg-emerald-50 border-emerald-200 text-emerald-700" : p.balance < p.amount ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-red-50 border-red-200 text-red-700"}`}>{p.balance === 0 ? "paid" : p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <div className="text-center py-8 text-sm text-slate-500">No payments match</div>}
        <div className="mt-3 text-xs text-slate-500">Balance = Future dues — Amount - Paid. Use AR dashboard for total pending.</div>
      </div>
    </div>
  );
}

function StudentsTab() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [pw, setPw] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [newStu, setNewStu] = useState({ name: "", fatherName: "", email: "", phone: "", address: "", branch: "Warangal", course: "SI", courseType: "Regular", medium: "Telugu", mode: "Residential", password: "" });
  const [branchOptions, setBranchOptions] = useState<string[]>(["Warangal", "Hyderabad", "Hanamkonda", "Bollikunta (Residential)"]);
  const [courseOptions, setCourseOptions] = useState<string[]>(["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC"]);
  const [mediumOptions, setMediumOptions] = useState<string[]>(["Telugu", "English"]);
  const load = () => fetch("/api/admin/students", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/branches").then((r) => r.json()).then((d) => Array.isArray(d) && setBranchOptions(d.map((b: any) => b.name))).catch(() => {});
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const title: string = String(c.title || "");
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          return String(c.slug || title).trim();
        }).filter(Boolean);
        setCourseOptions(Array.from(new Set(opts)));
      }
    }).catch(() => {});
    fetch("/api/mediums").then((r) => r.json()).then((d) => Array.isArray(d) && setMediumOptions(d.map((m: any) => m.name))).catch(() => {});
  }, []);
  const act = async (id: string, action: string, extra: any = {}) => {
    const r = await fetch("/api/admin/students", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
    const data = await r.json();
    if (r.ok) load();
    else alert(data.error || "Failed");
  };
  const create = async () => {
    if (!newStu.name.trim() || !newStu.email.trim() || !newStu.phone.trim() || !newStu.password.trim()) return alert("Name, email, phone, password required");
    const r = await fetch("/api/admin/students", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...newStu }) });
    const data = await r.json();
    if (r.ok) { setNewStu({ name: "", fatherName: "", email: "", phone: "", address: "", branch: "Warangal", course: "SI", courseType: "Regular", medium: "Telugu", mode: "Residential", password: "" }); setShowAdd(false); load(); }
    else alert(data.error || "Failed");
  };
  const filtered = list.filter((u) => !q || `${u.name} ${u.email} ${u.phone} ${u.course}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-navy-900">Students • {list.length} accounts</h2>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-40" />
          <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 rounded-full bg-navy-900 text-white text-sm">{showAdd ? "Close" : "+ Add Student"}</button>
        </div>
      </div>
      {showAdd && (
        <div className="mt-4 p-4 rounded-2xl border border-slate-200 bg-slate-50 grid gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={newStu.name} onChange={(e) => setNewStu({ ...newStu, name: e.target.value })} placeholder="Full Name *" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={newStu.fatherName} onChange={(e) => setNewStu({ ...newStu, fatherName: e.target.value })} placeholder="Father Name" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <input value={newStu.email} onChange={(e) => setNewStu({ ...newStu, email: e.target.value })} placeholder="Email * (login ID)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <input value={newStu.phone} onChange={(e) => setNewStu({ ...newStu, phone: e.target.value })} placeholder="Phone * (10 digits)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <input value={newStu.address} onChange={(e) => setNewStu({ ...newStu, address: e.target.value })} placeholder="Address" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid sm:grid-cols-3 gap-2">
            <select value={newStu.branch} onChange={(e) => setNewStu({ ...newStu, branch: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <select value={newStu.course} onChange={(e) => setNewStu({ ...newStu, course: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input value={newStu.password} onChange={(e) => setNewStu({ ...newStu, password: e.target.value })} placeholder="Password * (min 6)" type="password" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <select value={newStu.courseType} onChange={(e) => setNewStu({ ...newStu, courseType: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Regular</option><option>Crash</option><option>Weekend</option><option>Online</option></select>
            <select value={newStu.medium} onChange={(e) => setNewStu({ ...newStu, medium: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{mediumOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <select value={newStu.mode} onChange={(e) => setNewStu({ ...newStu, mode: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Residential</option><option>Offline</option><option>Online</option></select>
          </div>
          <button onClick={create} className="btn-primary justify-center">Create Student →</button>
        </div>
      )}
      <div className="mt-4 grid gap-3">
        {filtered.map((u) => (
          <div key={u.id} className="p-4 rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-navy-900">{u.name} <span className={`ml-2 text-xs px-2 py-1 rounded-full border ${u.active === false ? "bg-red-50 border-red-200 text-red-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{u.active === false ? "disabled" : "active"}</span></div>
                <div className="text-xs text-slate-600 mt-1">{u.email} • {u.phone} • {u.course} • {u.medium} • {u.mode}</div>
                <div className="text-xs text-slate-400">Created {new Date(u.createdAt).toLocaleDateString("en-IN")} • {u.id}</div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => act(u.id, "toggleActive", { active: u.active === false ? true : false })} className="px-3 py-1.5 rounded-full border text-xs bg-white hover:bg-slate-50">{u.active === false ? "Enable" : "Disable"}</button>
                <button onClick={() => { if (confirm(`Delete ${u.email}?`)) act(u.id, "delete"); }} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">Delete</button>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={pw[u.id] || ""} onChange={(e) => setPw({ ...pw, [u.id]: e.target.value })} placeholder="New password (min 6)" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm" />
              <button onClick={() => act(u.id, "resetPassword", { password: pw[u.id] })} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">Reset PW</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No students</div>}
      </div>
    </div>
  );
}

function FinanceTab() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any>(null);
  const [form, setForm] = useState({ title: "", category: "Rent", amount: 0, dueDate: new Date().toISOString().slice(0, 10), status: "pending", vendor: "", notes: "" });
  const loadExp = () => fetch("/api/admin/expenses", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setExpenses(d)).catch(() => {});
  const loadPay = () => fetch("/api/admin/payments", { credentials: "same-origin" }).then((r) => r.json()).then((d) => setPayments(d)).catch(() => {});
  useEffect(() => { loadExp(); loadPay(); }, []);
  const save = async () => {
    if (!form.title || !form.amount) return alert("Title and amount required");
    const r = await fetch("/api/admin/expenses", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setForm({ title: "", category: "Rent", amount: 0, dueDate: new Date().toISOString().slice(0, 10), status: "pending", vendor: "", notes: "" }); loadExp(); }
  };
  const togglePaid = async (e: any) => {
    await fetch("/api/admin/expenses", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...e, status: e.status === "paid" ? "pending" : "paid" }) });
    loadExp();
  };
  const del = async (id: string) => {
    if (!confirm("Delete expense?")) return;
    await fetch(`/api/admin/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    loadExp();
  };
  const totalReceivable = payments?.totals?.totalReceivable || 0;
  const totalCollected = payments?.totals?.totalCollected || 0;
  const approvedExpenses = expenses.filter((e: any) => ["approved", "paid"].includes(e.status));
  const totalPayable = approvedExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const paidPayable = expenses.filter((e: any) => e.status === "paid").reduce((s: number, e: any) => s + Number(e.amount), 0);
  const pendingApproval = expenses.filter((e: any) => e.status === "pending").reduce((s: number, e: any) => s + Number(e.amount), 0);
  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7">
        <div className="card p-6">
          <h3 className="font-semibold text-navy-900">AR — Accounts Receivable (Fees)</h3>
          <div className="mt-4 grid sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-slate-50 border"><div className="text-xs text-slate-500">Receivable</div><div className="text-lg font-bold text-navy-900">₹{totalReceivable.toLocaleString("en-IN")}</div></div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200"><div className="text-xs text-emerald-700">Collected</div><div className="text-lg font-bold text-emerald-700">₹{totalCollected.toLocaleString("en-IN")}</div></div>
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200"><div className="text-xs text-amber-700">Pending</div><div className="text-lg font-bold text-amber-700">₹{(totalReceivable - totalCollected).toLocaleString("en-IN")}</div></div>
          </div>
          <div className="mt-4 text-xs text-slate-500">Receivable = sum of all admission fees (course+mode). Collected = approved admissions (or UPI/Bank with txn). Pending = Receivable - Collected.</div>
        </div>
        <div className="card p-6 mt-4">
          <h3 className="font-semibold text-navy-900">AP — Accounts Payable (Expenses)</h3>
          <div className="mt-3 grid gap-2 max-h-[50vh] overflow-auto pr-1">
            {expenses.map((e) => (
              <div key={e.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3 bg-white">
                <div><div className="text-sm font-medium text-navy-900">{e.title}</div><div className="text-xs text-slate-500">{e.category} • {e.vendor} • Due {e.dueDate} • ₹{e.amount.toLocaleString("en-IN")}</div></div>
                <div className="flex gap-1">
                  <button onClick={() => togglePaid(e)} className={`px-3 py-1.5 rounded-full text-xs border ${e.status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>{e.status}</button>
                  <button onClick={() => del(e.id)} className="px-2 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">✕</button>
                </div>
              </div>
            ))}
            {expenses.length === 0 && <div className="text-sm text-slate-500">No payables</div>}
          </div>
        </div>
      </div>
      <div className="lg:col-span-5 card p-6 h-fit">
        <h3 className="font-semibold text-navy-900">Add Payable (AP)</h3>
        <div className="mt-4 grid gap-3">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title (e.g., Campus Rent - Sep)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Rent</option><option>Faculty</option><option>Utilities</option><option>Marketing</option><option>Maintenance</option><option>Other</option></select>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} placeholder="Amount" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option value="pending">pending</option><option value="paid">paid</option></select>
          </div>
          <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Vendor / Payee" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <button onClick={save} className="btn-primary justify-center">Add Payable →</button>
          <div className="p-3 rounded-xl bg-slate-50 border text-xs text-slate-600"><b>Net:</b> ₹{(totalCollected - totalPayable).toLocaleString("en-IN")} (Collected - Approved Payable) • Paid: ₹{paidPayable.toLocaleString("en-IN")} • Due: ₹{(totalPayable - paidPayable).toLocaleString("en-IN")} • <span className="text-amber-700">Pending Approval: ₹{pendingApproval.toLocaleString("en-IN")}</span> • Use Expense Tracker for detailed tracker (paid by/via/date → super_admin approval)</div>
        </div>
      </div>
    </div>
  );
}

function LeadsTab() {
  const [list, setList] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "new" | "contacted" | "converted">("all");
  const [q, setQ] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ notes: "", freeText: "", employeeName: "", dueDate: "", status: "new" });
  const load = () => fetch("/api/admin/leads", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => { load(); }, []);
  const update = async (id: string, patch: any) => {
    await fetch("/api/admin/leads", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
    load();
  };
  const del = async (id: string) => {
    if (!confirm("Delete lead?")) return;
    await fetch(`/api/admin/leads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };
  const startEdit = (x: any) => {
    setEditId(x.id);
    setEditForm({
      notes: x.notes || "",
      freeText: x.freeText || "",
      employeeName: x.employeeName || "",
      dueDate: x.dueDate ? new Date(x.dueDate).toISOString().slice(0, 10) : "",
      status: x.status,
    });
  };
  const saveEdit = async () => {
    if (!editId) return;
    await update(editId, {
      notes: editForm.notes,
      freeText: editForm.freeText,
      employeeName: editForm.employeeName,
      dueDate: editForm.dueDate || null,
      status: editForm.status,
    });
    setEditId(null);
  };
  const exportCsv = () => {
    const headers = ["id", "name", "phone", "course", "medium", "mode", "status", "employeeName", "lastActionAt", "dueDate", "notes", "freeText", "createdAt"];
    const rows = list.map((x) => headers.map((h) => {
      let v = x[h] ?? "";
      if (h === "lastActionAt" || h === "dueDate" || h === "createdAt") v = v ? new Date(v).toLocaleString("en-IN") : "";
      v = String(v).replace(/"/g, '""');
      return `"${v}"`;
    }).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const exportXlsx = () => {
    // Excel-compatible CSV with BOM
    const headers = ["Name", "Phone", "Course", "Medium", "Mode", "Status", "Employee", "Last Action", "Due Date", "Notes", "Free Text", "Created"];
    const rows = list.map((x) => [
      x.name, x.phone, x.course || "", x.medium || "", x.mode || "", x.status,
      x.employeeName || "", x.lastActionAt ? new Date(x.lastActionAt).toLocaleString("en-IN") : "",
      x.dueDate ? new Date(x.dueDate).toLocaleDateString("en-IN") : "",
      (x.notes || "").replace(/\n/g, " "), (x.freeText || "").replace(/\n/g, " "),
      x.createdAt ? new Date(x.createdAt).toLocaleString("en-IN") : "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return alert("Empty or invalid file");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    const idx = (name: string) => headers.indexOf(name);
    const get = (cols: string[], name: string) => {
      const i = idx(name);
      if (i === -1) return "";
      return (cols[i] || "").replace(/^"|"$/g, "").trim();
    };
    const parseCsvLine = (line: string) => {
      const cols: string[] = [];
      let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === "," && !inQ) { cols.push(cur); cur = ""; continue; }
        cur += ch;
      }
      cols.push(cur);
      return cols;
    };
    const leads: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const name = get(cols, "name") || get(cols, "Name");
      const phone = get(cols, "phone") || get(cols, "Phone");
      if (!name || !phone) continue;
      leads.push({
        name, phone,
        course: get(cols, "course") || get(cols, "Course"),
        medium: get(cols, "medium") || get(cols, "Medium"),
        mode: get(cols, "mode") || get(cols, "Mode"),
        status: get(cols, "status") || get(cols, "Status") || "new",
        employeeName: get(cols, "employee") || get(cols, "employeename") || "",
        notes: get(cols, "notes") || "",
        freeText: get(cols, "freetext") || get(cols, "free text") || get(cols, "freeText") || "",
        dueDate: get(cols, "due date") || get(cols, "duedate") || null,
      });
    }
    if (leads.length === 0) return alert("No valid rows found (need name, phone)");
    if (!confirm(`Import ${leads.length} lead(s)? Existing phones will be skipped.`)) return;
    const r = await fetch("/api/admin/leads", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leads }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { alert(`Imported ${d.imported} lead(s)`); load(); }
    else alert(d.error || "Import failed");
    e.target.value = "";
  };

  const fmtLastAction = (v: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  const fmtDue = (v: string | null) => {
    if (!v) return "—";
    const d = new Date(v);
    const isOverdue = d.getTime() < Date.now() && d.toDateString() !== new Date().toDateString();
    return <span className={isOverdue ? "text-red-600 font-medium" : ""}>{d.toLocaleDateString("en-IN")}{isOverdue ? " • Overdue" : ""}</span>;
  };

  const filtered = list.filter((x) => {
    const fOk = filter === "all" || x.status === filter;
    const qOk = !q || `${x.name} ${x.phone} ${x.employeeName || ""} ${x.notes || ""}`.toLowerCase().includes(q.toLowerCase());
    return fOk && qOk;
  });

  return (
    <div className="card p-4 sm:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">Leads • {list.length} <span className="font-normal text-slate-500">— tabular</span></h2>
          <div className="text-xs text-slate-500 mt-1">From Home → “Find your batch” → Join (name + mobile). Add notes, assign employee, set due date.</div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, employee…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-44" />
          <label className="px-3 py-2 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50 cursor-pointer">Import CSV/Excel<input type="file" accept=".csv,.xls,.xlsx" onChange={onImport} className="hidden" /></label>
          <button onClick={exportCsv} className="px-3 py-2 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50">Export CSV</button>
          <button onClick={exportXlsx} className="px-3 py-2 rounded-full bg-navy-900 text-white text-xs">Export Excel</button>
        </div>
      </div>

      <div className="mt-3 flex gap-1 flex-wrap">
        {(["all", "new", "contacted", "converted"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-full text-xs border capitalize ${filter === f ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>{f} ({f === "all" ? list.length : list.filter((x) => x.status === f).length})</button>
        ))}
        <span className="ml-2 text-xs text-slate-500 self-center">Showing {filtered.length}</span>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-auto border border-slate-200 rounded-2xl">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Name / Phone</th>
              <th className="text-left px-3 py-2 font-semibold">Course</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
              <th className="text-left px-3 py-2 font-semibold">Employee</th>
              <th className="text-left px-3 py-2 font-semibold">Last Action</th>
              <th className="text-left px-3 py-2 font-semibold">Due Date</th>
              <th className="text-left px-3 py-2 font-semibold">Notes</th>
              <th className="text-left px-3 py-2 font-semibold">Free Text</th>
              <th className="text-center px-3 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((x) => (
              <tr key={x.id} className="hover:bg-slate-50/70">
                <td className="px-3 py-2">
                  <div className="font-medium text-navy-900">{x.name}</div>
                  <a href={`tel:${x.phone}`} className="text-xs text-sky-700 hover:underline">{x.phone}</a>
                  <div className="text-[11px] text-slate-400">{new Date(x.createdAt).toLocaleDateString("en-IN")}</div>
                </td>
                <td className="px-3 py-2 text-xs">{x.course || "—"}<div className="text-slate-500">{x.medium} • {x.mode}</div></td>
                <td className="px-3 py-2">
                  {editId === x.id ? (
                    <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="px-2 py-1 rounded-full border text-xs bg-white">
                      <option value="new">new</option><option value="contacted">contacted</option><option value="converted">converted</option>
                    </select>
                  ) : (
                    <span className={`px-2 py-1 rounded-full border text-xs ${x.status === "new" ? "bg-amber-50 border-amber-200 text-amber-700" : x.status === "contacted" ? "bg-sky-50 border-sky-200 text-sky-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{x.status}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editId === x.id ? (
                    <input value={editForm.employeeName} onChange={(e) => setEditForm({ ...editForm, employeeName: e.target.value })} placeholder="Employee name" className="w-28 px-2 py-1 rounded-lg border text-xs" />
                  ) : (
                    <span className="text-xs">{x.employeeName || <span className="text-slate-400">—</span>}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtLastAction(x.lastActionAt || x.updatedAt)}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {editId === x.id ? (
                    <input type="date" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} className="px-2 py-1 rounded-lg border text-xs" />
                  ) : (
                    fmtDue(x.dueDate)
                  )}
                </td>
                <td className="px-3 py-2 max-w-[160px]">
                  {editId === x.id ? (
                    <input value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} placeholder="Notes" className="w-full px-2 py-1 rounded-lg border text-xs" />
                  ) : (
                    <span className="text-xs line-clamp-2" title={x.notes}>{x.notes || <span className="text-slate-400">—</span>}</span>
                  )}
                </td>
                <td className="px-3 py-2 max-w-[160px]">
                  {editId === x.id ? (
                    <textarea value={editForm.freeText} onChange={(e) => setEditForm({ ...editForm, freeText: e.target.value })} placeholder="Free text" rows={2} className="w-full px-2 py-1 rounded-lg border text-xs" />
                  ) : (
                    <span className="text-xs line-clamp-2" title={x.freeText}>{x.freeText || <span className="text-slate-400">—</span>}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-center">
                    {editId === x.id ? (
                      <>
                        <button onClick={saveEdit} className="px-2 py-1 rounded-full bg-emerald-600 text-white text-xs">Save</button>
                        <button onClick={() => setEditId(null)} className="px-2 py-1 rounded-full bg-white border text-xs">Cancel</button>
                      </>
                    ) : (
                      <>
                        <a href={`tel:${x.phone}`} className="w-7 h-7 rounded-full bg-emerald-600 text-white grid place-items-center text-xs" title="Call">☎</a>
                        <button onClick={() => startEdit(x)} className="w-7 h-7 rounded-full bg-white border grid place-items-center text-xs" title="Edit">✎</button>
                        <button onClick={() => del(x.id)} className="w-7 h-7 rounded-full bg-red-50 border border-red-200 text-red-700 grid place-items-center text-xs">✕</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-sm text-slate-500 text-center py-8">No {filter} leads — try import or wait for home Joins.</div>}
      </div>

      <div className="mt-3 text-xs text-slate-500">Tip: Employee = assigned counsellor. Last Action auto-updates on any edit. Due Date highlights overdue in red. Export includes all columns for Excel.</div>
    </div>
  );
}

function AlumniTab() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [courseOptions, setCourseOptions] = useState<string[]>(["Constable", "SI", "Groups", "SSC GD", "Defence", "UPSC", "General"]);
  const [form, setForm] = useState({ id: "", name: "", role: "", batch: "", course: "Constable", quote: "", video: "", image: "", featured: false });
  const [editing, setEditing] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const load = () => fetch("/api/admin/alumni", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const title: string = String(c.title || "");
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          return String(c.slug || title).trim();
        }).filter(Boolean);
        const uniq = Array.from(new Set(opts));
        if (uniq.length > 0) setCourseOptions(uniq);
      }
    }).catch(() => {});
  }, []);
  const filtered = list.filter((a: any) => {
    if (!q) return true;
    const qq = q.toLowerCase();
    const hay = [a.name, a.role, a.batch, a.course, a.quote, a.video].join(" ").toLowerCase();
    return hay.includes(qq);
  });
  const uploadImage = async (f: File | undefined) => {
    if (!f) return;
    setUploadErr("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return setUploadErr("Only JPG, PNG or WEBP allowed");
    if (f.size > 2 * 1024 * 1024) return setUploadErr("Image must be under 2MB");
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/admin/alumni/upload", { credentials: "same-origin",  method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setUploading(false);
    if (r.ok && d.url) setForm({ ...form, image: d.url });
    else setUploadErr(d.error || "Upload failed");
  };
  const save = async () => {
    if (!form.name.trim() || !form.quote.trim()) return alert("Name and quote required");
    const r = await fetch("/api/admin/alumni", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setForm({ id: "", name: "", role: "", batch: "", course: "Constable", quote: "", video: "", image: "", featured: false }); setEditing(null); setUploadErr(""); load(); }
    else alert("Failed");
  };
  const del = async (id: string) => {
    if (!confirm("Delete alumni?")) return;
    await fetch(`/api/admin/alumni?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };
  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 card p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div><h2 className="font-semibold text-navy-900">Alumni • {filtered.length}/{list.length}</h2><p className="text-xs text-slate-500">From https://ayaaninstitute.in/ — manages /alumni page</p></div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, course…" className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white min-w-[180px]" />
        </div>
        <div className="mt-4 grid gap-3 max-h-[70vh] overflow-auto pr-1">
          {filtered.length === 0 ? <div className="text-sm text-slate-500 text-center py-8">No testimonials match.</div> : filtered.map((a) => (
            <div key={a.id} className="p-4 rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  {a.image ? <img src={a.image} alt={a.name} className="w-10 h-10 rounded-full object-cover border border-slate-200 shrink-0" /> : <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 grid place-items-center text-xs font-bold text-slate-500 shrink-0">{a.name[0]}</div>}
                  <div>
                  <div className="text-sm font-semibold text-navy-900">{a.name} <span className="text-xs font-normal text-slate-500">• {a.role}</span> {a.featured && <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">Featured</span>}</div>
                  <div className="text-xs text-slate-500 mt-1">{a.batch} • {a.course} • {a.createdAt}</div>
                  <div className="text-sm text-slate-700 mt-2 line-clamp-2">“{a.quote}”</div>
                  {a.video && <div className="text-xs text-sky-700 mt-1 truncate">▶ {a.video}</div>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => { setEditing(a.id); setForm({ id: a.id, name: a.name, role: a.role, batch: a.batch, course: a.course, quote: a.quote, video: a.video, image: a.image, featured: !!a.featured }); }} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs">Edit</button>
                  <button onClick={() => del(a.id)} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-5 card p-6 h-fit sticky top-[88px]">
        <h3 className="font-semibold text-navy-900">{editing ? `Edit: ${editing}` : "Add Alumni"}</h3>
        <div className="mt-4 grid gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name *" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Role (e.g., Constable — Selected)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} placeholder="Batch (e.g., 2020 • Warangal)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <select value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}<option>General</option></select>
          </div>
          <textarea value={form.quote} onChange={(e) => setForm({ ...form, quote: e.target.value })} placeholder="Quote * — testimonial text" rows={4} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <input value={form.video} onChange={(e) => setForm({ ...form, video: e.target.value })} placeholder="YouTube link (e.g., https://www.youtube.com/watch?v=...)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div>
            <label className="text-xs font-medium text-slate-700">Alumni photo — upload (JPG/PNG/WEBP, max 2MB)</label>
            <div className="mt-1 flex items-center gap-3">
              {form.image ? (
                <img src={form.image} alt="preview" className="w-14 h-14 rounded-full object-cover border border-slate-200" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-slate-100 border border-slate-200 grid place-items-center text-xs text-slate-400">No img</div>
              )}
              <label className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50 cursor-pointer">
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadImage(e.target.files?.[0])} className="hidden" />
                {uploading ? "Uploading…" : form.image ? "Replace image…" : "Upload image…"}
              </label>
              {form.image && <button onClick={() => setForm({ ...form, image: "" })} className="text-xs text-red-600 hover:underline">Remove</button>}
            </div>
            {uploadErr && <div className="mt-1 text-xs text-red-600">{uploadErr}</div>}
            <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="…or paste image URL" className="mt-2 px-3 py-2.5 rounded-xl border border-slate-200 text-sm w-full" />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured on home</label>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 btn-primary justify-center">{editing ? "Update" : "Add"} Alumni</button>
            <button onClick={() => { setEditing(null); setForm({ id: "", name: "", role: "", batch: "", course: "Constable", quote: "", video: "", image: "", featured: false }); }} className="px-4 py-2.5 rounded-full border border-slate-200 text-sm">Clear</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreStockTab() {
  const [list, setList] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [form, setForm] = useState({ id: "", name: "", price: 0, category: "Gear", stock: 0, threshold: 5, sku: "", image: "", sizes: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const load = () => fetch("/api/admin/store", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  useEffect(() => { load(); }, []);
  const categories = Array.from(new Set(list.map((x: any) => x.category).filter(Boolean))) as string[];
  const filtered = list.filter((x: any) => {
    if (catFilter !== "all" && x.category !== catFilter) return false;
    if (q) {
      const qq = q.toLowerCase();
      const hay = [x.name, x.category, x.sku, Array.isArray(x.sizes) ? x.sizes.join(" ") : x.sizes].join(" ").toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  });
  const save = async () => {
    if (!form.name.trim() || !form.price) return alert("Name and price required");
    const r = await fetch("/api/admin/store", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (r.ok) { setForm({ id: "", name: "", price: 0, category: "Gear", stock: 0, threshold: 5, sku: "", image: "", sizes: "" }); setEditing(null); load(); }
  };
  const quick = async (id: string, delta: number) => { await fetch("/api/admin/store", { credentials: "same-origin",  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, delta }) }); load(); };
  const setStock = async (id: string, stock: number) => { await fetch("/api/admin/store", { credentials: "same-origin",  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, stock }) }); load(); };
  const del = async (id: string) => { if (!confirm("Delete item?")) return; await fetch(`/api/admin/store?id=${encodeURIComponent(id)}`, { method: "DELETE" }); load(); };
  const low = list.filter((x) => x.stock > 0 && x.stock <= x.threshold).length;
  const out = list.filter((x) => x.stock === 0).length;
  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Store Stock • {filtered.length}/{list.length} items</h2>
          <div className="flex gap-2 text-xs"><span className="px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">{low} low</span><span className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700">{out} out</span></div>
        </div>
        <div className="mt-3 flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, category, SKU…" className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white" />
          <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white"><option value="all">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        <div className="mt-4 grid gap-3 max-h-[70vh] overflow-auto pr-1">
          {filtered.length === 0 ? <div className="text-sm text-slate-500 text-center py-8">No items match.</div> : filtered.map((it) => (
            <div key={it.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="text-sm font-semibold text-navy-900">{it.name} <span className="text-xs font-normal text-slate-500">• {it.category} • {it.sku}{Array.isArray(it.sizes) && it.sizes.length > 0 ? ` • Sizes: ${it.sizes.join(", ")}` : ""}</span></div>
                <div className="text-sm font-bold text-navy-900">₹{it.price.toLocaleString("en-IN")} • <span className={`text-xs px-2 py-1 rounded-full border ${it.stock === 0 ? "bg-red-50 border-red-200 text-red-700" : it.stock <= it.threshold ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{it.stock === 0 ? "Out" : it.stock <= it.threshold ? `Low: ${it.stock}` : `In: ${it.stock}`}</span></div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => quick(it.id, -1)} className="w-8 h-8 rounded-full border border-slate-200 grid place-items-center hover:bg-slate-50">−</button>
                <input type="number" value={it.stock} onChange={(e) => setStock(it.id, Number(e.target.value))} className="w-16 px-2 py-1 rounded-full border border-slate-200 text-center text-sm" />
                <button onClick={() => quick(it.id, 1)} className="w-8 h-8 rounded-full border border-slate-200 grid place-items-center hover:bg-slate-50">+</button>
                <button onClick={() => { setEditing(it.id); setForm({ id: it.id, name: it.name, price: it.price, category: it.category, stock: it.stock, threshold: it.threshold, sku: it.sku || "", image: it.image || "", sizes: Array.isArray(it.sizes) ? it.sizes.join(", ") : (it.sizes || "") }); }} className="ml-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs">Edit</button>
                <button onClick={() => del(it.id)} className="px-2 py-1.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="lg:col-span-5 card p-6 h-fit">
        <h3 className="font-semibold text-navy-900">{editing ? `Edit: ${editing}` : "Add / Update Item"}</h3>
        <div className="mt-4 grid gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name *" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="grid grid-cols-3 gap-2">
            <input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} placeholder="Price" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Footwear</option><option>Apparel</option><option>Gear</option><option>Equipment</option><option>Fitness</option><option>General</option></select>
            <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="SKU" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-slate-500">Stock</label><input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: Number(e.target.value) })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
            <div><label className="text-xs text-slate-500">Low threshold</label><input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
          </div>
          <input value={form.image} onChange={(e) => setForm({ ...form, image: e.target.value })} placeholder="Image URL (optional)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div>
            <input value={form.sizes} onChange={(e) => setForm({ ...form, sizes: e.target.value })} placeholder="Sizes (optional, e.g., S, M, L, XL, XXL — blank = no size)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm w-full" />
            <div className="text-xs text-slate-400 mt-1">Leave blank for products without sizing. Size is required at checkout when set.</div>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 btn-primary justify-center">{editing ? "Update" : "Add"} Item</button>
            <button onClick={() => { setEditing(null); setForm({ id: "", name: "", price: 0, category: "Gear", stock: 0, threshold: 5, sku: "", image: "", sizes: "" }); }} className="px-4 py-2.5 rounded-full border border-slate-200 text-sm">Clear</button>
          </div>
          <div className="text-xs text-slate-400">Stock 0 = Out of stock (button disabled on store). Low stock shows amber badge.</div>
        </div>
      </div>
    </div>
  );
}

function BannerTab() {
  const [data, setData] = useState({ enabled: false, message: "", type: "info", link: "" });
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetch("/api/admin/banner", { credentials: "same-origin" }).then((r) => r.json()).then((d) => setData({ enabled: !!d.enabled, message: d.message || "", type: d.type || "info", link: d.link || "" })).catch(() => {}); }, []);

  const save = async () => {
    const r = await fetch("/api/admin/banner", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (r.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      // notify banner in all tabs immediately (no 10s wait)
      try {
        localStorage.setItem("ayaan_banner_updated", Date.now().toString());
        window.dispatchEvent(new Event("ayaan_banner_updated"));
        // clear dismissed so new state shows instantly
        if (!data.enabled) {
          sessionStorage.removeItem("ayaan_banner_dismissed");
          sessionStorage.removeItem("ayaan_banner_dismissed_key");
        }
      } catch {}
    }
  };

  const bg = data.type === "urgent" ? "bg-red-600" : data.type === "warning" ? "bg-[#f59e0b]" : data.type === "success" ? "bg-emerald-600" : "bg-navy-900";

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-5 card p-6 h-fit">
        <h2 className="font-semibold text-navy-900">Rolling Banner</h2>
        <p className="text-sm text-slate-500">Toggle on → banner appears site-wide (top). Turn off to hide.</p>

        <div className="mt-6 flex items-center justify-between p-4 rounded-2xl border border-slate-200 bg-slate-50">
          <div>
            <div className="text-sm font-semibold text-navy-900">Banner Enabled</div>
            <div className="text-xs text-slate-500">Only when ON, banner pops up</div>
          </div>
          <button onClick={() => setData({ ...data, enabled: !data.enabled })} className={`w-12 h-7 rounded-full p-1 transition ${data.enabled ? "bg-emerald-500" : "bg-slate-300"}`}>
            <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${data.enabled ? "translate-x-5" : "translate-x-0"}`} />
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-slate-600">Message * (max 300 chars)</label>
          <textarea value={data.message} onChange={(e) => setData({ ...data, message: e.target.value })} placeholder="e.g., Admissions Open for SI & Constable — Free Demo on 1st Sep! Call +91 8886667222" rows={3} maxLength={300} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <div className="text-xs text-slate-400 text-right">{data.message.length}/300</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Type</label>
              <select value={data.type} onChange={(e) => setData({ ...data, type: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">
                <option value="info">info (navy)</option>
                <option value="warning">warning (amber)</option>
                <option value="success">success (green)</option>
                <option value="urgent">urgent (red)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Link (optional)</label>
              <input value={data.link} onChange={(e) => setData({ ...data, link: e.target.value })} placeholder="/contact or https://..." className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            </div>
          </div>

          <button onClick={save} className="btn-primary justify-center">Save Banner →</button>
          {saved && <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl text-center">Saved! Refresh site to see.</div>}
        </div>
      </div>

      <div className="lg:col-span-7">
        <div className="card p-6">
          <div className="text-sm font-semibold text-navy-900">Preview (as on website top)</div>
          <div className={`mt-4 rounded-2xl overflow-hidden border ${data.enabled ? "border-slate-200" : "border-dashed border-slate-300 opacity-60"}`}>
            {data.enabled && data.message ? (
              <div className={`${bg} text-white px-4 py-3 flex items-center gap-3 text-sm`}>
                <span className="hidden sm:inline-flex px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-xs font-semibold">UPDATE</span>
                <span className="flex-1 truncate">{data.message}</span>
                {data.link && <span className="px-3 py-1.5 rounded-full bg-white text-navy-900 text-xs font-semibold hidden sm:inline-flex">View →</span>}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm text-slate-500">{data.enabled ? "Enter a message to preview" : "Banner is OFF — turn on to preview"}</div>
            )}
          </div>
          <div className="mt-4 text-xs text-slate-500">Banner is dismissible per session (X stores in sessionStorage). It reappears on new visit if still enabled.</div>
        </div>

        <div className="card p-6 mt-4">
          <div className="text-sm font-semibold text-navy-900">How it works</div>
          <ul className="mt-2 grid gap-1 text-sm text-slate-600">
            <li>• Banner is fetched from <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">/api/banner</code> on every page load.</li>
            <li>• Only when <b>enabled = true</b> and message non-empty, it renders.</li>
            <li>• No deploy needed — save here, refresh site.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function FeeConfigTab() {
  const [fees, setFees] = useState<any[]>([]);
  const [durations, setDurations] = useState<{ id: string; name: string; months: number }[]>([]);
  const [mediums, setMediums] = useState<{ id?: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id?: string; name: string }[]>([]);
  const [durKey, setDurKey] = useState<string>("");
  const [medKey, setMedKey] = useState<string>("");
  const [brKey, setBrKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [courses, setCourses] = useState<string[]>(["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC"]);
  const modes = ["Residential", "Offline", "Online"] as const;

  const load = async () => {
    setLoading(true);
    try {
      const [fr, dr, mr, br, cr] = await Promise.all([
        fetch("/api/admin/fees", { credentials: "same-origin",  cache: "no-store" }),
        fetch("/api/durations", { cache: "no-store" }),
        fetch("/api/mediums", { cache: "no-store" }),
        fetch("/api/branches", { cache: "no-store" }),
        fetch("/api/courses", { cache: "no-store" }),
      ]);
      const fd = await fr.json();
      if (Array.isArray(fd)) setFees(fd);
      const dd = await dr.json();
      if (Array.isArray(dd)) setDurations(dd);
      const md = await mr.json();
      if (Array.isArray(md)) setMediums(md.map((m: any) => ({ id: m.id, name: m.name })));
      const bd = await br.json();
      if (Array.isArray(bd)) setBranches(bd.map((b: any) => ({ id: b.id, name: b.name })));
      const cd = await cr.json();
      if (Array.isArray(cd) && cd.length > 0) {
        const opts: string[] = cd.map((c: any) => {
          const slug = String(c.slug || "").trim();
          const title: string = String(c.title || "").trim();
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          if (slug) return slug.toUpperCase().replace(/-/g, " ");
          return title;
        }).filter(Boolean);
        const uniq = Array.from(new Set(opts));
        if (uniq.length > 0) setCourses(uniq);
      }
    } catch {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const norm = (v: any) => (v === undefined || v === null ? "" : String(v));
  // Fallback chain for the current picker key: exact → peel branch → peel medium → peel duration → all-base
  const chainFor = (): [string, string, string][] => {
    const chain: [string, string, string][] = [[durKey, medKey, brKey], [durKey, medKey, ""], [durKey, "", ""], ["", "", ""]];
    const seen = new Set<string>();
    return chain.filter(([d, m, b]) => {
      const k = `${d}|${m}|${b}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  // Resolve inherited value for placeholder (first hit below the exact key)
  const inheritedFee = (course: string, mode: string): number | string => {
    const chain = chainFor().slice(1);
    for (const [d, m, b] of chain) {
      const f = fees.find((x) => x.course === course && x.mode === mode && norm(x.duration) === d && norm(x.medium) === m && norm(x.branch) === b);
      if (f) return f.amount;
    }
    return FEE_FALLBACK[course]?.[mode] ?? "";
  };
  const hardcodedFee = (course: string, mode: string): number | string => FEE_FALLBACK[course]?.[mode] ?? "";
  const getFee = (course: string, mode: string) => {
    const f = fees.find((x) => x.course === course && x.mode === mode && norm(x.duration) === durKey && norm(x.medium) === medKey && norm(x.branch) === brKey);
    return f ? f.amount : "";
  };
  const placeholderFor = (course: string, mode: string) => {
    if (durKey === "" && medKey === "" && brKey === "") {
      const h = hardcodedFee(course, mode);
      return h === "" || h === undefined ? "—" : `Base ${Number(h).toLocaleString("en-IN")}`;
    }
    const v = inheritedFee(course, mode);
    return v === "" || v === undefined ? "—" : `Inherits ₹${Number(v).toLocaleString("en-IN")}`;
  };
  const setFee = (course: string, mode: string, amount: string) => {
    const val = amount === "" ? "" : Math.max(0, Number(amount));
    const idx = fees.findIndex((x) => x.course === course && x.mode === mode && norm(x.duration) === durKey && norm(x.medium) === medKey && norm(x.branch) === brKey);
    if (idx >= 0) {
      const next = [...fees];
      next[idx] = { ...next[idx], amount: val === "" ? "" : val };
      setFees(next);
    } else {
      setFees([...fees, { course, mode, duration: durKey, medium: medKey, branch: brKey, amount: val === "" ? "" : val }]);
    }
  };

  const saveAll = async () => {
    setSaving(true);
    // Send the full visible grid for the selected key; blanks delete that row (falls back up the chain)
    const payload = courses.flatMap((course) =>
      modes.map((mode) => {
        const row = fees.find((x) => x.course === course && x.mode === mode && norm(x.duration) === durKey && norm(x.medium) === medKey && norm(x.branch) === brKey);
        const amount = row ? row.amount : "";
        return { course, mode, duration: durKey, medium: medKey, branch: brKey, amount: amount === "" ? null : Number(amount) };
      })
    );
    const r = await fetch("/api/admin/fees", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fees: payload }) });
    setSaving(false);
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); load(); }
    else alert("Failed to save");
  };

  const resetFallback = async () => {
    if (!confirm("Reset BASE fees to defaults? This will overwrite base values (duration overrides are kept).")) return;
    const list: any[] = [];
    for (const c of courses) for (const m of modes) list.push({ course: c, mode: m, duration: "", amount: FEE_FALLBACK[c][m] });
    const r = await fetch("/api/admin/fees", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fees: list }) });
    if (r.ok) { load(); alert("Base fees reset to defaults"); }
  };

  if (loading) return <div className="text-sm text-slate-500">Loading fee config…</div>;

  return (
    <div className="grid gap-6">
      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-navy-900">Fee Config • Per Course × Mode × Duration × Medium × Branch</h2>
            <p className="text-xs text-slate-500 mt-1">Configurable — changes reflect instantly in admission form & student checkout. Only super_admin can save; finance can view.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={resetFallback} className="px-4 py-2 rounded-full border border-slate-200 text-sm hover:bg-slate-50">Reset Base Defaults</button>
            <button onClick={saveAll} disabled={saving} className="px-6 py-2.5 rounded-full bg-navy-900 text-white text-sm font-medium disabled:opacity-50 hover:bg-navy-800">{saving ? "Saving…" : "Save All →"}</button>
          </div>
        </div>
        {saved && <div className="mt-3 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl text-center">✓ Saved! Admission form now uses new fees.</div>}

        <div className="mt-4 flex gap-2 overflow-auto scrollbar-none pb-1">
          <button
            onClick={() => setDurKey("")}
            className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${durKey === "" ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            Base (all durations)
          </button>
          {durations.map((d) => (
            <button
              key={d.id}
              onClick={() => setDurKey(d.name)}
              className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${durKey === d.name ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {d.name}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-2">
          <div className="flex gap-2 items-center overflow-auto scrollbar-none pb-1">
            <span className="text-xs font-semibold text-slate-500 w-16 shrink-0">Medium</span>
            <button
              onClick={() => setMedKey("")}
              className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${medKey === "" ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              Base (all mediums)
            </button>
            {mediums.map((m) => (
              <button
                key={m.id || m.name}
                onClick={() => setMedKey(m.name)}
                className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${medKey === m.name ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {m.name}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center overflow-auto scrollbar-none pb-1">
            <span className="text-xs font-semibold text-slate-500 w-16 shrink-0">Branch</span>
            <button
              onClick={() => setBrKey("")}
              className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${brKey === "" ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              Base (all branches)
            </button>
            {branches.map((b) => (
              <button
                key={b.id || b.name}
                onClick={() => setBrKey(b.name)}
                className={`shrink-0 px-4 py-2 rounded-full border text-sm font-medium transition ${brKey === b.name ? "bg-navy-900 text-white border-navy-900 shadow-sm" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
        {durKey === "" && medKey === "" && brKey === "" ? (
          <div className="mt-2 text-xs text-slate-500">Editing <b>Base</b> fees — used everywhere unless overridden. Clearing a cell removes the row (hardcoded fallback applies). Add mediums/branches in Masters.</div>
        ) : (
          <div className="mt-2 text-xs text-slate-500">Editing overrides for <b>{[durKey || "all durations", medKey || "all mediums", brKey || "all branches"].join(" • ")}</b> — empty cells inherit the value shown as placeholder. Clearing a filled cell deletes the override.</div>
        )}

        <div className="mt-4 overflow-auto border border-slate-200 rounded-2xl">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Course</th>
                {modes.map((m) => (
                  <th key={m} className="text-center px-4 py-3 font-semibold">{m}<div className="font-normal text-slate-400">{m === "Residential" ? "+ Hostel" : m === "Online" ? "60% of Offline" : "Day-scholar"}</div></th>
                ))}
                <th className="text-center px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {courses.map((course) => (
                <tr key={course} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-navy-900">{course}</td>
                  {modes.map((mode) => (
                    <td key={mode} className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-center">
                        <span className="text-slate-400 text-xs">₹</span>
                        <input
                          type="number"
                          min={0}
                          value={getFee(course, mode)}
                          onChange={(e) => setFee(course, mode, e.target.value)}
                          placeholder={placeholderFor(course, mode)}
                          className="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500"
                        />
                      </div>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs text-slate-500">
                      {(() => {
                        const r = Number(getFee(course, "Residential") || 0);
                        const o = Number(getFee(course, "Offline") || 0);
                        if (!r || !o) return "—";
                        return `Diff: +₹${(r - o).toLocaleString("en-IN")}`;
                      })()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-800"><b>Residential:</b> Includes hostel + food + 24×7 study hall (Bollikunta 15 Acres).</div>
          <div className="p-3 rounded-xl bg-slate-50 border text-slate-600"><b>Offline:</b> Day-scholar — Warangal / Hyderabad / Hanamkonda.</div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800"><b>Online:</b> Live + recorded, unlimited rewatch (typically 60% of Offline).</div>
        </div>
        <div className="mt-3 text-xs text-slate-500">Tip: Save All writes the whole visible grid — filled cells upsert, blank cells delete that row (inherited/hardcoded fallback then applies).</div>
      </div>

      <div className="card p-6">
        <h3 className="font-semibold text-navy-900">How it works</h3>
        <ul className="mt-2 grid gap-1 text-sm text-slate-600">
          <li>• Admission form fetches <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">GET /api/fees</code> (public) — no auth, cached no-store.</li>
          <li>• Lookup order per course + mode: exact (duration + medium + branch) → peel branch → peel medium → peel duration → Base → hardcoded fallback.</li>
          <li>• Save All does <code className="px-1 py-0.5 bg-slate-100 rounded text-xs">POST /api/admin/fees {"{ fees: [...] }"}</code> upsert by (course, mode, duration, medium, branch); blanks delete that row.</li>
          <li>• Changes reflect immediately — no redeploy needed.</li>
        </ul>
      </div>
    </div>
  );
}

function ExpenseTrackerTab() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ title: "", category: "General", amount: "", paidBy: "", paymentMethod: "cash", expenseDate: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [role, setRole] = useState<string>("super_admin");
  const load = () => fetch("/api/admin/expenses", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setExpenses(d)).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/admin/login", { credentials: "same-origin" }).then((r) => r.json()).then((d) => setRole(d.role || "super_admin")).catch(() => {});
  }, []);
  const isSuper = role === "super_admin";
  const save = async () => {
    if (!form.title.trim() || !form.amount) return alert("Expense and amount required");
    const r = await fetch("/api/admin/expenses", { credentials: "same-origin", 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: form.title, expense: form.title, category: form.category, amount: Number(form.amount), paidBy: form.paidBy, paymentMethod: form.paymentMethod, expenseDate: form.expenseDate, dueDate: form.dueDate, notes: form.notes }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setForm({ title: "", category: "General", amount: "", paidBy: "", paymentMethod: "cash", expenseDate: new Date().toISOString().slice(0, 10), dueDate: new Date().toISOString().slice(0, 10), notes: "" });
      load();
      if (!isSuper) alert("Submitted for super_admin approval (pending)");
    } else alert(d.error || "Failed");
  };
  const act = async (id: string, action: string) => {
    const r = await fetch("/api/admin/expenses", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    if (r.ok) load();
    else alert("Failed");
  };
  const del = async (id: string) => {
    if (!confirm("Delete expense?")) return;
    await fetch(`/api/admin/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };
  const filtered = expenses.filter((e) => {
    const fOk = filter === "all" || e.status === filter;
    const qOk = !q || `${e.title} ${e.paidBy || ""} ${e.notes || ""} ${e.category}`.toLowerCase().includes(q.toLowerCase());
    return fOk && qOk;
  });
  const totals = {
    pending: expenses.filter((e) => e.status === "pending").reduce((s, e) => s + Number(e.amount), 0),
    approved: expenses.filter((e) => e.status === "approved").reduce((s, e) => s + Number(e.amount), 0),
    paid: expenses.filter((e) => e.status === "paid").reduce((s, e) => s + Number(e.amount), 0),
    total: expenses.reduce((s, e) => s + Number(e.amount), 0),
  };
  // AR/AP relation: Approved expenses count toward AP (payable), pending is awaiting approval
  const apTotal = totals.approved + totals.paid;
  const apPending = totals.pending;

  return (
    <div className="grid gap-6">
      {/* AR/AP summary related */}
      <div className="grid sm:grid-cols-4 gap-3">
        <div className="card p-4"><div className="text-xs text-slate-500">Total Expenses</div><div className="text-xl font-bold text-navy-900">₹{totals.total.toLocaleString("en-IN")}</div><div className="text-xs text-slate-500">{expenses.length} records</div></div>
        <div className="card p-4 border-amber-200 bg-amber-50"><div className="text-xs text-amber-700 font-semibold">Pending Approval</div><div className="text-xl font-bold text-amber-800">₹{totals.pending.toLocaleString("en-IN")}</div><div className="text-xs text-amber-700">{expenses.filter((e) => e.status === "pending").length} awaiting super_admin</div></div>
        <div className="card p-4 border-emerald-200 bg-emerald-50"><div className="text-xs text-emerald-700 font-semibold">Approved (AP)</div><div className="text-xl font-bold text-emerald-800">₹{apTotal.toLocaleString("en-IN")}</div><div className="text-xs text-emerald-700">Counts toward Accounts Payable</div></div>
        <div className="card p-4"><div className="text-xs text-slate-500">Rejected</div><div className="text-xl font-bold text-slate-700">₹{expenses.filter((e) => e.status === "rejected").reduce((s, e) => s + Number(e.amount), 0).toLocaleString("en-IN")}</div></div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 card p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-semibold text-navy-900">Expense Tracker • {expenses.length}</h2>
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search expense, paid by…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-32" />
              <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="px-3 py-2 rounded-full border border-slate-200 text-sm bg-white">
                <option value="all">All</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="paid">Paid</option>
              </select>
            </div>
          </div>
          <div className="mt-1 text-xs text-slate-500">Finance creates → <b>pending</b> → super_admin approves → counts in AR/AP • Super_admin auto-approved</div>

          <div className="mt-4 overflow-auto border border-slate-200 rounded-2xl max-h-[60vh]">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-slate-50 text-xs text-slate-600 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Expense / Category</th>
                  <th className="text-left px-3 py-2">Paid By</th>
                  <th className="text-right px-3 py-2">Amount</th>
                  <th className="text-center px-3 py-2">Via</th>
                  <th className="text-center px-3 py-2">Date</th>
                  <th className="text-center px-3 py-2">Status</th>
                  <th className="text-center px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-navy-900">{e.title}</div>
                      <div className="text-xs text-slate-500">{e.category} • {e.notes ? e.notes.slice(0, 40) : ""} {e.requestedBy ? `• by ${e.requestedBy}` : ""}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.paidBy || e.vendor || "—"}</td>
                    <td className="px-3 py-2 text-right font-bold">₹{Number(e.amount).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-center"><span className="px-2 py-1 rounded-full bg-slate-100 border text-xs capitalize">{e.paymentMethod || "cash"}</span></td>
                    <td className="px-3 py-2 text-center text-xs">{e.expenseDate ? new Date(e.expenseDate).toLocaleDateString("en-IN") : new Date(e.dueDate).toLocaleDateString("en-IN")}</td>
                    <td className="px-3 py-2 text-center"><span className={`px-2 py-1 rounded-full text-xs border capitalize ${e.status === "pending" ? "bg-amber-50 border-amber-200 text-amber-700" : e.status === "approved" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : e.status === "rejected" ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-100 border-slate-200"}`}>{e.status}</span></td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 justify-center flex-wrap">
                        {e.status === "pending" && isSuper ? (
                          <>
                            <button onClick={() => act(e.id, "approve")} className="px-2 py-1 rounded-full bg-emerald-600 text-white text-xs">Approve</button>
                            <button onClick={() => act(e.id, "reject")} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">Reject</button>
                          </>
                        ) : e.status === "approved" && isSuper ? (
                          <button onClick={() => act(e.id, "markPaid")} className="px-2 py-1 rounded-full bg-navy-900 text-white text-xs">Mark Paid</button>
                        ) : null}
                        <button onClick={() => del(e.id)} className="px-2 py-1 rounded-full bg-white border text-xs">✕</button>
                      </div>
                      {e.approvedBy && <div className="text-[10px] text-slate-400 text-center mt-1">by {e.approvedBy}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No {filter} expenses</div>}
          </div>
          <div className="mt-3 text-xs text-slate-500">AR/AP: Only <b>approved/paid</b> counts toward Accounts Payable in Dashboard → Finance. Pending is separate.</div>
        </div>

        <div className="lg:col-span-5 card p-6 h-fit sticky top-[88px]">
          <h3 className="font-semibold text-navy-900">Add Expense • Tracker</h3>
          <p className="text-xs text-slate-500">Creates expense → {isSuper ? "auto-approved (super_admin)" : "pending for super_admin approval"} • Related to AR/AP.</p>
          <div className="mt-4 grid gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">Expense *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g., Mess Food - Aug, Rent, Printing" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white">
                  <option>General</option><option>Rent</option><option>Food</option><option>Faculty</option><option>Utilities</option><option>Marketing</option><option>Maintenance</option><option>Transport</option><option>Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Amount *</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="₹ amount" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Paid By *</label>
                <input value={form.paidBy} onChange={(e) => setForm({ ...form, paidBy: e.target.value })} placeholder="e.g., Anwar Sir, Staff Name" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Paid Via</label>
                <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white">
                  <option value="cash">Cash</option><option value="UPI">UPI</option><option value="bank">Bank</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Expense Date *</label>
                <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Due Date (AP)</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Free text — vendor, bill no, remarks…" rows={2} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
            </div>
            <button onClick={save} className="btn-primary justify-center">{isSuper ? "Add & Approve →" : "Submit for Approval →"}</button>
            <div className="text-xs text-slate-500 text-center">{isSuper ? "As super_admin, your expenses are auto-approved and counted in AP." : "Your expense will be pending until super_admin approves. It will then count toward AP."}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MastersTab() {
  const [durations, setDurations] = useState<any[]>([]);
  const [addons, setAddons] = useState<any[]>([]);
  const [mediums, setMediums] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [dForm, setDForm] = useState({ id: "", name: "", months: "", active: true });
  const [aForm, setAForm] = useState({ id: "", name: "", fee: "", courses: "", active: true });
  const [mForm, setMForm] = useState({ id: "", name: "", active: true });
  const [bForm, setBForm] = useState({ id: "", name: "", address: "", phone: "", active: true });
  const [cForm, setCForm] = useState({ id: "", slug: "", title: "", fee: "", duration: "", eligibility: "" });
  const load = () => {
    fetch("/api/admin/durations", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setDurations(d)).catch(() => {});
    fetch("/api/admin/addons", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setAddons(d)).catch(() => {});
    fetch("/api/admin/mediums", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setMediums(d)).catch(() => {});
    fetch("/api/admin/branches", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setBranches(d)).catch(() => {});
    fetch("/api/admin/courses", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setCourses(d)).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const saveD = async () => {
    if (!dForm.name.trim() || !dForm.months) return alert("Name and months required");
    const r = await fetch("/api/admin/durations", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: dForm.id || undefined, name: dForm.name, months: Number(dForm.months), active: dForm.active }) });
    if (r.ok) { setDForm({ id: "", name: "", months: "", active: true }); load(); } else alert("Failed (name must be unique)");
  };
  const saveA = async () => {
    if (!aForm.name.trim() || aForm.fee === "") return alert("Name and fee required");
    const r = await fetch("/api/admin/addons", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: aForm.id || undefined, name: aForm.name, fee: Number(aForm.fee), courses: aForm.courses, active: aForm.active }) });
    if (r.ok) { setAForm({ id: "", name: "", fee: "", courses: "", active: true }); load(); } else alert("Failed");
  };
  const del = async (kind: "d" | "a" | "m" | "b" | "c", id: string) => {
    if (!confirm("Delete?")) return;
    const ep = kind === "d" ? "durations" : kind === "a" ? "addons" : kind === "m" ? "mediums" : kind === "b" ? "branches" : "courses";
    const r = await fetch(`/api/admin/${ep}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "Delete failed");
    }
    load();
  };
  const saveM = async () => {
    if (!mForm.name.trim()) return alert("Name required");
    const r = await fetch("/api/admin/mediums", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: mForm.id || undefined, name: mForm.name, active: mForm.active }) });
    if (r.ok) { setMForm({ id: "", name: "", active: true }); load(); } else alert("Failed (name must be unique)");
  };
  const saveB = async () => {
    if (!bForm.name.trim() || !bForm.address.trim()) return alert("Name and address required");
    const r = await fetch("/api/admin/branches", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: bForm.id || undefined, name: bForm.name, address: bForm.address, phone: bForm.phone, active: bForm.active }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setBForm({ id: "", name: "", address: "", phone: "", active: true }); load(); } else alert(d.error || "Failed (name must be unique)");
  };
  const saveC = async () => {
    if (!cForm.slug.trim() || !cForm.title.trim()) return alert("Slug and title required");
    const r = await fetch("/api/admin/courses", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cForm.id || undefined, slug: cForm.slug, title: cForm.title, fee: cForm.fee, duration: cForm.duration, eligibility: cForm.eligibility }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setCForm({ id: "", slug: "", title: "", fee: "", duration: "", eligibility: "" }); load(); } else alert(d.error || "Failed");
  };
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-6">
        <h2 className="font-semibold text-navy-900">Durations • {durations.length}</h2>
        <p className="text-xs text-slate-500">Drives registration duration dropdown, batch end dates & course end dates.</p>
        <div className="mt-4 grid gap-2">
          {durations.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
              <div><div className="text-sm font-medium">{d.name} <span className="text-xs text-slate-500">• {d.months} months</span></div></div>
              <div className="flex gap-1 items-center">
                <span className={`text-xs px-2 py-1 rounded-full border ${d.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200"}`}>{d.active ? "active" : "off"}</span>
                <button onClick={() => setDForm({ id: d.id, name: d.name, months: String(d.months), active: d.active })} className="px-2 py-1 rounded-full bg-white border text-xs">Edit</button>
                <button onClick={() => del("d", d.id)} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 p-3 rounded-xl bg-slate-50 border">
          <input value={dForm.name} onChange={(e) => setDForm({ ...dForm, name: e.target.value })} placeholder="Name (e.g., 1 Year)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <div className="flex gap-2">
            <input type="number" min={1} value={dForm.months} onChange={(e) => setDForm({ ...dForm, months: e.target.value })} placeholder="Months" className="flex-1 px-3 py-2 rounded-xl border text-sm bg-white" />
            <label className="flex items-center gap-1 text-xs px-2"><input type="checkbox" checked={dForm.active} onChange={(e) => setDForm({ ...dForm, active: e.target.checked })} /> Active</label>
            <button onClick={saveD} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">{dForm.id ? "Update" : "Add"}</button>
            {dForm.id && <button onClick={() => setDForm({ id: "", name: "", months: "", active: true })} className="text-xs text-slate-500">Clear</button>}
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-semibold text-navy-900">Add-ons • {addons.length}</h2>
        <p className="text-xs text-slate-500">Offered at registration per course (blank courses = all). Fees snapshot at submit.</p>
        <div className="mt-4 grid gap-2 max-h-[50vh] overflow-auto pr-1">
          {addons.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
              <div><div className="text-sm font-medium">{a.name} <span className="font-bold">₹{Number(a.fee).toLocaleString("en-IN")}</span></div><div className="text-xs text-slate-500">{a.courses?.length ? a.courses.join(", ") : "All courses"}</div></div>
              <div className="flex gap-1 items-center">
                <span className={`text-xs px-2 py-1 rounded-full border ${a.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200"}`}>{a.active ? "active" : "off"}</span>
                <button onClick={() => setAForm({ id: a.id, name: a.name, fee: String(a.fee), courses: (a.courses || []).join(", "), active: a.active })} className="px-2 py-1 rounded-full bg-white border text-xs">Edit</button>
                <button onClick={() => del("a", a.id)} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 p-3 rounded-xl bg-slate-50 border">
          <input value={aForm.name} onChange={(e) => setAForm({ ...aForm, name: e.target.value })} placeholder="Add-on name (e.g., Hostel Upgrade)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <div className="flex gap-2">
            <input type="number" min={0} value={aForm.fee} onChange={(e) => setAForm({ ...aForm, fee: e.target.value })} placeholder="Fee ₹" className="flex-1 px-3 py-2 rounded-xl border text-sm bg-white" />
            <input value={aForm.courses} onChange={(e) => setAForm({ ...aForm, courses: e.target.value })} placeholder="Courses (blank=all)" className="flex-1 px-3 py-2 rounded-xl border text-sm bg-white" />
          </div>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-xs px-2"><input type="checkbox" checked={aForm.active} onChange={(e) => setAForm({ ...aForm, active: e.target.checked })} /> Active</label>
            <button onClick={saveA} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">{aForm.id ? "Update" : "Add"}</button>
            {aForm.id && <button onClick={() => setAForm({ id: "", name: "", fee: "", courses: "", active: true })} className="text-xs text-slate-500">Clear</button>}
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-semibold text-navy-900">Mediums • {mediums.length}</h2>
        <p className="text-xs text-slate-500">Language options for registration & fee config. Inactive ones are hidden from forms.</p>
        <div className="mt-4 grid gap-2">
          {mediums.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
              <div className="text-sm font-medium">{m.name}</div>
              <div className="flex gap-1 items-center">
                <span className={`text-xs px-2 py-1 rounded-full border ${m.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200"}`}>{m.active ? "active" : "off"}</span>
                <button onClick={() => setMForm({ id: m.id, name: m.name, active: m.active })} className="px-2 py-1 rounded-full bg-white border text-xs">Edit</button>
                <button onClick={() => del("m", m.id)} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">✕</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 p-3 rounded-xl bg-slate-50 border">
          <input value={mForm.name} onChange={(e) => setMForm({ ...mForm, name: e.target.value })} placeholder="Name (e.g., Hindi)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-xs px-2"><input type="checkbox" checked={mForm.active} onChange={(e) => setMForm({ ...mForm, active: e.target.checked })} /> Active</label>
            <button onClick={saveM} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">{mForm.id ? "Update" : "Add"}</button>
            {mForm.id && <button onClick={() => setMForm({ id: "", name: "", active: true })} className="text-xs text-slate-500">Clear</button>}
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-semibold text-navy-900">Branches • {branches.length}</h2>
        <p className="text-xs text-slate-500">Branch options for registration, batches & fee config. Inactive ones are hidden from forms.</p>
        <div className="mt-4 grid gap-2 max-h-[50vh] overflow-auto pr-1">
          {branches.map((b) => (
            <div key={b.id} className="p-3 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{b.name}</div>
                <div className="flex gap-1 items-center shrink-0">
                  <span className={`text-xs px-2 py-1 rounded-full border ${b.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200"}`}>{b.active ? "active" : "off"}</span>
                  <button onClick={() => setBForm({ id: b.id, name: b.name, address: b.address, phone: b.phone || "", active: b.active })} className="px-2 py-1 rounded-full bg-white border text-xs">Edit</button>
                  <button onClick={() => del("b", b.id)} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">✕</button>
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-1">{b.address}{b.phone ? ` • ${b.phone}` : ""}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 p-3 rounded-xl bg-slate-50 border">
          <input value={bForm.name} onChange={(e) => setBForm({ ...bForm, name: e.target.value })} placeholder="Branch name (e.g., Warangal)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={bForm.address} onChange={(e) => setBForm({ ...bForm, address: e.target.value })} placeholder="Full address" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={bForm.phone} onChange={(e) => setBForm({ ...bForm, phone: e.target.value })} placeholder="Phone (optional)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1 text-xs px-2"><input type="checkbox" checked={bForm.active} onChange={(e) => setBForm({ ...bForm, active: e.target.checked })} /> Active</label>
            <button onClick={saveB} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">{bForm.id ? "Update" : "Add"}</button>
            {bForm.id && <button onClick={() => setBForm({ id: "", name: "", address: "", phone: "", active: true })} className="text-xs text-slate-500">Clear</button>}
          </div>
        </div>
      </div>
      <div className="card p-6">
        <h2 className="font-semibold text-navy-900">Courses • {courses.length}</h2>
        <p className="text-xs text-slate-500">Course options for registration, batches & fee config. Changes reflect instantly in admission form. Delete blocked if batches/admissions use it.</p>
        <div className="mt-4 grid gap-2 max-h-[50vh] overflow-auto pr-1">
          {courses.map((c: any) => (
            <div key={c.id} className="p-3 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{c.title} <span className="text-xs text-slate-500">• {c.slug}</span></div>
                  <div className="text-xs text-slate-500 mt-0.5">{c.fee ? `Fee: ${c.fee}` : ""} {c.duration ? `• ${c.duration}` : ""}</div>
                </div>
                <div className="flex gap-1 items-center shrink-0">
                  <button onClick={() => setCForm({ id: c.id, slug: c.slug, title: c.title, fee: c.fee || "", duration: c.duration || "", eligibility: c.eligibility || "" })} className="px-2 py-1 rounded-full bg-white border text-xs">Edit</button>
                  <button onClick={() => del("c", c.id)} className="px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 p-3 rounded-xl bg-slate-50 border">
          <input value={cForm.slug} onChange={(e) => setCForm({ ...cForm, slug: e.target.value })} placeholder="Slug (e.g., si, constable, upsc)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={cForm.title} onChange={(e) => setCForm({ ...cForm, title: e.target.value })} placeholder="Title (e.g., Sub-Inspector (SI))" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={cForm.fee} onChange={(e) => setCForm({ ...cForm, fee: e.target.value })} placeholder="Fee (e.g., ₹35,000 Residential)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={cForm.duration} onChange={(e) => setCForm({ ...cForm, duration: e.target.value })} placeholder="Duration (e.g., 3-4 Months)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <input value={cForm.eligibility} onChange={(e) => setCForm({ ...cForm, eligibility: e.target.value })} placeholder="Eligibility (e.g., Graduation)" className="px-3 py-2 rounded-xl border text-sm bg-white" />
          <div className="flex gap-2 items-center">
            <button onClick={saveC} className="px-4 py-2 rounded-full bg-navy-900 text-white text-xs">{cForm.id ? "Update" : "Add"}</button>
            {cForm.id && <button onClick={() => setCForm({ id: "", slug: "", title: "", fee: "", duration: "", eligibility: "" })} className="text-xs text-slate-500">Clear</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DuesTab() {
  const [view, setView] = useState<"queue" | "workspace" | "dues" | "receipts">("queue");
  const [queue, setQueue] = useState<any[]>([]);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [admPayments, setAdmPayments] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [duesRows, setDuesRows] = useState<any[]>([]);
  const [allReceipts, setAllReceipts] = useState<any[]>([]);
  const [showReceipt, setShowReceipt] = useState<any>(null);
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [allocRows, setAllocRows] = useState<{ installmentId: string; amount: string }[]>([{ installmentId: "", amount: "" }]);
  const [newInst, setNewInst] = useState({ label: "", amount: "", dueDate: "", notes: "" });
  const [dueEdit, setDueEdit] = useState<Record<string, { date: string; reason: string }>>({});
  const [dueHist, setDueHist] = useState<Record<string, any[]>>({});
  const [f, setF] = useState({ due: "all", status: "all", branch: "", course: "", batch: "", from: "", to: "", q: "" });

  const loadQueue = () =>
    Promise.all([
      fetch("/api/admin/fee-payments?status=submitted", { credentials: "same-origin",  cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch("/api/admin/fee-payments?status=pending_verification", { credentials: "same-origin",  cache: "no-store" }).then((r) => r.json()).catch(() => []),
    ]).then(([a, b]) => setQueue([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]));
  const loadAdmissions = () => fetch("/api/admin/admissions", { credentials: "same-origin" }).then((r) => r.json()).then((d) => Array.isArray(d) && setAdmissions(d)).catch(() => {});
  useEffect(() => { loadQueue(); loadAdmissions(); }, []);

  const openWorkspace = async (a: any) => {
    setSel(a);
    setView("workspace");
    const [inst, pays, recs, aud] = await Promise.all([
      fetch(`/api/admin/installments?admissionId=${a.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch(`/api/admin/fee-payments?admissionId=${a.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch(`/api/admin/receipts?admissionId=${a.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => []),
      fetch(`/api/admin/audit?entity=admission&entityId=${a.id}`, { cache: "no-store" }).then((r) => r.json()).catch(() => []),
    ]);
    setInstallments(Array.isArray(inst) ? inst : []);
    setAdmPayments(Array.isArray(pays) ? pays : []);
    setReceipts(Array.isArray(recs) ? recs : []);
    setAuditTrail(Array.isArray(aud) ? aud : []);
  };
  const refreshWorkspace = () => sel && openWorkspace(sel);

  const loadDues = async () => {
    const p = new URLSearchParams({ due: f.due, status: f.status, branch: f.branch, course: f.course, batch: f.batch, from: f.from, to: f.to, q: f.q });
    const r = await fetch(`/api/admin/dues?${p.toString()}`, { cache: "no-store" });
    const d = await r.json().catch(() => []);
    if (Array.isArray(d)) setDuesRows(d);
  };
  const loadReceipts = async () => {
    const r = await fetch("/api/admin/receipts", { credentials: "same-origin",  cache: "no-store" });
    const d = await r.json().catch(() => []);
    if (Array.isArray(d)) setAllReceipts(d);
  };

  const acknowledge = async (payId: string) => {
    const rows = allocRows.filter((r) => r.installmentId && Number(r.amount) > 0).map((r) => ({ installmentId: r.installmentId, amount: Number(r.amount) }));
    if (rows.length === 0) return alert("Add at least one allocation row");
    const r = await fetch("/api/admin/fee-payments", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: payId, action: "acknowledge", allocations: rows }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { alert(`Acknowledged — Receipt ${d.receiptNo}`); setAckFor(null); setAllocRows([{ installmentId: "", amount: "" }]); loadQueue(); refreshWorkspace(); }
    else alert(d.error || "Failed");
  };
  const rejectPay = async (payId: string) => {
    const note = prompt("Rejection reason (recorded, balance unaffected):") || "";
    const r = await fetch("/api/admin/fee-payments", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: payId, action: "reject", note }) });
    if (r.ok) { loadQueue(); refreshWorkspace(); } else alert("Failed");
  };
  const autoOldest = (payAmount: number) => {
    const sorted = [...installments].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    let left = payAmount;
    const rows: { installmentId: string; amount: string }[] = [];
    for (const i of sorted) {
      if (left <= 0) break;
      const room = Math.max(0, i.originalAmount - (i.paidAmount || 0));
      if (room <= 0) continue;
      const take = Math.min(room, left);
      rows.push({ installmentId: i.id, amount: String(take) });
      left -= take;
    }
    setAllocRows(rows.length ? rows : [{ installmentId: "", amount: "" }]);
  };

  const addInst = async () => {
    if (!sel || !newInst.amount || !newInst.dueDate) return alert("Amount and due date required");
    const r = await fetch("/api/admin/installments", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ admissionId: sel.id, label: newInst.label, amount: Number(newInst.amount), dueDate: newInst.dueDate, notes: newInst.notes }) });
    if (r.ok) { setNewInst({ label: "", amount: "", dueDate: "", notes: "" }); refreshWorkspace(); } else alert("Failed");
  };
  const saveDue = async (instId: string) => {
    const e = dueEdit[instId];
    if (!e?.date) return alert("New due date required");
    const r = await fetch("/api/admin/installments", { credentials: "same-origin",  method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: instId, dueDate: e.date, reason: e.reason }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setDueEdit({ ...dueEdit, [instId]: { date: "", reason: "" } }); refreshWorkspace(); }
    else alert(d.error || "Failed");
  };
  const showHist = async (instId: string) => {
    if (dueHist[instId]) { const n = { ...dueHist }; delete n[instId]; setDueHist(n); return; }
    const r = await fetch(`/api/admin/audit?entity=installment&entityId=${instId}`, { cache: "no-store" });
    const d = await r.json().catch(() => []);
    setDueHist({ ...dueHist, [instId]: Array.isArray(d) ? d : [] });
  };
  const delInst = async (id: string) => {
    if (!confirm("Delete installment? Only allowed when nothing is paid/allocated.")) return;
    const r = await fetch(`/api/admin/installments?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) refreshWorkspace(); else alert(d.error || "Failed");
  };

  const filteredAdm = admissions.filter((a) => {
    if (!q) return a.status === "approved";
    return `${a.name} ${a.email} ${a.applicationId || ""} ${a.applicantStudentId || ""}`.toLowerCase().includes(q.toLowerCase());
  }).slice(0, 20);

  const allocTotal = allocRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <div className="grid gap-4">
      <div className="card p-4 flex gap-2 flex-wrap">
        {([["queue", "Verify Queue"], ["workspace", "Student Workspace"], ["dues", "Due Payments"], ["receipts", "Receipts"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => { setView(v); if (v === "receipts") loadReceipts(); }} className={`px-4 py-2 rounded-full text-sm font-medium border ${view === v ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>{l}{v === "queue" && queue.length > 0 ? ` (${queue.length})` : ""}</button>
        ))}
      </div>

      {view === "queue" && (
        <div className="card p-6">
          <h2 className="font-semibold text-navy-900">Payments Awaiting Acknowledgement • {queue.length}</h2>
          <p className="text-xs text-slate-500">Submitted / provider-paid. Acknowledge → allocate → receipt. Rejected payments never reduce outstanding.</p>
          <div className="mt-4 grid gap-3">
            {queue.map((p) => (
              <div key={p.id} className="p-4 rounded-2xl border border-slate-200">
                <div className="flex justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold">₹{Number(p.amount).toLocaleString("en-IN")} <span className="capitalize font-normal text-slate-500">• {p.method}</span> <span className={`ml-1 text-xs px-2 py-0.5 rounded-full border ${p.status === "pending_verification" ? "bg-sky-50 border-sky-200 text-sky-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>{p.status.replace(/_/g, " ")}</span></div>
                    <div className="text-xs text-slate-500 mt-1">{p.transactionId ? `Ref: ${p.transactionId} • ` : ""}{new Date(p.createdAt).toLocaleString("en-IN")} • by {p.recordedBy || "—"}</div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => { setAckFor(ackFor === p.id ? null : p.id); setAllocRows([{ installmentId: "", amount: "" }]); }} className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs">Acknowledge + Allocate</button>
                    <button onClick={() => rejectPay(p.id)} className="px-3 py-1.5 rounded-full bg-white border text-xs">Reject</button>
                  </div>
                </div>
                {ackFor === p.id && (
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border grid gap-2">
                    <div className="text-xs font-semibold">Allocate exactly ₹{Number(p.amount).toLocaleString("en-IN")} (explicit or oldest-first)</div>
                    <InstallmentOptions admissionId={p.admissionId} />
                    {allocRows.map((row, i) => (
                      <div key={i} className="flex gap-2">
                        <AllocSelect admissionId={p.admissionId} value={row.installmentId} onChange={(v: string) => setAllocRows(allocRows.map((r, j) => (j === i ? { ...r, installmentId: v } : r)))} />
                        <input type="number" min={0} value={row.amount} onChange={(e) => setAllocRows(allocRows.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))} placeholder="₹" className="w-28 px-2 py-1.5 rounded-lg border text-xs bg-white" />
                        <button onClick={() => setAllocRows(allocRows.filter((_, j) => j !== i))} className="text-xs text-red-600">✕</button>
                      </div>
                    ))}
                    <div className="flex gap-2 items-center flex-wrap">
                      <button onClick={() => setAllocRows([...allocRows, { installmentId: "", amount: "" }])} className="text-xs px-3 py-1.5 rounded-full bg-white border">+ Split row</button>
                      <button onClick={() => autoOldest(p.amount)} className="text-xs px-3 py-1.5 rounded-full bg-white border">Auto: oldest-first</button>
                      <span className={`text-xs font-semibold ${allocTotal === p.amount ? "text-emerald-700" : "text-red-600"}`}>Total ₹{allocTotal.toLocaleString("en-IN")} / ₹{Number(p.amount).toLocaleString("en-IN")}</span>
                      <button onClick={() => acknowledge(p.id)} disabled={allocTotal !== p.amount} className="ml-auto px-4 py-1.5 rounded-full bg-navy-900 text-white text-xs disabled:opacity-40">Confirm → Receipt</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {queue.length === 0 && <div className="text-sm text-slate-500 text-center py-6">Nothing awaiting verification ✓</div>}
          </div>
        </div>
      )}

      {view === "workspace" && (
        <div className="grid gap-4">
          <div className="card p-5">
            <div className="font-semibold text-navy-900">Find student admission</div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, Application ID, Student ID…" className="mt-2 w-full px-3 py-2.5 rounded-xl border text-sm" />
            <div className="mt-2 grid gap-1 max-h-48 overflow-auto">
              {filteredAdm.map((a) => (
                <button key={a.id} onClick={() => openWorkspace(a)} className={`text-left px-3 py-2 rounded-xl border text-sm ${sel?.id === a.id ? "bg-navy-900 text-white border-navy-900" : "bg-white hover:bg-slate-50"}`}>
                  <b>{a.name}</b> • {a.applicationId || a.id} {a.applicantStudentId ? `• ${a.applicantStudentId}` : ""} • {a.course}
                </button>
              ))}
              {filteredAdm.length === 0 && <div className="text-xs text-slate-400">Type to search approved admissions (default shows approved).</div>}
            </div>
          </div>

          {sel && (
            <>
              <div className="card p-5">
                <div className="flex justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-semibold text-navy-900">{sel.name} • {sel.course}</div>
                    <div className="text-xs text-slate-500">{sel.applicationId} {sel.applicantStudentId ? `• ${sel.applicantStudentId}` : ""} • {sel.branch} • {sel.batchName || ""}</div>
                    <div className="text-xs text-slate-500">Start {sel.admissionStartDate ? new Date(sel.admissionStartDate).toLocaleDateString("en-IN") : "—"} → End {sel.courseEndDate ? new Date(sel.courseEndDate).toLocaleDateString("en-IN") : "—"} • Final fee ₹{Number(sel.finalFee ?? sel.totalFee ?? 0).toLocaleString("en-IN")}{sel.feeLocked ? " (locked)" : ""}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-xs font-bold tracking-widest text-slate-500">PAYMENT SCHEDULE</div>
                  <div className="mt-2 grid gap-2">
                    {installments.map((i) => (
                      <div key={i.id} className="p-3 rounded-xl border border-slate-200">
                        <div className="flex justify-between flex-wrap gap-2 text-sm">
                          <b>{i.label}</b>
                          <span>₹{Number(i.originalAmount).toLocaleString("en-IN")} • Paid ₹{Number(i.paidAmount || 0).toLocaleString("en-IN")} • Due ₹{Number(i.outstanding).toLocaleString("en-IN")}</span>
                        </div>
                        <div className="mt-1 flex gap-2 items-center flex-wrap text-xs">
                          <span className={`px-2 py-0.5 rounded-full border ${i.status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : i.status === "partial" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200"}`}>{i.status}</span>
                          <span className="px-2 py-0.5 rounded-full border">{i.dueStatus} • {new Date(i.dueDate).toLocaleDateString("en-IN")}</span>
                          <button onClick={() => showHist(i.id)} className="text-sky-700 hover:underline">due history</button>
                          <button onClick={() => delInst(i.id)} className="text-red-600 hover:underline">delete</button>
                        </div>
                        <div className="mt-2 flex gap-2 flex-wrap">
                          <input type="date" value={dueEdit[i.id]?.date || ""} onChange={(e) => setDueEdit({ ...dueEdit, [i.id]: { ...(dueEdit[i.id] || { date: "", reason: "" }), date: e.target.value } })} className="px-2 py-1.5 rounded-lg border text-xs" />
                          <input value={dueEdit[i.id]?.reason || ""} onChange={(e) => setDueEdit({ ...dueEdit, [i.id]: { ...(dueEdit[i.id] || { date: "", reason: "" }), reason: e.target.value } })} placeholder="Reason (kept in history)" className="flex-1 min-w-[160px] px-2 py-1.5 rounded-lg border text-xs" />
                          <button onClick={() => saveDue(i.id)} className="px-3 py-1.5 rounded-full bg-navy-900 text-white text-xs">Update due date</button>
                        </div>
                        {dueHist[i.id] && (
                          <div className="mt-2 grid gap-1">
                            {dueHist[i.id].filter((h: any) => h.action === "due_date_changed").map((h: any) => (
                              <div key={h.id} className="text-xs text-slate-500">• {h.note} — by {h.actor}, {new Date(h.createdAt).toLocaleString("en-IN")}</div>
                            ))}
                            {dueHist[i.id].length === 0 && <div className="text-xs text-slate-400">No changes yet.</div>}
                          </div>
                        )}
                      </div>
                    ))}
                    {installments.length === 0 && <div className="text-xs text-slate-400">No installments — add the first below.</div>}
                  </div>
                  <div className="mt-3 p-3 rounded-xl bg-slate-50 border grid sm:grid-cols-4 gap-2">
                    <input value={newInst.label} onChange={(e) => setNewInst({ ...newInst, label: e.target.value })} placeholder={`Installment ${installments.length + 1}`} className="px-2 py-2 rounded-lg border text-xs bg-white" />
                    <input type="number" value={newInst.amount} onChange={(e) => setNewInst({ ...newInst, amount: e.target.value })} placeholder="Amount ₹" className="px-2 py-2 rounded-lg border text-xs bg-white" />
                    <input type="date" value={newInst.dueDate} onChange={(e) => setNewInst({ ...newInst, dueDate: e.target.value })} className="px-2 py-2 rounded-lg border text-xs bg-white" />
                    <button onClick={addInst} className="px-3 py-2 rounded-full bg-navy-900 text-white text-xs">+ Add</button>
                  </div>
                </div>
              </div>

              <div className="card p-5">
                <div className="text-xs font-bold tracking-widest text-slate-500">PAYMENTS ({admPayments.length})</div>
                <div className="mt-2 grid gap-2">
                  {admPayments.map((p) => (
                    <div key={p.id} className="text-xs p-2.5 rounded-xl border flex flex-wrap gap-x-3 gap-y-1 items-center">
                      <b>₹{Number(p.amount).toLocaleString("en-IN")}</b>
                      <span className="capitalize">{p.method}</span>
                      <span className={`px-2 py-0.5 rounded-full border ${p.status === "acknowledged" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : p.status === "rejected" || p.status === "failed" ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>{p.status.replace(/_/g, " ")}</span>
                      {p.transactionId && <span className="text-slate-500">{p.transactionId}</span>}
                      {p.receiptNo && <span className="font-semibold">{p.receiptNo}</span>}
                      <span className="text-slate-400">{new Date(p.createdAt).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                  {admPayments.length === 0 && <div className="text-xs text-slate-400">No payments yet.</div>}
                </div>
              </div>

              <div className="card p-5">
                <div className="text-xs font-bold tracking-widest text-slate-500">RECEIPTS ({receipts.length})</div>
                <div className="mt-2 grid gap-2">
                  {receipts.map((r: any) => (
                    <div key={r.id} className="flex justify-between items-center text-sm p-2.5 rounded-xl border">
                      <span><b>{r.receiptNo}</b> • ₹{Number(r.amount).toLocaleString("en-IN")} • {new Date(r.createdAt).toLocaleDateString("en-IN")}</span>
                      <button onClick={() => setShowReceipt(r)} className="text-xs text-sky-700 hover:underline">View / Print</button>
                    </div>
                  ))}
                  {receipts.length === 0 && <div className="text-xs text-slate-400">No receipts — generated on acknowledgement.</div>}
                </div>
              </div>

              <div className="card p-5">
                <div className="text-xs font-bold tracking-widest text-slate-500">AUDIT TRAIL</div>
                <div className="mt-2 grid gap-1.5 max-h-56 overflow-auto">
                  {auditTrail.map((h: any) => (
                    <div key={h.id} className="text-xs p-2 rounded-lg bg-slate-50 border"><b>{h.action.replace(/_/g, " ")}</b> • by {h.actor} • {new Date(h.createdAt).toLocaleString("en-IN")}{h.note && <div className="text-slate-600">{h.note}</div>}</div>
                  ))}
                  {auditTrail.length === 0 && <div className="text-xs text-slate-400">No audit entries.</div>}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {view === "dues" && (
        <div className="card p-5">
          <h2 className="font-semibold text-navy-900">Due Payments</h2>
          <div className="mt-3 grid sm:grid-cols-4 gap-2 text-xs">
            <select value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className="px-2 py-2 rounded-lg border bg-white"><option value="all">All due states</option><option value="today">Due Today</option><option value="soon">Due Soon</option><option value="overdue">Overdue</option><option value="notdue">Not Due</option></select>
            <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="px-2 py-2 rounded-lg border bg-white"><option value="all">All payment states</option><option value="pending">Pending</option><option value="partial">Partially Paid</option><option value="paid">Paid</option></select>
            <select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} className="px-2 py-2 rounded-lg border bg-white"><option value="">All branches</option><option>Warangal</option><option>Hyderabad</option><option>Hanamkonda</option><option>Bollikunta (Residential)</option></select>
            <select value={f.course} onChange={(e) => setF({ ...f, course: e.target.value })} className="px-2 py-2 rounded-lg border bg-white"><option value="">All courses</option><option>SI</option><option>Constable</option><option>Groups</option><option>SSC GD</option><option>Defence</option><option>Army</option><option>UPSC</option></select>
            <input value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} placeholder="Batch name filter" className="px-2 py-2 rounded-lg border bg-white" />
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="px-2 py-2 rounded-lg border bg-white" />
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="px-2 py-2 rounded-lg border bg-white" />
            <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search name, phone, IDs…" className="px-2 py-2 rounded-lg border bg-white" />
          </div>
          <button onClick={loadDues} className="mt-3 px-5 py-2 rounded-full bg-navy-900 text-white text-xs">Apply Filters →</button>
          <div className="mt-4 overflow-auto border rounded-2xl max-h-[60vh]">
            <table className="w-full text-xs min-w-[900px]">
              <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-slate-500"><th className="px-3 py-2">Student</th><th className="px-3 py-2">IDs</th><th className="px-3 py-2">Course/Branch/Batch</th><th className="px-3 py-2">Installment</th><th className="px-3 py-2 text-right">Original</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2">Due</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody className="divide-y">
                {duesRows.map((r: any) => (
                  <tr key={r.installment.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2"><b>{r.student.name}</b><div className="text-slate-500">{r.student.phone}</div></td>
                    <td className="px-3 py-2">{r.admission.studentId || "—"}<div className="text-slate-500">{r.admission.applicationId || ""}</div></td>
                    <td className="px-3 py-2">{r.admission.course} • {r.admission.branch}<div className="text-slate-500">{r.admission.batchName || ""}</div></td>
                    <td className="px-3 py-2">{r.installment.label}</td>
                    <td className="px-3 py-2 text-right">₹{Number(r.installment.originalAmount).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right">₹{Number(r.installment.paidAmount || 0).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2 text-right font-bold">₹{Number(r.installment.outstanding).toLocaleString("en-IN")}</td>
                    <td className="px-3 py-2">{new Date(r.installment.dueDate).toLocaleDateString("en-IN")}<div>{r.installment.dueStatus}</div></td>
                    <td className="px-3 py-2">{r.installment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {duesRows.length === 0 && <div className="p-8 text-center text-xs text-slate-400">Apply filters to load dues.</div>}
          </div>
        </div>
      )}

      {view === "receipts" && (
        <div className="card p-5">
          <h2 className="font-semibold text-navy-900">Receipts • {allReceipts.length}</h2>
          <div className="mt-3 grid gap-2">
            {allReceipts.map((r: any) => (
              <div key={r.id} className="flex justify-between items-center text-sm p-3 rounded-xl border">
                <span><b>{r.receiptNo}</b> • ₹{Number(r.amount).toLocaleString("en-IN")} • {new Date(r.createdAt).toLocaleString("en-IN")} • {r.feePayment?.allocations?.map((a: any) => a.installment?.label).filter(Boolean).join(", ")}</span>
                <button onClick={() => setShowReceipt(r)} className="text-xs text-sky-700 hover:underline">View / Print</button>
              </div>
            ))}
            {allReceipts.length === 0 && <div className="text-xs text-slate-400">No receipts yet — generated when payments are acknowledged.</div>}
          </div>
        </div>
      )}

      {showReceipt && (
        <ReceiptModal receiptNo={showReceipt.receiptNo} onClose={() => setShowReceipt(null)} />
      )}
    </div>
  );
}

function InstallmentOptions({ admissionId }: { admissionId: string }) {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/admin/installments?admissionId=${encodeURIComponent(admissionId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  }, [admissionId]);
  if (list.length === 0) return <div className="text-xs text-red-600">No installments for this admission — create a schedule first (Workspace).</div>;
  return (
    <div className="text-xs text-slate-600">
      Open: {list.filter((i) => i.status !== "paid").map((i) => `${i.label} (₹${Math.max(0, i.originalAmount - (i.paidAmount || 0)).toLocaleString("en-IN")} due)`).join(" • ") || "none — all paid"}
    </div>
  );
}

function AllocSelect({ admissionId, value, onChange }: { admissionId: string; value: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/admin/installments?admissionId=${encodeURIComponent(admissionId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => Array.isArray(d) && setList(d)).catch(() => {});
  }, [admissionId]);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 px-2 py-1.5 rounded-lg border text-xs bg-white">
      <option value="">Select installment…</option>
      {list.map((i) => (
        <option key={i.id} value={i.id}>{i.label} — ₹{Number(i.originalAmount).toLocaleString("en-IN")} (paid ₹{Number(i.paidAmount || 0).toLocaleString("en-IN")})</option>
      ))}
    </select>
  );
}

function ReceiptModal({ receiptNo, onClose }: { receiptNo: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetch("/api/admin/receipts", { credentials: "same-origin",  cache: "no-store" }).then((r) => r.json()).then((d) => {
      const r = (Array.isArray(d) ? d : []).find((x: any) => x.receiptNo === receiptNo);
      if (r) setData(r);
    }).catch(() => {});
  }, [receiptNo]);
  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 p-4 grid place-items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        {data ? <ReceiptView r={{ receiptNo: data.receiptNo, amount: data.amount, createdAt: data.createdAt, feePayment: data.feePayment }} /> : <div className="bg-white p-8 rounded-2xl text-sm">Loading…</div>}
      </div>
    </div>
  );
}

const ORDER_FLOW = ["placed", "payment_confirmed", "processing", "ready_for_handover", "handed_over", "completed"] as const;
const ORDER_LABEL: Record<string, string> = {
  placed: "Order Placed",
  payment_confirmed: "Payment Confirmed",
  processing: "Processing",
  ready_for_handover: "Ready for Handover",
  handed_over: "Handed Over",
  completed: "Completed",
  cancelled: "Cancelled",
  payment_failed: "Payment Failed",
};

function OrdersTab() {
  const [orders, setOrders] = useState<any[]>([]);
  const [newCount, setNewCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [role, setRole] = useState("super_admin");
  const [note, setNote] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const load = () =>
    fetch("/api/admin/orders", { credentials: "same-origin",  cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.orders)) setOrders(d.orders);
        setNewCount(Number(d.newCount || 0));
      })
      .catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/admin/login", { credentials: "same-origin" }).then((r) => r.json()).then((d) => d.role && setRole(d.role)).catch(() => {});
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  const isSuper = role === "super_admin";
  const act = async (id: string, action: string) => {
    const r = await fetch("/api/admin/orders", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, note: note[id] || "" }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setNote({ ...note, [id]: "" }); load(); }
    else alert(d.error || "Failed");
  };
  const filtered = orders.filter((o) => filter === "all" || o.status === filter);
  const pill = (s: string) =>
    s === "completed" || s === "handed_over" || s === "payment_confirmed"
      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
      : s === "cancelled" || s === "payment_failed"
        ? "bg-red-50 border-red-200 text-red-700"
        : "bg-amber-50 border-amber-200 text-amber-700";
  return (
    <div className="grid gap-4">
      <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">Store Orders • {orders.length}</h2>
          <p className="text-xs text-slate-500 mt-1">{newCount > 0 ? `🔔 ${newCount} new (placed / payment confirmed)` : "No new orders"} • Lifecycle: Placed → Payment Confirmed → Processing → Ready → Handed Over → Completed</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["all", "placed", "payment_confirmed", "processing", "ready_for_handover", "handed_over", "completed", "cancelled"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1.5 rounded-full text-xs border ${filter === f ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>
              {f === "all" ? `All (${orders.length})` : `${ORDER_LABEL[f] || f} (${orders.filter((x) => x.status === f).length})`}
            </button>
          ))}
        </div>
      </div>
      {!isSuper && <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">Read-only for finance — status changes need super_admin.</div>}
      {filtered.length === 0 && <div className="card p-10 text-center text-sm text-slate-500">No {filter} orders yet.</div>}
      {filtered.map((o) => (
        <div key={o.id} className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-navy-900">{o.orderNo}</span>
                <span className={`px-2 py-1 rounded-full text-xs border ${pill(o.status)}`}>{ORDER_LABEL[o.status] || o.status}</span>
                <span className={`px-2 py-1 rounded-full text-xs border ${o.paymentStatus === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : o.paymentStatus === "failed" ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-100 border-slate-200 text-slate-600"}`}>Pay: {o.paymentStatus}</span>
              </div>
              <div className="text-sm text-slate-700 mt-2">{o.name} • <a href={`tel:${o.phone}`} className="text-sky-700 hover:underline">{o.phone}</a> • {o.email}</div>
              <div className="text-xs text-slate-500 mt-1">Ordered {new Date(o.createdAt).toLocaleString("en-IN")}{o.razorpayPaymentId ? ` • Ref: ${o.razorpayPaymentId}` : ""}{o.handedOverAt ? ` • Handed over ${new Date(o.handedOverAt).toLocaleString("en-IN")} by ${o.handedOverBy}` : ""}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xl font-bold text-navy-900">₹{Number(o.subtotal).toLocaleString("en-IN")}</div>
              <button onClick={() => setOpenId(openId === o.id ? null : o.id)} className="mt-1 text-xs text-sky-700 hover:underline">{openId === o.id ? "Hide details ▲" : "Details + history ▼"}</button>
            </div>
          </div>

          {openId === o.id && (
            <div className="mt-4 grid lg:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-bold tracking-widest text-slate-500">ITEMS</div>
                <div className="mt-2 grid gap-2">
                  {(o.items || []).map((it: any) => (
                    <div key={it.id} className="flex justify-between text-sm p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span>{it.name} {it.size ? <b>• Size {it.size}</b> : ""} <span className="text-slate-500">× {it.qty}</span></span>
                      <span className="font-medium">₹{(Number(it.price) * Number(it.qty)).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs tracking-widest font-bold text-slate-500 mt-4">STATUS FLOW</div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                  {ORDER_FLOW.map((s, i) => {
                    const reached = ORDER_FLOW.indexOf(o.status as any) >= i;
                    return (
                      <span key={s} className="flex items-center gap-1">
                        <span className={`px-2 py-1 rounded-full border ${reached ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200 text-slate-400"}`}>{ORDER_LABEL[s]}</span>
                        {i < ORDER_FLOW.length - 1 && <span className="text-slate-300">→</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold tracking-widest text-slate-500">HISTORY / AUDIT TRAIL</div>
                <div className="mt-2 grid gap-1.5 max-h-56 overflow-auto pr-1">
                  {(o.events || []).map((e: any) => (
                    <div key={e.id} className="text-xs p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                      <span className="font-semibold text-navy-900">{e.action.replace(/_/g, " ")}</span>
                      <span className="text-slate-500"> • by {e.actor} • {new Date(e.createdAt).toLocaleString("en-IN")}</span>
                      {e.note && <div className="text-slate-600 mt-0.5">{e.note}</div>}
                    </div>
                  ))}
                  {(o.events || []).length === 0 && <div className="text-xs text-slate-400">No events yet.</div>}
                </div>
                {isSuper && (
                  <div className="mt-3">
                    <input value={note[o.id] || ""} onChange={(e) => setNote({ ...note, [o.id]: e.target.value })} placeholder="Note for handover/cancel (optional)" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs" />
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(o.status === "placed" || o.status === "payment_confirmed") && <button onClick={() => act(o.id, "start_processing")} className="px-3 py-1.5 rounded-full bg-navy-900 text-white text-xs">Start Processing</button>}
                      {["placed", "payment_confirmed", "processing"].includes(o.status) && <button onClick={() => act(o.id, "mark_ready")} className="px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs">Ready for Handover</button>}
                      {["ready_for_handover", "processing", "payment_confirmed"].includes(o.status) && <button onClick={() => { if (confirm(`Confirm handover of ${o.orderNo} to customer?`)) act(o.id, "handover"); }} className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold">✓ Confirm Handover</button>}
                      {o.status === "handed_over" && <button onClick={() => act(o.id, "complete")} className="px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs">Complete Order</button>}
                      {!["handed_over", "completed", "cancelled"].includes(o.status) && <button onClick={() => { if (confirm("Cancel this order?")) act(o.id, "cancel"); }} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs">Cancel</button>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const ADMIN_TABS: { id: string; label: string; desc: string }[] = [
  { id: "dashboard", label: "Dashboard", desc: "Overview & reports" },
  { id: "store", label: "Store Stock", desc: "Inventory" },
  { id: "orders", label: "Orders", desc: "Store orders & handover" },
  { id: "alumni", label: "Alumni", desc: "Alumni stories" },
  { id: "leads", label: "Leads", desc: "Enquiries" },
  { id: "payments", label: "Payments", desc: "Student fee payments" },
  { id: "students", label: "Students", desc: "Enrolled students" },
  { id: "finance", label: "AR / AP", desc: "Receivables / Payables" },
  { id: "dues", label: "Dues & Receipts", desc: "Installments & receipts" },
  { id: "expenses", label: "Expense Tracker", desc: "Expenses & approvals" },
  { id: "admissions", label: "Admissions", desc: "Applications & approvals" },
  { id: "rag", label: "RAG", desc: "Chatbot knowledge" },
  { id: "batches", label: "Batches", desc: "Course batches & capacity" },
  { id: "masters", label: "Masters", desc: "Courses / Durations / Addons / Mediums / Branches" },
  { id: "banner", label: "Banner", desc: "Top announcement" },
  { id: "fees", label: "Fee Config", desc: "Fee per course×mode×duration×medium×branch" },
  { id: "admins", label: "Admins", desc: "Manage admin users (super_admin only)" },
  { id: "carousel", label: "Carousel", desc: "Home page carousel (super_admin only)" },
  { id: "email", label: "Email", desc: "Send updates to users (SMTP)" },
];

function AdminsTab() {
  const [admins, setAdmins] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "admissions" as Role, permissions: [] as string[], isActive: true });

  const load = () => {
    fetch("/api/admin/users", { cache: "no-store", credentials: "same-origin" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setMsg({ type: "err", text: d.error || `Load failed (${r.status}) — ensure you are logged in as super_admin` }); return; }
        if (Array.isArray(d)) setAdmins(d);
      })
      .catch(() => setMsg({ type: "err", text: "Failed to load admins — check network / session" }));
  };
  useEffect(() => { load(); }, []);

  const togglePerm = (perm: string, list: string[], setter: (v: string[]) => void) => {
    if (list.includes(perm)) setter(list.filter((p) => p !== perm));
    else setter([...list, perm]);
  };

  const create = async () => {
    setMsg(null);
    if (!form.email.trim() || !form.email.includes("@")) return setMsg({ type: "err", text: "Valid email required" });
    if (!form.password || form.password.length < 6) return setMsg({ type: "err", text: "Password min 6 chars" });
    if (!form.name.trim()) return setMsg({ type: "err", text: "Name required" });
    const r = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(form) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setMsg({ type: "ok", text: `Created ${d.admin.email} — must change password on first login` });
      setShowCreate(false);
      setForm({ email: "", password: "", name: "", role: "admissions", permissions: [], isActive: true });
      load();
    } else {
      const hint = r.status === 401 ? " (session expired — log in again as super_admin)" : r.status === 403 ? " (need super_admin)" : "";
      setMsg({ type: "err", text: (d.error || "Failed") + hint });
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const r = await fetch("/api/admin/users", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ id: editing.id, name: editing.name, role: editing.role, permissions: editing.permissions, isActive: editing.isActive }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setMsg({ type: "ok", text: "Updated" });
      setEditing(null);
      load();
    } else {
      const hint = r.status === 401 ? " (session expired)" : r.status === 403 ? " (need super_admin)" : "";
      setMsg({ type: "err", text: (d.error || "Failed") + hint });
    }
  };

  const del = async (id: string, email: string) => {
    if (!confirm(`Delete admin ${email}? This will also delete their Supabase auth and sessions.`)) return;
    const r = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setMsg({ type: "ok", text: "Deleted" }); load(); }
    else {
      const hint = r.status === 401 ? " (session expired)" : r.status === 403 ? " (need super_admin)" : "";
      setMsg({ type: "err", text: (d.error || "Failed") + hint });
    }
  };

  const reset = async () => {
    if (!resetTarget) return;
    if (!resetPw || resetPw.length < 6) return setMsg({ type: "err", text: "Password min 6 chars" });
    const r = await fetch("/api/admin/users/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ id: resetTarget.id, newPassword: resetPw }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setMsg({ type: "ok", text: `Password reset for ${resetTarget.email} — they must change on next login` });
      setResetTarget(null); setResetPw("");
      load();
    } else setMsg({ type: "err", text: d.error || "Failed" });
  };

  const filtered = admins.filter((a) => !q || `${a.name} ${a.email} ${a.role} ${a.username}`.toLowerCase().includes(q.toLowerCase()));

  const roleBadge = (r: string) => r === "super_admin" ? "bg-navy-900 text-white border-navy-900" : r === "finance" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-sky-50 border-sky-200 text-sky-700";

  return (
    <div className="grid gap-4">
      <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">Admins • {admins.length}</h2>
          <p className="text-xs text-slate-500 mt-1">Create admins with email + password • they must change on first login • super_admin configures per-admin permissions • deactivating blocks login immediately</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, role…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-sky-500" />
          <button onClick={() => setShowCreate(true)} className="btn-primary !py-2 !px-4 text-sm whitespace-nowrap">+ Create Admin</button>
        </div>
      </div>

      {msg && <div className={`px-4 py-3 rounded-xl border text-sm ${msg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>{msg.text}</div>}

      <div className="grid gap-3">
        {filtered.map((a) => (
          <div key={a.id} className="card p-4 flex flex-col lg:flex-row lg:items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-navy-900">{a.name}</span>
                <span className={`text-xs px-2 py-1 rounded-full border capitalize ${roleBadge(a.role)}`}>{a.role.replace("_", " ")}</span>
                {!a.isActive && <span className="text-xs px-2 py-1 rounded-full bg-red-50 border border-red-200 text-red-700">Deactivated</span>}
                {a.mustChangePassword && <span className="text-xs px-2 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">Must change password</span>}
              </div>
              <div className="text-sm text-slate-600 mt-1">{a.email} <span className="text-slate-400">• @{a.username}</span></div>
              <div className="text-xs text-slate-500 mt-1">Created {new Date(a.createdAt).toLocaleDateString("en-IN")} • Updated {new Date(a.updatedAt).toLocaleDateString("en-IN")}</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(a.permissions && a.permissions.length > 0 ? a.permissions : (roleTabs[a.role as Role] || [])).map((p: string) => (
                  <span key={p} className="text-[11px] px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600">{p}</span>
                ))}
                {(!a.permissions || a.permissions.length === 0) && <span className="text-[11px] px-2 py-1 rounded-full bg-slate-100 border text-slate-500">role default • {roleTabs[a.role as Role]?.length || 0} tabs</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 shrink-0">
              <button onClick={() => setEditing({ ...a, permissions: a.permissions || [] })} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs hover:bg-slate-50">Edit</button>
              <button onClick={() => setResetTarget(a)} className="px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs hover:bg-amber-100">Reset PW</button>
              <button onClick={() => del(a.id, a.email)} className="px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs text-red-600 hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="card p-8 text-center text-sm text-slate-500">No admins match “{q}”</div>}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm p-4 grid place-items-center" onClick={() => setShowCreate(false)}>
          <div className="card w-full max-w-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">Create Admin</h3>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center">✕</button>
            </div>
            <p className="text-xs text-slate-500 mt-1">Email + password • they will be forced to change on first login. Configure role + per-tab permissions.</p>
            <div className="mt-4 grid gap-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Email *</label>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@ayaaninstitute.in" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium">Full Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Finance Officer" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">Temporary Password *</label>
                  <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 chars" type="password" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" />
                  <div className="text-[11px] text-amber-600 mt-1">User must change on first login</div>
                </div>
                <div>
                  <label className="text-xs font-medium">Role *</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm bg-white">
                    <option value="super_admin">super_admin — all tabs</option>
                    <option value="finance">finance — dashboard, payments, finance, dues, expenses, orders, fees</option>
                    <option value="admissions">admissions — dashboard, admissions, leads, students, alumni</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium">Per-tab Permissions (optional override)</label>
                <div className="text-[11px] text-slate-500">If you select any, the admin will only see those tabs (instead of role defaults). Leave empty to use role defaults.</div>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-3 rounded-xl bg-slate-50 border max-h-52 overflow-auto">
                  {ADMIN_TABS.map((t) => (
                    <label key={t.id} className="flex items-start gap-1.5 text-xs p-1.5 rounded hover:bg-white cursor-pointer border border-transparent hover:border-slate-200">
                      <input type="checkbox" checked={form.permissions.includes(t.id)} onChange={() => togglePerm(t.id, form.permissions, (v) => setForm({ ...form, permissions: v }))} className="mt-0.5" />
                      <span><span className="font-medium">{t.label}</span><span className="block text-[11px] text-slate-500">{t.desc}</span></span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <button onClick={() => setForm({ ...form, permissions: ADMIN_TABS.map((t) => t.id) })} className="text-sky-700 hover:underline">Select all</button>
                  <button onClick={() => setForm({ ...form, permissions: [] })} className="text-slate-500 hover:underline">Clear (use role defaults)</button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (can login)</label>
              <div className="flex gap-2">
                <button onClick={create} className="flex-1 btn-primary justify-center">Create Admin →</button>
                <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 rounded-full border text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm p-4 grid place-items-center" onClick={() => setEditing(null)}>
          <div className="card w-full max-w-xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">Edit {editing.email}</h3>
              <button onClick={() => setEditing(null)} className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center">✕</button>
            </div>
            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs font-medium">Name</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Role</label>
                <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm bg-white">
                  <option value="super_admin">super_admin</option>
                  <option value="finance">finance</option>
                  <option value="admissions">admissions</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Permissions (override role defaults)</label>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-3 rounded-xl bg-slate-50 border max-h-52 overflow-auto">
                  {ADMIN_TABS.map((t) => (
                    <label key={t.id} className="flex items-start gap-1.5 text-xs p-1.5 rounded hover:bg-white cursor-pointer">
                      <input type="checkbox" checked={editing.permissions?.includes(t.id)} onChange={() => togglePerm(t.id, editing.permissions || [], (v) => setEditing({ ...editing, permissions: v }))} className="mt-0.5" />
                      <span><span className="font-medium">{t.label}</span><span className="block text-[11px] text-slate-500">{t.desc}</span></span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 flex gap-2 text-xs">
                  <button onClick={() => setEditing({ ...editing, permissions: ADMIN_TABS.map((t) => t.id) })} className="text-sky-700 hover:underline">Select all</button>
                  <button onClick={() => setEditing({ ...editing, permissions: [] })} className="text-slate-500 hover:underline">Clear (use role defaults)</button>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Active</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!editing.mustChangePassword} onChange={(e) => setEditing({ ...editing, mustChangePassword: e.target.checked })} /> Must change password on next login</label>
              <div className="flex gap-2">
                <button onClick={saveEdit} className="flex-1 btn-primary justify-center">Save Changes →</button>
                <button onClick={() => setEditing(null)} className="px-4 py-2.5 rounded-full border text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm p-4 grid place-items-center" onClick={() => setResetTarget(null)}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-navy-900">Reset Password — {resetTarget.email}</h3>
            <p className="text-xs text-slate-500 mt-1">Sets new temporary password and forces change on next login. Old sessions will be revoked.</p>
            <input value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="New temporary password (min 6)" type="password" className="mt-4 w-full px-3 py-2.5 rounded-xl border text-sm" />
            <div className="mt-4 flex gap-2">
              <button onClick={reset} className="flex-1 btn-primary justify-center">Reset & Force Change →</button>
              <button onClick={() => setResetTarget(null)} className="px-4 py-2.5 rounded-full border text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CarouselTab() {
  const [slides, setSlides] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ image: "", badge: "", title: "", highlight: "", desc: "", ctaLabel: "Learn More →", ctaHref: "/courses", cta2Label: "", cta2Href: "", accent: "from-sky-600 to-navy-900", order: 0, active: true });
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const load = () => fetch("/api/admin/carousel", { credentials: "same-origin",  cache: "no-store" }).then((r) => r.json()).then((d) => Array.isArray(d) && setSlides(d)).catch(() => {});
  useEffect(() => { load(); }, []);

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return setMsg({ type: "err", text: "Image must be under 2MB" });
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/admin/carousel/upload", { credentials: "same-origin",  method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setUploading(false);
    if (r.ok && d.url) {
      setForm({ ...form, image: d.url });
      setMsg({ type: "ok", text: "Image uploaded — preview below" });
    } else setMsg({ type: "err", text: d.error || "Upload failed" });
  };

  const save = async () => {
    if (!form.image.trim()) return setMsg({ type: "err", text: "Image required — upload or paste URL" });
    const payload: any = editing ? { id: editing.id, ...form } : form;
    const r = await fetch("/api/admin/carousel", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      setMsg({ type: "ok", text: editing ? "Updated" : "Created" });
      setShowForm(false); setEditing(null); setForm({ image: "", badge: "", title: "", highlight: "", desc: "", ctaLabel: "Learn More →", ctaHref: "/courses", cta2Label: "", cta2Href: "", accent: "from-sky-600 to-navy-900", order: 0, active: true });
      load();
    } else setMsg({ type: "err", text: d.error || "Failed" });
  };

  const startEdit = (s: any) => {
    setEditing(s);
    setForm({ image: s.image, badge: s.badge || "", title: s.title || "", highlight: s.highlight || "", desc: s.desc || "", ctaLabel: s.ctaLabel || "", ctaHref: s.ctaHref || "", cta2Label: s.cta2Label || "", cta2Href: s.cta2Href || "", accent: s.accent || "from-sky-600 to-navy-900", order: s.order || 0, active: s.active !== false });
    setShowForm(true);
  };

  const del = async (id: string) => {
    if (!confirm("Delete this slide?")) return;
    const r = await fetch(`/api/admin/carousel?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (r.ok) load(); else alert("Delete failed");
  };

  const toggle = async (s: any) => {
    await fetch("/api/admin/carousel", { credentials: "same-origin",  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, active: !s.active }) });
    load();
  };

  const move = async (s: any, dir: -1 | 1) => {
    const sorted = [...slides].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((x) => x.id === s.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    await fetch("/api/admin/carousel", { credentials: "same-origin",  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id, order: b.order }) });
    await fetch("/api/admin/carousel", { credentials: "same-origin",  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.id, order: a.order }) });
    load();
  };

  const filtered = slides.filter((s) => !q || `${s.title} ${s.badge} ${s.desc}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid gap-4">
      <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">Carousel • {slides.length} slides</h2>
          <p className="text-xs text-slate-500 mt-1">Upload images (JPG/PNG/WEBP ≤2MB) — stored in Supabase <b>carousel</b> bucket as files you can change anytime. No external links.</p>
        </div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="px-3 py-2 rounded-full border border-slate-200 text-sm w-36" />
          <button onClick={() => { setEditing(null); setForm({ image: "", badge: "", title: "", highlight: "", desc: "", ctaLabel: "Learn More →", ctaHref: "/courses", cta2Label: "", cta2Href: "", accent: "from-sky-600 to-navy-900", order: slides.length, active: true }); setShowForm(true); }} className="btn-primary !py-2 !px-4 text-sm">+ New Slide</button>
        </div>
      </div>

      {msg && <div className={`px-4 py-3 rounded-xl border text-sm ${msg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>{msg.text}</div>}

      <div className="grid gap-3">
        {filtered.sort((a, b) => a.order - b.order).map((s) => (
          <div key={s.id} className="card p-4 flex gap-4">
            <img src={s.image} alt={s.title} className="w-40 h-24 object-cover rounded-xl border border-slate-200 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-navy-900 text-sm">{s.title || "Untitled"} <span className="font-light">{s.highlight}</span></span>
                <span className="text-xs px-2 py-1 rounded-full border bg-slate-50">#{s.order}</span>
                <span className={`text-xs px-2 py-1 rounded-full border ${s.active ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-slate-100 border-slate-200 text-slate-500"}`}>{s.active ? "active" : "hidden"}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">{s.badge}</div>
              <div className="text-xs text-slate-600 mt-1 line-clamp-2">{s.desc}</div>
              <div className="text-xs text-slate-500 mt-1">CTA: {s.ctaLabel} → {s.ctaHref} {s.cta2Label ? `• ${s.cta2Label} → ${s.cta2Href}` : ""}</div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <div className="flex gap-1">
                <button onClick={() => move(s, -1)} className="px-2 py-1 rounded-full bg-white border text-xs">↑</button>
                <button onClick={() => move(s, 1)} className="px-2 py-1 rounded-full bg-white border text-xs">↓</button>
              </div>
              <button onClick={() => toggle(s)} className={`px-3 py-1.5 rounded-full text-xs border ${s.active ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{s.active ? "Hide" : "Show"}</button>
              <button onClick={() => startEdit(s)} className="px-3 py-1.5 rounded-full bg-white border text-xs">Edit</button>
              <button onClick={() => del(s.id)} className="px-3 py-1.5 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs">Delete</button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="card p-8 text-center text-sm text-slate-500">No slides. Create one → upload an image file.</div>}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm p-4 grid place-items-center" onClick={() => setShowForm(false)}>
          <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">{editing ? `Edit Slide #${editing.order}` : "New Slide — upload image file"}</h3>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center">✕</button>
            </div>
            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs font-medium">Image * — upload file (JPG/PNG/WEBP ≤2MB)</label>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0])} className="mt-1 w-full px-3 py-2 rounded-xl border text-sm bg-white" />
                {uploading && <div className="text-xs text-sky-600 mt-1">Uploading…</div>}
                {form.image && <img src={form.image} alt="preview" className="mt-2 w-full h-40 object-cover rounded-xl border" />}
                <div className="text-[11px] text-slate-500 mt-1">Stored as file in Supabase <b>carousel</b> bucket — you can replace anytime. No external link needed.</div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium">Badge</label><input value={form.badge} onChange={(e) => setForm({ ...form, badge: e.target.value })} placeholder="SI • CONSTABLE • MOST DEMANDED" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
                <div><label className="text-xs font-medium">Accent</label><select value={form.accent} onChange={(e) => setForm({ ...form, accent: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm bg-white"><option value="from-sky-600 to-navy-900">Sky → Navy</option><option value="from-emerald-600 to-teal-800">Emerald → Teal</option><option value="from-amber-600 to-orange-700">Amber → Orange</option><option value="from-violet-600 to-indigo-800">Violet → Indigo</option><option value="from-slate-800 to-navy-900">Slate → Navy</option></select></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium">Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Wear the Khaki" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
                <div><label className="text-xs font-medium">Highlight</label><input value={form.highlight} onChange={(e) => setForm({ ...form, highlight: e.target.value })} placeholder="with Pride." className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              </div>
              <div><label className="text-xs font-medium">Description</label><textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} rows={2} placeholder="Telangana's No.1 …" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium">CTA Label</label><input value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} placeholder="Join SI Batch →" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
                <div><label className="text-xs font-medium">CTA Href</label><input value={form.ctaHref} onChange={(e) => setForm({ ...form, ctaHref: e.target.value })} placeholder="/admission" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium">CTA2 Label (optional)</label><input value={form.cta2Label} onChange={(e) => setForm({ ...form, cta2Label: e.target.value })} placeholder="View Batches" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
                <div><label className="text-xs font-medium">CTA2 Href</label><input value={form.cta2Href} onChange={(e) => setForm({ ...form, cta2Href: e.target.value })} placeholder="/courses" className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-medium">Order</label><input type="number" min={0} value={form.order} onChange={(e) => setForm({ ...form, order: parseInt(e.target.value) || 0 })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
                <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
              </div>
              <div className="flex gap-2">
                <button onClick={save} disabled={uploading} className="flex-1 btn-primary justify-center disabled:opacity-50">{editing ? "Update Slide →" : "Create Slide →"}</button>
                <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-full border text-sm">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailTab() {
  const [smtp, setSmtp] = useState<any>(null);
  const [tab, setTab] = useState<"single" | "bulk">("single");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [bulkType, setBulkType] = useState<"admissions" | "users">("admissions");
  const [bulkCourse, setBulkCourse] = useState("");
  const [bulkBranch, setBulkBranch] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [branchOptions, setBranchOptions] = useState<string[]>([]);
  const [courseOptions, setCourseOptions] = useState<string[]>([]);

  const loadSmtp = () => fetch("/api/admin/email", { credentials: "same-origin",  cache: "no-store" }).then((r) => r.json()).then(setSmtp).catch(() => {});
  useEffect(() => {
    loadSmtp();
    fetch("/api/branches").then((r) => r.json()).then((d) => Array.isArray(d) && setBranchOptions(d.map((b: any) => b.name))).catch(() => {});
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const title: string = String(c.title || "");
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          return String(c.slug || title).trim();
        }).filter(Boolean);
        setCourseOptions(Array.from(new Set(opts)));
      }
    }).catch(() => {});
  }, []);

  const preview = async () => {
    const qs = new URLSearchParams({ type: bulkType, course: bulkCourse, branch: bulkBranch, status: bulkStatus }).toString();
    const r = await fetch(`/api/admin/email?${qs}`, { cache: "no-store" });
    const d = await r.json();
    setCount(d.count ?? 0);
    setSmtp(d);
  };

  const sendSingle = async () => {
    if (!to.trim() || !subject.trim() || !html.trim()) return setMsg({ type: "err", text: "to, subject, html required" });
    setSending(true); setMsg(null);
    const r = await fetch("/api/admin/email", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, subject, html }) });
    const d = await r.json().catch(() => ({}));
    setSending(false);
    if (r.ok) setMsg({ type: "ok", text: d.skipped ? `Logged (SMTP not configured) — would send to ${to}` : `Sent to ${to} ✓ ${d.id || ""}` });
    else setMsg({ type: "err", text: d.error || "Failed" });
  };

  const sendBulk = async () => {
    if (!subject.trim() || !html.trim()) return setMsg({ type: "err", text: "subject and html required" });
    setSending(true); setMsg(null);
    const r = await fetch("/api/admin/email", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject, html, bulk: { type: bulkType, filter: { course: bulkCourse || undefined, branch: bulkBranch || undefined, status: bulkStatus || undefined } } }) });
    const d = await r.json().catch(() => ({}));
    setSending(false);
    if (r.ok) setMsg({ type: "ok", text: `Bulk: sent ${d.sent} • failed ${d.failed} • total ${d.recipients} ${bulkType}` + (d.errors?.length ? ` • ${d.errors.slice(0,2).join("; ")}` : "") });
    else setMsg({ type: "err", text: d.error || "Failed" });
  };

  const sendTest = async () => {
    const r = await fetch("/api/admin/email", { credentials: "same-origin",  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: smtp?.smtpFrom || to || "test@example.com", subject: "Ayaan SMTP test ✓", html: "<p>This is a test from Ayaan Admin → Email. If you see this, SMTP works.</p>" }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setMsg({ type: "ok", text: d.skipped ? "Logged (SMTP not configured)" : `Test sent ✓ ${d.id || ""}` });
    else setMsg({ type: "err", text: d.error || "Failed" });
  };

  return (
    <div className="grid gap-6">
      <div className="card p-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div><h2 className="font-semibold text-navy-900">Email • Send updates to users (SMTP)</h2><p className="text-xs text-slate-500 mt-1">Auto-emails already fire on: application submitted / approved / rejected / clarification, discount, payment acknowledged/rejected. Use this for custom updates (admission, payments, or any announcement).</p></div>
          <button onClick={loadSmtp} className="px-3 py-1.5 rounded-full bg-white border text-xs">Refresh</button>
        </div>
        <div className={`mt-3 px-3 py-2 rounded-xl border text-xs flex items-center gap-2 ${smtp?.configured ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          <span className={`w-2 h-2 rounded-full ${smtp?.configured ? "bg-emerald-500" : "bg-amber-500"}`} /> {smtp?.configured ? `SMTP ready — ${smtp.smtpHost} • from ${smtp.smtpFrom}` : "SMTP not configured — emails will be logged, not sent. Set SMTP_HOST/PORT/USER/PASS/FROM in env (see .env.example)"}
          <button onClick={sendTest} className="ml-auto px-3 py-1 rounded-full bg-white border text-xs">Send test</button>
        </div>
        <div className="mt-3 flex gap-2">
          <button onClick={() => setTab("single")} className={`px-4 py-2 rounded-full text-xs font-medium border ${tab === "single" ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>Single / Comma-separated</button>
          <button onClick={() => setTab("bulk")} className={`px-4 py-2 rounded-full text-xs font-medium border ${tab === "bulk" ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200"}`}>Bulk by filter</button>
        </div>
      </div>

      {tab === "single" ? (
        <div className="card p-6 grid gap-3">
          <h3 className="font-semibold text-navy-900 text-sm">Send to specific emails</h3>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="to@example.com, cc2@example.com" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (e.g., Admission update — Your batch starts 1st Oct)" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="HTML body (you can paste &lt;p&gt;… or plain text — will be wrapped in Ayaan header/footer automatically)" rows={7} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono" />
          <div className="flex gap-2">
            <button onClick={sendSingle} disabled={sending} className="btn-primary justify-center disabled:opacity-50">{sending ? "Sending…" : "Send Email →"}</button>
            <button onClick={() => { setTo(""); setSubject(""); setHtml(""); setMsg(null); }} className="px-4 py-2.5 rounded-full border text-sm">Clear</button>
          </div>
          {msg && <div className={`px-3 py-2 rounded-xl border text-xs ${msg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>{msg.text}</div>}
          <div className="text-[11px] text-slate-400">Supports comma-separated `to`. Use HTML for rich content; plain text will be wrapped.</div>
        </div>
      ) : (
        <div className="card p-6 grid gap-3">
          <h3 className="font-semibold text-navy-900 text-sm">Bulk — filtered admissions or users</h3>
          <div className="grid sm:grid-cols-4 gap-2">
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value as any)} className="px-3 py-2.5 rounded-xl border bg-white text-sm"><option value="admissions">Admissions (applicants)</option><option value="users">Users (students)</option></select>
            <select value={bulkCourse} onChange={(e) => setBulkCourse(e.target.value)} className="px-3 py-2.5 rounded-xl border bg-white text-sm"><option value="">All courses</option>{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <select value={bulkBranch} onChange={(e) => setBulkBranch(e.target.value)} className="px-3 py-2.5 rounded-xl border bg-white text-sm"><option value="">All branches</option>{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="px-3 py-2.5 rounded-xl border bg-white text-sm"><option value="">All statuses</option><option value="pending">pending</option><option value="approved">approved</option><option value="clarification_required">clarification_required</option><option value="discount_pending">discount_pending</option><option value="rejected">rejected</option></select>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={preview} className="px-4 py-2 rounded-full bg-white border text-xs">Preview count</button>
            {count !== null && <span className="text-xs px-3 py-2 rounded-full bg-slate-50 border">{count} recipients match</span>}
          </div>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
          <textarea value={html} onChange={(e) => setHtml(e.target.value)} placeholder="HTML body" rows={7} className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-mono" />
          <div className="flex gap-2">
            <button onClick={sendBulk} disabled={sending} className="btn-primary justify-center disabled:opacity-50">{sending ? "Sending bulk…" : `Send bulk → ${count !== null ? count + " recipients" : ""}`}</button>
            <button onClick={() => { setBulkCourse(""); setBulkBranch(""); setBulkStatus(""); setCount(null); setMsg(null); }} className="px-4 py-2.5 rounded-full border text-sm">Clear filters</button>
          </div>
          {msg && <div className={`px-3 py-2 rounded-xl border text-xs ${msg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>{msg.text}</div>}
          <div className="text-[11px] text-slate-400">Bulk sends sequentially (rate-limited) and is audit-logged. Max 2000 per send.</div>
        </div>
      )}
    </div>
  );
}
