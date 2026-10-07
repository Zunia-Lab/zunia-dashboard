"use client";

/**
 * What a proposal executes if it passes: each message's type, its plain
 * fields at a glance (authority, recipient, amounts…), and the full JSON in a
 * fold. Huge fields (wasm byte code) arrive elided from the server and say
 * so; nothing here is interpreted, only printed as text.
 */

import { Badge, Card, CardBody, CardHeader, CopyButton, Disclosure } from "@/components/ui";
import { typeLabel } from "./model";

interface Field {
  key: string;
  value: string;
}

/** Top-level fields worth a glance: scalars as text, lists and objects summarised. */
function glance(message: Record<string, unknown>): Field[] {
  const fields: Field[] = [];
  for (const [key, value] of Object.entries(message)) {
    if (key === "@type") continue;
    if (value === null || value === undefined || value === "") continue;
    let text: string;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") text = String(value);
    else if (Array.isArray(value)) text = coinsText(value) ?? `${value.length} ${value.length === 1 ? "item" : "items"}`;
    else text = "{…}";
    fields.push({ key, value: text.length > 160 ? `${text.slice(0, 157)}…` : text });
    if (fields.length >= 6) break;
  }
  return fields;
}

/** `[{denom, amount}]` as "160183618723 factory/…/locust-vault-1922 + …" (raw base units, never guessed decimals). */
function coinsText(value: unknown[]): string | null {
  if (value.length === 0 || value.length > 8) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { denom, amount } = item as { denom?: unknown; amount?: unknown };
    if (typeof denom !== "string" || typeof amount !== "string") return null;
    parts.push(`${amount} ${denom}`);
  }
  return parts.join(" + ");
}

function fieldLabel(key: string): string {
  const words = key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ProposalMessages({ messages, truncated }: { messages: readonly unknown[]; truncated: boolean }) {
  if (messages.length === 0) {
    return (
      <Card>
        <CardHeader title="Messages" subtitle="What executes if it passes" icon="list" />
        <p className="text-[13px] text-fg-dim">A text proposal: nothing executes on chain if it passes. It records a decision.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Messages"
        subtitle="What executes on chain if it passes"
        icon="list"
        actions={<Badge>{messages.length === 1 ? "1 message" : `${messages.length} messages`}</Badge>}
      />
      <CardBody className="flex flex-col gap-2.5">
        {messages.map((raw, index) => {
          const message = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          const typeUrl = typeof message["@type"] === "string" ? message["@type"] : "unknown";
          const short = typeUrl.split(".").pop() ?? typeUrl;
          const json = JSON.stringify(raw, null, 2);
          const fields = glance(message);
          return (
            <div key={index} className="flex min-w-0 flex-col gap-2.5 rounded-[var(--d-radius-inner)] border border-[var(--d-hairline)] bg-[var(--d-card-2)] p-3.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-[11px] text-fg-dim">{String(index + 1).padStart(2, "0")}</span>
                <span className="text-[14px] font-medium text-fg">{typeLabel(short)}</span>
                <span className="min-w-0 break-all font-mono text-[11.5px] text-fg-dim">{typeUrl}</span>
              </div>
              {fields.length ? (
                <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)]">
                  {fields.map((field) => (
                    <div key={field.key} className="contents">
                      <dt className="text-fg-dim">{fieldLabel(field.key)}</dt>
                      <dd className="min-w-0 break-all font-mono text-[12px] text-fg-muted">{field.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <Disclosure summary="Raw JSON">
                <div className="relative">
                  <pre className="d-scroll max-h-[420px] overflow-auto rounded-[10px] border border-[var(--d-hairline)] bg-[var(--d-card)] p-3 pr-10 font-mono text-[11.5px] leading-[1.6] text-fg-muted">
                    {json}
                  </pre>
                  <span className="absolute right-1.5 top-1.5">
                    <CopyButton value={json} label="message JSON" size="sm" />
                  </span>
                </div>
              </Disclosure>
            </div>
          );
        })}
        {truncated ? (
          <p className="text-[12px] text-fg-dim">Very large fields, such as uploaded contract code, are shortened here.</p>
        ) : null}
      </CardBody>
    </Card>
  );
}
