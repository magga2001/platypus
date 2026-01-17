# Trade Ledger API Architecture

## Overview

This document explains how the Trade Ledger API works, including perpetual vs spot trading, deposit tracking, builder attribution, real-time data synchronization, and database caching.

## System Architecture

### Three-Tier Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Client Layer                          │
│  HTTP Requests → REST API Endpoints                       │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                  Application Layer                        │
│                                                            │
│  ┌──────────────────────────────────────────────┐        │
│  │  Controllers (Express Routes)                │        │
│  │  - TradesController                          │        │
│  │  - PositionHistoryController                 │        │
│  │  - PnlController                             │        │
│  │  - LeaderboardController                     │        │
│  │  - DepositsController                        │        │
│  └──────────────┬───────────────────────────────┘        │
│                 │                                          │
│  ┌──────────────▼───────────────────────────────┐        │
│  │  LedgerService (Business Logic)             │        │
│  │  - Position lifecycle tracking               │        │
│  │  - PnL calculation                           │        │
│  │  - Builder attribution                       │        │
│  │  - Multi-coin aggregation                    │        │
│  │  - Smart caching strategy                    │        │
│  └──────────────┬───────────────────────────────┘        │
│                 │                                          │
│  ┌──────────────▼───────────────────────────────┐        │
│  │  FillSyncService (Real-time Sync)           │        │
│  │  - WebSocket subscription management         │        │
│  │  - Idempotent user syncing                   │        │
│  │  - Auto-reconnection handling                │        │
│  └──────────────────────────────────────────────┘        │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│                    Data Layer                             │
│                                                            │
│  ┌──────────────────┐  ┌──────────────────────────┐     │
│  │  Database        │  │  Hyperliquid API         │     │
│  │  (PostgreSQL)    │  │  (REST + WebSocket)      │     │
│  │                  │  │                          │     │
│  │  - user_fills    │  │  - userFills (REST)      │     │
│  │  - Indexes       │  │  - userFills (WebSocket) │     │
│  │  - Caching       │  │  - deposits              │     │
│  │                  │  │  - equity                │     │
│  └──────────────────┘  └──────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

## Real-Time Data Synchronization

### Smart Caching Strategy

The system uses a **hybrid approach** combining database caching with real-time WebSocket updates:

**On First API Call (New User)**:
1. Fetch initial 2000 fills from Hyperliquid REST API
2. Cache fills in PostgreSQL database
3. Start WebSocket subscription for real-time updates
4. Return data to client

**On Subsequent API Calls (Existing User)**:
1. Read fills from database (fast!)
2. WebSocket keeps database fresh in background
3. Return data to client
4. **No API call to Hyperliquid** (reduces load)

**On Server Startup**:
1. Load predefined users (configurable list)
2. Check if user exists in database
   - If YES: Backfill recent data (catch missed fills)
   - If NO: Fetch initial 2000 fills
3. Start WebSocket subscriptions for all users

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  Client Request (API Call)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Is user in database?        │
         └───────┬───────────────┬───────┘
                 │               │
            YES  │               │  NO (New User)
                 │               │
                 ▼               ▼
    ┌────────────────────┐  ┌──────────────────────┐
    │  Read from DB      │  │  Fetch from API      │
    │  (Fast, cached)    │  │  (Initial 2000)      │
    └────────┬───────────┘  └──────────┬───────────┘
             │                         │
             │                         ▼
             │              ┌──────────────────────┐
             │              │  Cache to Database   │
             │              └──────────┬───────────┘
             │                         │
             │                         ▼
             │              ┌──────────────────────┐
             │              │  Start WebSocket     │
             │              │  Subscription        │
             │              └──────────────────────┘
             │                         │
             └─────────┬───────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │  Return to Client    │
            └──────────────────────┘
            
┌─────────────────────────────────────────────────────────────┐
│            WebSocket (Background Process)                   │
│                                                              │
│  New fill arrives → Cache to DB → Keep data fresh          │
└─────────────────────────────────────────────────────────────┘
```

### WebSocket Management

**FillSyncService** manages real-time subscriptions:

```typescript
class FillSyncService {
  private activeSubscriptions: Map<string, () => void>;
  
