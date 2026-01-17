# Trade Ledger API Architecture

## Overview

This document explains how the Trade Ledger API works, including perpetual vs spot trading, deposit tracking, and builder attribution.

## Hyperliquid Account Model

### Unified Account System

Hyperliquid uses a **unified account model** where:

1. **Single USDC Balance**: One USDC balance shared across all trading
2. **Perp Trading**: Trade perpetual contracts (BTC, ETH, etc.) using USDC margin
3. **Spot Trading**: Trade spot tokens (HYPE, PURR, etc.) using USDC

```
┌─────────────────────────────────┐
│   L1 Blockchain (Arbitrum)      │
│                                  │
│   User deposits USDC ──────┐    │
└────────────────────────────┼────┘
                             │
                             ▼
┌─────────────────────────────────┐
│   Hyperliquid L1 Account        │
│                                  │
│   USDC Balance: 10,000          │ ◄── userNonFundingLedgerUpdates
│   ├─ Perp Margin: ~8,000        │     (deposits/withdrawals)
│   └─ Spot Available: ~2,000     │
│                                  │
│   ┌──────────────────────────┐  │
│   │  Perp Trading            │  │
│   │  - BTC: 0.5 long         │  │ ◄── userFills (coin: "BTC")
│   │  - ETH: -2.3 short       │  │
│   └──────────────────────────┘  │
│                                  │
│   ┌──────────────────────────┐  │
│   │  Spot Balances           │  │
│   │  - HYPE: 1000.0          │  │ ◄── userFills (coin: "@107")
│   │  - PURR: 500.0           │  │     spotClearinghouseState
│   └──────────────────────────┘  │
└─────────────────────────────────┘
```

### Deposits: Perp Only, But Shared

**Key Insight**: There is NO separate "spot deposit" API. 

- **One deposit system**: `userNonFundingLedgerUpdates` tracks USDC deposits
- **Shared balance**: Deposited USDC can be used for both perp and spot
- **Spot tokens acquired via trading**: Buy HYPE with USDC on spot market

Example flow:
```
1. Deposit 1000 USDC          → userNonFundingLedgerUpdates (type: "deposit")
2. Buy 500 HYPE @ 2.0 USDC    → userFills (coin: "@107", side: "B")
3. Long 0.1 BTC @ 97000       → userFills (coin: "BTC", side: "B")
```

## Fill Data Structure

### Perpetual vs Spot Identification

The `userFills` API returns **both perpetual and spot fills** in the same response:

```json
// Perpetual fill
{
  "coin": "BTC",              // ← No @ prefix = perpetual
  "px": "97000.0",
  "sz": "0.1",
  "side": "B",
  "time": 1768665950720,
  "closedPnl": "7.39",
  "fee": "3.74",
  "builderFee": "0.94"        // ← Builder attribution
}

// Spot fill
{
  "coin": "@107",             // ← @ prefix = spot (universe index)
  "px": "24.865",
  "sz": "30.0",
  "side": "A",
  "time": 1768592175201,
  "closedPnl": "13.95",
  "fee": "0.32"
  // No builderFee on most spot fills
}
```

### Coin Identifier Format

| Format | Type | Example | Description |
|--------|------|---------|-------------|
| `"BTC"` | Perpetual | BTC, ETH, SOL | Standard perp markets |
| `"xyz:XYZ100"` | HIP-3 Perp | xyz:XYZ100 | DEX-deployed perps (HIP-3) |
| `"@107"` | Spot | @107, @1, @2 | Spot universe index (@ prefix) |

### Implementation: Unified Processing

Our implementation **naturally handles both** perpetual and spot fills:

```typescript
// Position tracking works for ANY coin identifier
const positionState: Record<string, {
  netSize: number;
  entryValue: number;
  entrySize: number;
}> = {};

// Works for "BTC", "ETH", "@107", "@1", etc.
positionState[fill.coin] = { ... };
```

**Design Decision**: We include both perp and spot fills in all endpoints because:
- ✅ API naturally returns both in unified format
- ✅ Position tracking logic is coin-agnostic
- ✅ No explicit requirement to exclude spot
- ✅ Spot fills are rare (0.2% for test user) but valid trading data
- ✅ Builder-only mode naturally filters most spot (rarely has builderFee)

## Builder Attribution

### How Builder Fees Work

Hyperliquid attributes trades to builders via the `builderFee` field:

```json
{
  "coin": "BTC",
  "fee": "3.74",           // Total fee paid by user
  "builderFee": "0.94"     // Portion attributed to builder (25% of fee)
}
```

**Key Properties**:
- `builderFee` field **only present when > 0**
- Builder attribution is **primarily on perpetuals** (rare on spot)
- Public API **does not expose** the actual builder address
- We use `TARGET_BUILDER` env var as a label in responses

### Builder Detection Logic

```typescript
private isBuilderTrade(fill: any): boolean {
  // Check if builderFee field exists and is > 0
  return fill.builderFee !== undefined && parseFloat(fill.builderFee) > 0;
}
```

