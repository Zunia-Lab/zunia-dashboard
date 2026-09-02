"use client";

import { ThemeProvider } from "@zunialab/ui";
import { WalletGate } from "@/components/WalletGate";
import { PrefsProvider } from "@/providers/PrefsProvider";
import { WalletProvider } from "@/providers/WalletProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider defaultTheme="dark">
      <PrefsProvider>
        <WalletProvider>
          <WalletGate>{children}</WalletGate>
        </WalletProvider>
      </PrefsProvider>
    </ThemeProvider>
  );
}
