"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  LayoutDashboard,
  Trophy,
  Dumbbell,
  Swords,
  Shield,
  BrainCircuit,
  BarChart3,
  GitCompare,
  Radio,
  BookOpen,
  User,
  Zap,
  Menu,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type SidebarLink = {
  href: string;
  label: string;
  icon: LucideIcon;
  aliases?: string[];
};

const primaryLinks: SidebarLink[] = [
  { href: "/panel", label: "Panel", icon: LayoutDashboard, aliases: ["/dashboard"] }
];

const sportGroups: Array<{
  key: "futbol" | "basketbol";
  title: string;
  icon: LucideIcon;
  links: SidebarLink[];
}> = [
  {
    key: "futbol",
    title: "FUTBOL",
    icon: Trophy,
    links: [
      { href: "/futbol/maclar", label: "Maçlar", icon: Swords, aliases: ["/football/matches"] },
      { href: "/futbol/tahminler", label: "Tahminler", icon: BrainCircuit, aliases: ["/football/predictions"] },
      {
        href: "/futbol/sonuclar",
        label: "Sonuçlar",
        icon: BarChart3,
        aliases: ["/football/predictions/completed"]
      },
      {
        href: "/futbol/lig-performansi",
        label: "Lig Performansı",
        icon: BarChart3,
        aliases: ["/football/predictions/leagues"]
      },
      { href: "/futbol/karsilastir", label: "Karşılaştır", icon: GitCompare, aliases: ["/football/compare/teams"] },
      { href: "/futbol/canli", label: "Canlı", icon: Radio, aliases: ["/football/live"] }
    ]
  },
  {
    key: "basketbol",
    title: "BASKETBOL",
    icon: Dumbbell,
    links: [
      { href: "/basketbol/maclar", label: "Maçlar", icon: Swords, aliases: ["/basketball/matches"] },
      {
        href: "/basketbol/tahminler",
        label: "Tahminler",
        icon: BrainCircuit,
        aliases: ["/basketball/predictions"]
      },
      {
        href: "/basketbol/sonuclar",
        label: "Sonuçlar",
        icon: BarChart3,
        aliases: ["/basketball/predictions/completed"]
      },
      {
        href: "/basketbol/lig-performansi",
        label: "Lig Performansı",
        icon: BarChart3,
        aliases: ["/basketball/predictions/leagues"]
      },
      {
        href: "/basketbol/karsilastir",
        label: "Karşılaştır",
        icon: GitCompare,
        aliases: ["/basketball/compare/teams"]
      },
      { href: "/basketbol/canli", label: "Canlı", icon: Radio, aliases: ["/basketball/live"] }
    ]
  }
];

const utilityLinks: SidebarLink[] = [
  { href: "/ligler", label: "Ligler", icon: Trophy, aliases: ["/leagues"] },
  { href: "/takimlar", label: "Takımlar", icon: Shield, aliases: ["/teams"] },
  { href: "/rehber", label: "Rehber", icon: BookOpen, aliases: ["/guide"] },
  { href: "/hesap", label: "Hesap", icon: User, aliases: ["/account"] }
];

const containerVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1
    }
  }
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 }
};

