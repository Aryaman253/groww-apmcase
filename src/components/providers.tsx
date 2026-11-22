"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeColorSync } from "@/components/layout/theme-color";
import { ServiceWorkerRegister } from "@/components/layout/sw-register";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider delayDuration={300}>
        {children}
        <Toaster position="top-center" richColors={false} closeButton />
        <ThemeColorSync />
        <ServiceWorkerRegister />
      </TooltipProvider>
    </ThemeProvider>
  );
}
