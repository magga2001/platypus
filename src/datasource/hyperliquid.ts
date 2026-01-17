/**
 * Datasource adapter for Hyperliquid public API.
 *
 * This layer wraps the low-level hyperliquidClient and implements
 * the LedgerDatasource interface. The service layer uses this interface,
 * making it easy to swap to different datasources (Insilico, HyperServe)
 * without changing service logic.
 */

import { defaultHyperliquidClient } from '../lib/hyperliquidClient';
import type { Fill } from '../lib/hyperliquidClient';

export interface GetFillsParams {
  user: string;
  coin?: string;
  fromMs?: number;
  toMs?: number;
  builderOnly?: boolean;
}

export interface GetVolumeParams {
  user: string;
  coin?: string;
  fromMs?: number;
  toMs?: number;
  builderOnly?: boolean;
}

export interface Deposit {
	time: number;           // Timestamp in milliseconds
	amount: string;         // Deposit amount
	coin: string;           // Coin deposited (e.g., "USDC")
	txHash?: string;        // Transaction hash
	type: 'deposit' | 'withdrawal' | 'transfer';
}

export interface GetDepositsParams {
	user: string;
	fromMs?: number;
	toMs?: number;
}

export interface Position {
	coin: string;
	szi: string;            // Position size
	leverage: {
		type: string;
		value: number;
	};
	liquidationPx?: string; // Liquidation price
	marginUsed: string;     // Margin used for this position
	maxLeverage: number;
	positionValue: string;
	returnOnEquity: string;
	unrealizedPnl: string;
	entryPx?: string;      // Entry price
}

export interface LedgerDatasource {
	getFills(params: GetFillsParams): Promise<Fill[]>;
	getEquityAt(user: string, atMs?: number): Promise<number>;
	getAllUsers(): Promise<string[]>;
	getVolume(params: GetVolumeParams): Promise<number>;
	getDeposits(params: GetDepositsParams): Promise<Deposit[]>;
	getCurrentPositions(user: string): Promise<Position[]>;
}

export class PublicHLDatasource implements LedgerDatasource {
	constructor() { }

	/**
	 * Fetch fills from Hyperliquid API.
	 * Chooses the appropriate endpoint based on time parameters:
	 * - If fromMs or toMs provided → use getAllFillsInRange (time-filtered, up to 10k fills with parallel batching)
	 * - Otherwise → use getUserFills (most recent 2000 fills)
	 * Filters by coin if specified.
	 */
	async getFills(params: GetFillsParams): Promise<Fill[]> {
		const { user, coin, fromMs, toMs } = params;

		let fills: Fill[];

		// If time range specified, fetch with parallel batching for up to 10k fills
		if (fromMs !== undefined || toMs !== undefined) {
			const startTime = fromMs || 0;
			fills = await this.getAllFillsInRange(user, startTime, toMs);
		} else {
			// Otherwise get most recent fills
			fills = await defaultHyperliquidClient.getUserFills(user, false);
		}

		// Filter by coin if specified
		if (coin) {
			return fills.filter(fill => fill.coin === coin);
		}

		return fills;
	}

	/**
	 * Fetch up to 10,000 fills in a time range using sequential batch requests.
	 * Hyperliquid API returns max 2000 fills per request, but stores 10000 most recent.
	 * 
	 * Strategy: Fetch batches sequentially, starting after the last fill of the previous batch.
	 * 
	 * @param user - User address
	 * @param startTime - Start timestamp in milliseconds
	 * @param endTime - Optional end timestamp in milliseconds
	 * @returns Array of fills, sorted by time (oldest first)
	 */
	private async getAllFillsInRange(user: string, startTime: number, endTime?: number): Promise<Fill[]> {
		const MAX_FILLS = 10000;
		const BATCH_SIZE = 2000; // Hyperliquid API limit per request
		const MAX_BATCHES = 5; // 5 batches * 2000 = 10000 fills max

		const allFills: Fill[] = [];
		let currentStartTime = startTime;

		// Fetch batches sequentially until we have enough or no more fills
		for (let batchNum = 0; batchNum < MAX_BATCHES && allFills.length < MAX_FILLS; batchNum++) {
			// Stop if we've passed endTime
			if (endTime && currentStartTime > endTime) break;

			const batch = await defaultHyperliquidClient.getUserFillsByTime(
				user,
				currentStartTime,
				endTime,
				false
			);

			// No more fills available
			if (batch.length === 0) break;

			allFills.push(...batch);

			// If batch is not full, we've reached the end
			if (batch.length < BATCH_SIZE) break;

			// Move to next batch: start from 1ms after the last fill
			const lastFill = batch[batch.length - 1];
			if (!lastFill) break;

			currentStartTime = lastFill.time + 1;

			// Stop if we've passed endTime
			if (endTime && currentStartTime > endTime) break;
		}

		// Trim to MAX_FILLS and ensure chronological order
		return allFills
			.sort((a, b) => a.time - b.time)
			.slice(0, MAX_FILLS);
	}

