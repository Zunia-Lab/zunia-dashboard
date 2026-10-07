/**
 * Activity building blocks other pages can reuse (Overview's recent activity,
 * the Live popover, Swap's and Bridge's recent lists), so a transaction reads
 * the same everywhere.
 *
 * `ActivityRow` renders an <li>: put rows in a <ul>. Pass `timeStyle="relative"`
 * in a short list without day headings.
 */

export { ActivityRow, type ActivityRowProps } from "./ActivityRow";
export { GROUP_COLORS, GROUP_COLOR_MAP, GROUP_ICONS, GroupSwatch, KIND_ICONS, KindIcon, type KindIconProps } from "./KindIcon";
export { txHref } from "./view";
