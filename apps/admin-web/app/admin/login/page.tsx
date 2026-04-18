interface AdminLoginPageProps {
  searchParams: Promise<{ next?: string; error?: string; loggedOut?: string }>;
}

const errorText: Record<string, string> = {
  missing_fields: "E-posta ve sifre zorunludur.",
  invalid_credentials: "E-posta veya sifre hatali.",
  unauthorized_role: "Bu hesap yonetim paneline erisemez.",
  session_validation_failed: "Oturum yapilandirmasi hatali. Admin ve API JWT_ACCESS_SECRET ayni olmali."
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
  const error = params.error ? errorText[params.error] ?? "GiriÅŸ iÅŸlemi baÅŸarÄ±sÄ±z oldu." : null;

  return (
    <div className="w-full max-w-md">
      {/* Card */}
      <div className="admin-card p-8">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-admin-brand-primary to-admin-brand-secondary flex items-center justify-center mx-auto mb-4 shadow-lg shadow-admin-brand-primary/20">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-admin-text-primary">YÃ¶netici GiriÅŸi</h1>
          <p className="mt-2 text-sm text-admin-text-secondary">SPORX Admin Paneline hoÅŸ geldiniz</p>
        </div>

        {/* Alerts */}
        {params.loggedOut === "1" && (
          <div className="mb-6 p-4 rounded-lg bg-admin-success/10 border border-admin-success/20 flex items-center gap-3">
            <svg className="w-5 h-5 text-admin-success flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-admin-success">Oturum baÅŸarÄ±yla kapatÄ±ldÄ±.</span>
          </div>
        )}
        
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-admin-error/10 border border-admin-error/20 flex items-center gap-3">
            <svg className="w-5 h-5 text-admin-error flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-admin-error">{error}</span>
          </div>
        )}

        {/* Form */}
        <form method="post" action="/api/admin/login" className="space-y-5">
          <input type="hidden" name="next" value={nextPath} />

          <div className="space-y-2">
            <label className="block text-sm font-medium text-admin-text-primary">
              E-posta Adresi
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-admin-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                type="email"
                name="email"
                autoComplete="username"
                placeholder="admin@sporx.local"
                required
                className="w-full pl-10 pr-4 py-3 bg-admin-bg-tertiary border border-admin-border-subtle rounded-lg text-admin-text-primary placeholder-admin-text-muted focus:outline-none focus:border-admin-brand-primary focus:ring-1 focus:ring-admin-brand-primary transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-admin-text-primary">
              Åifre
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="w-5 h-5 text-admin-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
                required
                className="w-full pl-10 pr-4 py-3 bg-admin-bg-tertiary border border-admin-border-subtle rounded-lg text-admin-text-primary placeholder-admin-text-muted focus:outline-none focus:border-admin-brand-primary focus:ring-1 focus:ring-admin-brand-primary transition-all"
              />
            </div>
          </div>

          <button 
            type="submit"
            className="w-full py-3 px-4 bg-gradient-to-r from-admin-brand-primary to-admin-brand-secondary text-white font-semibold rounded-lg hover:opacity-90 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-admin-brand-primary/25"
          >
            GiriÅŸ Yap
          </button>
        </form>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-admin-border-subtle text-center">
          <p className="text-xs text-admin-text-muted">
            Sadece yetkili kullanÄ±cÄ±lar eriÅŸebilir. <br/>
            Yetkisiz giriÅŸ denemeleri kaydedilmektedir.
          </p>
        </div>
      </div>
    </div>
  );
}

