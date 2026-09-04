// Plain, non-"use client" home for shared layout numbers — src/app/(app)/layout.tsx (an async
// Server Component) needs BOTTOM_NAV_HEIGHT_PX in a template literal, and importing a plain
// constant across the RSC client/server boundary from a "use client" module (BottomNav.tsx)
// doesn't work: Next wraps client-module exports as opaque client-reference objects even for
// non-component values, so the server side sees `[object Object]` instead of the number. A
// boundary-free constants file sidesteps that entirely.
export const BOTTOM_NAV_HEIGHT_PX = 64;
// AppTopBar is a fixed h-14 row (see that file) rather than natural-height padding, specifically
// so Home's own no-scroll layout can size itself as an exact calc(100vh - ...) — a padding-based
// height would drift if its content ever wrapped to two lines.
export const TOP_BAR_HEIGHT_PX = 56;
