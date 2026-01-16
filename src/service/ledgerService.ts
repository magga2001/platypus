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

  async getTrades(params: {
    user: string;
    coin?: string;
    fromMs?: number;
    toMs?: number;
    builderOnly?: boolean;
  }) {
    const fills = await this.datasource.getFills(params);

    if (!params.builderOnly) {
      return fills;
    }

    return fills.map((f) => ({
      ...f,
      builderAttributed: this.isBuilderTrade(f),
    }));
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

  private isBuilderTrade(fill: any): boolean {
    if (!TARGET_BUILDER) return false;
    return (
      fill.builder &&
      fill.builder.toLowerCase() === TARGET_BUILDER
    );
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