  // Idempotent: Only starts sync if not already syncing
  async ensureUserSyncing(user: string): Promise<void> {
    if (!this.isSyncing(user)) {
      await this.startSyncingUser(user);
    }
  }
  
  // Start real-time fill sync for a user
  async startSyncingUser(user: string): Promise<void> {
    const unsubscribe = await this.datasource.subscribeToUserFills(
      user,
      async (fills: Fill[]) => {
        // Cache new fills to database
        await userFillRepository.upsertMany(fills);
      }
    );
    this.activeSubscriptions.set(user, unsubscribe);
  }
}
```

**Key Features**:
- **Idempotent**: `ensureUserSyncing()` prevents duplicate subscriptions
- **Auto-reconnect**: WebSocket automatically reconnects on disconnect
- **Logging**: Shows distinct user count after each subscription
- **Graceful shutdown**: Cleans up all subscriptions on server stop

### Database Schema

**user_fills table**:
```sql
CREATE TABLE user_fills (
  user TEXT NOT NULL,
  coin TEXT NOT NULL,
  oid BIGINT NOT NULL,
  tid BIGINT NOT NULL,
  px TEXT NOT NULL,
  sz TEXT NOT NULL,
  side TEXT NOT NULL,
  time BIGINT NOT NULL,
  closed_pnl TEXT NOT NULL,
  fee TEXT NOT NULL,
  builder_fee TEXT,
  start_position TEXT NOT NULL,
  dir TEXT NOT NULL,
  hash TEXT NOT NULL,
  crossed BOOLEAN,
  fee_token TEXT,
  
  -- Indexes for query performance
  INDEX idx_user_time (user, time),
  INDEX idx_user_coin_time (user, coin, time),
  
  -- Prevent duplicates
  UNIQUE (user, tid)
);
```

**Why This Schema**:
- **user + tid unique constraint**: Prevents duplicate fills
- **Indexes on (user, time, coin)**: Fast queries for API endpoints
- **TEXT for decimals**: Preserves precision (Hyperliquid uses string decimals)
- **builder_fee nullable**: Only present when trade is builder-attributed

### Startup User Configuration

**Server startup** (`src/server.ts`):
```typescript
const STARTUP_USERS = [
  '0x0e09b56ef137f417e424f1265425e93bfff77e17',
  '0x186b7610ff3f2e3fd7985b95f525ee0e37a79a74',
  '0x6c8031a9eb4415284f3f89c0420f697c87168263',
];

