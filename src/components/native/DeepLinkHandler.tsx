"use client";

// Opens the screen a home-screen widget pointed at. The widgets launch MainActivity with a
// `parva://open/<screen>` link (see WidgetLinks.java); Capacitor's App plugin reports it as
// `appUrlOpen` when the app was already running, and as the launch URL when the tap started it.
// A notification that carries a screen (the end-of-day review) opens it the same way, through the
// local-notifications plugin's tap event (see listenForNotificationTaps).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { routeFromWidgetUrl } from "@/lib/widgetRoutes";
import { getLogger } from "@/lib/observability";

const log = getLogger("system", "deep-link");

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
    })().catch((err) => log.warn("SYSTEM_DEEP_LINK_FAILED", { error: err, layer: "local" }));

    return () => {
      cancelled = true;
      remove?.();
    };
  }, [router]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    import("@/local/nativeNotifications")
      .then(({ listenForNotificationTaps }) => {
        if (!cancelled) stop = listenForNotificationTaps((route) => router.push(route));
      })
      .catch((err) => log.warn("SYSTEM_DEEP_LINK_FAILED", { error: err, layer: "local" }));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [router]);

  return null;
}
