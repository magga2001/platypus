import { Router } from 'express';
import { DepositController } from '../controller/depositController';

const router = Router();
const depositController = new DepositController();

/**
 * @openapi
 * /v1/deposits:
 *   get:
 *     summary: Get deposit history for a user (Bonus feature)
 *     description: Returns deposit tracking data for fair competition filtering
 *     tags: [Ledger]
 *     parameters:
 *       - in: query
 *         name: user
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet address
 *       - in: query
 *         name: fromMs
 *         required: false
 *         schema:
 *           type: number
 *         description: Start time in milliseconds
 *       - in: query
 *         name: toMs
 *         required: false
 *         schema:
 *           type: number
 *         description: End time in milliseconds
 *     responses:
 *       200:
 *         description: Deposit history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalDeposits:
 *                   type: string
 *                 depositCount:
 *                   type: number
 *                 deposits:
 *                   type: array
 *                   items:
 *                     type: object
 */
router.get('/', depositController.getDeposits);

export default router;
