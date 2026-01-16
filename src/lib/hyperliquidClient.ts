/**
 * Minimal Hyperliquid HTTP client.
 *
 * This file provides a small, well-typed wrapper around fetch for
 * calling Hyperliquid endpoints. Endpoints and query parameters are
 * intentionally generic — adapt the paths to the real Hyperliquid API
 * when you have the exact routes.
 *
 * Notes:
 * - This uses the global `fetch` available in Node 18+. If your Node
 *   runtime is older, install a fetch polyfill (e.g. `node-fetch` or
 *   `undici`) and ensure it's globally available.
 */

/**
 * Fill response from Hyperliquid API.
 * Matches the exact structure returned by /info endpoints.
 */
export interface Fill {
	coin: string;           // Asset symbol (e.g., "AVAX", "xyz:XYZ100", "@107" for spot)
	px: string;             // Price
	sz: string;             // Size
	side: 'B' | 'A';        // Buy or Ask (sell)
	time: number;           // Timestamp in milliseconds
	startPosition: string;  // Position before this fill
	dir: string;            // Direction (e.g., "Open Long", "Close Short", "Sell")
	closedPnl: string;      // Realized PnL from this fill
	hash: string;           // Transaction hash
	oid: number;            // Order ID
	crossed: boolean;       // Whether this was a crossing order
	fee: string;            // Total fee (inclusive of builderFee)
	tid: number;            // Trade ID
	feeToken: string;       // Fee currency (e.g., "USDC")
	builderFee?: string;    // Optional builder fee (only present if > 0)
}

export interface HyperliquidClientOptions {
	baseUrl: string; // e.g. https://api.hyperliquid.example
	apiKey?: string; // optional API key if Hyperliquid requires auth
	timeoutMs?: number;
}

export class HyperliquidClient {
	private baseUrl: string;
	private apiKey?: string;
	private timeoutMs: number;

	constructor(opts: HyperliquidClientOptions) {
		this.baseUrl = opts.baseUrl.replace(/\/$/, '');
		this.apiKey = opts.apiKey;
		this.timeoutMs = opts.timeoutMs ?? 10_000;
	}

	private buildUrl(path: string, query?: Record<string, any>) {
		const url = new URL(this.baseUrl + path);
		if (query) {
			Object.entries(query).forEach(([k, v]) => {
				if (v === undefined || v === null) return;
				if (Array.isArray(v)) {
					v.forEach((x) => url.searchParams.append(k, String(x)));
				} else {
					url.searchParams.append(k, String(v));
				}
			});
		}
		return url.toString();
	}

	private async fetchJson<T = any>(path: string, query?: Record<string, any>): Promise<T> {
		const url = this.buildUrl(path, query);

		const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
		const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		};

		if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

		try {
			const res = await fetch(url, {
				method: 'GET',
				headers,
				signal: controller ? controller.signal : undefined,
			} as RequestInit);

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`Hyperliquid API error ${res.status}: ${text}`);
			}

			return (await res.json()) as T;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private async postJson<T = any>(path: string, body?: any): Promise<T> {
		const url = this.baseUrl + path;

		const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
		const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;

		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'Content-Type': 'application/json',
		};

		if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

		try {
			const res = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(body ?? {}),
				signal: controller ? controller.signal : undefined,
			} as RequestInit);

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new Error(`Hyperliquid API error ${res.status}: ${text}`);
			}

			return (await res.json()) as T;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	/**
	 * Retrieve a user's fills (POST /info with type="userFills")
	 * Returns at most 2000 most recent fills.
	 */
	async getUserFills(user: string, aggregateByTime?: boolean): Promise<Fill[]> {
		const body = {
			type: 'userFills',
			user,
			aggregateByTime: aggregateByTime ?? false,
		};

		const payload = await this.postJson<any>('/info', body);
		if (Array.isArray(payload)) return payload as Fill[];
		return (payload && Array.isArray(payload.fills)) ? payload.fills : [];
	}

	/**
	 * Retrieve a user's fills by time range (POST /info with type="userFillsByTime")
	 * Returns at most 2000 fills per response; only the 10000 most recent are available.
	 */
	async getUserFillsByTime(user: string, startTime: number, endTime?: number, aggregateByTime?: boolean): Promise<Fill[]> {
		const body: Record<string, any> = {
			type: 'userFillsByTime',
			user,
			startTime,
			aggregateByTime: aggregateByTime ?? false,
		};
		if (endTime !== undefined) body.endTime = endTime;

		const payload = await this.postJson<any>('/info', body);
		if (Array.isArray(payload)) return payload as Fill[];
		return (payload && Array.isArray(payload.fills)) ? payload.fills : [];
	}

}

export const defaultHyperliquidClient = new HyperliquidClient({
	baseUrl: process.env.HYPERLIQUID_API_URL || 'http://localhost:8080',
	apiKey: process.env.HYPERLIQUID_API_KEY,
});

export default HyperliquidClient;

