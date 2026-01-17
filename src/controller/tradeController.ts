// src/controller/tradeController.ts
import type { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';

export class TradesController {
  private ledgerService: LedgerService;

  constructor(ledgerService: LedgerService) {
    this.ledgerService = ledgerService;
  }

  getTrades = async (req: Request, res: Response): Promise<void> => {
    try {
      const { user, coin, fromMs, toMs, builderOnly } = req.query;

      // Validate required params
      if (!user || typeof user !== 'string') {
        res
          .status(400)
          .json({ error: 'Missing or invalid required parameter: user' });
        return;
      }

      // Parse query params
      const params = {
        user,
        coin: coin as string | undefined,
        fromMs: fromMs ? Number(fromMs) : undefined,
        toMs: toMs ? Number(toMs) : undefined,
        builderOnly: builderOnly === 'true',
      };

      const trades = await this.ledgerService.getTrades(params);

      res.status(200).json({
        success: true,
        data: trades,
        count: trades.length,
      });
    } catch (error) {
      console.error('Error fetching trades:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trades',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
