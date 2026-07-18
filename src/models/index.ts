export * from "./invoice.js";
export * from "./receivable.js";
export * from "./property.js";
export * from "./inventory.js";
export * from "./trade-finance.js";
export * from "./equipment-lease.js";

import type { AssetClass, RiskModel } from "../types.js";
import { invoiceRiskModel } from "./invoice.js";
import { receivableRiskModel } from "./receivable.js";
import { propertyRiskModel } from "./property.js";
import { inventoryRiskModel } from "./inventory.js";
import { tradeFinanceRiskModel } from "./trade-finance.js";
import { equipmentLeaseRiskModel } from "./equipment-lease.js";

/**
 * Lookup table of the default risk model for each built-in asset class.
 * Each entry is a plain `RiskModel` object — use `mergeRiskModel` to
 * derive a customized variant, or construct an entirely new
 * `RiskModel<TFacts>` for asset classes not covered here.
 */
export const defaultRiskModels: Record<AssetClass, RiskModel<any>> = {
  invoice: invoiceRiskModel,
  receivable: receivableRiskModel,
  property: propertyRiskModel,
  inventory: inventoryRiskModel,
  "trade-finance": tradeFinanceRiskModel,
  "equipment-lease": equipmentLeaseRiskModel,
};
