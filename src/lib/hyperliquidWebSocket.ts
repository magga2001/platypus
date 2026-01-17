/**
 * WebSocket client for Hyperliquid real-time data streaming.
 * 
 * Features:
 * - Auto-reconnection with graceful handling of disconnects
 * - Heartbeat/ping to keep connection alive
 * - Subscription management with automatic resubscription on reconnect
 * - Type-safe subscription methods for common feeds
 * 
 * Usage:
 *   const ws = new HyperliquidWebSocket();
 *   await ws.connect();
 *   const unsubscribe = ws.subscribeUserFills('0x...', (data) => {
 *     console.log('New fills:', data.fills);
 *   });
 */

import WebSocket from 'ws';
import type { Fill } from './hyperliquidClient';

/**
 * WebSocket user fills message format
 */
export interface WsUserFills {
  isSnapshot?: boolean;  // True for initial snapshot on subscription
  user: string;
  fills: Fill[];
}

/**
 * WebSocket subscription object
 */
export interface WSSubscription {
  type: string;
  user?: string;
  coin?: string;
  interval?: string;
  aggregateByTime?: boolean;
  [key: string]: any;
}

/**
 * WebSocket message format
 */
interface WSMessage {
  method: 'subscribe' | 'unsubscribe';
  subscription: WSSubscription;
}

/**
 * WebSocket response from server
 */
interface WSResponse {
  channel: string;
  data: any;
}

export class HyperliquidWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectInterval: number = 5000;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private subscriptions: Map<string, WSSubscription> = new Map();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;

  constructor(url?: string) {
    this.url = url || process.env.HYPERLIQUID_WS_URL || 'wss://api.hyperliquid.xyz/ws';
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return Promise.resolve();
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      const onOpen = () => {
        console.log('✅ Hyperliquid WebSocket connected');
        this.isConnecting = false;
        this.startHeartbeat();
        this.resubscribeAll();
        resolve();
      };

      const onMessage = (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as WSResponse;
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      const onClose = () => {
        console.warn('⚠️ Hyperliquid WebSocket disconnected');
        this.isConnecting = false;
        this.stopHeartbeat();
        
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      const onError = (error: Error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
        reject(error);
      };

      this.ws.on('open', onOpen);
      this.ws.on('message', onMessage);
      this.ws.on('close', onClose);
      this.ws.on('error', onError);
    });
  }

  /**
   * Subscribe to a data feed
   * @returns Unsubscribe function
   */
  subscribe(subscription: WSSubscription, callback: (data: any) => void): () => void {
    const key = this.getSubscriptionKey(subscription);
    
    // Store subscription for reconnection
    this.subscriptions.set(key, subscription);

    // Add listener
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(callback);

    // Send subscribe message if connected
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ method: 'subscribe', subscription });
    }

    // Return unsubscribe function
    return () => {
      this.listeners.get(key)?.delete(callback);
      if (this.listeners.get(key)?.size === 0) {
        this.unsubscribe(subscription);
      }
    };
  }

  /**
   * Unsubscribe from a data feed
   */
  unsubscribe(subscription: WSSubscription): void {
    const key = this.getSubscriptionKey(subscription);
    this.subscriptions.delete(key);
    this.listeners.delete(key);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ method: 'unsubscribe', subscription });
    }
  }

  /**
   * Subscribe to user fills (real-time trade updates)
   * @param user - User address
   * @param callback - Called with fill data
   * @returns Unsubscribe function
   */
  subscribeUserFills(user: string, callback: (data: WsUserFills) => void): () => void {
    return this.subscribe(
      { type: 'userFills', user, aggregateByTime: false },
      callback
    );
  }

  /**
   * Subscribe to order updates
   * @param user - User address
   * @param callback - Called with order update data
   * @returns Unsubscribe function
   */
  subscribeOrderUpdates(user: string, callback: (data: any) => void): () => void {
    return this.subscribe({ type: 'orderUpdates', user }, callback);
  }

  /**
   * Subscribe to user events
   * @param user - User address
   * @param callback - Called with event data
   * @returns Unsubscribe function
   */
  subscribeUserEvents(user: string, callback: (data: any) => void): () => void {
    return this.subscribe({ type: 'userEvents', user }, callback);
  }

  /**
   * Subscribe to trades for a specific coin
   * @param coin - Coin symbol (e.g., "BTC", "ETH")
   * @param callback - Called with trade data
   * @returns Unsubscribe function
   */
  subscribeTrades(coin: string, callback: (data: any) => void): () => void {
    return this.subscribe({ type: 'trades', coin }, callback);
  }

  /**
   * Subscribe to all mids (mark prices)
   * @param callback - Called with price data
   * @returns Unsubscribe function
   */
  subscribeAllMids(callback: (data: any) => void): () => void {
    return this.subscribe({ type: 'allMids' }, callback);
  }

  /**
   * Disconnect WebSocket and stop all subscriptions
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.subscriptions.clear();
    this.listeners.clear();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): WSSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  // Private methods

  private send(message: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket not connected');
    }
  }

  private handleMessage(message: WSResponse): void {
    const { channel, data } = message;

    // Handle subscription response
    if (channel === 'subscriptionResponse') {
      console.log('Subscription confirmed:', data?.subscription?.type);
      return;
    }

    // Route message to appropriate listeners
    const key = this.getMessageKey(message);
    const listeners = this.listeners.get(key);

    if (listeners && listeners.size > 0) {
      listeners.forEach(callback => {
        try {
          callback(data || message);
        } catch (error) {
          console.error('Error in WebSocket listener callback:', error);
        }
      });
    }
  }

  private getSubscriptionKey(subscription: WSSubscription): string {
    // Create a consistent key for subscription tracking
    const { type, user, coin, interval, aggregateByTime } = subscription;
    const parts = [type];
    if (user) parts.push(`user:${user}`);
    if (coin) parts.push(`coin:${coin}`);
    if (interval) parts.push(`interval:${interval}`);
    if (aggregateByTime !== undefined) parts.push(`agg:${aggregateByTime}`);
    return parts.join('|');
  }

  private getMessageKey(message: WSResponse): string {
    const { channel, data } = message;

    // Map incoming message channels to subscription keys
    if (channel === 'user' && data) {
      // User-specific channels
      if (data.fills !== undefined) {
        return this.getSubscriptionKey({ 
          type: 'userFills', 
          user: data.user,
          aggregateByTime: false 
        });
      }
      if (data.orders !== undefined) {
        return this.getSubscriptionKey({ type: 'orderUpdates', user: data.user });
      }
    }

    if (channel === 'trades' && data?.coin) {
      return this.getSubscriptionKey({ type: 'trades', coin: data.coin });
    }

    if (channel === 'allMids') {
      return this.getSubscriptionKey({ type: 'allMids' });
    }

    // Default: try to match by channel name
    return this.getSubscriptionKey({ type: channel });
  }

  private resubscribeAll(): void {
    console.log(`Resubscribing to ${this.subscriptions.size} feeds...`);
    this.subscriptions.forEach(subscription => {
      this.send({ method: 'subscribe', subscription });
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      if (this.shouldReconnect && !this.isConnecting) {
        console.log('Attempting to reconnect WebSocket...');
        this.connect().catch(error => {
          console.error('Reconnection failed:', error);
        });
      }
    }, this.reconnectInterval);
  }

  private startHeartbeat(): void {
    // Send ping every 30 seconds to keep connection alive
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

/**
 * Singleton WebSocket instance
 * Use this for all WebSocket operations to maintain a single connection
 */
export const defaultHyperliquidWebSocket = new HyperliquidWebSocket();
