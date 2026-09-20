"use client";

// Opens the screen a home-screen widget pointed at. The widgets launch MainActivity with a
// `parva://open/<screen>` link (see WidgetLinks.java); Capacitor's App plugin reports it as
// `appUrlOpen` when the app was already running, and as the launch URL when the tap started it.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { routeFromWidgetUrl } from "@/lib/widgetRoutes";

// The launch URL stays readable for the life of the process; it must only be acted on once.
let launchUrlHandled = false;

function isNativePlatform(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

export default function DeepLinkHandler() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    (async () => {
      const { App } = await import("@capacitor/app");

      if (!launchUrlHandled) {
        launchUrlHandled = true;
        const launch = await App.getLaunchUrl();
        const route = routeFromWidgetUrl(launch?.url);
        if (route && !cancelled) router.push(route);
      }

      const handle = await App.addListener("appUrlOpen", (event) => {
        const route = routeFromWidgetUrl(event.url);
        if (route) router.push(route);
      });
      remove = () => void handle.remove();
      if (cancelled) remove();
    })().catch((err) => console.error("deep link setup failed", err));

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);

  return null;
}