**Note**: Since the public API doesn't expose builder addresses, we detect "any builder" via `builderFee` presence. The `TARGET_BUILDER` environment variable is used as a display label, but detection works independently.

## Position Lifecycle Tracking

### Lifecycle Definition

A **position lifecycle** is a sequence of fills from:
- **Open**: `netSize` goes from 0 → non-zero
- **Modifications**: Add to position, partial closes, flips (long↔short)
- **Close**: `netSize` returns to 0

### Builder-Only Mode with Taint Detection

In `builderOnly` mode, we track two lifecycle states:

```typescript
{
  builderOnly: boolean,  // true if ALL fills are builder-attributed
  tainted: boolean       // true if MIXED (both builder + non-builder fills)
}
```

**Taint Rules**:
- ✅ **Pure builder lifecycle**: All fills have `builderFee` → `builderOnly=true, tainted=false`
- ❌ **Tainted lifecycle**: Mix of builder and non-builder fills → `builderOnly=false, tainted=true`
- ❌ **Non-builder lifecycle**: No builder fills → `builderOnly=false, tainted=false`

**Why Taint?** Prevents gaming the system by:
1. Opening position via builder (gets attribution)
2. Closing via non-builder (avoid builder fees)
3. Result: Tainted lifecycle excluded from builder-only results

### Example Lifecycle

```
Timeline:
  t=0    → Buy  0.1 BTC @ 97000 (builder)    netSize: +0.1   ✓ builder
  t=100  → Buy  0.05 BTC @ 97500 (builder)   netSize: +0.15  ✓ builder
  t=200  → Sell 0.05 BTC @ 98000 (non-builder) netSize: +0.1 ✗ TAINTED!
  t=300  → Sell 0.1 BTC @ 98500 (builder)    netSize: 0     ✓ builder

Result: tainted=true, builderOnly=false (excluded from builder-only results)
```

## PnL Calculation

### Realized PnL Components

The API returns:

```json
{
  "realizedPnl": 196.87,    // Gross PnL (sum of closedPnl from fills)
  "feesPaid": 2999.82,      // Total trading fees
  "returnPct": 1.97,        // (realizedPnl / effectiveCapital) * 100
  "tradeCount": 2000,       // Number of fills
  "tainted": false          // Taint status (builderOnly mode only)
}
```

### Gross vs Net PnL

**Important**: `realizedPnl` is **gross PnL** (price movements only):

```
Gross PnL = Sum of closedPnl from all fills
Net PnL   = Gross PnL - Fees Paid

Example:
  realizedPnl:  +196.87 USDC  (looks profitable!)
  feesPaid:    -2999.82 USDC  (high trading costs)
  Net PnL:     -2802.95 USDC  (actually losing money)
```

**Design Decision**: We return both components separately for transparency:
- Users can see gross PnL (trading skill)
- Users can see fees (execution cost)
- Users can calculate net PnL: `realizedPnl - feesPaid`

### Return Percentage

```typescript
returnPct = (realizedPnl / effectiveCapital) * 100

where:
  effectiveCapital = min(equityAtFromMs, maxStartCapital)
```

**Note**: Return % uses **gross PnL**, not net PnL (as specified in task requirements).

## API Endpoints

### GET /v1/trades

Returns normalized fills with builder attribution:

```json
[
  {
    "timeMs": 1768665950720,
    "coin": "BTC",
    "side": "B",
    "px": "97000.0",
    "sz": "0.1",
    "fee": "3.74",
    "closedPnl": "7.39",
    "builder": "your-builder-name"  // Present only if builderFee > 0
  }
]
```

**Features**:
- Includes both perp and spot fills
- `builder` field only present for builder-attributed trades
- `builderOnly=true` filters to builder-attributed only

### GET /v1/positions/history

Returns position timeline snapshots:

```json
[
  {
    "timeMs": 1768665950720,
    "netSize": "0.1",
    "avgEntryPx": "97000.0",
    "tainted": false  // Only in builderOnly mode
  }
]
```

**Features**:
- Shows position changes over time (netSize, entry price)
- Handles partial closes and position flips (long↔short)
- Taint tracking in builderOnly mode
- Multi-coin support: omit `coin` param for all positions

### GET /v1/pnl

Returns aggregated PnL metrics:

```json
{
  "realizedPnl": 196.87,
  "returnPct": 1.97,
  "feesPaid": 2999.82,
  "tradeCount": 2000,
  "tainted": false
}
```

**Features**:
- Multi-coin aggregation (portfolio-level when `coin` omitted)
- Taint exclusion in builderOnly mode
- Effective capital capping via `maxStartCapital`

### GET /v1/leaderboard

Returns ranked users by metric:

```json
[
  {
    "rank": 1,
    "user": "0x...",
    "metricValue": 1234.56,
    "tradeCount": 150,
    "tainted": false
  }
]
```

**Metrics**: `volume`, `pnl`, `returnPct`

### GET /v1/deposits

Returns deposit history:

