import { Outlet } from "react-router-dom";
import { BookOpen, CalendarClock, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Brand } from "@/components/layout/Brand";

const features = [
  { icon: Sparkles, title: "Multimodal conversations", text: "Persistent threads, streamed answers, citations and real file context." },
  { icon: BookOpen, title: "Library with lexical retrieval", text: "Upload, chunk, tag and ground answers in your own material." },
  { icon: CalendarClock, title: "Durable automations", text: "Scheduled prompts and reports with honest run history." },
  { icon: Users, title: "InternFlow agent", text: "Assign, evaluate and audit intern work with deterministic rubrics." },
];

export function AuthLayout() {
  return (
    <div className="grid min-h-screen bg-mist-50 dark:bg-navy-950 lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-navy-950 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-brand-glow" />
        <div className="auth-grid absolute inset-0" />
        <div className="relative flex items-center justify-between px-10 pt-9">
          <Brand inverted />
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-mist-400">
            v1.0 workspace
          </span>
        </div>

        <div className="relative flex flex-1 flex-col justify-center px-10 pb-8 xl:px-14">
          <p className="eyebrow !text-electric-300">Built for serious work</p>
          <h1 className="heading-display mt-3 max-w-xl text-[40px] leading-[1.08] text-white xl:text-[46px]">
            One workspace for thinking, evidence and execution.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-7 text-mist-400">
            NEXORA AI combines grounded chat, document intelligence, live research and InternFlow’s evaluation agent.
            Demo behavior is always labeled — nothing is manufactured.
          </p>

          <div className="mt-9 grid max-w-xl gap-3 sm:grid-cols-2">
            {features.map((feature) => (
              <div key={feature.title} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-3.5 backdrop-blur">
                <feature.icon className="h-4 w-4 text-electric-300" />
                <p className="mt-2 text-xs font-semibold text-white">{feature.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-mist-400">{feature.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex items-center gap-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-3.5 py-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-300" />
            <p className="text-[11px] leading-5 text-mist-400">
              Tenant isolation, role gates, hashed sessions and CSRF protection are enforced in the API.
            </p>
          </div>
        </div>

        <div className="relative border-t border-white/[0.06] px-10 py-4 text-[10px] uppercase tracking-[0.2em] text-mist-500">
          Navy · graphite · off-white · electric blue
        </div>
      </aside>

      <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-electric-500/[0.06] to-transparent dark:from-electric-500/[0.08]" />
        <div className="relative mb-7 flex w-full max-w-[420px] items-center justify-between lg:hidden">
          <Brand />
          <span className="text-[10px] uppercase tracking-[0.18em] text-mist-400">AI workspace</span>
        </div>
        <div className="relative w-full max-w-[420px] animate-slide-up">
          <Outlet />
        </div>
        <p className="relative mt-8 text-center text-[10px] leading-5 text-mist-400">
          By continuing you agree to responsible use. Demo accounts exist only outside production.
        </p>
      </main>
    </div>
  );
}
