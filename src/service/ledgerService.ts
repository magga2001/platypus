import { PublicHLDatasource } from '../datasource/hyperliquid';
import type { LedgerDatasource } from '../datasource/hyperliquid';
import { UserFillRepository } from '../repository/userFillRepository';
import type { NewUserFill } from '../db/schema';
import { fillSyncService } from './fillSyncService';

const TARGET_BUILDER = process.env.TARGET_BUILDER?.toLowerCase();

export class LedgerService {
  private datasource: LedgerDatasource;
  private userFillRepo: UserFillRepository;

  constructor(datasource: LedgerDatasource = new PublicHLDatasource()) {
    this.datasource = datasource;
    this.userFillRepo = new UserFillRepository();
  }

  /* =========================
     Trades
     ========================= */

  /**
   * Get trades for a user with optional filters.
   *
   * API Spec: GET /v1/trades?user=&coin=&fromMs=&toMs=&builderOnly=false
   * Returns normalized fills: timeMs, coin, side, px, sz, fee, closedPnl, builder (optional)
   *
   * All-trades mode (default): returns complete ledger
   * Builder-only mode: returns only builder-attributed trades
   */
  async getTrades(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
  }) {
    // Get transformed fills with position tracking (already filtered by coin at datasource level)
    const transformedFills = await this.getTransformedFills(params);

    // Normalize to API response format with all fields
    const normalizedTrades = transformedFills.map((f) => ({
      timeMs: f.timeMs,
      coin: f.coin,
      side: f.side,
      px: f.px,
      sz: f.sz,
      fee: f.fee,
      closedPnl: f.closedPnl,
      builder: f.builderFee ? TARGET_BUILDER : undefined, // If builderFee exists, attribute to TARGET_BUILDER
      oid: f.oid, // Order ID
      tid: f.tid, // Trade ID
    }));

    // If builder-only mode, filter to only builder-attributed trades
    if (params.builderOnly) {
      return normalizedTrades.filter((t) => t.builder !== undefined);
    }

    return normalizedTrades;
  }

  /* =========================
     Position History
     ========================= */

  async getPositionHistory(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
  }) {
    // Get lifecycles (reusable internal method)
    const lifecycles = await this.getPositionLifecycles(params);

    // Get current open positions for risk data (bonus feature)
    const currentPositions = await this.datasource.getCurrentPositions(
      params.user,
    );
    const positionRiskMap = new Map(
      currentPositions.map((p) => [
        p.coin,
        {
          liquidationPx: p.liquidationPx,
          marginUsed: p.marginUsed,
        },
      ]),
    );

    // Filter by builderOnly if specified, and exclude tainted lifecycles
    const filteredLifecycles = params.builderOnly
      ? lifecycles.filter((l) => l.builderOnly && !l.tainted)
      : lifecycles;

    // Flatten timeline and add risk data for current open positions
    return filteredLifecycles.flatMap((l) => {
      const riskData = positionRiskMap.get(l.coin);

      return l.timeline.map((entry: any, index: number) => {
        // Only add risk data to the LAST entry if position is still open
        const isLastEntry = index === l.timeline.length - 1;
        const isOpenPosition = entry.netSize !== 0;

        if (isLastEntry && isOpenPosition && riskData) {
          return {
            ...entry,
            liquidationPx: riskData.liquidationPx,
            marginUsed: riskData.marginUsed,
          };
        }

        return entry;
      });
    });
  }

  /* =========================
     PnL
     ========================= */

  /**
   * Get PnL for a user with optional filters.
   *
   * Multi-coin aggregation (bonus feature):
   * - If coin specified: returns PnL for that specific coin
   * - If coin NOT specified: returns portfolio-level PnL across all coins
   *
   * This enables both single-coin and multi-coin leaderboards.
   */
  async getPnl(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
    maxStartCapital?: number;
  }) {
    // Reuse getPositionLifecycles to avoid duplication
    const lifecycles = await this.getPositionLifecycles(params);

    const equityAtFromMs = await this.datasource.getEquityAt(
      params.user,
      params.fromMs,
    );

    const eligible = params.builderOnly
      ? lifecycles.filter((l) => l.builderOnly && !l.tainted)
      : lifecycles;

    const realizedPnl = eligible.reduce((sum, l) => sum + l.realizedPnl, 0);

    const feesPaid = eligible.reduce((sum, l) => sum + l.feesPaid, 0);

    const tradeCount = eligible.reduce((sum, l) => sum + l.tradeCount, 0);
    const fillCount = eligible.reduce((sum, l) => sum + l.fillCount, 0);

    // Spec: effectiveCapital = min(equityAtFromMs, maxStartCapital)
    // If maxStartCapital not specified, use actual equityAtFromMs
    const effectiveCapital =
      params.maxStartCapital !== undefined
        ? Math.min(equityAtFromMs, params.maxStartCapital)
        : equityAtFromMs;

    return {
      realizedPnl,
      returnPct:
        effectiveCapital > 0 ? (realizedPnl / effectiveCapital) * 100 : 0,
      feesPaid,
      tradeCount, // Unique trades (by oid - Order ID)
      fillCount, // Total fills
      tainted: params.builderOnly ? lifecycles.some((l) => l.tainted) : false,
      // Metadata: show which capital source was used
      effectiveCapital,
      capitalSource:
        params.maxStartCapital !== undefined
          ? 'maxStartCapital'
          : 'equityAtFromMs',
      equityAtFromMs, // Always show actual equity found (even if maxStartCapital was used)
    };
  }

  /* =========================
     Leaderboard
     ========================= */

  async getLeaderboard(params: {
    coin?: string;
    fromMs?: number;
    toMs?: number;
    metric: 'volume' | 'pnl' | 'returnPct';
    builderOnly?: boolean;
    maxStartCapital?: number;
  }) {
    const users = await this.datasource.getAllUsers();

    // For returnPct metric, we need equity. Fetch once for all users if needed.
    let equityCache: Record<string, number> = {};
    if (params.metric === 'returnPct' || params.maxStartCapital !== undefined) {
      await Promise.all(
        users.map(async (user) => {
          equityCache[user] = await this.datasource.getEquityAt(
            user,
            params.fromMs,
          );
        }),
      );
    }

    const rows = await Promise.all(
      users.map(async (user) => {
        // Fetch lifecycles once per user
        const lifecycles = await this.getPositionLifecycles({
          user,
          coin: params.coin,
          fromMs: params.fromMs,
          toMs: params.toMs,
          builderOnly: params.builderOnly,
        });

        // Filter for builderOnly if needed
        const eligible = params.builderOnly
          ? lifecycles.filter((l) => l.builderOnly && !l.tainted)
          : lifecycles;

        const isTainted = params.builderOnly
          ? lifecycles.some((l) => l.tainted)
          : false;

        // Use cached equity (already fetched once if needed)
        const equityAtFromMs = equityCache[user] || 0;
        const effectiveCapital =
          params.maxStartCapital !== undefined
            ? Math.min(equityAtFromMs, params.maxStartCapital)
            : equityAtFromMs;

        // Calculate all metrics from eligible lifecycles
        const realizedPnl = eligible.reduce((sum, l) => sum + l.realizedPnl, 0);
        const volume = eligible.reduce((sum, l) => sum + l.volume, 0);
        const returnPct =
          effectiveCapital > 0 ? (realizedPnl / effectiveCapital) * 100 : 0;
        const tradeCount = eligible.reduce((sum, l) => sum + l.tradeCount, 0);
        const fillCount = eligible.reduce((sum, l) => sum + l.fillCount, 0);

        // Determine metric value based on requested metric
        let metricValue = 0;
        if (params.metric === 'volume') metricValue = volume;
        if (params.metric === 'pnl') metricValue = realizedPnl;
        if (params.metric === 'returnPct') metricValue = returnPct;

        // If builderOnly and user is tainted, exclude from results
        if (params.builderOnly && isTainted) {
          metricValue = 0;
        }

        return {
          user,
          metricValue,
          tradeCount,
          fillCount,
          tainted: isTainted,
        };
      }),
    );

    return rows
      .sort((a, b) => b.metricValue - a.metricValue)
      .map((r, i) => ({
        rank: i + 1,
        ...r,
      }));
  }

  /* =========================
     Deposits (Bonus Feature)
     ========================= */

  /**
   * Get deposit history for a user (optional bonus feature).
   *
   * API Spec: GET /v1/deposits?user=&fromMs=&toMs=
   * Returns: totalDeposits, depositCount, deposits[]
   *
   * Enables filtering users who reloaded capital during competition window.
   * Important for fair competition - users who deposit mid-competition
   * should be flagged or excluded from certain leaderboards.
   *
   * Returns: totalDeposits, depositCount, deposits[]
   * Note: Only positive transfers (deposits) are returned, withdrawals are filtered out.
   */
  async getDeposits(params: { user: string; fromMs?: number; toMs?: number }) {
    const allTransfers = await this.datasource.getDeposits(params);

    // Filter to only deposits (positive amounts)
    const deposits = allTransfers.filter((d) => d.type === 'deposit');

    // Calculate total
    const totalDeposits = deposits.reduce((sum, d) => {
      return sum + parseFloat(d.amount || '0');
    }, 0);

    return {
      totalDeposits: totalDeposits.toFixed(2),
      depositCount: deposits.length,
      deposits: deposits.map((d) => ({
        timeMs: d.time,
        amount: d.amount,
        coin: d.coin,
      })),
    };
  }

  /* =========================
     Internal helpers
     ========================= */

  /**
   * Backfill user data from API on server startup.
   * This fetches any new fills that occurred while the server was down
   * and updates the database cache.
   */
  async backfillUser(user: string) {
    const normalizedUser = user.toLowerCase();
    
    // Get latest timestamp from database
    const latestDbTimestamp = await this.userFillRepo.getLatestTimestamp(normalizedUser);
    
    if (latestDbTimestamp === null) {
      console.log(`  ℹ️  ${normalizedUser}: No cached data, will fetch on first request`);
      return;
    }
    
    // Fetch only new fills from API (after latest cached timestamp)
    const newFillsFromApi = await this.datasource.getFills({
      user: normalizedUser,
      fromMs: latestDbTimestamp + 1,
    });
    
    if (newFillsFromApi.length === 0) {
      console.log(`  ✅ ${normalizedUser}: Cache is up to date`);
      return;
    }
    
    console.log(`  ⚠️  ${normalizedUser}: Found ${newFillsFromApi.length} new fills, backfilling...`);
    
    const newFills: NewUserFill[] = newFillsFromApi.map((f) => ({
      user: normalizedUser,
      coin: f.coin,
      oid: f.oid,
      tid: f.tid,
      px: f.px,
      sz: f.sz,
      side: f.side,
      time: f.time,
      closedPnl: f.closedPnl || '0',
      fee: f.fee || '0',
      builderFee: f.builderFee || null,
      startPosition: f.startPosition || '0',
      dir: f.dir,
      hash: f.hash,
    }));
    
    try {
      const BATCH_SIZE = 100;
      for (let i = 0; i < newFills.length; i += BATCH_SIZE) {
        const batch = newFills.slice(i, i + BATCH_SIZE);
        await this.userFillRepo.upsertMany(batch);
      }
      console.log(`  ✅ ${normalizedUser}: Backfilled ${newFillsFromApi.length} fills`);
    } catch (error) {
      console.error(`  ❌ ${normalizedUser}: Failed to backfill:`, error);
    }
  }

  /**
   * Internal helper: Get position lifecycles for a user.
   * This is a reusable method that both getPositionHistory and getPnl use.
   *
   * Returns position lifecycles with builder/taint tracking.
   */
  private async getPositionLifecycles(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
  }) {
    const transformedFills = await this.getTransformedFills(params);
    return this.buildPositionLifecycles(
      transformedFills,
      params.builderOnly || false,
    );
  }

  /**
   * Internal helper: Get transformed fills with position tracking fields.
   * This fetches fills from the datasource and transforms them to include
   * netAfter (position size after fill) and avgEntryPx (weighted average entry price).
   *
   * Used by getTrades, getPositionHistory, and getPnl to avoid code duplication.
   * 
   * Runtime behavior:
   * - If user has cached data: Read from DB only (WebSocket keeps it fresh)
   * - If new user: Fetch from API and cache (will start WebSocket sync automatically)
   */
  private async getTransformedFills(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
  }) {
    const normalizedUser = params.user.toLowerCase();
    let fills: any[] = [];

    // Get latest timestamp from database for this user (and coin if specified)
    const latestDbTimestamp = await this.userFillRepo.getLatestTimestamp(
      normalizedUser,
      params.coin,
    );

    // If we have cached data, read from DB only (WebSocket keeps it fresh)
    if (latestDbTimestamp !== null) {
      const cachedFills = await this.userFillRepo.findByUser(normalizedUser, {
        coin: params.coin,
        fromMs: params.fromMs,
        toMs: params.toMs,
      });

      fills = cachedFills.map((f) => ({
        coin: f.coin,
        time: f.time,
        side: f.side,
        px: f.px,
        sz: f.sz,
        fee: f.fee,
        closedPnl: f.closedPnl,
        builderFee: f.builderFee,
        startPosition: f.startPosition,
        dir: f.dir,
        oid: f.oid,
        tid: f.tid,
        hash: f.hash,
      }));
    } else {
      // New user - fetch all from API and cache
      console.log(`🆕 New user detected: ${normalizedUser}, fetching initial data...`);
      
      fills = await this.datasource.getFills(params);

      // Cache all fills in database for future requests
      if (fills.length > 0) {
        console.log(`💾 Caching ${fills.length} fills for ${normalizedUser}`);

        const newFills: NewUserFill[] = fills.map((f) => ({
          user: normalizedUser,
          coin: f.coin,
          oid: f.oid,
          tid: f.tid,
          px: f.px,
          sz: f.sz,
          side: f.side,
          time: f.time,
          closedPnl: f.closedPnl || '0',
          fee: f.fee || '0',
          builderFee: f.builderFee || null,
          startPosition: f.startPosition || '0',
          dir: f.dir,
          hash: f.hash,
        }));

        try {
          const BATCH_SIZE = 100;
          for (let i = 0; i < newFills.length; i += BATCH_SIZE) {
            const batch = newFills.slice(i, i + BATCH_SIZE);
            await this.userFillRepo.upsertMany(batch);
          }
          console.log(`✅ Cached ${fills.length} fills for ${normalizedUser}`);
        } catch (error) {
          console.warn('Failed to cache fills in database:', error);
        }
      }
      
      // Start WebSocket sync for this new user
      if (!fillSyncService.isSyncing(normalizedUser)) {
        console.log(`🔄 Starting WebSocket sync for ${normalizedUser}...`);
        fillSyncService.startSyncingUser(normalizedUser).catch((error) => {
          console.error(`Failed to start sync for ${normalizedUser}:`, error);
        });
      }
    }

    return this.transformFillsForPositions(fills);
  }

  /**
   * Check if a fill is attributed to a builder.
   *
   * According to Hyperliquid API spec:
   * - builderFee field is present (and > 0) when trade is builder-attributed
   * - The specific builder address is not returned in the API response
   *
   * Note: Since the public API doesn't expose the actual builder address,
   * we check for presence of builderFee as "best effort" attribution.
   * TARGET_BUILDER is used as a label in responses, but builder detection
   * works based on builderFee presence, not TARGET_BUILDER value.
   */
  private isBuilderTrade(fill: any): boolean {
    // Check if builderFee field exists and is > 0
    // This indicates the trade was attributed to a builder (any builder)
    return (
      fill.builderFee !== undefined && parseFloat(fill.builderFee || '0') > 0
    );
  }

  /**
   * Transform Hyperliquid fills to include position tracking fields.
   * Calculates netAfter (position size after fill) and avgEntryPx (weighted average entry price).
   */
  private transformFillsForPositions(fills: any[]) {
    // Sort fills by time to process chronologically
    const sortedFills = fills.sort((a, b) => a.time - b.time);

    // Track position state per coin
    const positionState: Record<
      string,
      {
        netSize: number;
        entryValue: number; // Sum of (price * size) for open position
        entrySize: number; // Sum of sizes for open position
      }
    > = {};

    return sortedFills.map((fill) => {
      const coin = fill.coin;

      // Initialize position state for coin if needed
      if (!positionState[coin]) {
        positionState[coin] = {
          netSize: 0,
          entryValue: 0,
          entrySize: 0,
        };
      }

      const state = positionState[coin];
      const startPosition = parseFloat(fill.startPosition || '0');
      const fillSize = parseFloat(fill.sz || '0');
      const fillPrice = parseFloat(fill.px || '0');

      // Determine fill direction from dir field
      const isLong = fill.dir?.includes('Long') || fill.side === 'B';
      const isClosing =
        fill.dir?.includes('Close') ||
        (isLong && startPosition > 0 && fillSize < 0) ||
        (!isLong && startPosition < 0 && fillSize > 0);

      // Calculate netSize after this fill
      // startPosition is position before fill, so netAfter = startPosition + fillDelta
      const fillDelta = isLong ? fillSize : -fillSize;
      const netAfter = startPosition + fillDelta;

      // Calculate average entry price (weighted average method)
      let avgEntryPx = 0;

      if (isClosing) {
        // When closing, keep the entry price of remaining position
        // If fully closing, use previous avgEntryPx
        if (state.entrySize !== 0) {
          avgEntryPx = state.entryValue / state.entrySize;
        } else if (startPosition !== 0) {
          // Fallback: if no entry tracked, use a reasonable default
          avgEntryPx = fillPrice;
        }
      } else {
        // When opening or adding to position, calculate weighted average
        if (startPosition === 0) {
          // Opening new position
          avgEntryPx = fillPrice;
          state.entryValue = fillPrice * fillSize;
          state.entrySize = fillSize;
        } else {
          // Adding to existing position or flipping
          const sameDirection =
            (startPosition > 0 && fillDelta > 0) ||
            (startPosition < 0 && fillDelta < 0);

          if (sameDirection) {
            // Same direction: weighted average
            // Weighted average: (oldValue + newValue) / (oldSize + newSize)
            state.entryValue += fillPrice * Math.abs(fillDelta);
            state.entrySize += Math.abs(fillDelta);
            avgEntryPx = state.entryValue / state.entrySize;
          } else {
            // Position flip or partial close (bonus feature implemented)
            // Handles: long → short, short → long, partial closes

            // Check if position flipped (sign changed)
            const didFlip = startPosition * netAfter < 0 && netAfter !== 0;

            if (didFlip) {
              // Position flip (long → short or short → long)
              // Reset entry calculation to new direction
              avgEntryPx = fillPrice;
              state.entryValue = fillPrice * Math.abs(netAfter);
              state.entrySize = Math.abs(netAfter);
            } else if (Math.abs(netAfter) < Math.abs(startPosition)) {
              // Partial close (reducing position) - keep entry price
              if (state.entrySize !== 0) {
                avgEntryPx = state.entryValue / state.entrySize;
              } else {
                avgEntryPx = fillPrice;
              }
              // Update entry size to remaining position
              state.entrySize = Math.abs(netAfter);
              state.entryValue = avgEntryPx * Math.abs(netAfter);
            } else {
              // Shouldn't happen, but fallback
              avgEntryPx = fillPrice;
              state.entryValue = fillPrice * Math.abs(netAfter);
              state.entrySize = Math.abs(netAfter);
            }
          }
        }
      }

      // Update position state
      state.netSize = netAfter;

      // Reset entry tracking if position is closed
      if (netAfter === 0) {
        state.entryValue = 0;
        state.entrySize = 0;
      }

      return {
        ...fill,
        timeMs: fill.time, // Map time to timeMs
        netAfter,
        avgEntryPx,
      };
    });
  }

  /**
   * Build position lifecycles from transformed fills.
   * A lifecycle starts when netSize goes from 0 → non-zero and ends when it returns to 0.
   */
  private buildPositionLifecycles(fills: any[], builderOnly: boolean) {
    const lifecycles: any[] = [];
    let current: any = null;

    for (const fill of fills.sort((a, b) => a.timeMs - b.timeMs)) {
      // Start new lifecycle when position opens (netAfter !== 0 and no current lifecycle)
      if (!current && fill.netAfter !== 0) {
        current = this.newLifecycle(fill);
      }

      if (current) {
        // Track builder/non-builder activity
        if (this.isBuilderTrade(fill)) {
          current.hasBuilder = true;
        } else {
          current.hasNonBuilder = true;
        }

        // Track unique trades by oid (Order ID)
        // Multiple fills can share the same oid when an order is partially filled
        if (fill.oid !== undefined && fill.oid !== null) {
          current.uniqueOrderIds.add(fill.oid);
        }

        // Add timeline entry
        const timelineEntry: any = {
          timeMs: fill.timeMs,
          netSize: fill.netAfter,
          avgEntryPx: fill.avgEntryPx,
        };

        // Include tainted flag when builderOnly mode is enabled
        if (builderOnly) {
          // For open lifecycles, tainted status will be determined at close
          // For closed lifecycles, use the final tainted status
          timelineEntry.tainted = current.tainted || false;
        }

        current.timeline.push(timelineEntry);

        // Accumulate lifecycle stats
        current.fillCount++; // Count total fills
        const fee = parseFloat(fill.fee || '0');
        current.feesPaid += fee;
        const closedPnl = parseFloat(fill.closedPnl || '0');
        current.realizedPnl += closedPnl;

        // Add volume: notional value (price * size)
        const px = parseFloat(fill.px || '0');
        const sz = parseFloat(fill.sz || '0');
        current.volume += px * sz;

        // Check if position closed (netAfter === 0)
        if (fill.netAfter === 0) {
          // Set tradeCount to unique order count before finalizing
          current.tradeCount = current.uniqueOrderIds.size;

          // Determine final tainted and builderOnly status
          current.tainted = current.hasNonBuilder && current.hasBuilder;
          current.builderOnly = current.hasBuilder && !current.tainted;

          // Update all timeline entries with final tainted status when builderOnly mode
          if (builderOnly && current.timeline.length > 0) {
            current.timeline.forEach((entry: any) => {
              entry.tainted = current.tainted;
            });
          }

          lifecycles.push(current);
          current = null;
        }
      }
    }

    // Handle open positions (lifecycle that hasn't closed)
    if (current) {
      // Set tradeCount to unique order count before finalizing
      current.tradeCount = current.uniqueOrderIds.size;

      // Set final tainted status for open position
      current.tainted = current.hasNonBuilder && current.hasBuilder;
      current.builderOnly = current.hasBuilder && !current.tainted;

      // Update all timeline entries with final tainted status when builderOnly mode
      if (builderOnly && current.timeline.length > 0) {
        current.timeline.forEach((entry: any) => {
          entry.tainted = current.tainted;
        });
      }

      lifecycles.push(current);
    }

    return lifecycles;
  }

  private newLifecycle(fill: any) {
    return {
      coin: fill.coin,
      timeline: [],
      realizedPnl: 0,
      volume: 0, // Total notional volume (price * size) for this lifecycle
      feesPaid: 0,
      tradeCount: 0, // Will be set to uniqueOrderIds.size when lifecycle closes
      fillCount: 0, // Total fills in this lifecycle
      uniqueOrderIds: new Set<number>(), // Track unique order IDs (oid) - multiple fills can share same oid
      hasBuilder: this.isBuilderTrade(fill),
      hasNonBuilder: !this.isBuilderTrade(fill),
      tainted: false,
      builderOnly: false,
    };
  }
}