async function startFillSync() {
  const dbUsers = await userFillRepository.getDistinctUsers();
  const allUsers = Array.from(new Set([...dbUsers, ...STARTUP_USERS]));
  
  for (const user of allUsers) {
    const isInDb = dbUsers.includes(user);
    
    if (isInDb) {
      // Backfill recent data (catch missed fills during downtime)
      await ledgerService.backfillUser(user);
    } else {
      // Fetch initial data (first time seeing this user)
      await ledgerService.getTrades({ user });
    }
    
    // Ensure WebSocket subscription is active
    await fillSyncService.ensureUserSyncing(user);
  }
}
```

**Benefits**:
- Predefined users have data ready immediately
- Database users are restored on restart
- Avoids redundant API calls for existing users
- Catches any missed fills during server downtime

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

**Dynamic User List**: The leaderboard pulls users from the database (users who have made API calls), not a hardcoded list. This ensures:
- Only active users appear in leaderboard
- Leaderboard updates automatically as new users make API calls
- Empty array `[]` returned if no users in database

**Query**: `getAllUsers()` → `userFillRepository.getDistinctUsers()` → Returns list of users with cached fills

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
               ├─► userFills (REST API)
               │   - Returns up to 2000 most recent fills
               │   - Used for initial data fetch
               │   - Supports time-range queries
               │
               ├─► userFills (WebSocket)
               │   - Real-time fill updates
               │   - Subscription-based
               │   - Auto-reconnect on disconnect
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
│                   PublicHLDatasource                        │
│                                                              │
│  getFills()             → Fetches fills (REST)              │
│  subscribeToUserFills() → WebSocket subscription           │
│  getDeposits()          → Fetches ledger updates            │
│  getEquityAt()          → Fetches account equity            │
│  getAllUsers()          → Gets users from database          │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database Layer                           │
│                   (userFillRepository)                      │
│                                                              │
│  upsertMany()           → Cache fills (prevent duplicates)  │
│  findByUser()           → Query cached fills               │
│  getLatestTimestamp()   → Check if user has cached data    │
│  getDistinctUsers()     → List all cached users            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                    LedgerService                            │
│                                                              │
│  getTransformedFills()                                      │
│  ├─► Check if user has cached data                         │
│  ├─► If cached: Read from DB only (fast!)                  │
│  ├─► If new: Fetch from API + cache + start WebSocket      │
│  └─► Return fills with position tracking                   │
│                                                              │
│  transformFillsForPositions()                               │
│  ├─► Tracks position state per coin                        │
│  └─► Adds netAfter, avgEntryPx to each fill               │
│                                                              │
│  buildPositionLifecycles()                                  │
│  ├─► Groups fills into position lifecycles                 │
│  ├─► Tracks builder/non-builder activity                  │
│  ├─► Calculates taint status                              │
│  └─► Aggregates realizedPnl, feesPaid, tradeCount         │
│                                                              │
│  backfillUser()                                             │
│  └─► Fetches recent fills to catch missed data            │
│                                                              │
│  getTrades()         → Normalized fills + builder label     │
│  getPositionHistory() → Timeline snapshots                  │
│  getPnl()            → Aggregated metrics                   │
│  getLeaderboard()    → Ranked users (from DB)               │
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

┌─────────────────────────────────────────────────────────────┐
│                 FillSyncService (Background)                │
│                                                              │
│  WebSocket → New Fill Event → Cache to DB → Keeps data fresh│
│  Runs continuously for all subscribed users                 │
│  Auto-reconnects on disconnect                              │
│  Idempotent subscription management                         │
└─────────────────────────────────────────────────────────────┘
```

### Complete Request Flow Examples

**Example 1: First API call for a new user**
```
1. Client: GET /v1/trades?user=0xABC
2. LedgerService: Check if user has cached data
   → getLatestTimestamp(0xABC) → null (not in DB)
3. LedgerService: Fetch from Hyperliquid API
   → getFills(user=0xABC) → 2000 fills
4. LedgerService: Cache to database
   → upsertMany(2000 fills) → DB write
5. LedgerService: Start WebSocket subscription
   → ensureUserSyncing(0xABC) → WebSocket subscribe
6. Return: 2000 fills to client
7. Background: WebSocket listens for new fills
```

**Example 2: Subsequent call for existing user**
```
1. Client: GET /v1/trades?user=0xABC
2. LedgerService: Check if user has cached data
   → getLatestTimestamp(0xABC) → 1768665950720 (exists!)
3. LedgerService: Read from database
   → findByUser(0xABC) → 2000 fills (fast!)
4. Return: 2000 fills to client
5. No API call to Hyperliquid (WebSocket keeps it fresh)
```

**Example 3: Server restart**
```
1. Server starts
2. Load predefined users: [0xABC, 0xDEF, 0xGHI]
3. Load database users: [0xABC] (existing from previous run)
4. Merge: [0xABC, 0xDEF, 0xGHI] (remove duplicates)
5. For 0xABC (in DB):
   → backfillUser() → Fetch recent fills (catch missed data)
   → ensureUserSyncing() → Start WebSocket
6. For 0xDEF, 0xGHI (not in DB):
   → getTrades() → Fetch initial 2000 fills + cache
   → ensureUserSyncing() → Start WebSocket
7. Server ready with 3 users syncing
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

# Database Configuration (Docker or Local)
DB_HOST=localhost                 # Database host
DB_PORT=5432                      # Database port
DB_USER=postgres                  # Database user
DB_PASS=postgres                  # Database password
DB_NAME=platypus                  # Database name

# Optional
PORT=3000                         # API server port (default: 3000)
```