```json
{
  "totalDeposits": "16579.90",
  "depositCount": 225,
  "deposits": [
    {
      "timeMs": 1767109566769,
      "amount": "1000.0",
      "coin": "USDC"
    }
  ]
}
```

**Note**: Tracks USDC deposits to the unified account (usable for both perp and spot).

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Hyperliquid Public API                  │
└──────────────┬──────────────────────────────────────────────┘
               │
               ├─► userFills
               │   - Returns all fills (perp + spot)
               │   - closedPnl, fee, builderFee fields
               │
               ├─► userNonFundingLedgerUpdates  
               │   - Returns deposits/withdrawals/transfers
               │   - USDC movements (perp account)
               │
               └─► clearinghouseState
                   - Returns current account equity
                   - Used for return % calculation
                   
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   LedgerDatasource                          │
│                                                              │
│  getFills()         → Fetches & filters fills by time/coin  │
│  getDeposits()      → Fetches ledger updates                │
│  getEquityAt()      → Fetches account equity at timestamp   │
│  getVolume()        → Calculates trading volume             │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    LedgerService                            │
│                                                              │
│  transformFillsForPositions()                               │
│  ├─► Tracks position state per coin (netSize, entry price) │
│  └─► Adds netAfter, avgEntryPx to each fill                │
│                                                              │
│  buildPositionLifecycles()                                  │
│  ├─► Groups fills into position lifecycles                  │
│  ├─► Tracks builder/non-builder activity                   │
│  ├─► Calculates taint status                               │
│  └─► Aggregates realizedPnl, feesPaid, tradeCount          │
│                                                              │
│  getTrades()         → Normalized fills + builder label     │
│  getPositionHistory() → Timeline snapshots                  │
│  getPnl()            → Aggregated metrics                   │
│  getLeaderboard()    → Ranked users                         │
│  getDeposits()       → USDC deposit tracking                │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    REST Controllers                         │
│                                                              │
│  /v1/trades          → TradesController                     │
│  /v1/positions/...   → PositionHistoryController            │
│  /v1/pnl             → PnlController                        │
│  /v1/leaderboard     → LeaderboardController                │
│  /v1/deposits        → DepositsController                   │
└─────────────────────────────────────────────────────────────┘
```

## Multi-Coin Aggregation

### Portfolio-Level Metrics

When `coin` parameter is **omitted**, endpoints return portfolio-level aggregations:

```bash
# Single coin PnL
GET /v1/pnl?user=0x...&coin=BTC
→ Returns PnL for BTC positions only

# Portfolio PnL (all coins)
GET /v1/pnl?user=0x...
→ Returns aggregated PnL across ALL coins (BTC, ETH, @107, etc.)
```

**Implementation**: Position state tracked per coin in a `Record<string, {...}>`:

```typescript
const positionState: Record<string, PositionState> = {
  "BTC": { netSize: 0.5, entryValue: 48500, entrySize: 0.5 },
  "ETH": { netSize: -2.3, entryValue: 7650, entrySize: 2.3 },
  "@107": { netSize: 1000, entryValue: 26000, entrySize: 1000 },
};
```

This enables both:
- ✅ Single-coin leaderboards (e.g., "Best BTC traders")
- ✅ Multi-coin leaderboards (e.g., "Best overall traders")

## Environment Configuration

```bash
# Required
TARGET_BUILDER=your-builder-name  # Label for builder attribution in responses

# Optional
PORT=3000                         # API server port (default: 3000)
```

**Note**: `TARGET_BUILDER` is used as a display label when trades have `builderFee`, but the actual builder detection is based on the presence of the `builderFee` field (the public API doesn't expose builder addresses).

## Testing

Example test user (from task spec):
```
0x6c8031a9eb4415284f3f89c0420f697c87168263
```

Statistics:
- 2000 total fills
- 1996 perpetual fills (99.8%)
- 4 spot fills (0.2%)
- 225 USDC deposits totaling $16,579.90
- Gross PnL: +196.87 USDC
- Fees paid: -2999.82 USDC
- Net PnL: -2802.95 USDC

## Key Design Decisions

1. **Perp + Spot Inclusion**: Both perpetual and spot fills are included because:
   - API returns them in unified format
   - Position tracking is coin-agnostic
   - No explicit requirement to exclude
   - Builder-only mode naturally filters most spot

2. **Deposit Tracking**: Only tracks USDC deposits (no separate spot deposits) because:
   - Hyperliquid uses unified account model
   - Single USDC balance shared across perp and spot
   - Spot tokens acquired via trading, not deposits

3. **Gross vs Net PnL**: Returns both `realizedPnl` (gross) and `feesPaid` separately:
   - Transparency: users see both components
   - Task spec uses gross PnL for return %
   - Users can calculate net if needed

4. **Taint Detection**: Prevents gaming builder attribution by:
   - Tracking mixed builder/non-builder lifecycles
   - Excluding tainted lifecycles from builder-only results
   - Ensures fair builder PnL tracking
