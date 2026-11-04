"use client";

/**
 * Insights: whether the dashboard suggests anything at all, and what the
 * reader has hidden. Insights are worked out on this device from reads the
 * pages make anyway; turning them off removes the Overview row and the
 * Insights page's lists, nothing else.
 *
 * The hidden count reads the record of opened and cleared insights directly
 * (`lib/insights/dismissals.ts`), so this page does not run the rules or the
 * reads behind them just to show a number.
 */

import { Button, Switch, useNow } from "@/components/ui";
import { useWallet } from "@/lib/connect/context";
import { activeDismissals, EMPTY_BOOK, INSIGHT_DISMISSALS_KEY, readBook, restoreInsights, type DismissalBook } from "@/lib/insights/dismissals";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs } from "@/providers/PrefsProvider";
import { SettingRow, SettingsSection } from "./SettingsBlocks";

export function InsightsSection() {
  const { insightsOn, setInsightsOn } = usePrefs();
  const { account } = useWallet();
  const [stored, setStored] = useStoredValue<DismissalBook>(INSIGHT_DISMISSALS_KEY, EMPTY_BOOK);
  const now = useNow();
  const address = account?.address ?? null;
  const hidden = now === null ? 0 : activeDismissals(readBook(stored), address, now);

  return (
    <SettingsSection id="insights" title="Insights" subtitle="Suggestions measured from your own wallet" icon="insights">
      <SettingRow
        title="Show insights"
        inline
        controlId="setting-insights"
        description="Rewards worth claiming, votes closing, idle balances and risks, on the Overview and the Insights page. Worked out on this device; nothing is sent."
        control={<Switch id="setting-insights" checked={insightsOn} onCheckedChange={setInsightsOn} />}
      />
      <SettingRow
        title="Hidden insights"
        description={
          address
            ? `${hidden === 0 ? "None" : hidden} hidden for this account. An insight you open or clear stays hidden for a week while it still holds, and comes back sooner if it becomes more urgent. A vote you clear returns only for its last 48 hours.`
            : "Connect a wallet to see the insights you hid. Hidden ones are kept per account, on this device."
        }
        control={
          <Button size="sm" variant="secondary" iconLeft="eye" disabled={!address || hidden === 0} onClick={() => address && setStored((prev) => restoreInsights(readBook(prev), address))}>
            Show them again
          </Button>
        }
      />
    </SettingsSection>
  );
}
