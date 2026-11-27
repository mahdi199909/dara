"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import RegisterWithCode from "@/components/auth/RegisterWithCode";

// Sign-up on an email address or a mobile number, proven by a one-time code (see RegisterWithCode).
export default function RegisterPage() {
  const router = useRouter();
  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-line p-6">
      <h2 className="text-lg font-bold mb-4 text-ink">ساخت حساب جدید</h2>
      <RegisterWithCode
        onAuthenticated={() => {
          router.push("/");
          router.refresh();
        }}
      />
      <p className="text-center text-sm text-muted mt-4">
        قبلاً ثبت‌نام کرده‌اید؟{" "}
        <Link href="/login" className="text-accent font-medium">
          ورود
        </Link>
      </p>
    </div>
  );
}
