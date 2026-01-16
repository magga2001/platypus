import express from 'express';
import tradeRoute from './tradeRoute';
import positionRoute from './positionRoute';
import pnlRoute from './pnlRoute';
import leaderboardRoute from './leaderboardRoute';

const router = express.Router();

const defaultRoutes = [
  {
    path: '/trades',
    route: tradeRoute,
  },
    {
    path: '/positions',
    route: positionRoute,
  },
  {
    path: '/pnl',
    route: pnlRoute,
  },
  {
    path: '/leaderboard',
    route: leaderboardRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;