import { AppShell } from "../components/app-shell";

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
