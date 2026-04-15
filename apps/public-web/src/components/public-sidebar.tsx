"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
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
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type SidebarLink = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const primaryLinks: SidebarLink[] = [{ href: "/dashboard", label: "Panel", icon: LayoutDashboard }];

const sportGroups: Array<{
  key: "football" | "basketball";
  title: string;
  icon: LucideIcon;
  links: SidebarLink[];
}> = [
  {
    key: "football",
    title: "Futbol",
    icon: Trophy,
    links: [
      { href: "/football/matches", label: "Maclar", icon: Swords },
      { href: "/football/predictions", label: "Tahminler", icon: BrainCircuit },
      { href: "/football/predictions/completed", label: "Sonuclar", icon: BarChart3 },
      { href: "/football/live", label: "Canli", icon: Radio }
    ]
  },
  {
    key: "basketball",
    title: "Basketbol",
    icon: Dumbbell,
    links: [
      { href: "/basketball/matches", label: "Maclar", icon: Swords },
      { href: "/basketball/predictions", label: "Tahminler", icon: BrainCircuit },
      { href: "/basketball/predictions/completed", label: "Sonuclar", icon: BarChart3 },
      { href: "/basketball/live", label: "Canli", icon: Radio }
    ]
  }
];

const utilityLinks: SidebarLink[] = [
  { href: "/leagues", label: "Ligler", icon: Trophy },
  { href: "/teams", label: "Takimlar", icon: Shield },
  { href: "/compare/teams", label: "Karsilastir", icon: GitCompare },
  { href: "/guide", label: "Rehber", icon: BookOpen },
  { href: "/account", label: "Hesap", icon: User }
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

function SidebarItem({ link, active }: { link: SidebarLink; active: boolean }) {
  const Icon = link.icon;

  return (
    <motion.div variants={itemVariants}>
      <Link
        href={link.href}
        prefetch={false}
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

export function PublicSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const isSportGroupActive = (groupKey: "football" | "basketball") =>
    pathname === `/${groupKey}` || pathname.startsWith(`/${groupKey}/`);

  return (
    <aside className="sticky top-0 flex h-screen w-72 flex-col border-r border-white/5 bg-depth/80 backdrop-blur-xl">
      <div className="border-b border-white/5 p-6">
        <Link href="/" prefetch={false} className="group flex items-center gap-3">
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
              <SidebarItem key={link.href} link={link} active={isActive(link.href)} />
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
                    <SidebarItem key={link.href} link={link} active={isActive(link.href)} />
                  ))}
                </div>
              </motion.section>
            );
          })}

          <div className="pt-1">
            <div className="px-2 pb-2 font-display text-[10px] uppercase tracking-[0.2em] text-slate-500">Genel</div>
            <div className="space-y-1">
              {utilityLinks.map((link) => (
                <SidebarItem key={link.href} link={link} active={isActive(link.href)} />
              ))}
            </div>
          </div>
        </motion.div>
      </nav>

      <div className="border-t border-white/5 p-4">
        <div className="glass-card rounded-xl p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-neon-green" />
            <span className="font-display text-xs tracking-wider text-slate-400">SISTEM AKTIF</span>
          </div>
          <p className="text-xs text-slate-500">AI modeli gercek zamanli analiz yapiyor</p>
        </div>
      </div>
    </aside>
  );
}
