"use client";
import { useEffect, useRef, useState } from "react";
import { knowledgeBase as fallbackKB, retrieve, detectLang, uiStrings, type Lang, type KBChunk } from "@/data/knowledgeBase";

type Msg = { id: string; role: "user" | "assistant"; text: string; sources?: string[]; lang: Lang };

export default function RagBot() {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [kb, setKb] = useState<KBChunk[]>(fallbackKB);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/rag", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && d.length && setKb(d))
      .catch(() => {});
  }, []);

  // init greeting
  useEffect(() => {
    const greet: Record<Lang, string> = {
      en: "Hi! I’m Ayaan Assistant — grounded on official institute info. Ask me about courses, residential campus, fees, tests, or addresses in English, हिंदी or తెలుగు.",
      hi: "नमस्ते! मैं आयान सहायक हूँ — आधिकारिक जानकारी पर आधारित। कोर्स, रेजिडेंशियल कैंपस, फीस, टेस्ट या पते के बारे में हिंदी, English या తెలుగు में पूछें।",
      te: "హాయ్! నేను ఆయాన్ అసిస్టెంట్ — అధికారిక సమాచారంపై ఆధారపడి ఉన్నాను. కోర్సులు, రెసిడెన్షియల్ క్యాంపస్, ఫీజులు, టెస్టులు లేదా అడ్రస్‌ల గురించి తెలుగు, हिंदी లేదా English లో అడగండి.",
    };
    if (msgs.length === 0) {
      setMsgs([{ id: "greet", role: "assistant", text: greet[lang], lang }]);
    }
  }, [lang]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, thinking, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const t = uiStrings[lang];

  const send = (textRaw?: string) => {
    const raw = (textRaw ?? input).trim();
    if (!raw) return;
    const detected = detectLang(raw);
    const useLang = detected ?? lang;
    if (detected && detected !== lang) setLang(detected);

    const userMsg: Msg = { id: Date.now().toString(), role: "user", text: raw, lang: useLang };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const hits = retrieve(raw, kb, 2);
      let text: string, sources: string[];
      if (hits.length === 0) {
        text = uiStrings[useLang].fallback;
        sources = [];
      } else {
        text = hits.map((h) => (useLang === "hi" ? h.hi : useLang === "te" ? h.te : h.en)).join(" ");
        sources = hits.map((h) => `${h.category} → ${h.source}`);
      }
      const botMsg: Msg = { id: (Date.now() + 1).toString(), role: "assistant", text, sources, lang: useLang };
      setMsgs((m) => [...m, botMsg]);
      setThinking(false);
    }, 500 + Math.random() * 300);
  };

  return (
    <>
      {/* floating button — left of WhatsApp to avoid clash */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open Ayaan Assistant"
        className="fixed bottom-6 left-6 lg:bottom-6 lg:right-[96px] lg:left-auto z-50 w-14 h-14 rounded-full bg-navy-900 text-white grid place-items-center shadow-lg hover:scale-105 active:scale-95 transition border border-white/10"
      >
        <span className="text-xl">{open ? "✕" : "◈"}</span>
        {!open && <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white animate-pulse" />}
      </button>
      {!open && (
        <div className="fixed bottom-[84px] left-6 lg:left-auto lg:right-6 z-40 hidden sm:block">
          <div className="px-3 py-2 rounded-full bg-white border border-slate-200 shadow-soft text-xs font-medium text-slate-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Ask Ayaan • EN / हिंदी / తెలుగు
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 sm:inset-auto sm:bottom-[88px] sm:right-6 sm:left-auto z-50 sm:w-[420px] sm:h-[640px] flex flex-col bg-white sm:rounded-3xl sm:border sm:border-slate-200 sm:shadow-2xl overflow-hidden">
          {/* header */}
          <div className="bg-navy-900 text-white p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white text-navy-900 grid place-items-center font-display font-bold">A</div>
                <div>
                  <div className="font-semibold leading-none">{t.title}</div>
                  <div className="text-xs text-white/70">{t.subtitle}</div>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-white/10 grid place-items-center hover:bg-white/20">
                ✕
              </button>
            </div>

            {/* language switch */}
            <div className="mt-4 flex gap-2">
              {(["en", "hi", "te"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`flex-1 py-2 rounded-full text-sm font-medium border transition ${lang === l ? "bg-white text-navy-900 border-white" : "bg-white/10 text-white border-white/20 hover:bg-white/15"}`}
                >
                  {l === "en" ? "English" : l === "hi" ? "हिंदी" : "తెలుగు"}
                </button>
              ))}
              <button onClick={() => setMsgs([])} className="px-3 py-2 rounded-full bg-white/10 border border-white/20 text-xs hover:bg-white/15">
                {t.clear}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-white/60">RAG • grounded • citations • auto-detects తెలుగు/हिंदी</div>
          </div>

          {/* quick prompts */}
          <div className="px-3 py-3 border-b border-slate-100 bg-slate-50/60">
            <div className="flex gap-2 overflow-auto scrollbar-none pb-1">
              {t.quick.map((q: string) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium hover:bg-slate-50 hover:border-slate-300 text-slate-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* messages */}
          <div ref={listRef} className="flex-1 overflow-auto p-4 space-y-3 bg-[#fcfcfd]">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === "user" ? "bg-navy-900 text-white rounded-br-sm" : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"}`}>
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <div className="text-[11px] tracking-wide font-semibold text-slate-500">{t.sources}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.sources.map((s) => (
                          <span key={s} className="px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-1 text-[11px] opacity-60">{m.role === "assistant" ? (m.lang === "hi" ? "हिंदी" : m.lang === "te" ? "తెలుగు" : "EN") : ""}</div>
                </div>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-slate-600 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:120ms]" />
                  <span className="w-2 h-2 rounded-full bg-slate-400 animate-bounce [animation-delay:240ms]" />
                  <span className="ml-1">{t.thinking}</span>
                </div>
              </div>
            )}
            <div className="text-center text-[11px] text-slate-400 pt-2">Answers are grounded on official KB. For admissions call +91 88866 67222.</div>
          </div>

          {/* input */}
          <div className="p-3 border-t border-slate-200 bg-white">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={t.placeholder}
                className="flex-1 px-4 py-3 rounded-full border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              />
              <button onClick={() => send()} disabled={!input.trim() || thinking} className="px-5 py-3 rounded-full bg-navy-900 text-white text-sm font-medium disabled:opacity-40 hover:bg-navy-800 active:scale-95 transition">
                {t.send}
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>↩ Enter to send • Auto-detects language</span>
              <span className="hidden sm:inline">RAG • grounded • no hallucination</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
