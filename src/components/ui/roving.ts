/**
 * Roving-focus arithmetic for radio groups, chip groups, tabs and lists:
 * which item an arrow / Home / End key moves to. Pure, so node:test covers
 * it; the components only focus the element at the returned index.
 */

/**
 * The next index for arrow / Home / End navigation over `count` items,
 * skipping disabled ones and wrapping around (the ARIA radio and tab
 * patterns both wrap). Null for any other key, or when nothing is enabled.
 */
export function nextRovingIndex(
  key: string,
  current: number,
  count: number,
  isDisabled: (index: number) => boolean = () => false,
): number | null {
  if (count === 0) return null;
  let step: number;
  let from = current;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      step = 1;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      step = -1;
      break;
    case "Home":
      step = 1;
      from = -1;
      break;
    case "End":
      step = -1;
      from = count;
      break;
    default:
      return null;
  }
  for (let i = 1; i <= count; i += 1) {
    const index = (((from + step * i) % count) + count) % count;
    if (!isDisabled(index)) return index;
  }
  return null;
}
