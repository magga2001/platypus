// Minimal datasource implementation used by LedgerService.
// This file provides the `LedgerDatasource` interface and a
// `PublicHLDatasource` class with stubbed methods so imports
// resolve during development. Replace with real implementations
// when integrating with Hyperliquid.

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
	getFills(params: GetFillsParams): Promise<any[]>;
	getEquityAt(user: string, atMs?: number): Promise<number>;
	getAllUsers(): Promise<string[]>;
	getVolume(params: GetVolumeParams): Promise<number>;
}

export class PublicHLDatasource implements LedgerDatasource {
	constructor() {}

	async getFills(_params: GetFillsParams): Promise<any[]> {
		// Return an empty array as a safe default.
		return [];
	}

	async getEquityAt(_user: string, _atMs?: number): Promise<number> {
		return 0;
	}

	async getAllUsers(): Promise<string[]> {
		return [];
	}

	async getVolume(_params: GetVolumeParams): Promise<number> {
		return 0;
	}
}

// Note: Add real Hyperliquid integration here later.
