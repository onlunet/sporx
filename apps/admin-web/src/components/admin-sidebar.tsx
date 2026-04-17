"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Database,
  Activity,
  Brain,
  Settings,
  Users,
  FileText,
  LogOut,
  Server,
  BarChart3,
  Zap,
  Shield,
  Clock,
  ChevronRight,
  Layers,
  Beaker,
  History,
  Cloud,
  GitMerge,
  Menu,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const menuCategories = [
  {
    title: "Genel",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }]
  },
  {
    title: "Veri Yönetimi",
    items: [
      { href: "/admin/providers", label: "Sağlayıcılar", icon: Cloud },
      { href: "/admin/providers/health", label: "Sistem Sağlığı", icon: Activity },
      { href: "/admin/ingestion/jobs", label: "Veri İşlemleri", icon: Server },
      { href: "/admin/import/historical", label: "Geçmiş Veri", icon: History },
      { href: "/admin/teams/identity", label: "Takım Kimlik Eşleştirme", icon: GitMerge },
      { href: "/admin/teams/identity/manual", label: "Kimlik Manuel İşlem", icon: GitMerge }
    ]
  },
  {
    title: "AI & Modeller",
    items: [
      { href: "/admin/models", label: "Modeller", icon: Brain },
      { href: "/admin/models/comparison", label: "Karşılaştırma", icon: BarChart3 },
      { href: "/admin/models/feature-importance", label: "Özellik Analizi", icon: Layers },
      { href: "/admin/models/performance", label: "Performans", icon: Activity },
      { href: "/admin/models/drift", label: "Model Sapması", icon: Zap },
      { href: "/admin/models/strategies", label: "Stratejiler", icon: Shield },
      { href: "/admin/models/ensemble", label: "Ansambl", icon: Database }
    ]
  },
  {
    title: "Kalite Kontrol",
    items: [
      { href: "/admin/calibration", label: "Kalibrasyon", icon: Beaker },
      { href: "/admin/backtest", label: "Geri Test", icon: Clock },
      { href: "/admin/predictions/failed", label: "Başarısız Tahminler", icon: Activity },
      { href: "/admin/predictions/low-confidence", label: "Düşük Güven", icon: Shield },
      { href: "/admin/predictions/performance", label: "Tahmin Performansı", icon: BarChart3 },
      { href: "/admin/predictions/shadow", label: "Shadow Cutover", icon: Layers }
    ]
  },
  {
    title: "Geliştirme",
    items: [
      { href: "/admin/features/lab", label: "Özellik Lab", icon: Beaker },
      { href: "/admin/features/experiments", label: "Deneyler", icon: Zap }
    ]
  },
  {
    title: "Sistem",
    items: [
      { href: "/admin/logs/api", label: "API Kayıtları", icon: FileText },
      { href: "/admin/logs/audit", label: "Denetim Kayıtları", icon: Shield },
      { href: "/admin/system/settings", label: "Ayarlar", icon: Settings },
      { href: "/admin/backup", label: "Yedekleme", icon: Database },
      { href: "/admin/users", label: "Kullanıcılar", icon: Users }
    ]
  }
];

function MenuItem({
  href,
  label,
  icon: Icon,
  isActive,
  onClick
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`
        group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200
        ${
          isActive
            ? "bg-admin-brand-primary text-white shadow-lg shadow-admin-brand-primary/25"
            : "text-admin-text-secondary hover:bg-admin-bg-tertiary hover:text-admin-text-primary"
        }
      `}
    >
      <Icon className={`w-4 h-4 ${isActive ? "text-white" : "text-admin-text-muted group-hover:text-admin-text-primary"}`} />
      <span className="flex-1 truncate">{label}</span>
      {isActive ? <ChevronRight className="w-4 h-4 opacity-50 flex-shrink-0" /> : null}
    </Link>
  );
}

function SidebarContent({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();

  return (
    <>
      <div className="p-6 border-b border-admin-border-subtle">
        <Link href="/admin/dashboard" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-admin-brand-primary to-admin-brand-secondary flex items-center justify-center shadow-lg shadow-admin-brand-primary/20">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-admin-text-primary">SPORX</h1>
            <p className="text-xs text-admin-text-muted font-medium tracking-wide">ADMIN PANEL</p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto p-4 space-y-6">
        {menuCategories.map((category) => (
          <div key={category.title}>
            <h3 className="px-3 mb-2 text-xs font-semibold text-admin-text-muted uppercase tracking-wider">{category.title}</h3>
            <div className="space-y-1">
              {category.items.map((item) => (
                <MenuItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onClick={onLinkClick}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-admin-border-subtle">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-admin-bg-tertiary mb-3">
          <div className="w-2 h-2 rounded-full bg-admin-success animate-pulse" />
          <span className="text-xs text-admin-text-secondary">Sistem Aktif</span>
        </div>

        <form action="/api/admin/logout" method="post">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-admin-text-secondary bg-admin-bg-tertiary border border-admin-border-subtle hover:bg-admin-bg-elevated hover:text-admin-text-primary transition-all"
          >
            <LogOut className="w-4 h-4" />
            Oturumu Kapat
          </button>
        </form>
      </div>
    </>
  );
}

export function AdminSidebar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 h-screen w-72 bg-admin-bg-secondary border-r border-admin-border-subtle flex-col hidden md:flex">
        <SidebarContent />
      </aside>

      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-40 md:hidden">
        <div className="flex items-center justify-between border-b border-admin-border-subtle bg-admin-bg-secondary/95 backdrop-blur-xl px-4 py-3">
          <Link href="/admin/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-admin-brand-primary to-admin-brand-secondary flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="text-base font-bold text-admin-text-primary">SPORX</span>
              <p className="text-[10px] text-admin-text-muted font-medium tracking-wide">ADMIN</p>
            </div>
          </Link>
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-bg-tertiary border border-admin-border-subtle text-admin-text-secondary hover:bg-admin-bg-elevated hover:text-admin-text-primary transition-colors"
            aria-label="Menüyü Aç"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
            />

            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 z-50 flex h-screen w-[280px] flex-col border-r border-admin-border-subtle bg-admin-bg-secondary shadow-2xl md:hidden"
            >
              <div className="flex items-center justify-between border-b border-admin-border-subtle p-4">
                <Link href="/admin/dashboard" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-admin-brand-primary to-admin-brand-secondary flex items-center justify-center">
                    <Shield className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <span className="text-base font-bold text-admin-text-primary">SPORX</span>
                    <p className="text-[10px] text-admin-text-muted font-medium tracking-wide">ADMIN</p>
                  </div>
                </Link>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg bg-admin-bg-tertiary border border-admin-border-subtle text-admin-text-secondary hover:bg-admin-bg-elevated hover:text-admin-text-primary transition-colors"
                  aria-label="Menüyü Kapat"
                >
                  <X className="w-5 h-5" />
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
