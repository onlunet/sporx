"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  GitMerge
} from "lucide-react";

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
      { href: "/admin/predictions/performance", label: "Tahmin Performansı", icon: BarChart3 }
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
  isActive
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}) {
  return (
    <Link
      href={href}
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
      <span className="flex-1">{label}</span>
      {isActive ? <ChevronRight className="w-4 h-4 opacity-50" /> : null}
    </Link>
  );
}

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-screen w-72 bg-admin-bg-secondary border-r border-admin-border-subtle flex flex-col">
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
    </aside>
  );
}


