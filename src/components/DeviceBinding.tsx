"use client";

import { useState } from "react";
import { Button, Callout } from "@zunialab/ui";
import { useWallet } from "@/providers/WalletProvider";

/**
 * ADR-36 device binding stub: challenge from /api/device/challenge,
 * signature via extension `signArbitrary` when available, verify via backend stub.
 */
export function DeviceBinding() {
  const { account } = useWallet();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function bind() {
    if (!account) {
      setStatus("Connect Zunia, Keplr, or WalletConnect first.");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const challengeRes = await fetch("/api/device/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          chainId: account.chainId,
        }),
      });
      const challenge = (await challengeRes.json()) as {
        challengeId?: string;
        message?: string;
        error?: string;
      };
      if (!challengeRes.ok || !challenge.message || !challenge.challengeId) {
        throw new Error(challenge.error ?? "Challenge failed");
      }

      let signature = "stub-signature";
      let pubKey = "stub-pubkey";

      const provider =
        typeof window !== "undefined"
          ? account.mode === "extension" && account.wallet === "keplr"
            ? window.keplr
            : (window.zunia ?? window.keplr)
          : undefined;
      if (
        provider &&
        "signArbitrary" in provider &&
        typeof (provider as { signArbitrary?: unknown }).signArbitrary ===
          "function"
      ) {
        const signed = await (
          provider as {
            signArbitrary: (
              chainId: string,
              signer: string,
              data: string,
            ) => Promise<{ signature: string; pub_key: { value: string } }>;
          }
        ).signArbitrary(account.chainId, account.address, challenge.message);
        signature = signed.signature;
        pubKey = signed.pub_key.value;
      }

      const verifyRes = await fetch("/api/device/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address: account.address,
          chainId: account.chainId,
          signature,
          pubKey,
        }),
      });
      const verified = (await verifyRes.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!verifyRes.ok || !verified.ok) {
        throw new Error(verified.error ?? "Verify failed");
      }
      setStatus("Device bound. Session token issued by backend when live.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Binding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Callout tone="info">
        Proves address ownership with ADR-36 `signArbitrary` in Zunia or Keplr.
        Signing never leaves the wallet.
      </Callout>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          size="sm"
          disabled={busy || !account}
          loading={busy}
          onClick={() => void bind()}
        >
          {busy ? "Binding…" : "Bind this device"}
        </Button>
        {!account ? (
          <span className="font-mono text-[12px] text-fg-dim">
            Connect a wallet first
          </span>
        ) : (
          <span className="font-mono text-[12px] text-fg-dim">
            {account.mode}
            {account.mode === "extension" && account.wallet
              ? ` · ${account.wallet}`
              : ""}
          </span>
        )}
      </div>
      {status ? (
        <p className="font-mono text-[12px] text-fg-muted">{status}</p>
      ) : null}
    </div>
  );
}
