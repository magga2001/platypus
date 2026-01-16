import { Router } from 'express';
import { TradesController } from '../controller/tradeController';

const router = Router();
const tradesController = new TradesController();

/**
 * @openapi
 * /v1/trades:
 *   get:
 *     summary: Get normalized trade history
 *     description: Returns fills for a user and optional coin over a time range.
 *     tags: [Ledger]
 *     parameters:
 *       - in: query
 *         name: user
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address
 *       - in: query
 *         name: coin
 *         required: false
 *         schema:
 *           type: string
 *       - in: query
 *         name: fromMs
 *         required: false
 *         schema:
 *           type: number
 *       - in: query
 *         name: toMs
 *         required: false
 *         schema:
 *           type: number
 *       - in: query
 *         name: builderOnly
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *     responses:
 *       200:
 *         description: List of normalized trades
 */
router.get('/trades', tradesController.getTrades);

export default router;
