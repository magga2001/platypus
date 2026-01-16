// src/controllers/pnl.controller.ts
import { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';
import { parseBool, parseNumber } from '../utils/math';

export class PnlController {
  constructor(private readonly ledger: LedgerService) {}

  getPnl = async (req: Request, res: Response) => {
    const {
      user,
      coin,
      fromMs,
      toMs,
      builderOnly,
      maxStartCapital,
    } = req.query;

    if (!user) {
      return res.status(400).json({ error: 'user is required' });
    }

    const pnl = await this.ledger.getPnl({
      user: String(user),
      coin: coin ? String(coin) : undefined,
      fromMs: parseNumber(fromMs as string),
      toMs: parseNumber(toMs as string),
      builderOnly: parseBool(builderOnly as string),
      maxStartCapital: parseNumber(maxStartCapital as string),
    });

    res.json(pnl);
  };
}
