"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AYAAN_APP_URL } from "@/lib/appConfig";

type NavItem = { label: string; href: string; external?: boolean };
const nav: NavItem[] = [
  { label: "About Us", href: "/about" },
  { label: "Aspirant Corner", href: "/courses" },
  { label: "Tests", href: AYAAN_APP_URL, external: true },
  { label: "Alumni", href: "/alumni" },
  { label: "Store", href: "/store" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [auth, setAuth] = useState<null | { role: string; name: string; email: string; isAdmin: boolean; isStudent: boolean }>(null);
  const router = useRouter();

  const fetchAuth = async () => {
    try {
      // Try student first (more specific), then admin
      const [meRes, adminRes] = await Promise.all([
        fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ authenticated: false })),
        fetch("/api/admin/login", { cache: "no-store", credentials: "same-origin" }).then((r) => r.json()).catch(() => ({ authenticated: false })),
      ]);
      if (meRes?.authenticated && meRes?.user) {
        setAuth({ role: "student", name: meRes.user.name || meRes.user.email || "Student", email: meRes.user.email || "", isAdmin: false, isStudent: true });
        return;
      }
      if (adminRes?.authenticated) {
        // adminRes is authenticated; check role — if student, treat as student (fallback already handled), else admin
        const role = String(adminRes.role || "").toLowerCase();
        if (role && role !== "student") {
          setAuth({ role: adminRes.role, name: adminRes.name || adminRes.user || adminRes.email || "Admin", email: adminRes.email || "", isAdmin: true, isStudent: false });
          return;
        }
        // role is student but meRes failed — still student
        if (role === "student") {
          setAuth({ role: "student", name: adminRes.name || adminRes.user || "Student", email: adminRes.email || "", isAdmin: false, isStudent: true });
          return;
        }
      }
      setAuth(null);
    } catch {
      setAuth(null);
    }
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    fetchAuth();
    const onVis = () => { if (document.visibilityState === "visible") fetchAuth(); };
    const onStorage = (e: StorageEvent) => { if (e.key === "ayaan_session" || e.key === "ayaan_banner_updated") fetchAuth(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", onStorage);
    const onCustom = () => fetchAuth();
    window.addEventListener("ayaan_auth_changed", onCustom as EventListener);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("ayaan_auth_changed", onCustom as EventListener);
    };
  }, []);

  const logout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
    try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
    setAuth(null);
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <header
        className={`sticky top-0 z-40 transition ${scrolled ? "bg-white/90 backdrop-blur-xl shadow-sm" : "bg-white/80 backdrop-blur-xl"}`}
      >

        <div className="container-soft">
          <div className="h-[72px] flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3 shrink-0">
              <div className="w-10 h-10 rounded-xl bg-navy-800 text-white grid place-items-center font-display font-bold text-[15px]">A</div>
              <div className="leading-tight hidden sm:block">
                <div className="font-display font-bold text-[16px] tracking-tight text-navy-800">AYAAN INSTITUTE</div>
                <div className="text-[11px] tracking-[0.14em] text-slate-500 font-medium">GROUP OF COMPETITIVE INSTITUTIONS</div>
              </div>
              <div className="sm:hidden font-display font-bold text-navy-800">AYAAN</div>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {nav.map((n) => (
                n.external ? (
                  <a
                    key={n.label}
                    href={n.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 rounded-full text-sm font-medium text-slate-600 hover:text-navy-800 hover:bg-slate-50 transition"
                  >
                    {n.label} ↗
                  </a>
                ) : (
                  <Link
                    key={n.label}
                    href={n.href}
                    className="px-4 py-2 rounded-full text-sm font-medium text-slate-600 hover:text-navy-800 hover:bg-slate-50 transition"
                  >
                    {n.label}
                  </Link>
                )
              ))}
            </nav>

            <div className="hidden lg:flex items-center gap-2">
              <Link href="/admission" className="inline-flex px-4 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold hover:bg-amber-100 shadow-sm whitespace-nowrap">
                Get Registered
              </Link>
              {auth ? (
                <div className="flex items-center gap-2 pl-2">
                  <Link href={auth.isAdmin ? "/admin" : "/account"} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-navy-900 text-white text-sm font-medium hover:bg-navy-800 transition">
                    <span className="w-6 h-6 rounded-full bg-white/20 grid place-items-center text-xs font-bold">{auth.name.trim().charAt(0).toUpperCase()}</span>
                    <span className="max-w-[14ch] truncate">{auth.name}</span>
                    <span className="hidden xl:inline text-xs font-normal opacity-70">• {auth.role}</span>
                  </Link>
                  <button onClick={logout} className="text-xs font-medium text-slate-600 hover:text-red-600 px-2">Logout</button>
                </div>
              ) : (
                <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-navy-800 px-2">
                  Login
                </Link>
              )}
            </div>

            <div className="flex lg:hidden items-center gap-2">
              <button
                onClick={() => setOpen(!open)}
                className="w-10 h-10 rounded-full border border-slate-200 grid place-items-center bg-white"
                aria-label="Menu"
              >
                <span className="text-lg">{open ? "✕" : "☰"}</span>
              </button>
            </div>
          </div>

          {open && (
            <div className="lg:hidden pb-6 border-t border-slate-100 pt-4 grid gap-1">
              {nav.map((n) => (
                n.external ? (
                  <a
                    key={n.label}
                    href={n.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpen(false)}
                    className="px-4 py-3 rounded-xl hover:bg-slate-50 font-medium flex items-center justify-between"
                  >
                    {n.label} ↗
                  </a>
                ) : (
                  <Link
                    key={n.label}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className="px-4 py-3 rounded-xl hover:bg-slate-50 font-medium flex items-center justify-between"
                  >
                    {n.label} <span className="text-slate-400">→</span>
                  </Link>
                )
              ))}
              <Link href="/admission" onClick={() => setOpen(false)} className="btn-primary mt-3 justify-center">
                Get Registered →
              </Link>
              {auth ? (
                <div className="mt-2 grid gap-2">
                  <Link href={auth.isAdmin ? "/admin" : "/account"} onClick={() => setOpen(false)} className="w-full py-3 rounded-xl bg-navy-900 text-white grid place-items-center text-sm font-medium">
                    👤 {auth.name} • {auth.role} → {auth.isAdmin ? "Admin" : "My Account"}
                  </Link>
                  <button onClick={() => { setOpen(false); logout(); }} className="w-full py-3 rounded-xl border border-slate-200 bg-white grid place-items-center text-sm font-medium hover:bg-slate-50 text-red-600">
                    Logout
                  </button>
                </div>
              ) : (
                <Link href="/login" onClick={() => setOpen(false)} className="mt-2 w-full py-3 rounded-xl border border-slate-200 bg-white grid place-items-center text-sm font-medium hover:bg-slate-50">
                  Login to Account
                </Link>
              )}
              <div className="mt-3 flex gap-2 text-xs">
                <a href="tel:+918886667222" className="flex-1 py-3 rounded-xl border border-slate-200 grid place-items-center font-medium">
                  Call
                </a>
                <a
                  href="https://api.whatsapp.com/send?phone=918886667222"
                  target="_blank"
                  className="flex-1 py-3 rounded-xl bg-[#25D366] text-white grid place-items-center font-medium"
                >
                  WhatsApp
                </a>
              </div>
            </div>
          )}
        </div>
      </header>
    </>
  );
}
