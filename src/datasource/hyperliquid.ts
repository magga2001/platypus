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
	constructor() {}

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
	 * Note: This endpoint is not yet implemented in the Hyperliquid API spec provided.
	 * Returns 0 as placeholder - implement when endpoint is available.
	 */
	async getEquityAt(_user: string, _atMs?: number): Promise<number> {
		// TODO: Implement when Hyperliquid exposes equity/account value endpoint
		return 0;
	}

	/**
	 * Get all users who have traded.
	 * Note: This endpoint is not available in public Hyperliquid API.
	 * Returns empty array - would need to maintain a separate index.
	 */
	async getAllUsers(): Promise<string[]> {
		// TODO: Implement via separate indexing service or database
		return [];
	}

	/**
	 * Calculate total volume for a user.
	 * Note: This is computed from fills, not a direct API endpoint.
	 * Returns 0 as placeholder - implement by summing notional from getFills.
	 */
	async getVolume(_params: GetVolumeParams): Promise<number> {
		// TODO: Implement by fetching fills and summing (px * sz)
		return 0;
	}
}
