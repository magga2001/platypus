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
}

export interface LedgerDatasource {
	getFills(params: GetFillsParams): Promise<Fill[]>;
	getEquityAt(user: string, atMs?: number): Promise<number>;
	getAllUsers(): Promise<string[]>;
	getVolume(params: GetVolumeParams): Promise<number>;
}

export class PublicHLDatasource implements LedgerDatasource {
	constructor() { }

	/**
	 * Fetch fills from Hyperliquid API.
	 * Chooses the appropriate endpoint based on time parameters:
	 * - If fromMs or toMs provided → use getUserFillsByTime (time-filtered, up to 2000 fills)
	 * - Otherwise → use getUserFills (most recent 2000 fills)
	 */
	async getFills(params: GetFillsParams): Promise<Fill[]> {
		const { user, fromMs, toMs } = params;

		// If time range specified, use the time-filtered endpoint
		if (fromMs !== undefined || toMs !== undefined) {
			// getUserFillsByTime requires startTime (required) and endTime (optional)
			const startTime = fromMs || 0; // Default to epoch if not provided
			return await defaultHyperliquidClient.getUserFillsByTime(
				user,
				startTime,
				toMs,
				false // aggregateByTime - keep fills separate for now
			);
		}

		// Otherwise get most recent fills
		return await defaultHyperliquidClient.getUserFills(user, false);
	}

	/**
	 * Get user's equity at a specific time.
	 * 
	 * LIMITATION: The Hyperliquid public API does not provide a direct endpoint
	 * to retrieve a user's account equity/value at a historical timestamp.
	 * 
	 * This method is used by the PnL service to calculate return percentage
	 * when `maxStartCapital` is provided. Without equity data, return percentage
	 * calculations will default to 0.
	 * 
	 * Possible workarounds (not implemented):
	 * - Calculate equity from position history (complex, requires market prices)
	 * - Use a separate data source that maintains account snapshots
	 * - Accept equity as a parameter in the PnL request
	 * 
	 * @returns 0 (placeholder - indicates equity data unavailable)
	 */
	async getEquityAt(_user: string, _atMs?: number): Promise<number> {
		// TODO: Implement via alternative data source or accept as request parameter
		return 0;
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
		];
	}

	/**
	 * Calculate total volume for a user.
	 * Volume is computed from fills by summing notional value (price * size).
	 * Applies coin and time filters if provided.
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
			filteredFills = fills.filter((fill) => fill.coin === params.coin);
		}

		// Sum notional value: price * size for each fill
		const volume = filteredFills.reduce((sum, fill) => {
			const px = parseFloat(fill.px);
			const sz = parseFloat(fill.sz);
			return sum + px * sz;
		}, 0);

		return volume;
	}
}
