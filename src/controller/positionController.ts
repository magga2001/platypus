// src/controllers/positions.controller.ts
import type { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';
import { parseBool, parseNumber } from '../utils/math';

export class PositionsController {
  constructor(private readonly ledger: LedgerService) {}

  getPositionHistory = async (req: Request, res: Response) => {
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

    const history = await this.ledger.getPositionHistory({
      user: String(user),
      coin: coin ? String(coin) : undefined,
      fromMs: parseNumber(fromMs as string),
      toMs: parseNumber(toMs as string),
      builderOnly: parseBool(builderOnly as string),
    });

    res.json(history);
  };
}