**Note**: `TARGET_BUILDER` is used as a display label when trades have `builderFee`, but the actual builder detection is based on the presence of the `builderFee` field (the public API doesn't expose builder addresses).

## Docker Deployment

### Two Deployment Options

**Option 1: Local Development (Database Only)**
```bash
docker-compose -f docker-compose.local.yml up -d
npm run dev
```
- PostgreSQL + pgAdmin in Docker
- Node.js app runs locally
- Uses `postgres_data_local` volume
- Best for development

**Option 2: Full Production Stack**
```bash
docker-compose up -d
```
- Everything in Docker (DB + App + pgAdmin)
- Uses `postgres_data` volume
- Best for production deployment

**Database Volumes**:
- `postgres_data_local`: Local development database (separate)
- `postgres_data`: Production database (separate)
- Both can run simultaneously without conflicts

**pgAdmin Access**:
- URL: http://localhost:5050
- Email: admin@admin.com
- Password: admin

## Performance Optimizations

### 1. Database Caching
- **First call**: Fetch from API + cache (slow)
- **Subsequent calls**: Read from DB only (fast!)
- **Typical speedup**: 10-50x faster for cached users

### 2. WebSocket Real-time Sync
- Keeps database fresh automatically
- No need to poll API
- Reduces API load significantly
- Auto-reconnects on disconnect

### 3. Smart Startup Strategy
- Predefined users: Pre-fetched on startup
- Database users: Backfill only (not full refetch)
- Idempotent subscriptions: No duplicates

### 4. Database Indexes
```sql
-- Fast user queries
INDEX idx_user_time ON user_fills (user, time);

-- Fast coin-specific queries  
INDEX idx_user_coin_time ON user_fills (user, coin, time);

-- Prevent duplicates
UNIQUE INDEX ON user_fills (user, tid);
```

### 5. Batch Processing
- Database writes: Batched (100 fills per batch)
- API fetches: Parallel time-range queries
- WebSocket updates: Real-time (no batching needed)

## Monitoring and Logging

### Startup Logs
```
🔄 Starting fill sync service...
📋 Found 1 users in database, 3 predefined users (3 total unique)
🔄 Fetching initial data for 0x0e09b56ef137f417e424f1265425e93bfff77e17...
💾 Caching 2000 fills for 0x0e09b56ef137f417e424f1265425e93bfff77e17
✅ Cached 2000 fills for 0x0e09b56ef137f417e424f1265425e93bfff77e17
🔄 Ensuring WebSocket sync for 0x0e09b56ef137f417e424f1265425e93bfff77e17...
✅ Subscribed to fills for 0x0e09b56ef137f417e424f1265425e93bfff77e17 (now syncing 1 users)
✅ Fill sync started for 3 users
```

### WebSocket Logs
```
Connecting to Hyperliquid WebSocket...
✅ Hyperliquid WebSocket connected
Resubscribing to 0 feeds...  ← Normal on fresh connection
✅ Subscribed to fills for 0xABC (now syncing 1 users)
Subscription confirmed: userFills
```

### Runtime Logs
```
🆕 New user detected: 0xDEF, fetching initial data...
💾 Caching 2000 fills for 0xDEF
✅ Cached 2000 fills for 0xDEF
✅ Subscribed to fills for 0xDEF (now syncing 2 users)

ℹ️  Already syncing 0xABC (2 total users)  ← Idempotent check
✅ Synced 5 fills for 0xABC  ← Real-time update
```

### Key Metrics to Monitor
- **Distinct user count**: How many users are actively syncing
- **Cache hit rate**: DB reads vs API calls
- **WebSocket reconnections**: Should be rare
- **Database write performance**: Batch insert times
- **API response times**: Should be <100ms for cached users

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
