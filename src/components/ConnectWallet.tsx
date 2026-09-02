"use client";

import { useState } from "react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@zunialab/ui";
import { ConnectWithZuniaButton } from "@zunialab/sdk-react";
import { useWallet } from "@/providers/WalletProvider";

export function ConnectWallet({
  size = "md",
  fullWidth = false,
  label = "Connect wallet",
}: {
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  label?: string;
} = {}) {
  const {
    busy,
    error,
    zuniaAvailable,
    keplrAvailable,
    connectWithExtension,
    connectWithKeplr,
    connectWithWalletConnect,
  } = useWallet();
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function run(fn: () => Promise<void> | void) {
    setLocalError(null);
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Connect failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <ConnectWithZuniaButton size={size} installed fullWidth={fullWidth}>
          {label}
        </ConnectWithZuniaButton>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>Connect</DialogTitle>
        <DialogDescription>
          Zunia, Keplr and WalletConnect keep keys on your device. The dashboard
          never asks for a recovery phrase.
        </DialogDescription>
        <Callout tone="info" className="mt-3 w-full" title="Phrases stay in the wallet apps">
          Create or import only in the extension or mobile app.
        </Callout>
        <div className="mt-4 flex flex-col gap-3">
          <ConnectWithZuniaButton
            size="md"
            installed={zuniaAvailable}
            loading={busy}
            label="Connect with Zunia"
            onClick={() => {
              if (!zuniaAvailable) {
                window.open("https://zuniawallet.com", "_blank", "noopener,noreferrer");
                return;
              }
              return run(() => connectWithExtension());
            }}
          />
          <Button
            variant="secondary"
            disabled={busy || !keplrAvailable}
            onClick={() => run(() => connectWithKeplr())}
          >
            {keplrAvailable ? "Keplr" : "Keplr not detected"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => connectWithWalletConnect())}
          >
            WalletConnect (mobile stub)
          </Button>
          {(localError || error) && (
            <p className="font-mono text-[13px] text-[var(--z-danger)]">
              {localError || error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
