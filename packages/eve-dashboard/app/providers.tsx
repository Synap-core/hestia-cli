"use client";

import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <HeroUIProvider>
        <ToastProvider
          placement="bottom-right"
          toastProps={{
            timeout: 4000,
            shouldShowTimeoutProgress: true,
            variant: "flat",
            radius: "md",
          }}
        />
        {children}
      </HeroUIProvider>
    </NextThemesProvider>
  );
}
