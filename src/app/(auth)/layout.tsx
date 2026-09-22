import { APP_DISPLAY_NAME } from "@/lib/appVersion";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-accent-soft to-surface px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt={APP_DISPLAY_NAME} className="h-14 w-14 rounded-2xl mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-accent">{APP_DISPLAY_NAME}</h1>
          <p className="text-sm text-muted mt-1">زمان، پول، کار و دارایی‌هایت در یک دفتر واحد.</p>
        </div>
        {children}
      </div>
    </div>
  );
}
