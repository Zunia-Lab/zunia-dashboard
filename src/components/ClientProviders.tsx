"use client";

import { Providers } from "@/providers/Providers";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
