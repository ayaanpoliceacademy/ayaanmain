"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Slide = {
  id: string | number;
  badge: string;
  title: string;
  highlight: string;
  desc: string;
  cta: { label: string; href: string };
  cta2?: { label: string; href: string };
  image: string;
  accent: string;
};

const fallbackSlides: Slide[] = [
  {
    id: 1,
    badge: "SI • CONSTABLE • MOST DEMANDED",
    title: "Wear the Khaki",
    highlight: "with Pride.",
    desc: "Telangana's No.1 for Uniform Jobs. 9 Years • 5000+ Selections. Written + Physical under one roof.",
    cta: { label: "Join SI Batch →", href: "/admission" },
    cta2: { label: "View Batches", href: "/courses" },
    image: "https://images.unsplash.com/photo-1542395975-d6d3f2761a28?q=80&w=1600&auto=format&fit=crop",
    accent: "from-sky-600 to-navy-900",
  },
  {
    id: 2,
    badge: "DEFENCE • ARMY • NAVY • AIRFORCE",
    title: "Serve the Nation",
    highlight: "in Uniform.",
    desc: "3-Level Grounds • L1 Track • L2 Strength • L3 Events. Trained by Mohd. Anwar Sir — International Athlete.",
    cta: { label: "Defence Coaching →", href: "/courses" },
    cta2: { label: "Pro Fitness", href: "/academy" },
    image: "https://images.unsplash.com/photo-1551836022-deb4988cc6c0?q=80&w=1600&auto=format&fit=crop",
    accent: "from-emerald-600 to-teal-800",
  },
  {
    id: 3,
    badge: "GROUPS 1/2/3/4 • STATE SERVICES",
    title: "Crack Groups",
    highlight: "& State Services.",
    desc: "Updated syllabus + Daily Current Affairs + Weekly Grand Tests. Bilingual — Telugu & English.",
    cta: { label: "Explore Groups →", href: "/courses" },
    image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?q=80&w=1600&auto=format&fit=crop",
    accent: "from-amber-600 to-orange-700",
  },
  {
    id: 4,
    badge: "RESIDENTIAL • INDIA'S FIRST • 15 ACRES",
    title: "Live. Learn.",
    highlight: "Conquer.",
    desc: "Bollikunta, Warangal — Classroom + Grounds + Hostel within 100m. 4am Study • Daily Tests • 24×7 Library.",
    cta: { label: "Aspirant Corner →", href: "/academy" },
    cta2: { label: "Book Hostel Tour", href: "/contact" },
    image: "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1600&auto=format&fit=crop",
    accent: "from-violet-600 to-indigo-800",
  },
  {
    id: 5,
    badge: "UPSC • CIVIL SERVICES • PRELIMS + MAINS",
    title: "Dream UPSC.",
    highlight: "We Guide.",
    desc: "GS 1-4 • Essay • CSAT • Optional • Daily Answer Writing • Mock Interviews by Ex-Bureaucrats.",
    cta: { label: "UPSC Batches →", href: "/courses" },
    image: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?q=80&w=1600&auto=format&fit=crop",
    accent: "from-slate-800 to-navy-900",
  },
];

