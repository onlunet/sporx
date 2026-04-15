"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { 
  LayoutDashboard, 
  Trophy, 
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

const links = [
  { href: "/dashboard", label: "Panel", icon: LayoutDashboard },
  { href: "/matches", label: "Maçlar", icon: Swords },
  { href: "/leagues", label: "Ligler", icon: Trophy },
  { href: "/teams", label: "Takımlar", icon: Shield },
  { href: "/predictions", label: "Tahminler", icon: BrainCircuit },
  { href: "/predictions/completed", label: "Sonuclanan", icon: BarChart3 },
  { href: "/compare/teams", label: "Karşılaştır", icon: GitCompare },
  { href: "/live", label: "Canlı", icon: Radio },
  { href: "/guide", label: "Rehber", icon: BookOpen },
  { href: "/account", label: "Hesap", icon: User },
];

const containerVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0 },
};

export function PublicSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 h-screen w-72 flex flex-col border-r border-white/5 bg-depth/80 backdrop-blur-xl">
      {/* Logo Area */}
      <div className="p-6 border-b border-white/5">
        <Link href="/" prefetch={false} className="flex items-center gap-3 group">
          <div className="relative">
            <div className="absolute inset-0 bg-neon-cyan/20 blur-xl rounded-full group-hover:bg-neon-cyan/30 transition-all" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center">
              <Zap className="w-5 h-5 text-void" />
            </div>
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-wider">
              <span className="gradient-text">SPOR</span>
              <span className="text-white">X</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-display tracking-[0.2em] uppercase">
              AI Analitik
            </p>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6 px-4">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-1"
        >
          {links.map((link) => {
            const Icon = link.icon;
            const active =
              link.href === "/predictions"
                ? pathname === "/predictions"
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            
            return (
              <motion.div key={link.href} variants={itemVariants}>
                <Link
                  href={link.href}
                  prefetch={false}
                  className={`
                    group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200
                    ${active 
                      ? "text-white" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                    }
                  `}
                >
                  {/* Active Indicator */}
                  {active && (
                    <motion.div
                      layoutId="activeNav"
                      className="absolute inset-0 rounded-lg bg-gradient-to-r from-neon-cyan/10 to-transparent border-l-2 border-neon-cyan"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                  
                  <span className={`
                    relative z-10 flex items-center justify-center w-8 h-8 rounded-lg transition-all
                    ${active 
                      ? "bg-neon-cyan/20 text-neon-cyan" 
                      : "bg-white/5 text-slate-400 group-hover:text-neon-cyan group-hover:bg-neon-cyan/10"
                    }
                  `}>
                    <Icon className="w-4 h-4" />
                  </span>
                  
                  <span className="relative z-10">
                    {link.label}
                  </span>
                  
                  {/* Hover Glow */}
                  {!active && (
                    <div className="absolute inset-0 rounded-lg bg-neon-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </Link>
              </motion.div>
            );
          })}
        </motion.div>
      </nav>

      {/* Status Card */}
      <div className="p-4 border-t border-white/5">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
            <span className="text-xs text-slate-400 font-display tracking-wider">SİSTEM AKTİF</span>
          </div>
          <p className="text-xs text-slate-500">
            AI modeli gerçek zamanlı analiz yapıyor
          </p>
        </div>
      </div>
    </aside>
  );
}

