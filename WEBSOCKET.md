# WebSocket Integration Guide

## Overview

The Hyperliquid Trade Ledger API now supports **WebSocket** for real-time data streaming, with **REST API** as a reliable fallback. This hybrid approach provides:

- ⚡ **Real-time updates** via WebSocket
- 🔄 **Automatic reconnection** on disconnect
- 📦 **In-memory caching** for instant access
- 🛡️ **REST fallback** for reliability
- 🔮 **Database-ready** architecture

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Application Layer                        │
│                  (Service, Controllers, Routes)              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    LedgerDatasource                          │
│              (PublicHLDatasource implementation)             │
├─────────────────────────────────────────────────────────────┤
│  WebSocket Stream          │         REST API Fallback      │
│  (Real-time)               │         (Historical/Reliable)  │
├────────────────────────────┼────────────────────────────────┤
│  • subscribeToUserFills()  │  • getFills()                  │
│  • getCachedFills()        │  • getEquityAt()               │
│  • Auto-reconnect          │  • getVolume()                 │
│  • In-memory cache         │  • Rate limit friendly         │
└────────────────────────────┴────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   Hyperliquid API            │
              │   wss://api.hyperliquid.xyz  │
              └──────────────────────────────┘
```

## Quick Start

### 1. Connect and Subscribe

```typescript
import { PublicHLDatasource } from './datasource/hyperliquid';

const datasource = new PublicHLDatasource();
const user = '0x0e09b56ef137f417e424f1265425e93bfff77e17';

// Subscribe to real-time fills
const unsubscribe = await datasource.subscribeToUserFills(user, (fills) => {
  console.log(`Received ${fills.length} new fills`);
  fills.forEach(fill => {
    console.log(`${fill.coin} ${fill.side} ${fill.sz} @ ${fill.px}`);
  });
});

// Unsubscribe when done
unsubscribe();
```

### 2. Check Connection Status

```typescript
if (datasource.isWebSocketConnected()) {
  console.log('WebSocket active - using real-time data');
} else {
  console.log('Using REST API fallback');
}
```

### 3. Use Cached Data

```typescript
// Get fills from WebSocket cache (instant, no API call)
const cached = datasource.getCachedFills(user);

// Fallback to REST if cache is empty
if (cached.length === 0) {
  const restFills = await datasource.getFills({ user });
}
```

## API Reference

### `subscribeToUserFills(user, onUpdate)`

Subscribe to real-time user fills via WebSocket.

**Parameters:**
- `user` (string): User address to monitor
- `onUpdate` (function): Callback with signature `(fills: Fill[]) => void`

**Returns:** `Promise<() => void>` - Unsubscribe function

**Behavior:**
- First call provides snapshot (all recent fills)
- Subsequent calls provide incremental updates
- Auto-reconnects on disconnect
- Updates in-memory cache

**Example:**
```typescript
const unsubscribe = await datasource.subscribeToUserFills(user, (fills) => {
  // Handle new fills
  updateDatabase(fills);
});
```

### `getCachedFills(user)`

Get cached fills from WebSocket updates (no API call).

**Parameters:**
- `user` (string): User address

**Returns:** `Fill[]` - Array of cached fills, or empty array

**Example:**
```typescript
const cached = datasource.getCachedFills(user);
console.log(`Cache has ${cached.length} fills`);
```

### `isWebSocketConnected()`

Check if WebSocket is active.

**Returns:** `boolean`

### `disconnectWebSocket()`

Disconnect WebSocket and clear all subscriptions. Call on shutdown.

## WebSocket Features

### Auto-Reconnection

WebSocket automatically reconnects if disconnected:
- Retries every 5 seconds
- Resubscribes to all feeds on reconnect
- Graceful handling of network issues

### Heartbeat

Sends ping every 30 seconds to keep connection alive.

### Snapshot on Subscribe

Initial subscription provides a snapshot:
```typescript
{
  isSnapshot: true,
  user: "0x...",
  fills: [...] // All recent fills
}
```

Subsequent updates are incremental:
```typescript
{
  isSnapshot: false,
  user: "0x...",
  fills: [...]  // New fills only
}
```

## Integration Patterns

### Pattern 1: WebSocket Primary, REST Fallback

```typescript
async function getFills(user: string) {
  // Try cache first
  const cached = datasource.getCachedFills(user);
  if (cached.length > 0) {
    return cached;
  }
  
  // Fallback to REST
  return await datasource.getFills({ user });
}
```

### Pattern 2: Database Write-Through

```typescript
await datasource.subscribeToUserFills(user, async (fills) => {
  // Write to database
  for (const fill of fills) {
    await db.fills.upsert({
      where: { user_timeMs_tid: { user, timeMs: fill.time, tid: fill.tid } },
      create: fill,
      update: fill
    });
  }
});
```

### Pattern 3: Multi-User Monitoring

```typescript
const users = ['0x123...', '0x456...', '0x789...'];

