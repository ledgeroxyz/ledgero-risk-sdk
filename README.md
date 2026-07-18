# @ledgeroxyz/risk-sdk

A configurable, explainable risk-scoring engine for real-world-asset (RWA) underwriting.

`@ledgeroxyz/risk-sdk` is a small, dependency-free TypeScript library that turns structured facts about an asset — an invoice, a receivable pool, a property, an inventory pool — into a **0-100 risk score**, a **risk tier** (`low` / `medium` / `high` / `critical`), and a **fully explainable, per-factor breakdown** of how that score was derived.

It contains no UI, no smart contracts, and no blockchain or network calls. It is pure scoring logic, meant to be embedded in whatever underwriting pipeline, API, or tool you're building.

## Why this exists

[LEDGERO](https://ledgero.xyz) (`$LDGR`) is an AI underwriting agent for RWA tokenization. Its pipeline ingests source documents for a candidate asset, extracts structured fields via OCR, cross-references external data, runs a structured risk assessment against a risk model for that asset class, and emits a signed on-chain attestation.

`@ledgeroxyz/risk-sdk` is the standalone risk-**scoring** component extracted from that pipeline — the part that takes structured facts and a risk model and produces a scored, explainable result. It's published separately, under its own license, specifically so that it's useful to anyone building their own underwriting tooling, not just LEDGERO's own agent. If you're building a credit engine, a diligence tool, or any system that needs to turn weighted risk factors into a defensible score, this library is meant to be a solid, general-purpose building block for that — no LEDGERO-specific assumptions required.

## Install

```bash
pnpm add @ledgeroxyz/risk-sdk
```

(npm / yarn work too — this is a standard ESM package.)

## Quickstart

```ts
import { createRiskEngine, defaultRiskModels } from "@ledgeroxyz/risk-sdk";
import type { InvoiceFacts } from "@ledgeroxyz/risk-sdk";

// 1. Pick a default model for your asset class (or bring your own — see below).
const engine = createRiskEngine(defaultRiskModels.invoice);

// 2. Provide structured facts about the asset (from your ingestion/extraction step).
const facts: InvoiceFacts = {
  invoiceAmount: 48_000,
  buyerOnTimePaymentRatio: 0.92,
  daysPastDue: 0,
  buyerConcentration: 0.18,
  documentCompleteness: 1,
  extractionConfidence: 0.95,
  jurisdictionRiskScore: 82,
};

// 3. Score it.
const result = engine.score(facts);

console.log(result.overallScore); // e.g. 87.4
console.log(result.tier);         // "low"
console.log(result.breakdown);
// [
//   { id: "payment-history", label: "Buyer payment history", weight: 25, normalizedWeight: 0.25, subScore: 92, contribution: 23 },
//   { id: "delinquency", label: "Current delinquency", weight: 20, normalizedWeight: 0.20, subScore: 100, contribution: 20 },
//   ...
// ]
```

Prefer a one-off, stateless call instead of a bound engine? Use `scoreAsset` directly:

```ts
import { scoreAsset, defaultRiskModels } from "@ledgeroxyz/risk-sdk";

const result = scoreAsset(defaultRiskModels.invoice, facts);
```

## Core concepts

### Scoring convention

Every sub-score and the overall score live on a **0-100 scale where 100 is best** (lowest risk) and **0 is worst** (highest risk). This keeps every factor's scoring function intuitive: "how healthy is this dimension?", answered on the same scale regardless of what the factor measures.

### Risk factors

A `RiskFactor<TFacts>` is one named, weighted, independently scorable dimension of risk:

```ts
interface RiskFactor<TFacts> {
  id: string;                          // stable, unique within a model
  label: string;                       // human-readable name
  description?: string;
  weight: number;                      // relative weight — doesn't need to sum to any total
  score: (facts: TFacts) => number;    // 0-100, 100 = best
}
```

### Risk models

A `RiskModel<TFacts>` bundles the factors for one asset class, plus optional custom tier thresholds:

```ts
interface RiskModel<TFacts> {
  assetClass: AssetClass;              // "invoice" | "receivable" | "property" | "inventory" | ...
  name?: string;
  description?: string;
  factors: RiskFactor<TFacts>[];
  tierThresholds?: RiskTierThreshold[]; // defaults to defaultTierThresholds
}
```

Weights are relative — the engine normalizes them across all factors in the model, so `{weight: 3}` / `{weight: 7}` behaves identically to `{weight: 30}` / `{weight: 70}`.

### The scoring engine

```ts
function scoreAsset<TFacts>(model: RiskModel<TFacts>, facts: TFacts): ScoreResult;

function createRiskEngine<TFacts>(model: RiskModel<TFacts>): {
  model: RiskModel<TFacts>;
  score(facts: TFacts): ScoreResult;
};
```

Both produce a `ScoreResult`:

```ts
interface ScoreResult {
  assetClass: AssetClass;
  overallScore: number;          // 0-100 weighted score
  tier: RiskTier;                // "low" | "medium" | "high" | "critical"
  breakdown: FactorContribution[]; // per-factor explainability
}

interface FactorContribution {
  id: string;
  label: string;
  weight: number;            // configured weight
  normalizedWeight: number;  // weight / sum(all weights)
  subScore: number;          // this factor's own 0-100 score
  contribution: number;      // subScore * normalizedWeight
}
```

`createRiskEngine` validates the model eagerly (no factors, duplicate factor ids, negative weights) so misconfiguration fails fast at construction time rather than on the first score.

### Risk tiers

```ts
const defaultTierThresholds: RiskTierThreshold[] = [
  { tier: "low", minScore: 80 },
  { tier: "medium", minScore: 60 },
  { tier: "high", minScore: 40 },
  { tier: "critical", minScore: 0 },
];
```

Override per-model via `RiskModel.tierThresholds`, or call `resolveTier(score, customThresholds)` directly.

### Scoring helpers

`RiskFactor.score` functions are plain `(facts) => number` — write them however you like — but the SDK ships a few small composable helpers for the common cases:

- `linearScore(value, { min, max, invert? })` — linear interpolation onto 0-100, clamped at the ends.
- `inverseLinearScore(value, { min, max })` — shorthand for `linearScore` with `invert: true` (higher raw value → lower score).
- `stepScore(value, steps)` — discrete risk bands, e.g. "0-15 days past due → 85, 15-30 → 60, ...".
- `boolScore(value, { trueScore, falseScore })` — map a boolean condition (e.g. "has title defects") to a score.
- `clampScore(value)` — clamp any number into [0, 100].

## Default risk models

The SDK ships a sensible default `RiskModel` for each of the four built-in asset classes, available individually or via the `defaultRiskModels` lookup:

```ts
import { defaultRiskModels, invoiceRiskModel, receivableRiskModel, propertyRiskModel, inventoryRiskModel } from "@ledgeroxyz/risk-sdk";
```

| Asset class | Factors (id — description) |
|---|---|
| `invoice` | `payment-history`, `delinquency`, `counterparty-concentration`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `receivable` | `delinquency-rate`, `days-sales-outstanding`, `collateral-coverage`, `counterparty-concentration`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `property` | `collateral-coverage` (loan-to-value), `asset-age`, `occupancy`, `title-defects`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `inventory` | `turnover`, `obsolescence`, `insurance-coverage`, `asset-age`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |

Each model's corresponding `*Facts` type (`InvoiceFacts`, `ReceivableFacts`, `PropertyFacts`, `InventoryFacts`) documents exactly what structured input each factor expects.

These are **defaults, not the only option** — the whole point of the SDK is that they're fully overridable.

## Defining a custom risk model

You have two options: adjust a default model, or write one from scratch.

### Option A — tweak a default model with `mergeRiskModel`

```ts
import { mergeRiskModel, invoiceRiskModel, createRiskEngine } from "@ledgeroxyz/risk-sdk";

const myInvoiceModel = mergeRiskModel(invoiceRiskModel, {
  name: "Acme Corp underwriting policy",
  factors: [
    { id: "payment-history", weight: 40 }, // re-weight an existing factor
  ],
  addFactors: [
    {
      id: "esg-flag",
      label: "ESG exclusion flag",
      weight: 10,
      score: (facts) => (facts.esgExcluded ? 0 : 100),
    },
  ],
  removeFactorIds: ["jurisdiction-risk"], // drop a factor entirely
  tierThresholds: [
    { tier: "low", minScore: 85 },
    { tier: "medium", minScore: 65 },
    { tier: "high", minScore: 45 },
    { tier: "critical", minScore: 0 },
  ],
});

const engine = createRiskEngine(myInvoiceModel);
```

`mergeRiskModel` never mutates the base model — it returns a new `RiskModel`.

### Option B — write a model from scratch

A `RiskModel` is just plain data, so you can construct one for an entirely new asset class:

```ts
import { createRiskEngine, linearScore, stepScore, type RiskModel } from "@ledgeroxyz/risk-sdk";

interface EquipmentLeaseFacts {
  remainingUsefulLifeYears: number;
  monthsInArrears: number;
  utilizationRatio: number; // 0-1
}

const equipmentLeaseModel: RiskModel<EquipmentLeaseFacts> = {
  assetClass: "invoice", // reuse an existing AssetClass, or extend the union yourself
  name: "Equipment lease risk model",
  factors: [
    {
      id: "remaining-life",
      label: "Remaining useful life",
      weight: 40,
      score: (f) => linearScore(f.remainingUsefulLifeYears, { min: 0, max: 10 }),
    },
    {
      id: "arrears",
      label: "Months in arrears",
      weight: 40,
      score: (f) =>
        stepScore(f.monthsInArrears, [
          { threshold: 0, score: 100 },
          { threshold: 1, score: 70 },
          { threshold: 3, score: 30 },
          { threshold: Infinity, score: 0 },
        ]),
    },
    {
      id: "utilization",
      label: "Utilization ratio",
      weight: 20,
      score: (f) => linearScore(f.utilizationRatio, { min: 0, max: 1 }),
    },
  ],
};

const engine = createRiskEngine(equipmentLeaseModel);
```

## API overview

```ts
// Engine
export function scoreAsset<TFacts>(model: RiskModel<TFacts>, facts: TFacts): ScoreResult;
export function createRiskEngine<TFacts>(model: RiskModel<TFacts>): RiskEngine<TFacts>;
export function mergeRiskModel<TFacts>(base: RiskModel<TFacts>, overrides: RiskModelOverrides<TFacts>): RiskModel<TFacts>;

// Tiers
export const defaultTierThresholds: RiskTierThreshold[];
export function resolveTier(score: number, thresholds?: RiskTierThreshold[]): RiskTier;

// Scoring helpers
export function clampScore(value: number): number;
export function linearScore(value: number, options: LinearScoreOptions): number;
export function inverseLinearScore(value: number, options: Omit<LinearScoreOptions, "invert">): number;
export function stepScore(value: number, steps: ScoreStep[]): number;
export function boolScore(value: boolean, options: BoolScoreOptions): number;

// Default models
export const defaultRiskModels: Record<AssetClass, RiskModel<any>>;
export const invoiceRiskModel: RiskModel<InvoiceFacts>;
export const receivableRiskModel: RiskModel<ReceivableFacts>;
export const propertyRiskModel: RiskModel<PropertyFacts>;
export const inventoryRiskModel: RiskModel<InventoryFacts>;

// Types
export type AssetClass = "invoice" | "receivable" | "property" | "inventory";
export type RiskTier = "low" | "medium" | "high" | "critical";
export interface RiskTierThreshold { tier: RiskTier; minScore: number; }
export interface RiskFactor<TFacts> { id: string; label: string; description?: string; weight: number; score: (facts: TFacts) => number; }
export interface RiskModel<TFacts> { assetClass: AssetClass; name?: string; description?: string; factors: RiskFactor<TFacts>[]; tierThresholds?: RiskTierThreshold[]; }
export interface FactorContribution { id: string; label: string; weight: number; normalizedWeight: number; subScore: number; contribution: number; }
export interface ScoreResult { assetClass: AssetClass; overallScore: number; tier: RiskTier; breakdown: FactorContribution[]; }
export class RiskModelError extends Error {}
```

## Development

```bash
pnpm install
pnpm test         # vitest
pnpm typecheck    # tsc --noEmit
pnpm build        # tsup -> dist/
```

## License

MIT © ledgeroxyz
