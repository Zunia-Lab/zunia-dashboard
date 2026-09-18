"use client";

import { useState } from "react";
import { Button, Callout } from "@zunialab/ui";
import { getZunia } from "@zunialab/sdk-web";
import { useWallet } from "@/providers/WalletProvider";

/**
 * Device binding via ADR-36 signArbitrary on the connected extension account.
 */
export function DeviceBinding() {
  const { account } = useWallet();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address =
    account && "address" in account ? account.address : undefined;
  const chainId =
    account && "chainId" in account ? account.chainId : "cosmoshub-4";
  const canBind = account?.mode === "extension" && Boolean(address);

  async function bind() {
    if (!address) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const challengeRes = await fetch("/api/device/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId }),
      });
      const challenge = await challengeRes.json();
      if (!challengeRes.ok) {
        throw new Error(challenge.message ?? "Challenge failed");
      }

      const zunia = await getZunia({ timeoutMs: 2_000 });
      if (!zunia?.signArbitrary) {
        throw new Error(
          "Extension does not expose signArbitrary. Update Zunia extension.",
        );
      }
      const signature = await zunia.signArbitrary(
        chainId,
        address,
        challenge.nonce,
      );

      const verifyRes = await fetch("/api/device/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          address,
          signature,
        }),
      });
      const verified = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verified.message ?? "Verify failed");
      }
      if (verified.sessionToken) {
        window.localStorage.setItem(
          "zunia.dashboard.session",
          verified.sessionToken,
        );
      }
      setMessage("Device bound. Session stored for this browser.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Binding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <Callout tone="info" title="Device binding">
        Binding proves you control the connected address by signing a one-time
        challenge with ADR-36 (signArbitrary). Keys never leave the wallet.
      </Callout>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm" disabled={!canBind || busy} onClick={() => void bind()}>
          {busy ? "Signing…" : "Bind this device"}
        </Button>
        {!canBind ? (
          <span className="font-mono text-[length:var(--z-type-meta)] text-fg-dim">
            Connect the Zunia extension first
          </span>
        ) : null}
      </div>
      {message ? (
        <p className="font-mono text-[12px] text-[var(--z-success)]">{message}</p>
      ) : null}
      {error ? (
        <p className="font-mono text-[12px] text-[var(--z-danger)]">{error}</p>
      ) : null}
    </div>
  );
}
