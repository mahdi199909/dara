"use client";

// Keeps an open app in step with the server without the person doing anything: while the app is
// on screen it periodically pulls whatever changed elsewhere (the web app, another phone). The
// other half — pushing shortly after every local edit — is triggered from apiClient.ts, and the
// open/resume syncs live in FirstRunGate.tsx and WidgetQueueDrainer.tsx. See src/lib/syncScheduler.ts.
import { useEffect } from "react";
import { startForegroundPolling } from "@/lib/syncScheduler";

export default function SyncScheduler() {
  useEffect(() => startForegroundPolling(), []);
  return null;
}
