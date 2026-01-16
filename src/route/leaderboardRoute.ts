import { Router } from 'express';
import { LeaderboardController } from '../controller/leaderboardController';

const router = Router();
const leaderboardController = new LeaderboardController();

/**
 * @openapi
 * /v1/leaderboard:
 *   get:
 *     summary: Get ranked leaderboard
 *     description: Ranks users by volume, PnL, or return percentage.
 *     tags: [Leaderboard]
 *     parameters:
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
 *         name: metric
 *         required: true
 *         schema:
 *           type: string
 *           enum: [volume, pnl, returnPct]
 *       - in: query
 *         name: builderOnly
 *         required: true
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: maxStartCapital
 *         required: false
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Leaderboard returned
 */
router.get('/leaderboard', leaderboardController.getLeaderboard);

export default router;
