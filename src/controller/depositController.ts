import type { Request, Response } from 'express';
import { LedgerService } from '../service/ledgerService';
import { parseNumber } from '../utils/math';

export class DepositController {
	private readonly ledger: LedgerService = new LedgerService();

	getDeposits = async (req: Request, res: Response) => {
		const { user, fromMs, toMs } = req.query;

		if (!user) {
			return res.status(400).json({ error: 'user is required' });
		}

		const deposits = await this.ledger.getDeposits({
			user: String(user),
			fromMs: parseNumber(fromMs as string),
			toMs: parseNumber(toMs as string),
		});

		res.json(deposits);
	};
}
