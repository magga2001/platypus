import express from 'express';
import tradeRoute from './tradeRoute';
import positionRoute from './positionRoute';
import pnlRoute from './pnlRoute';
import leaderboardRoute from './leaderboardRoute';

const router = express.Router();

const defaultRoutes = [
  {
    path: '/api/trade',
    route: tradeRoute,
  },
    {
    path: '/api/position',
    route: positionRoute,
  },
  {
    path: '/api/pnl',
    route: pnlRoute,
  },
  {
    path: '/api/leaderboard',
    route: leaderboardRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;