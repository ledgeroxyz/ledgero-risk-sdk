# @ledgeroxyz/risk-sdk

A configurable, explainable risk-scoring engine for real-world-asset (RWA) underwriting.

`@ledgeroxyz/risk-sdk` is a small, dependency-free TypeScript library that turns structured facts about an asset — an invoice, a receivable pool, real estate, an inventory pool, a trade finance instrument, an equipment lease, or any generic asset — into a **0-100 risk score**, a **risk tier** (`low` / `medium` / `high` / `critical`), a **dapp-aligned letter grade** (`A` / `B` / `C` / `D`), and a **fully explainable, per-factor breakdown** of how that score was derived.

Beyond scoring a single asset, the SDK also ships **portfolio-level aggregation** (weighted averages, concentration risk, worst contributors), **model versioning & JSON serialization** (so a risk policy can be stored, diffed, and shipped as data), and a **calibration/backtesting utility** (Brier score, bucketed predicted-vs-actual default rates) for checking a model against real outcomes over time.

It contains no UI, no smart contracts, and no blockchain or network calls. It is pure scoring logic, meant to be embedded in whatever underwriting pipeline, API, or tool you're building.

## Why this exists

[LEDGERO](https://ledgero.xyz) (`$LEDGER`) is an AI underwriting agent for RWA tokenization. Its pipeline ingests source documents for a candidate asset, extracts structured fields via OCR, cross-references external data, runs a structured risk assessment against a risk model for that asset class, and emits a signed on-chain attestation.

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
console.log(result.letterGrade);  // "A" — dapp-aligned rating (>=80 A, >=60 B, >=40 C, else D)
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

The SDK ships a sensible default `RiskModel` for each built-in asset class, available individually or via the `defaultRiskModels` lookup:

```ts
import {
  defaultRiskModels,
  invoiceRiskModel,
  receivableRiskModel,
  propertyRiskModel,
  realEstateRiskModel,
  inventoryRiskModel,
  tradeFinanceRiskModel,
  equipmentLeaseRiskModel,
  otherRiskModel,
} from "@ledgeroxyz/risk-sdk";
```

| Asset class | Factors (id — description) |
|---|---|
| `invoice` | `payment-history`, `delinquency`, `counterparty-concentration`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `receivable` | `delinquency-rate`, `days-sales-outstanding`, `collateral-coverage`, `counterparty-concentration`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `property` / `real_estate` | `collateral-coverage` (loan-to-value), `asset-age`, `occupancy`, `title-defects`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `inventory` | `turnover`, `obsolescence`, `insurance-coverage`, `asset-age`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `trade-finance` | `issuing-bank-strength`, `documentary-discrepancies`, `tenor-risk`, `counterparty-concentration`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `equipment-lease` | `remaining-useful-life`, `arrears`, `lessee-creditworthiness`, `utilization`, `maintenance-compliance`, `document-completeness`, `valuation-confidence`, `jurisdiction-risk` |
| `other` | `document-completeness`, `counterparty-known`, `claimed-value`, `valuation-confidence` |

Each model's corresponding `*Facts` type (`InvoiceFacts`, `ReceivableFacts`, `PropertyFacts`, `RealEstateFacts`, `InventoryFacts`, `TradeFinanceFacts`, `EquipmentLeaseFacts`, `OtherFacts`) documents exactly what structured input each factor expects.

`real_estate` is the [LEDGERO dapp](#using-with-the-ledgero-dapp)'s canonical name for the `property` model — `realEstateRiskModel` reuses the same factors and weights, differing only in its `assetClass`. `other` is a generic fallback for assets that don't fit a specific class, built from class-agnostic signals with conservative defaults.

These are **defaults, not the only option** — the whole point of the SDK is that they're fully overridable.

## Using with the LEDGERO dapp

The SDK is aligned with the [LEDGERO dapp](https://ledgero.xyz)'s underwriting domain model so the dapp can adopt it directly — with no reshaping of the scoring output. Three things line up:

**1. Asset classes.** The dapp's asset classes are `invoice`, `receivable`, `real_estate`, `inventory`, and `other`. The SDK's `AssetClass` union is a **superset** of these, so any dapp asset class maps straight to a default model via `defaultRiskModels[assetClass]`. (`property` is retained as an alias of `real_estate` for existing SDK callers; the two share factors and weights.)

**2. Letter grades.** The dapp presents a single letter `rating` (`A`/`B`/`C`/`D`) rather than the SDK's four-tier ladder. Every `ScoreResult` now carries a `letterGrade` field computed with the dapp's exact thresholds (`>=80` → `A`, `>=60` → `B`, `>=40` → `C`, else `D`). Use `toLetterGrade(score)` to grade any score directly, or `tierToLetterGrade(tier)` to map an existing `RiskTier`.

**3. Factor shape.** The dapp renders each factor as `{ label, impact, detail }`, where `impact` is `"positive" | "negative" | "neutral"`. `toDappRiskFactors(result)` converts the SDK's weighted `breakdown` into exactly that shape — the returned array can be stored straight into the dapp's `factorsJson` column and read back with no transform.

```ts
import {
  scoreAsset,
  defaultRiskModels,
  toDappRiskFactors,
  type RealEstateFacts,
} from "@ledgeroxyz/risk-sdk";

// The dapp already has an asset class (e.g. "real_estate") and structured facts.
const facts: RealEstateFacts = {
  appraisedValue: 1_200_000,
  outstandingLoanAmount: 400_000,
  propertyAgeYears: 12,
  occupancyRatio: 0.95,
  titleDefects: false,
  documentCompleteness: 1,
  extractionConfidence: 0.9,
  jurisdictionRiskScore: 80,
};

const result = scoreAsset(defaultRiskModels.real_estate, facts);

// Persist the dapp's asset record straight from the SDK result:
const dappRecord = {
  riskScore: Math.round(result.overallScore), // 0-100
  rating: result.letterGrade,                 // "A" | "B" | "C" | "D"
  factorsJson: JSON.stringify(toDappRiskFactors(result)),
};

// toDappRiskFactors(result) →
// [
//   { label: "Collateral coverage ratio", impact: "positive",
//     detail: "Collateral coverage ratio scored 100/100 (30% of the overall weight) — supports the asset." },
//   { label: "Title defects", impact: "positive",
//     detail: "Title defects scored 100/100 (15% of the overall weight) — supports the asset." },
//   ...
// ]
```

`toDappRiskFactors` accepts an options object to tune the neutral band — sub-scores strictly above `neutralHigh` (default 55) read as `positive`, strictly below `neutralLow` (default 45) as `negative`, and anything in between as `neutral`.

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

## Portfolio risk aggregation

Once you've scored a set of individual assets, `summarizePortfolio` rolls those `ScoreResult`s up into portfolio-level metrics: an exposure-weighted average score, a tier distribution/histogram, Herfindahl-Hirschman-style concentration risk over any grouping key you supply (counterparty, asset class, jurisdiction, ...), and the worst-N contributors.

```ts
import { summarizePortfolio, scoreAsset, defaultRiskModels } from "@ledgeroxyz/risk-sdk";

const portfolio = [
  {
    id: "inv-001",
    result: scoreAsset(defaultRiskModels.invoice, invoiceFactsA),
    exposure: 48_000, // e.g. face value / outstanding balance
    groups: { counterparty: "acme-corp", assetClass: "invoice" },
  },
  {
    id: "inv-002",
    result: scoreAsset(defaultRiskModels.invoice, invoiceFactsB),
    exposure: 12_000,
    groups: { counterparty: "globex-inc", assetClass: "invoice" },
  },
  // ...
];

const summary = summarizePortfolio(portfolio, {
  concentrationBy: ["counterparty", "assetClass"],
  worstN: 5,
});

summary.weightedAverageScore;      // exposure-weighted mean overallScore
summary.tierDistribution;          // per-tier count/exposure histogram
summary.concentration;             // HHI + largest-group share, per grouping dimension
summary.worstContributors;         // the 5 lowest-scoring entries
```

`exposure` and `groups` are both optional — omit `exposure` for an equal-weighted portfolio, and omit `concentrationBy`/`groups` if you don't need concentration analysis. The `hhi` on each `ConcentrationResult` is on a 0-1 scale (sum of squared exposure shares); multiply by 10,000 for the conventional 0-10,000 HHI scale used in credit-risk literature.

## Model versioning & serialization

`RiskModel.factors[].score` is a plain JS function, so a live `RiskModel` can't be `JSON.stringify`'d directly — closures don't survive serialization. `serialize.ts` introduces a declarative, JSON-safe equivalent, `SerializableRiskModel`, built entirely out of the `scoring-utils` primitives (`linearScore`/`inverseLinearScore` → `{ type: "linear", invert? }`, `stepScore` → `{ type: "step" }`, `boolScore` → `{ type: "bool" }`, plus `{ type: "clamp" }` for a direct pass-through field):

```ts
import {
  serializeRiskModel,
  deserializeRiskModel,
  hydrateRiskModel,
  diffRiskModels,
  type SerializableRiskModel,
} from "@ledgeroxyz/risk-sdk";

const policy: SerializableRiskModel<InvoiceFacts> = {
  version: "1.0.0",
  assetClass: "invoice",
  name: "Acme Corp underwriting policy",
  factors: [
    {
      id: "payment-history",
      label: "Buyer payment history",
      weight: 40,
      field: "buyerOnTimePaymentRatio",
      scoring: { type: "linear", min: 0, max: 1 },
    },
    {
      id: "delinquency",
      label: "Current delinquency",
      weight: 30,
      field: "daysPastDue",
      // JSON has no Infinity — use a large finite sentinel for an open-ended top band.
      scoring: {
        type: "step",
        steps: [
          { threshold: 0, score: 100 },
          { threshold: 30, score: 50 },
          { threshold: Number.MAX_SAFE_INTEGER, score: 0 },
        ],
      },
    },
  ],
};

// Store/ship it as JSON:
const json = serializeRiskModel(policy);

// Later, load it back and turn it into a live, scorable RiskModel:
const restored = deserializeRiskModel<InvoiceFacts>(json);
const engine = createRiskEngine(hydrateRiskModel(restored));
```

`diffRiskModels` compares two versions of a policy and reports what changed — added/removed factors, re-weighted factors, changed scoring specs, and tier-threshold changes — useful for reviewing a policy change before promoting it to production:

```ts
import { diffRiskModels } from "@ledgeroxyz/risk-sdk";

const diff = diffRiskModels(policyV1, policyV2);
diff.versionChanged;     // true if `version` differs
diff.addedFactorIds;     // factor ids introduced in v2
diff.removedFactorIds;   // factor ids dropped in v2
diff.weightChanges;      // [{ id, fromWeight, toWeight }, ...]
diff.scoringChanges;     // factors whose scoring spec changed
```

**Limitation:** only factors expressible via the `scoring-utils` primitives can round-trip this way. A `RiskFactor` whose `score` is a fully custom closure (arbitrary multi-field logic, closures over outside state, etc.) is not representable as a `SerializableRiskFactor` — such models have to stay in plain in-memory `RiskModel` form.

## Calibration / backtesting

`calibrationReport` is a standalone statistical utility for checking whether a model's scores track real-world outcomes. Feed it historical `{ predictedScore, actualOutcome }` pairs — e.g. "we scored this invoice 72 at underwriting time, and it did/didn't ultimately default" — and it returns a bucketed predicted-vs-actual default rate table, a Brier score, and a calibration-gap summary. It has no dependency on `RiskModel`/`scoreAsset`, so it works against scores from any source, not just this SDK.

```ts
import { calibrationReport } from "@ledgeroxyz/risk-sdk";

const report = calibrationReport(
  [
    { predictedScore: 92, actualOutcome: false },
    { predictedScore: 15, actualOutcome: true },
    { predictedScore: 55, actualOutcome: false },
    // ... historical (score, outcome) pairs
  ],
  { bucketCount: 10 }, // optional, defaults to 10 decile buckets
);

report.brierScore;                   // 0 (perfect) to 1 (worst)
report.meanAbsoluteCalibrationGap;   // sample-weighted mean |actual - predicted| across buckets
report.buckets;                      // per-decile predicted vs. actual default rate
report.overallPredictedDefaultRate;  // mean predicted default probability
report.overallActualDefaultRate;     // observed default rate
```

Each bucket's `calibrationGap` (`actualDefaultRate - predictedDefaultRate`) is positive when the model was too optimistic for that score range, and negative when it was too pessimistic.

## API overview

```ts
// Engine
export function scoreAsset<TFacts>(model: RiskModel<TFacts>, facts: TFacts): ScoreResult;
export function createRiskEngine<TFacts>(model: RiskModel<TFacts>): RiskEngine<TFacts>;
export function mergeRiskModel<TFacts>(base: RiskModel<TFacts>, overrides: RiskModelOverrides<TFacts>): RiskModel<TFacts>;

// Tiers
export const defaultTierThresholds: RiskTierThreshold[];
export function resolveTier(score: number, thresholds?: RiskTierThreshold[]): RiskTier;

// Letter grades (dapp-aligned)
export function toLetterGrade(score: number): LetterGrade;
export function tierToLetterGrade(tier: RiskTier): LetterGrade;

// Dapp adapter
export function toDappRiskFactors(result: ScoreResult, options?: DappAdapterOptions): DappRiskFactor[];
export function toDappRiskFactor(factor: FactorContribution, options?: DappAdapterOptions): DappRiskFactor;

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
export const realEstateRiskModel: RiskModel<RealEstateFacts>;
export const inventoryRiskModel: RiskModel<InventoryFacts>;
export const tradeFinanceRiskModel: RiskModel<TradeFinanceFacts>;
export const equipmentLeaseRiskModel: RiskModel<EquipmentLeaseFacts>;
export const otherRiskModel: RiskModel<OtherFacts>;

// Portfolio aggregation
export function summarizePortfolio(entries: PortfolioEntry[], options?: PortfolioSummaryOptions): PortfolioSummary;

// Model versioning & serialization
export function hydrateRiskModel<TFacts>(model: SerializableRiskModel<TFacts>): RiskModel<TFacts>;
export function serializeRiskModel<TFacts>(model: SerializableRiskModel<TFacts>, space?: string | number): string;
export function deserializeRiskModel<TFacts>(json: string): SerializableRiskModel<TFacts>;
export function validateSerializableModel<TFacts>(model: SerializableRiskModel<TFacts>): void;
export function diffRiskModels<TFacts>(from: SerializableRiskModel<TFacts>, to: SerializableRiskModel<TFacts>): RiskModelDiff;

// Calibration / backtesting
export function calibrationReport(samples: CalibrationSample[], options?: CalibrationOptions): CalibrationReport;

// Types
export type AssetClass = "invoice" | "receivable" | "property" | "real_estate" | "inventory" | "trade-finance" | "equipment-lease" | "other";
export type RiskTier = "low" | "medium" | "high" | "critical";
export type LetterGrade = "A" | "B" | "C" | "D";
export interface RiskTierThreshold { tier: RiskTier; minScore: number; }
export interface RiskFactor<TFacts> { id: string; label: string; description?: string; weight: number; score: (facts: TFacts) => number; }
export interface RiskModel<TFacts> { assetClass: AssetClass; name?: string; description?: string; factors: RiskFactor<TFacts>[]; tierThresholds?: RiskTierThreshold[]; }
export interface FactorContribution { id: string; label: string; weight: number; normalizedWeight: number; subScore: number; contribution: number; }
export interface ScoreResult { assetClass: AssetClass; overallScore: number; tier: RiskTier; letterGrade: LetterGrade; breakdown: FactorContribution[]; }
export class RiskModelError extends Error {}

// Dapp adapter types
export interface DappRiskFactor { label: string; impact: "positive" | "negative" | "neutral"; detail: string; }
export interface DappAdapterOptions { neutralLow?: number; neutralHigh?: number; }

// Portfolio types
export interface PortfolioEntry { result: ScoreResult; exposure?: number; id?: string; groups?: Record<string, string>; }
export interface PortfolioSummaryOptions { concentrationBy?: string[]; worstN?: number; }
export interface PortfolioSummary { count: number; totalExposure: number; averageScore: number; weightedAverageScore: number; tierDistribution: TierDistributionEntry[]; concentration: ConcentrationResult[]; worstContributors: WorstContributor[]; }

// Serialization types
export type SerializableScoringSpec = { type: "linear"; min: number; max: number; invert?: boolean } | { type: "step"; steps: ScoreStep[] } | { type: "bool"; trueScore: number; falseScore: number } | { type: "clamp" };
export interface SerializableRiskFactor<TFacts> { id: string; label: string; description?: string; weight: number; field: Extract<keyof TFacts, string>; scoring: SerializableScoringSpec; }
export interface SerializableRiskModel<TFacts> { version: string; assetClass: AssetClass; name?: string; description?: string; factors: SerializableRiskFactor<TFacts>[]; tierThresholds?: RiskTierThreshold[]; }
export interface RiskModelDiff { fromVersion: string; toVersion: string; versionChanged: boolean; addedFactorIds: string[]; removedFactorIds: string[]; weightChanges: FactorWeightChange[]; fieldChanges: FactorFieldChange[]; scoringChanges: FactorScoringChange[]; tierThresholdsChanged: boolean; }

// Calibration types
export interface CalibrationSample { predictedScore: number; actualOutcome: boolean; }
export interface CalibrationOptions { bucketCount?: number; }
export interface CalibrationReport { sampleCount: number; brierScore: number; buckets: CalibrationBucket[]; meanAbsoluteCalibrationGap: number; overallPredictedDefaultRate: number; overallActualDefaultRate: number; }
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
