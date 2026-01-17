# Project Platypus

**Project Platypus** is a **Hyperliquid trade ledger API** that reconstructs **trade history**, **position lifecycles**, **realized PnL**, and **leaderboard rankings**, with optional **builder-attribution filtering**.

It is designed for analytics, transparency, research, and performance comparison using **only public Hyperliquid API data**.

---

## What This Project Is For

Hyperliquid exposes raw fills and account data, but does not provide:

- Position lifecycle reconstruction
- Builder-segmented performance
- Comparable PnL and return metrics
- Leaderboards with execution filtering

Platypus fills this gap by transforming raw fill data into **structured, auditable performance analytics**, with explicit handling of builder-attributed execution.

---

## What Platypus Is / Is Not

### What Platypus Is

- A **read-only analytics API**
- A **trade and position reconstruction engine**
- A **PnL and return calculation service**
- A **builder-attribution filter based on public signals**

### What Platypus Is Not

- Not a trading bot
- Not placing or simulating orders
- Not a wallet, portfolio manager, or balance authority
- Not verifying builder identities
- Not modifying on-chain or exchange state

No private keys are ever used. All data is public and read-only.

---

## Quick Start

```bash
# Start local database and pgAdmin (recommended)
docker compose -f docker-compose.local.yml up -d --build

# Rebuild & start if you've changed Dockerfile or deps
docker compose -f docker-compose.local.yml up -d --build --force-recreate

# Run the app locally (outside Docker)
npm install && npm run dev
```

The server runs at:

```
http://localhost:3000
```

Refer to Environmental Variable below for the .env file

Interactive API documentation is available at:

```
/docs
```

---

## Docker Deployment

### Local development with `docker-compose.local.yml`

This repo includes a lightweight local compose file that starts PostgreSQL, pgAdmin, and the migration job. Use these commands (I verified them locally):

Start (build if needed):

```bash
docker compose -f docker-compose.local.yml up -d --build
```

Check containers and ports:

```bash
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
```

Follow logs (all services):

```bash
docker compose -f docker-compose.local.yml logs -f --tail=200
```

Access services:

- pgAdmin: http://localhost:5050 (login: `admin@admin.com` / `admin`)
- Postgres: `localhost:5432` (DB user/pass from `.env` or compose file)
- App (run locally with nodemon / dev script): http://localhost:3000

To stop & remove local stack:

```bash
docker compose -f docker-compose.local.yml down
```

Notes:

- The compose file runs migrations on startup (look for container `migrate-1` or `platypus-migrate-1`). If migrations report `No schema changes`, your DB is up-to-date.
- If you see a warning about `version` being obsolete, remove the `version:` key from `docker-compose.local.yml` — modern Compose uses the top-level format without `version`.
- Local development typically runs the app outside Docker with `npm run dev` so you can hot-reload code while using the containerized DB.

### Full Docker stack (optional)

If you prefer running the app inside Docker as well, use the normal compose:

```bash
docker compose up --build -d

docker compose logs -f app

docker compose down
```

Both local and full stacks use separate volumes for local vs production-style DB setups to avoid conflicts.

---

## Environment Variables

| Variable              | Required | Default                       | Description                                |
| --------------------- | -------- | ----------------------------- | ------------------------------------------ |
| `PORT`                | No       | `3000`                        | Server port                                |
| `NODE_ENV`            | No       | `development`                 | Environment mode                           |
| `HYPERLIQUID_API_URL` | No       | `https://api.hyperliquid.xyz` | Hyperliquid API base URL                   |
| `TARGET_BUILDER`      | No       | –                             | Builder address **label only** (lowercase) |
| `DB_HOST`             | No       | `localhost`                   | PostgreSQL host                            |
| `DB_PORT`             | No       | `5432`                        | PostgreSQL port                            |
| `DB_USER`             | No       | `postgres`                    | PostgreSQL username                        |
| `DB_PASS`             | No       | `postgres`                    | PostgreSQL password                        |
| `DB_NAME`             | No       | `platypus`                    | PostgreSQL database name                   |

Example `.env`:

```env
PORT=3000
NODE_ENV=development
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
TARGET_BUILDER=0x1234...abcd

# Database (for local development with docker-compose.local.yml)
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=platypus
```

**Important:**

- `TARGET_BUILDER` is used only as a **label** in responses. It is **not used for verification**.
- Database variables are used for local development. Docker Compose overrides `DB_HOST=postgres` internally.

---

## API Overview

All endpoints are prefixed with:

```
/v1
```

---

## GET /v1/trades

Returns normalized trade fills for a wallet.

### Parameters

| Parameter     | Type    | Required | Description                           |
| ------------- | ------- | -------- | ------------------------------------- |
| `user`        | string  | Yes      | Wallet address                        |
| `coin`        | string  | No       | Coin symbol (e.g. `ETH`)              |
| `fromMs`      | number  | No       | Start timestamp (ms)                  |
| `toMs`        | number  | No       | End timestamp (ms)                    |
| `builderOnly` | boolean | No       | Only return builder-attributed trades |

### Response Fields

`timeMs`, `coin`, `side`, `px`, `sz`, `fee`, `closedPnl`, `builder`, `oid`, `tid`

---

## GET /v1/positions/history

Returns reconstructed **position lifecycle states**.

### Parameters

| Parameter     | Type    | Required | Description                               |
| ------------- | ------- | -------- | ----------------------------------------- |
| `user`        | string  | Yes      | Wallet address                            |
| `coin`        | string  | No       | Coin symbol                               |
| `fromMs`      | number  | No       | Start timestamp (ms)                      |
| `toMs`        | number  | No       | End timestamp (ms)                        |
| `builderOnly` | boolean | No       | Only return builder-attributed lifecycles |

