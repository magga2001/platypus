// src/controllers/leaderboard.controller.ts
import { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';
import { parseNumber, parseBool } from '../utils/math';

export class LeaderboardController {
  constructor(private readonly ledger: LedgerService) {}

  getLeaderboard = async (req: Request, res: Response) => {
    const {
      coin,
      fromMs,
      toMs,
      metric,
      builderOnly,
      maxStartCapital,
    } = req.query;

    if (!metric) {
      return res.status(400).json({ error: 'metric is required' });
    }

    const leaderboard = await this.ledger.getLeaderboard({
      coin: coin ? String(coin) : undefined,
      fromMs: parseNumber(fromMs as string),
      toMs: parseNumber(toMs as string),
      metric: metric as 'volume' | 'pnl' | 'returnPct',
      builderOnly: parseBool(builderOnly as string),
      maxStartCapital: parseNumber(maxStartCapital as string),
    });

    res.json(leaderboard);
  };
}
