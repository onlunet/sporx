export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">SPORX Admin</h1>
        <p className="mt-3 text-sm text-slate-300">
          Yonetim paneline erismek icin giris sayfasini kullanin.
        </p>
        <div className="mt-6">
          <a
            href="/admin/login"
            className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
          >
            Admin Giris
          </a>
        </div>
      </section>
    </main>
  );
}
