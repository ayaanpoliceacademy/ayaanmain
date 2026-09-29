"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthForgotPassword from "@/components/AuthForgotPassword";

export default function LoginPage() {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const router = useRouter();

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: id, password: pw }) });
    const data = await r.json();
    setLoading(false);
    if (r.ok) {
      try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
      router.push(data.mustChangePassword ? "/change-password" : "/account");
      router.refresh();
    } else setErr(data.error || "Login failed");
  };

  return (
    <div className="min-h-[70vh] bg-slate-50 grid place-items-center p-4">
      <div className="card p-8 w-full max-w-md">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-navy-900 text-white grid place-items-center font-bold mx-auto">A</div>
          <h1 className="mt-3 font-display font-bold text-xl text-navy-900">Student Login</h1>
          <p className="text-sm text-slate-500">Use email/phone + password created by admin after admission approval</p>
        </div>
        <form onSubmit={doLogin} className="mt-6 grid gap-3">
          <input value={id} onChange={(e) => setId(e.target.value)} placeholder="Email or Phone" required className="px-4 py-3 rounded-xl border border-slate-200 text-sm" />
          <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" type="password" required className="px-4 py-3 rounded-xl border border-slate-200 text-sm" />
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{err}</div>}
          <button type="submit" disabled={loading} className="btn-primary justify-center disabled:opacity-50">{loading ? "Signing in…" : "Login →"}</button>
          <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-sky-700 hover:underline text-center">Forgot password? Reset with OTP to email →</button>
        </form>
        <div className="mt-4 text-center text-xs text-slate-500">
          No account yet? <Link href="/admission" className="text-sky-700 hover:underline">Apply for Admission</Link> • <Link href="/admin" className="text-slate-400">Admin</Link>
        </div>
        {showForgot && <AuthForgotPassword onClose={() => setShowForgot(false)} defaultEmail={id.includes("@") ? id : ""} />}
      </div>
    </div>
  );
}
