import type { RiskModel } from "../types.js";
import { propertyRiskModel, type PropertyFacts } from "./property.js";

/**
 * Structured facts about a real-estate asset being underwritten for
 * tokenization. `real_estate` is the LEDGERO dapp's canonical name for
 * what the SDK historically called `property`; the fact shape is
 * identical, so this is a type alias rather than a separate interface.
 */
export type RealEstateFacts = PropertyFacts;

/**
 * Default LEDGERO risk model for real-estate assets.
 *
 * This is the dapp-aligned counterpart of {@link propertyRiskModel}: it
 * reuses the exact same factors and weights, differing only in its
 * `assetClass` (`"real_estate"` vs `"property"`). Scoring either model on
 * the same facts yields the same overall score and breakdown — the two
 * names exist so callers can key off whichever asset-class vocabulary
 * they already use.
 *
 * Fully overridable via `mergeRiskModel` or by constructing your own
 * `RiskModel<RealEstateFacts>`.
 */
export const realEstateRiskModel: RiskModel<RealEstateFacts> = {
  ...propertyRiskModel,
  assetClass: "real_estate",
  name: "Default real-estate risk model",
  description:
    "Default LEDGERO risk model for real-estate assets. Dapp-aligned name for the property model; shares its factors and weights.",
};