export default function HeroCarousel() {
  // null = still loading, [] = admin deleted every slide (render nothing), array = show these.
  // The DB is the source of truth — fallback slides are used ONLY when the request fails,
  // never when the API legitimately returns an empty list (that is how deleted slides used
  // to keep reappearing on the homepage).
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/carousel", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`carousel ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        const mapped: Slide[] = (Array.isArray(d) ? d : []).map((s: any) => ({
          id: s.id,
          badge: s.badge || "",
          title: s.title || "",
          highlight: s.highlight || "",
          desc: s.desc || "",
          cta: { label: s.ctaLabel || "Learn More →", href: s.ctaHref || "/courses" },
          cta2: s.cta2Label ? { label: s.cta2Label, href: s.cta2Href || "/contact" } : undefined,
          image: s.image,
          accent: s.accent || "from-sky-600 to-navy-900",
        }));
        setSlides(mapped);
        setActive(0);
      })
      .catch(() => {
        // Network/server failure only — fall back so the hero is never blank
        if (!cancelled) { setSlides(fallbackSlides); setActive(0); }
      });
    return () => { cancelled = true; };
  }, []);

  // Poll so admin add/edit/delete appears without a manual refresh
  useEffect(() => {
    const id = setInterval(() => {
      fetch("/api/carousel", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!Array.isArray(d)) return;
          const mapped: Slide[] = d.map((s: any) => ({
            id: s.id,
            badge: s.badge || "",
            title: s.title || "",
            highlight: s.highlight || "",
            desc: s.desc || "",
            cta: { label: s.ctaLabel || "Learn More →", href: s.ctaHref || "/courses" },
            cta2: s.cta2Label ? { label: s.cta2Label, href: s.cta2Href || "/contact" } : undefined,
            image: s.image,
            accent: s.accent || "from-sky-600 to-navy-900",
          }));
          setSlides((prev) => {
            if (prev === null) return mapped;
            // only reset the active index when the set of slides actually changed
            const same = prev.length === mapped.length && prev.every((p, i) => p.id === mapped[i].id && p.image === mapped[i].image);
            if (!same) setActive(0);
            return mapped;
          });
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (paused || !slides || slides.length <= 1) return;
    const id = setInterval(() => setActive((i) => (i + 1) % slides.length), 4000);
    return () => clearInterval(id);
  }, [paused, slides]);

  // Render nothing while loading or when every slide was deleted. Critically, the
  // fallback slides are NOT shown here — doing so is what made deleted images
  // "persist". A neutral skeleton keeps the layout stable without stale content.
  if (slides === null) {
    return (
      <div className="relative w-full overflow-hidden bg-slate-900">
        <div className="relative h-[62vh] sm:h-[64vh] lg:h-[68vh] min-h-[480px] max-h-[720px]">
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 animate-pulse" />
        </div>
      </div>
    );
  }
  if (slides.length === 0) return null;

  const list = slides;
  const go = (i: number) => setActive((i + list.length) % list.length);

  return (
    <div
      className="relative w-full overflow-hidden bg-slate-900"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      {/* slides */}
      <div className="relative h-[62vh] sm:h-[64vh] lg:h-[68vh] min-h-[480px] max-h-[720px]">
        {list.map((s, idx) => (
          <div
            key={s.id}
            className={`absolute inset-0 transition-opacity duration-700 ease-out ${idx === active ? "opacity-100 z-10" : "opacity-0 z-0"}`}
          >
            {/* image */}
            <img src={s.image} alt={s.title} className="absolute inset-0 w-full h-full object-cover" />
            {/* gradient overlays */}
            <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-900/10" />
            <div className={`absolute inset-0 bg-gradient-to-t ${s.accent} opacity-20 mix-blend-multiply`} />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-transparent to-transparent" />

            {/* content */}
            <div className="container-soft relative h-full flex items-center">
              <div className="w-full lg:w-[58%] py-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur text-xs font-semibold tracking-widest text-white">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  {s.badge}
                </div>
                <h2 className="mt-4 font-display font-bold tracking-tight text-white leading-[0.9] text-[36px] sm:text-[48px] lg:text-[56px]">
                  {s.title}
                  <span className="block font-light text-white/90">{s.highlight}</span>
                </h2>
                <p className="mt-4 text-[15px] sm:text-[17px] leading-relaxed text-white/80 max-w-[560px]">{s.desc}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href={s.cta.href} className="px-6 py-3 rounded-full bg-white text-navy-900 text-sm font-bold hover:bg-slate-100 shadow-lg active:scale-[0.98] transition">
                    {s.cta.label}
                  </Link>
                  {s.cta2 && (
                    <Link href={s.cta2.href} className="px-6 py-3 rounded-full bg-white/10 border border-white/20 text-white text-sm font-semibold backdrop-blur hover:bg-white/15 transition">
                      {s.cta2.label}
                    </Link>
                  )}
                </div>
                <div className="mt-6 flex flex-wrap gap-2 text-xs text-white/70">
                  <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10">✓ Telugu & English</span>
                  <span className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10">✓ Offline • Residential • Online</span>
                  <span className="px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/20 text-emerald-200">✓ 5000+ Selections</span>
                </div>
              </div>

              {/* side stats card - desktop only */}
              <div className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-[340px]">
                <div className="rounded-3xl bg-white/95 backdrop-blur border border-white/40 p-5 shadow-2xl">
                  <div className="text-xs tracking-widest font-bold text-sky-700">WHY AYAAN • {String(idx + 1).padStart(2, "0")} / {String(list.length).padStart(2, "0")}</div>
                  <div className="mt-2 font-display font-bold text-navy-900 leading-tight">Trusted by 5000+ families since 2016</div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="p-3 rounded-xl bg-slate-50 border"><div className="font-bold text-navy-900">9+</div><div className="text-[11px] text-slate-500">Years</div></div>
                    <div className="p-3 rounded-xl bg-slate-50 border"><div className="font-bold text-navy-900">15 Acres</div><div className="text-[11px] text-slate-500">Campus</div></div>
                    <div className="p-3 rounded-xl bg-slate-50 border"><div className="font-bold text-navy-900">4.7★</div><div className="text-[11px] text-slate-500">Reviews</div></div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <a href="tel:+918886667222" className="flex-1 py-2.5 rounded-full bg-navy-900 text-white text-sm font-medium grid place-items-center">Call Advisor</a>
                    <a href="https://api.whatsapp.com/send?phone=918886667222" target="_blank" className="px-4 py-2.5 rounded-full bg-[#25D366] text-white text-sm grid place-items-center">WhatsApp</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="absolute bottom-6 left-0 right-0 z-20">
        <div className="container-soft flex items-center justify-between">
          <div className="flex items-center gap-2">
            {list.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={`transition-all rounded-full ${i === active ? "w-8 h-2 bg-white" : "w-2 h-2 bg-white/40 hover:bg-white/70"}`}
              />
            ))}
            <span className="ml-3 text-xs text-white/60 hidden sm:inline">{String(active + 1).padStart(2, "0")} / {String(list.length).padStart(2, "0")}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => go(active - 1)} className="w-9 h-9 rounded-full bg-white/10 border border-white/20 text-white backdrop-blur grid place-items-center hover:bg-white/15" aria-label="Previous">‹</button>
            <button onClick={() => go(active + 1)} className="w-9 h-9 rounded-full bg-white text-navy-900 grid place-items-center hover:bg-slate-100" aria-label="Next">›</button>
          </div>
        </div>
      </div>

      {/* top progress */}
      <div className="absolute top-0 left-0 right-0 h-[3px] bg-white/10 z-20">
        <div className="h-full bg-white transition-all duration-500" style={{ width: `${((active + 1) / list.length) * 100}%` }} />
      </div>
    </div>
  );
}