function SidebarItem({ link, active, onClick }: { link: SidebarLink; active: boolean; onClick?: () => void }) {
  const Icon = link.icon;

  return (
    <motion.div variants={itemVariants}>
      <Link
        href={link.href}
        onClick={onClick}
        className={`
          group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200
          ${active ? "text-white" : "text-slate-400 hover:text-white hover:bg-white/5"}
        `}
      >
        {active ? (
          <motion.div
            layoutId="activeNav"
            className="absolute inset-0 rounded-lg border-l-2 border-neon-cyan bg-gradient-to-r from-neon-cyan/10 to-transparent"
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />
        ) : null}

        <span
          className={`
            relative z-10 flex h-8 w-8 items-center justify-center rounded-lg transition-all
            ${
              active
                ? "bg-neon-cyan/20 text-neon-cyan"
                : "bg-white/5 text-slate-400 group-hover:bg-neon-cyan/10 group-hover:text-neon-cyan"
            }
          `}
        >
          <Icon className="h-4 w-4" />
        </span>

        <span className="relative z-10">{link.label}</span>

        {!active ? (
          <div className="absolute inset-0 rounded-lg bg-neon-cyan/5 opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </Link>
    </motion.div>
  );
}

function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();
  const isActive = (link: SidebarLink) =>
    pathname === link.href ||
    pathname.startsWith(`${link.href}/`) ||
    (link.aliases ?? []).some((alias) => pathname === alias || pathname.startsWith(`${alias}/`));

  const isSportGroupActive = (groupKey: "futbol" | "basketbol") =>
    (groupKey === "futbol" &&
      (pathname === "/futbol" ||
        pathname.startsWith("/futbol/") ||
        pathname === "/football" ||
        pathname.startsWith("/football/"))) ||
    (groupKey === "basketbol" &&
      (pathname === "/basketbol" ||
        pathname.startsWith("/basketbol/") ||
        pathname === "/basketball" ||
        pathname.startsWith("/basketball/")));

  return (
    <>
      <div className="border-b border-white/5 p-6">
        <Link href="/" className="group flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-neon-cyan/20 blur-xl transition-all group-hover:bg-neon-cyan/30" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Zap className="h-5 w-5 text-void" />
            </div>
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-wider">
              <span className="gradient-text">SPOR</span>
              <span className="text-white">X</span>
            </h1>
            <p className="font-display text-[10px] uppercase tracking-[0.2em] text-slate-500">AI Analitik</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-4 py-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
          <div className="space-y-1">
            {primaryLinks.map((link) => (
              <SidebarItem key={link.href} link={link} active={isActive(link)} onClick={onLinkClick} />
            ))}
          </div>

          {sportGroups.map((group) => {
            const GroupIcon = group.icon;
            const groupActive = isSportGroupActive(group.key);

            return (
              <motion.section key={group.key} variants={itemVariants} className="rounded-xl border border-white/5 bg-white/[0.02] p-2">
                <div className="mb-1 flex items-center gap-2 px-2 py-1">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md ${
                      groupActive ? "bg-neon-cyan/20 text-neon-cyan" : "bg-white/5 text-slate-400"
                    }`}
                  >
                    <GroupIcon className="h-4 w-4" />
                  </span>
                  <span className="font-display text-xs uppercase tracking-[0.18em] text-slate-300">{group.title}</span>
                </div>

                <div className="space-y-1">
                  {group.links.map((link) => (
                    <SidebarItem key={link.href} link={link} active={isActive(link)} onClick={onLinkClick} />
                  ))}
                </div>
              </motion.section>
            );
          })}

          <div className="pt-1">
            <div className="px-2 pb-2 font-display text-[10px] uppercase tracking-[0.2em] text-slate-500">GENEL</div>
            <div className="space-y-1">
              {utilityLinks.map((link) => (
                <SidebarItem key={link.href} link={link} active={isActive(link)} onClick={onLinkClick} />
              ))}
            </div>
          </div>
        </motion.div>
      </nav>

      <div className="border-t border-white/5 p-4">
        <div className="glass-card rounded-xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-neon-green" />
            <span className="font-display text-xs tracking-wider text-slate-500">SİSTEM AKTİF</span>
          </div>
          <p className="text-xs text-slate-500">AI modeli gerçek zamanlı analiz yapıyor.</p>
        </div>
      </div>
    </>
  );
}

export function PublicSidebar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-0 hidden lg:flex h-screen w-72 flex-col border-r border-white/5 bg-depth/80 backdrop-blur-xl">
        <SidebarContent />
      </aside>

      <div className="fixed top-0 left-0 right-0 z-40 lg:hidden">
        <div className="flex items-center justify-between border-b border-white/5 bg-depth/95 backdrop-blur-xl px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Zap className="h-4 w-4 text-void" />
            </div>
            <span className="font-display text-lg font-bold tracking-wider">
              <span className="gradient-text">SPOR</span>
              <span className="text-white">X</span>
            </span>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Menüyü Aç"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm lg:hidden"
            />

            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 z-50 flex h-screen w-[280px] flex-col border-r border-white/5 bg-depth shadow-2xl lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-white/5 p-4">
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                  <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple">
                    <Zap className="h-4 w-4 text-void" />
                  </div>
                  <span className="font-display text-lg font-bold tracking-wider">
                    <span className="gradient-text">SPOR</span>
                    <span className="text-white">X</span>
                  </span>
                </Link>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                  aria-label="Menüyü Kapat"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <SidebarContent onLinkClick={() => setMobileMenuOpen(false)} />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
