import { AppShell } from "../components/app-shell";

export default function IntentsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
