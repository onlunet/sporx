interface AdminLoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; loggedOut?: string }>;
}

const errorText: Record<string, string> = {
  missing_fields: "E-posta ve şifre zorunludur.",
  invalid_credentials: "E-posta veya şifre hatalı.",
  unauthorized_role: "Bu hesap yönetim paneline erişemez.",
  session_validation_failed: "Oturum yapılandırması hatalı. Admin ve API JWT_ACCESS_SECRET aynı olmalı.",
  auth_service_unreachable: "Kimlik doğrulama servisine ulaşılamıyor. Lütfen daha sonra tekrar deneyin.",
  auth_service_unavailable: "Kimlik doğrulama servisi geçici olarak kullanılamıyor.",
  login_failed: "Giriş işlemi şu anda tamamlanamadı."
};

function sanitizeNextPath(value?: string) {
  if (!value || !value.startsWith("/admin") || value.startsWith("/admin/login")) {
    return "/admin/dashboard";
  }
  return value;
}

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);
  const error = params.error ? errorText[params.error] ?? "Giriş işlemi başarısız oldu." : null;

  return (
    <div className="w-full max-w-md">
      <div className="admin-card p-8">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-admin-brand-primary to-admin-brand-secondary shadow-lg shadow-admin-brand-primary/20">
            <svg className="h-8 w-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-admin-text-primary">Yönetici Girişi</h1>
          <p className="mt-2 text-sm text-admin-text-secondary">SPORX Admin Paneline hoş geldiniz</p>
        </div>

        {params.loggedOut === "1" && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-admin-success/20 bg-admin-success/10 p-4">
            <svg className="h-5 w-5 shrink-0 text-admin-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-admin-success">Oturum başarıyla kapatıldı.</span>
          </div>
        )}

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-admin-error/20 bg-admin-error/10 p-4">
            <svg className="h-5 w-5 shrink-0 text-admin-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-admin-error">{error}</span>
          </div>
        )}

        <form method="post" action="/api/admin/login" className="space-y-5">
          <input type="hidden" name="next" value={nextPath} />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-admin-text-primary">E-posta Adresi</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <svg className="h-5 w-5 text-admin-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="admin@sporx.local"
                required
                className="w-full rounded-lg border border-admin-border-subtle bg-admin-bg-tertiary py-3 pl-10 pr-4 text-admin-text-primary placeholder-admin-text-muted transition-all focus:border-admin-brand-primary focus:outline-none focus:ring-1 focus:ring-admin-brand-primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-admin-text-primary">Şifre</label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <svg className="h-5 w-5 text-admin-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                required
                className="w-full rounded-lg border border-admin-border-subtle bg-admin-bg-tertiary py-3 pl-10 pr-4 text-admin-text-primary placeholder-admin-text-muted transition-all focus:border-admin-brand-primary focus:outline-none focus:ring-1 focus:ring-admin-brand-primary"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-admin-brand-primary to-admin-brand-secondary px-4 py-3 font-semibold text-white shadow-lg shadow-admin-brand-primary/25 transition-all hover:opacity-90 active:scale-[0.98]"
          >
            Giriş Yap
          </button>
        </form>

        <div className="mt-8 border-t border-admin-border-subtle pt-6 text-center">
          <p className="text-xs text-admin-text-muted">
            Sadece yetkili kullanıcılar erişebilir.
            <br />
            Yetkisiz giriş denemeleri kaydedilmektedir.
          </p>
        </div>
      </div>
    </div>
  );
}
