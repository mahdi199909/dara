// Server-only — Resend's SDK and the API key must never reach the browser/native bundle. Only
// ever import this from src/app/api/**/route.ts (or other server-side code), the same way
// src/lib/db.ts's Prisma client is server-only.
import { Resend } from "resend";

// resend.dev is only usable for sending to the account's own verified address during
// development — sending to real users' inboxes needs a verified sending domain configured in
// the Resend dashboard, at which point this should become something like "دارا <no-reply@dara.app>".
const FROM = "دارا <onboarding@resend.dev>";

export async function sendEmail(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  // Constructed here, not at module scope: Next.js's build step imports and statically analyzes
  // every route module (to "collect page data"), which runs top-level code including this
  // constructor — and the Resend SDK throws immediately if the key is missing. Railway's build
  // step doesn't have RESEND_API_KEY available (only the running container does), so a
  // module-scope `new Resend(...)` broke every production build from the moment this file was
  // added, silently leaving Railway stuck serving a stale pre-email-verification deployment.
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({ from: FROM, to, subject, html });
  if (error) throw new Error(error.message);
}
