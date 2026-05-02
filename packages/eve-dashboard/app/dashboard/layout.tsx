"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { LogOut, LayoutDashboard, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/dashboard/ai", label: "AI Providers", icon: Sparkles },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [hostname, setHostname] = useState<string>("");

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-divider bg-content1 px-6 py-3 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌿</span>
            <span className="font-bold text-foreground">Eve</span>
            {hostname && (
              <span className="text-xs text-default-400 font-mono ml-2 hidden sm:inline">
                {hostname}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href === "/dashboard" && pathname === "/dashboard");
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-primary-50 text-primary dark:bg-primary-900/30"
                      : "text-default-500 hover:text-foreground hover:bg-content2"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <Button
          variant="light"
          size="sm"
          startContent={<LogOut className="w-4 h-4" />}
          onPress={signOut}
          className="text-default-500"
        >
          Sign out
        </Button>
      </header>
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
