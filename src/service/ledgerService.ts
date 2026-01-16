import { PublicHLDatasource } from '../datasource/hyperliquid';
import type { LedgerDatasource } from '../datasource/hyperliquid';

const TARGET_BUILDER = process.env.TARGET_BUILDER?.toLowerCase();

export class LedgerService {
  private datasource: LedgerDatasource;

  constructor(
    datasource: LedgerDatasource = new PublicHLDatasource(),
  ) {
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
    // Fetch fills from datasource
    const fills = await this.datasource.getFills(params);

    // Filter by coin if specified
    let filteredFills = fills;
    if (params.coin) {
      filteredFills = fills.filter((f) => f.coin === params.coin);
    }

    // Normalize to API response format
    const normalizedTrades = filteredFills.map((f) => ({
      timeMs: f.time,
      coin: f.coin,
      side: f.side,
      px: f.px,
      sz: f.sz,
      fee: f.fee,
      closedPnl: f.closedPnl,
      builder: f.builderFee ? TARGET_BUILDER : undefined, // If builderFee exists, attribute to TARGET_BUILDER
      builderAttributed: this.isBuilderTrade(f),
    }));

    // If builder-only mode, filter to only builder-attributed trades
    if (params.builderOnly) {
      return normalizedTrades.filter((t) => t.builderAttributed);
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

    const lifecycles = this.buildPositionLifecycles(fills);

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

    const lifecycles = this.buildPositionLifecycles(fills);

    const eligible = params.builderOnly
      ? lifecycles.filter((l) => l.builderOnly && !l.tainted)
      : lifecycles;

    const realizedPnl = eligible.reduce(
      (sum, l) => sum + l.realizedPnl,
      0,
    );

    const feesPaid = eligible.reduce(
      (sum, l) => sum + l.feesPaid,
      0,
    );

    const tradeCount = eligible.reduce(
      (sum, l) => sum + l.tradeCount,
      0,
    );

    const effectiveCapital = params.maxStartCapital
      ? Math.min(equityAtFromMs, params.maxStartCapital)
      : equityAtFromMs;

    return {
      realizedPnl,
      returnPct:
        effectiveCapital > 0
          ? (realizedPnl / effectiveCapital) * 100
          : 0,
      feesPaid,
      tradeCount,
      tainted: params.builderOnly
        ? lifecycles.some((l) => l.tainted)
        : false,
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
    return fill.builderFee !== undefined && parseFloat(fill.builderFee || '0') > 0;
  }

  private buildPositionLifecycles(fills: any[]) {
    const lifecycles: any[] = [];
    let current: any = null;

    for (const fill of fills.sort((a, b) => a.timeMs - b.timeMs)) {
      if (!current && fill.netAfter !== 0) {
        current = this.newLifecycle(fill);
      }

      if (current) {
        current.timeline.push({
          timeMs: fill.timeMs,
          netSize: fill.netAfter,
          avgEntryPx: fill.avgEntryPx,
        });

        current.tradeCount++;
        current.feesPaid += fill.fee || 0;
        current.realizedPnl += fill.closedPnl || 0;

        if (!this.isBuilderTrade(fill)) {
          current.hasNonBuilder = true;
        }

        if (fill.netAfter === 0) {
          current.tainted =
            current.hasNonBuilder && current.hasBuilder;
          current.builderOnly =
            current.hasBuilder && !current.tainted;

          lifecycles.push(current);
          current = null;
        }
      }
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
