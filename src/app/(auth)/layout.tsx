export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-accent-soft to-surface px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="پروا" className="h-14 w-14 rounded-2xl mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-accent">پروا</h1>
          <p className="text-sm text-muted mt-1">سیستم‌عامل شخصی زمان، وظایف و مالی</p>
        </div>
        {children}
      </div>
    </div>
  );
}
