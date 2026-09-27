"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import CodeSignIn from "@/components/auth/CodeSignIn";

// "Forgot password": a code to the verified email or mobile number, then a new password. The account is
// signed out everywhere else and signed in here.
export default function ForgotPasswordPage() {
  const router = useRouter();
  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-line p-6">
      <h2 className="text-lg font-bold mb-4 text-ink">بازیابی رمز عبور</h2>
      <CodeSignIn
        purpose="RESET_PASSWORD"
        onAuthenticated={() => {
          router.push("/");
          router.refresh();
        }}
      />
      <p className="text-center text-sm text-muted mt-4">
        <Link href="/login" className="text-accent font-medium">
          بازگشت به ورود
        </Link>
      </p>
    </div>
  );
}
