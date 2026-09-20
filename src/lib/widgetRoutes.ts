// Where a tap on a home-screen widget can take the app. The widgets (Java) open MainActivity with
// a `parva://open/<screen>` link; src/components/native/DeepLinkHandler.tsx turns that into a
// navigation. Only screens listed here are honoured, so a crafted link cannot push the app to an
// arbitrary path.
const SCHEME_PREFIX = "parva://open";

export const WIDGET_ROUTES: ReadonlySet<string> = new Set(["/", "/habits", "/calendar", "/reports", "/tasks", "/finance", "/settings"]);

/** The in-app path a widget link points at, or null when it is not one of ours or not an allowed screen. */
export function routeFromWidgetUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(SCHEME_PREFIX)) return null;
  let path = url.slice(SCHEME_PREFIX.length).split("?")[0].split("#")[0];
  if (path === "") path = "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return WIDGET_ROUTES.has(path) ? path : null;
}