  /**
   * Get user's equity at a specific time.
   *
   * Uses the Hyperliquid portfolio endpoint to retrieve account value history.
   * If atMs is provided, finds the closest equity value at or before that timestamp.
   * If atMs is not provided, returns the most recent equity value.
   *
   * @param user - User address
   * @param atMs - Optional timestamp in milliseconds
   * @returns User's equity at the specified time, or 0 if unavailable
   */
  async getEquityAt(user: string, atMs?: number): Promise<number> {
    try {
      // Get portfolio history from Hyperliquid API
      const portfolio = await defaultHyperliquidClient.getPortfolio(user);

      if (!portfolio || !Array.isArray(portfolio)) {
        return 0;
      }

      // Extract accountValueHistory from the appropriate timeframe
      // Try "day" first for most recent data, fallback to other timeframes
      let accountValueHistory: [number, string][] = [];

      for (const item of portfolio) {
        if (Array.isArray(item) && item.length === 2) {
          const [timeframe, data] = item;
          if (
            data &&
            Array.isArray(data.accountValueHistory) &&
            data.accountValueHistory.length > 0
          ) {
            accountValueHistory = data.accountValueHistory;
            // Prefer "day" or "allTime" timeframes for more granular data
            if (timeframe === 'day' || timeframe === 'allTime') {
              break;
            }
          }
        }
      }

      if (accountValueHistory.length === 0) {
        return 0;
      }

      // If no specific timestamp requested, return most recent equity
      if (!atMs) {
        const latest = accountValueHistory[accountValueHistory.length - 1];
        return latest ? parseFloat(latest[1]) : 0;
      }

      // Find equity closest to but not after atMs
      let closestEntry: [number, string] | null = null;

      for (const entry of accountValueHistory) {
        const [timestamp, value] = entry;
        if (timestamp <= atMs) {
          if (!closestEntry || timestamp > closestEntry[0]) {
            closestEntry = entry as [number, string];
          }
        }
      }

      // If no entry found before atMs, use the earliest available
      if (!closestEntry && accountValueHistory.length > 0) {
        closestEntry = accountValueHistory[0] as [number, string];
      }

      return closestEntry ? parseFloat(closestEntry[1]) : 0;
    } catch (error) {
      console.warn(`Failed to get equity for user ${user}:`, error);
      return 0;
    }
  }

 /**
   * Get all users who have traded.
   *
   * LIMITATION: The Hyperliquid public API does not provide an endpoint to
   * retrieve a list of all users. The leaderboard feature requires this method
   * to rank users by volume, PnL, or return percentage.
   *
   * This implementation returns a hardcoded list of users for leaderboard functionality.
   * For production, consider:
   * - Maintaining an in-memory cache of users from previous queries
   * - Using a database/indexing service to track known users
   * - Accepting a user list as a parameter in the leaderboard request
   * - Using a separate data source that maintains user registries
   *
   * @returns Array of user addresses for leaderboard ranking
   */
  async getAllUsers(): Promise<string[]> {
    // Default user list for leaderboard
    return [
      '0x0e09b56ef137f417e424f1265425e93bfff77e17',
      '0x186b7610ff3f2e3fd7985b95f525ee0e37a79a74',
      '0x6c8031a9eb4415284f3f89c0420f697c87168263',
      '0xa1650C9f9EAd31802Bf4f802c84B28eD9f123C19',
    ];
  }

