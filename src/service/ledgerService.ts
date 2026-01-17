import { PublicHLDatasource } from '../datasource/hyperliquid';
import type { LedgerDatasource } from '../datasource/hyperliquid';

const TARGET_BUILDER = process.env.TARGET_BUILDER?.toLowerCase();

export class LedgerService {
  private datasource: LedgerDatasource;

  constructor(datasource: LedgerDatasource = new PublicHLDatasource()) {
    this.datasource = datasource;
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
    // Fetch fills from datasource (time filtering happens at API level)
    const fills = await this.datasource.getFills(params);

    // Transform fills to include position tracking fields (netSize, avgEntryPx)
    // Do this before coin filtering to ensure accurate position state tracking
    const transformedFills = this.transformFillsForPositions(fills);

    // Filter by coin if specified (after transformation)
    let filteredFills = transformedFills;
    if (params.coin) {
      filteredFills = transformedFills.filter((f) => f.coin === params.coin);
    }

    // Normalize to API response format with all fields
    const normalizedTrades = filteredFills.map((f) => ({
      timeMs: f.timeMs,
      coin: f.coin,
      side: f.side,
      px: f.px,
      sz: f.sz,
      fee: f.fee,
      closedPnl: f.closedPnl,
      builder: f.builderFee ? TARGET_BUILDER : undefined, // If builderFee exists, attribute to TARGET_BUILDER
    }));

    // If builder-only mode, filter to only builder-attributed trades
    if (params.builderOnly) {
      return normalizedTrades.filter((t) => t.builder);
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
    const fills = await this.datasource.getFills(params);

    // Transform fills to include calculated position fields
    const transformedFills = this.transformFillsForPositions(fills);

    // Build position lifecycles with builderOnly flag
    const lifecycles = this.buildPositionLifecycles(
      transformedFills,
      params.builderOnly || false,
    );

    return lifecycles
      .filter((l) => !params.builderOnly || l.builderOnly)
      .flatMap((l) => l.timeline);
  }

  /* =========================
     PnL
     ========================= */

  async getPnl(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
    maxStartCapital?: number;
  }) {
    const fills = await this.datasource.getFills(params);
    const equityAtFromMs = await this.datasource.getEquityAt(
      params.user,
      params.fromMs,
    );

    // Transform fills to include calculated position fields
    const transformedFills = this.transformFillsForPositions(fills);

    // Build position lifecycles with builderOnly flag
    const lifecycles = this.buildPositionLifecycles(
      transformedFills,
      params.builderOnly || false,
    );

    const eligible = params.builderOnly
      ? lifecycles.filter((l) => l.builderOnly && !l.tainted)
      : lifecycles;

    const realizedPnl = eligible.reduce((sum, l) => sum + l.realizedPnl, 0);

    const feesPaid = eligible.reduce((sum, l) => sum + l.feesPaid, 0);

    const tradeCount = eligible.reduce((sum, l) => sum + l.tradeCount, 0);

    const effectiveCapital = params.maxStartCapital
      ? Math.min(equityAtFromMs, params.maxStartCapital)
      : equityAtFromMs;

    return {
      realizedPnl,
      returnPct:
        effectiveCapital > 0 ? (realizedPnl / effectiveCapital) * 100 : 0,
      feesPaid,
      tradeCount,
      tainted: params.builderOnly ? lifecycles.some((l) => l.tainted) : false,
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

    const rows = await Promise.all(
      users.map(async (user) => {
        const pnl = await this.getPnl({
          user,
          ...params,
        });

        let metricValue = 0;

        if (params.metric === 'pnl') metricValue = pnl.realizedPnl;
        if (params.metric === 'returnPct') metricValue = pnl.returnPct;
        if (params.metric === 'volume') {
          metricValue = await this.datasource.getVolume({
            user,
            coin: params.coin,
            fromMs: params.fromMs,
            toMs: params.toMs,
          });
        }

        return {
          user,
          metricValue,
          tradeCount: pnl.tradeCount,
          tainted: pnl.tainted,
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
     Internal helpers
     ========================= */

  /**
   * Check if a fill is attributed to the configured TARGET_BUILDER.
   *
   * According to Hyperliquid API spec:
   * - builderFee field is present (and > 0) when trade is builder-attributed
   * - The specific builder address is not returned in the API response
   *
   * Note: Since the public API doesn't expose the actual builder address,
   * we check for presence of builderFee as "best effort" attribution.
   * For exact builder matching, would need access to private/enhanced API.
   */
  private isBuilderTrade(fill: any): boolean {
    if (!TARGET_BUILDER) return false;

    // Check if builderFee field exists and is > 0
    // This indicates the trade was attributed to a builder
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
            // Flipping position (long to short or vice versa) or partial close
            // When flipping, reset entry calculation to new direction
            // For partial close, keep previous entry price
            if (Math.abs(netAfter) < Math.abs(startPosition)) {
              // Partial close - keep entry price
              if (state.entrySize !== 0) {
                avgEntryPx = state.entryValue / state.entrySize;
              } else {
                avgEntryPx = fillPrice;
              }
              // Update entry size to remaining position
              state.entrySize = Math.abs(netAfter);
              state.entryValue = avgEntryPx * Math.abs(netAfter);
            } else {
              // Flipping - reset entry calculation
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
  private buildPositionLifecycles(
    fills: any[],
    builderOnly: boolean,
  ) {
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
        current.tradeCount++;
        const fee = parseFloat(fill.fee || '0');
        current.feesPaid += fee;
        const closedPnl = parseFloat(fill.closedPnl || '0');
        current.realizedPnl += closedPnl;

        // Check if position closed (netAfter === 0)
        if (fill.netAfter === 0) {
          // Determine final tainted and builderOnly status
          current.tainted =
            current.hasNonBuilder && current.hasBuilder;
          current.builderOnly =
            current.hasBuilder && !current.tainted;

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
      feesPaid: 0,
      tradeCount: 0,
      hasBuilder: this.isBuilderTrade(fill),
      hasNonBuilder: !this.isBuilderTrade(fill),
      tainted: false,
      builderOnly: false,
    };
  }
}
