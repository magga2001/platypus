import { Router } from 'express';
import { PnlController } from '../controller/pnlController';

const router = Router();
const pnlController = new PnlController();

/**
 * @openapi
 * /v1/pnl:
 *   get:
 *     summary: Get realized PnL and performance metrics
 *     description: Computes realized PnL, return percentage, and fees.
 *     tags: [Ledger]
 *     parameters:
 *       - in: query
 *         name: user
 *         required: true
 *         schema:
 *           type: string
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
 *       - in: query
 *         name: maxStartCapital
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: PnL summary returned
 */
router.get('/pnl', pnlController.getPnl);

export default router;
