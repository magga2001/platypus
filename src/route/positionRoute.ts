import { Router } from 'express';
import { PositionsController } from '../controller/positionController';

const router = Router();
const positionsController = new PositionsController();

/**
 * @openapi
 * /v1/positions/history:
 *   get:
 *     summary: Get position history timeline
 *     description: Returns time-ordered position states suitable for plotting.
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
 *     responses:
 *       200:
 *         description: Position history returned
 */
router.get('/positions/history', positionsController.getPositionHistory);

export default router;
