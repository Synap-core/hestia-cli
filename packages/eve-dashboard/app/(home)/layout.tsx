import { AppShell } from "../components/app-shell";

/**
 * Home route group layout.
 *
 * Wraps `/` (the OS Home) in the same AppShell that powers the rest of
 * the dashboard so the sidebar / mobile nav stay consistent. The
 * `(home)` parens make this a route group — it does not add a path
 * segment, so the page lives at `/`.
 */
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
