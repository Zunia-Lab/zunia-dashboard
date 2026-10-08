/**
 * The memo row of a review step: the memo exactly as it will be signed
 * (`describeTxMemo`, the same string `planTx` signs), and a quiet line when
 * Zunia wrote it because the user left the memo empty. Shared by every
 * review (Send, Bridge, Swap, staking, governance, NFT) so the row reads the
 * same wherever a transaction is checked.
 */

import type { KeyValueItem } from "@/components/ui";
import type { TxMemoView } from "@/lib/tx/memo";

export function txMemoItem(view: TxMemoView): KeyValueItem {
  return {
    key: "memo",
    label: "Memo",
    value: <span className="break-words font-mono text-[12.5px]">{view.memo}</span>,
    ...(view.automatic ? { sub: "Added automatically" } : {}),
  };
}