  /**
   * Calculate total volume for a user.
   * Volume is computed from fills by summing notional value (price * size).
   * Applies coin, time, and builderOnly filters if provided.
   *
   * Note: For builderOnly, we can only filter at the fill level (by builderFee presence).
   * Taint detection (mixed builder/non-builder trades in same lifecycle) requires
   * position lifecycle analysis, which is done in the service layer.
   */
  async getVolume(params: GetVolumeParams): Promise<number> {
    const fills = await this.getFills({
      user: params.user,
      fromMs: params.fromMs,
      toMs: params.toMs,
    });

    // Filter by coin if specified (Hyperliquid API doesn't filter at request level)
    let filteredFills = fills;
    if (params.coin) {
      filteredFills = filteredFills.filter((fill) => fill.coin === params.coin);
    }

    // Filter by builderOnly if specified (only builder-attributed trades)
    // Note: This filters based on builderFee presence, but doesn't account for
    // tainted lifecycles. For proper builder-only filtering with taint detection,
    // use getPnl() instead which uses getPositionLifecycles().
    if (params.builderOnly) {
      filteredFills = filteredFills.filter(
        (fill) =>
          fill.builderFee !== undefined &&
          parseFloat(fill.builderFee || '0') > 0,
      );
    }

    // Sum notional value: price * size for each fill
    const volume = filteredFills.reduce((sum, fill) => {
      const px = parseFloat(fill.px);
      const sz = parseFloat(fill.sz);
      return sum + px * sz;
    }, 0);

    return volume;
  }

	/**
	 * Get deposits/withdrawals for a user.
	 * 
	 * Uses the userNonFundingLedgerUpdates endpoint which provides actual
	 * deposit/withdrawal transactions (not inferred from portfolio changes).
	 * 
	 * This endpoint returns ledger updates including:
	 * - Deposits: type="deposit" with usdc field
	 * - Withdrawals: type="withdraw" with usdc field
	 * - Internal transfers: type="accountClassTransfer", type="spotTransfer", etc.
	 */
	async getDeposits(params: GetDepositsParams): Promise<Deposit[]> {
		try {
			const { user, fromMs, toMs } = params;
			
			// Get all non-funding ledger updates
			const ledger = await defaultHyperliquidClient.getUserNonFundingLedgerUpdates(
				user,
				fromMs,
				toMs
			);

			if (!Array.isArray(ledger) || ledger.length === 0) {
				return [];
			}

			// Extract deposits and withdrawals
			const deposits: Deposit[] = [];
			
			for (const entry of ledger) {
				if (!entry || !entry.delta || !entry.delta.type) continue;

				const { time, delta, hash } = entry;
				
				// Handle deposits
				if (delta.type === 'deposit' && delta.usdc) {
					deposits.push({
						time,
						amount: delta.usdc,
						coin: 'USDC',
						txHash: hash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? hash : undefined,
						type: 'deposit',
					});
				}
				
				// Handle withdrawals
				else if (delta.type === 'withdraw' && delta.usdc) {
					deposits.push({
						time,
						amount: delta.usdc,
						coin: 'USDC',
						txHash: hash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? hash : undefined,
						type: 'withdrawal',
					});
				}
			}

			// Return deposits and withdrawals sorted by time (newest first)
			return deposits.sort((a, b) => b.time - a.time);

		} catch (error) {
			console.warn(`Failed to get deposits for user ${params.user}:`, error);
			return [];
		}
	}

	/**
	 * Get current open positions for a user with risk data.
	 * 
	 * Fetches clearinghouse state which includes:
	 * - Position size and direction
	 * - Liquidation price
	 * - Margin used
	 * - Leverage
	 * - Unrealized PnL
	 */
	async getCurrentPositions(user: string): Promise<Position[]> {
		try {
			const state = await defaultHyperliquidClient.getClearinghouseState(user);
			
			if (!state || !state.assetPositions) {
				return [];
			}

			return state.assetPositions.map((pos: any) => ({
				coin: pos.position.coin,
				szi: pos.position.szi,
				leverage: pos.position.leverage,
				liquidationPx: pos.position.liquidationPx,
				marginUsed: pos.position.marginUsed,
				maxLeverage: pos.position.maxLeverage,
				positionValue: pos.position.positionValue,
				returnOnEquity: pos.position.returnOnEquity,
				unrealizedPnl: pos.position.unrealizedPnl,
				entryPx: pos.position.entryPx,
			}));

		} catch (error) {
			console.warn(`Failed to get current positions for user ${user}:`, error);
			return [];
		}
	}
}