### Response Fields

`timeMs`, `netSize`, `avgEntryPx`, `tainted`, `liquidationPx`, `marginUsed`

The `tainted` field appears only when `builderOnly=true`.

---

## GET /v1/pnl

Computes realized performance metrics over a time range.

### Parameters

| Parameter         | Type    | Required | Description                                 |
| ----------------- | ------- | -------- | ------------------------------------------- |
| `user`            | string  | Yes      | Wallet address                              |
| `coin`            | string  | No       | Coin symbol                                 |
| `fromMs`          | number  | No       | Start timestamp (ms)                        |
| `toMs`            | number  | No       | End timestamp (ms)                          |
| `builderOnly`     | boolean | No       | Only include builder-attributed lifecycles  |
| `maxStartCapital` | number  | No       | Cap starting capital for return calculation |

### Response Fields

- `realizedPnl`
- `returnPct`
- `feesPaid`
- `tradeCount`
- `fillCount`
- `tainted`
- `effectiveCapital`
- `capitalSource`
- `equityAtFromMs`

---

## GET /v1/leaderboard

Ranks users by performance metrics.

### Parameters

| Parameter         | Type    | Required | Description                                |
| ----------------- | ------- | -------- | ------------------------------------------ |
| `metric`          | string  | Yes      | `volume`, `pnl`, or `returnPct`            |
| `coin`            | string  | No       | Coin filter                                |
| `fromMs`          | number  | No       | Start timestamp (ms)                       |
| `toMs`            | number  | No       | End timestamp (ms)                         |
| `builderOnly`     | boolean | No       | Only include builder-attributed lifecycles |
| `maxStartCapital` | number  | No       | Capital cap for return %                   |

### Response Fields

`rank`, `user`, `metricValue`, `tradeCount`, `fillCount`, `tainted`

---

## GET /v1/deposits

Returns deposit history for a wallet.

### Parameters

| Parameter | Type   | Required | Description          |
| --------- | ------ | -------- | -------------------- |
| `user`    | string | Yes      | Wallet address       |
| `fromMs`  | number | No       | Start timestamp (ms) |
| `toMs`    | number | No       | End timestamp (ms)   |

### Response Fields

`totalDeposits`, `depositCount`, `deposits[]` (`timeMs`, `amount`, `coin`)

---

## Builder Attribution

### Critical Disclaimer

**Builder attribution is inferred, not verified.**

Hyperliquid’s public API does not expose the builder address responsible for a fill.
The only available signal is whether a **builder fee was paid**.

---

### How Builder Attribution Is Determined

A trade is considered builder-attributed if:

```
builderFee exists AND parseFloat(builderFee) > 0
```

When `TARGET_BUILDER` is set, this value is attached as a **label** in responses.

---

### What `builderOnly=true` Does

| Endpoint             | Behavior                                         |
| -------------------- | ------------------------------------------------ |
| `/trades`            | Returns only fills with a builder fee            |
| `/positions/history` | Returns only fully builder-attributed lifecycles |
| `/pnl`               | Excludes mixed (tainted) lifecycles              |
| `/leaderboard`       | Ranks using clean builder-only performance       |

---

### Tainted Lifecycles

A lifecycle becomes **tainted** when it mixes builder and non-builder trades.

```
Builder → Builder → Close        Included
Non-builder → Builder → Close    Tainted
Non-builder → Non-builder → Close Ignored
```

When `builderOnly=true`, tainted lifecycles are excluded and flagged.

---

### Builder Attribution Limitation

Because builder addresses are not exposed:

- The specific builder cannot be verified
- Multiple builders cannot be distinguished
- All `builderFee > 0` trades are treated uniformly

---

## Return Percentage and Capital Logic

Raw PnL alone is not comparable across users with different capital sizes.

Platypus computes returns as:

```
returnPct = realizedPnl / effectiveCapital
```

Where `effectiveCapital` is determined by:

- Historical equity at `fromMs`, if available
- Otherwise `maxStartCapital`, if supplied

This prevents small accounts from appearing disproportionately successful and enables fair leaderboard comparisons.

---

## Leaderboard Scope

Leaderboards are **not global**.

Hyperliquid does not provide a list of all users, so rankings apply only to the provided or known address set. Missing wallets are not implicitly ranked.

---

## Limitations and Assumptions

### Data Limits

| Limit                      | Value         |
| -------------------------- | ------------- |
| Max fills per request      | 2,000         |
| Max historical fills       | ~10,000       |
| Builder address visibility | Not available |

---

### Metrics Explained

| Metric        | Description                    |
| ------------- | ------------------------------ |
| `tradeCount`  | Unique orders (`oid`)          |
| `fillCount`   | Total fills                    |
| `volume`      | Sum of `price × size`          |
| `realizedPnl` | Sum of Hyperliquid `closedPnl` |

---

### Assumptions

1. Fills are processed chronologically
2. A lifecycle opens when position size moves from zero
3. A lifecycle closes when position size returns to zero
4. Average entry price uses weighted average cost
5. Volume is calculated per fill

---

## Security and Safety

- No private keys
- Read-only API usage
- No trade execution
- No on-chain state modification
- Public data only

---

## Scripts

| Script          | Description        |
| --------------- | ------------------ |
| `npm run dev`   | Development server |
| `npm run build` | Production build   |
| `npm start`     | Production server  |

---
