/**
 * `use-toast` — centralized, typed toast helper.
 *
 * Wraps `addToast` from HeroUI so every surface uses the same
 * title patterns, description style, and timeout behaviour.
 *
 * Usage:
 *   const { success, error, warning } = useToast();
 *   success("Pod connected", "Welcome to your workspace");
 *   error("Couldn't reach pod", "Check your network and try again");
 */

import { addToast } from "@heroui/react";

interface ToastOptions {
  title: string;
  description?: string;
  timeout?: number;
}

export function useToast() {
  function success(title: string, description?: string, timeout?: number) {
    addToast({
      title,
      description,
      color: "success",
      timeout: timeout ?? 4000,
    });
  }

  function error(title: string, description?: string, timeout?: number) {
    addToast({
      title,
      description,
      color: "danger",
      timeout: timeout ?? 5000,
    });
  }

  function warning(title: string, description?: string, timeout?: number) {
    addToast({
      title,
      description,
      color: "warning",
      timeout: timeout ?? 4000,
    });
  }

  function info(title: string, description?: string, timeout?: number) {
    addToast({
      title,
      description,
      color: "default",
      timeout: timeout ?? 3000,
    });
  }

  return { success, error, warning, info };
}