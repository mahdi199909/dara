export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white text-2xl font-bold mb-3">
            د
          </div>
          <h1 className="text-2xl font-bold text-brand-900">پنهان</h1>
          <p className="text-sm text-gray-500 mt-1">سیستم‌عامل شخصی زمان، وظایف و مالی</p>
        </div>
        {children}
      </div>
    </div>
  );
}