const unsubscribers = await Promise.all(
  users.map(user => 
    datasource.subscribeToUserFills(user, (fills) => {
      console.log(`${user}: ${fills.length} fills`);
    })
  )
);

// Unsubscribe all
unsubscribers.forEach(unsubscribe => unsubscribe());
```

## Database Integration (Future)

When adding a database layer:

### Recommended Schema

```sql
CREATE TABLE fills (
  user VARCHAR(42),
  time_ms BIGINT,
  coin VARCHAR(50),
  px VARCHAR(50),
  sz VARCHAR(50),
  side CHAR(1),
  oid INTEGER,
  tid INTEGER,
  fee VARCHAR(50),
  builder_fee VARCHAR(50),
  -- ... other fields
  
  PRIMARY KEY (user, time_ms, tid),
  INDEX idx_user_time (user, time_ms),
  INDEX idx_coin (coin),
  INDEX idx_oid (oid)
);
```

### Upsert Strategy

```typescript
// WebSocket updates write to DB
datasource.subscribeToUserFills(user, async (fills) => {
  await db.fills.upsertMany(fills);
});

// REST backfill for historical data
const historicalFills = await datasource.getFills({
  user,
  fromMs: startTime,
  toMs: endTime
});
await db.fills.upsertMany(historicalFills);
```

### Query Pattern

```typescript
// Query DB instead of API
async function getUserFills(user: string, fromMs: number, toMs: number) {
  return await db.fills.findMany({
    where: {
      user,
      time_ms: { gte: fromMs, lte: toMs }
    },
    orderBy: { time_ms: 'asc' }
  });
}
```

## Environment Variables

```bash
# Optional: Override WebSocket URL
HYPERLIQUID_WS_URL=wss://api.hyperliquid.xyz/ws

# REST API URL (already configured)
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
```

## Testing

Run the example script:

```bash
npm run dev src/examples/websocketExample.ts
```

Expected output:
```
🚀 WebSocket Example
===================

WebSocket connected: false

📡 Subscribing to fills for 0x0e09...
✅ Subscribed! Listening for fills...
Connection status: true

✨ Received 157 fill(s): (snapshot)
  - BTC BUY 0.01 @ 42350.5 (2024-01-17T10:30:45.123Z)
  - ETH SELL 0.5 @ 2245.25 (2024-01-17T10:31:12.456Z)
  ...
```

## Benefits

| Feature | WebSocket | REST API |
|---------|-----------|----------|
| **Latency** | Real-time (< 100ms) | 200-500ms |
| **Rate Limits** | None (streaming) | 60/min per IP |
| **Historical Data** | Limited (recent) | 10k fills |
| **Connection** | Persistent | Request/Response |
| **Use Case** | Live monitoring | Historical queries |

## Troubleshooting

### WebSocket not connecting

Check network/firewall:
```typescript
try {
  await datasource.subscribeToUserFills(user, console.log);
} catch (error) {
  console.error('Connection failed:', error);
  // Use REST fallback
}
```

### Missing fills

WebSocket only streams new fills. Use REST for historical:
```typescript
// Get historical fills
const historical = await datasource.getFills({
  user,
  fromMs: Date.now() - 86400000 // Last 24 hours
});

// Then subscribe for new fills
await datasource.subscribeToUserFills(user, handleNewFills);
```

### Memory usage

Cache is auto-limited to 10,000 fills per user. Clear if needed:
```typescript
datasource.disconnectWebSocket(); // Clears cache
```

## Next Steps

1. ✅ **WebSocket client** - Implemented
2. ✅ **Datasource integration** - Implemented
3. ✅ **Auto-reconnection** - Implemented
4. ✅ **Caching layer** - Implemented
5. 🔄 **Database integration** - Ready for implementation
6. 🔄 **Service layer updates** - Optional enhancement
7. 🔄 **Monitoring/metrics** - Future feature

## Resources

- [Hyperliquid WebSocket Docs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket)
- [Subscription Types](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions)
- [Example Code](./src/examples/websocketExample.ts)
