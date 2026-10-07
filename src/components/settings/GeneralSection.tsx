"use client";

/**
 * General: how numbers and the page look. Currency, theme, privacy mode and
 * the small-balance fold on Assets. Each applies at once and is remembered
 * on this browser; nothing here is sent anywhere.
 */

import { useTheme, type ThemeMode } from "@zunialab/ui";
import { Segmented, Switch } from "@/components/ui";
import { currencySymbol } from "@/lib/format";
import { useStoredValue } from "@/lib/useStoredValue";
import { usePrefs, type FiatCurrency } from "@/providers/PrefsProvider";
import { SettingRow, SettingsSection } from "./SettingsBlocks";

/**
 * The Assets page's own view preferences (its "Hide < $1" toggle lives
 * here): the same key and shape, so the switch below and the one on Assets
 * are one setting.
 */
const ASSETS_VIEW_KEY = "zunia.dashboard.assets.view";
type AssetsView = { hideSmall?: boolean } & Record<string, unknown>;
const NO_VIEW: AssetsView = {};

export function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const { currency, setCurrency, hideAmounts, toggleHideAmounts } = usePrefs();
  const [view, setView] = useStoredValue<AssetsView>(ASSETS_VIEW_KEY, NO_VIEW);
  const symbol = currencySymbol(currency);

  return (
    <SettingsSection id="general" title="General" subtitle="How numbers and the dashboard look" icon="settings">
      <SettingRow
        title="Currency"
        description="For every value, chart and total. Without an exchange rate, figures stay in USD and say so."
        control={
          <Segmented<FiatCurrency>
            ariaLabel="Currency"
            mono
            size="md"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "usd", label: "USD" },
              { value: "eur", label: "EUR" },
              { value: "gbp", label: "GBP" },
            ]}
          />
        }
      />
      <SettingRow
        title="Theme"
        description="System follows your device's light or dark setting."
        control={
          <Segmented<ThemeMode>
            ariaLabel="Theme"
            size="md"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" },
            ]}
          />
        }
      />
      <SettingRow
        title="Hide amounts"
        inline
        controlId="setting-hide-amounts"
        description="Masks balances, values and notification amounts; prices and percentages stay. The eye in the top bar does the same."
        control={<Switch id="setting-hide-amounts" checked={hideAmounts} onCheckedChange={() => toggleHideAmounts()} />}
      />
      <SettingRow
        title="Hide small balances"
        inline
        controlId="setting-hide-small"
        description={`Folds positions under ${symbol}1 away on Assets. Unpriced tokens always show: unknown is not small.`}
        control={
          <Switch
            id="setting-hide-small"
            checked={view.hideSmall === true}
            onCheckedChange={(hideSmall) => setView((current) => ({ ...current, hideSmall }))}
          />
        }
      />
    </SettingsSection>
  );
}
