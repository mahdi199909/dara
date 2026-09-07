export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="پروا" className="h-14 w-14 rounded-2xl mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-brand-900">پروا</h1>
          <p className="text-sm text-gray-500 mt-1">سیستم‌عامل شخصی زمان، وظایف و مالی</p>
        </div>
        {children}
      </div>
    </div>
  );
}
