// src/controllers/trades.controller.ts
import { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';
import { parseBool, parseNumber } from '../utils/math';

export class TradesController {
  constructor(private readonly ledger: LedgerService) {}

  getTrades = async (req: Request, res: Response) => {
    const {
      user,
      coin,
      fromMs,
      toMs,
      builderOnly,
    } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'user is required' });
    }

    const trades = await this.ledger.getTrades({
      user: String(user),
      coin: coin ? String(coin) : undefined,
      fromMs: parseNumber(fromMs as string),
      toMs: parseNumber(toMs as string),
      builderOnly: parseBool(builderOnly as string),
    });

    res.json(trades);
  };
}
