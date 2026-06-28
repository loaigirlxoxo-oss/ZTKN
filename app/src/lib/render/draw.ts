import type { PanelItem } from "../model/panel";
import { formatValue } from "./format";

export function itemDisplayText(item: PanelItem, value: number): string {
  return formatValue(item.format ?? "%d", value);
}
