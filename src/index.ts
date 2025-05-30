import { DurableObject } from "cloudflare:workers";
import type { JetstreamEvent, StoredStats, QueueMessage } from "./types";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** Durable Object for managing Jetstream connection and event processing */
export class JetstreamProcessor extends DurableObject<Env> {
	private websocket: WebSocket | null = null;
	private reconnectTimeout: any = null;
	private stats: StoredStats = {
		cursor: 0,
		eventCounts: {},
		totalEvents: 0,
		totalReceived: 0,
		lastEventTime: new Date().toISOString()
	};

	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.initializeProcessor();
	}

	private async initializeProcessor() {
		// Load existing stats from storage
		const storedStats = await this.ctx.storage.get<StoredStats>("stats");
		if (storedStats) {
			this.stats = storedStats;
		}

		// Start the Jetstream connection
		this.connectToJetstream();
	}

	private async connectToJetstream() {
		try {
			const collections = ["work.doing.*", "blue.2048.*"];
			const url = new URL("wss://jetstream1.us-west.bsky.network/subscribe");
			
			// Add collections to the query
			collections.forEach(collection => {
				url.searchParams.append("wantedCollections", collection);
			});

			// Add cursor if we have one (reconnection scenario)
			if (this.stats.cursor > 0) {
				// Subtract 5 seconds as buffer to ensure gapless playback
				const cursorWithBuffer = this.stats.cursor - (5 * 1000 * 1000);
				url.searchParams.set("cursor", cursorWithBuffer.toString());
			}

			console.log(`Connecting to Jetstream: ${url.toString()}`);

			this.websocket = new WebSocket(url.toString());

			this.websocket.addEventListener("open", () => {
				console.log("Jetstream WebSocket connected");
				// Clear any existing reconnect timeout
				if (this.reconnectTimeout) {
					clearTimeout(this.reconnectTimeout);
					this.reconnectTimeout = null;
				}
			});

			this.websocket.addEventListener("message", async (event) => {
				try {
					// WebSocket message data can be string or ArrayBuffer, we expect JSON string
					const data = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data);
					const jetstreamEvent: JetstreamEvent = JSON.parse(data);
					await this.processEvent(jetstreamEvent);
				} catch (error) {
					console.error("Error processing Jetstream event:", error);
				}
			});

			this.websocket.addEventListener("close", (event) => {
				console.log(`Jetstream WebSocket closed: ${event.code} ${event.reason}`);
				this.websocket = null;
				this.scheduleReconnect();
			});

			this.websocket.addEventListener("error", (event) => {
				console.error("Jetstream WebSocket error:", event);
				this.websocket = null;
				this.scheduleReconnect();
			});

		} catch (error) {
			console.error("Error connecting to Jetstream:", error);
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect() {
		if (this.reconnectTimeout) return;

		// Exponential backoff with jitter, starting at 1 second, max 30 seconds
		const baseDelay = 1000;
		const maxDelay = 30000;
		const delay = Math.min(baseDelay * Math.pow(2, Math.random()), maxDelay);

		console.log(`Scheduling Jetstream reconnect in ${delay}ms`);
		this.reconnectTimeout = setTimeout(() => {
			this.reconnectTimeout = null;
			this.connectToJetstream();
		}, delay);
	}

	private async processEvent(event: JetstreamEvent) {
		// Always update cursor and received count for all events
		this.stats.cursor = event.time_us;
		this.stats.totalReceived++;

		// Skip identity and account events - only process commits
		if (event.kind !== "commit") {
			return;
		}

		// Update stats for commit events only
		this.stats.totalEvents++;
		this.stats.lastEventTime = new Date().toISOString();

		// Track collection-specific stats for commits only
		if (event.commit?.collection) {
			const collection = event.commit.collection;
			this.stats.eventCounts[collection] = (this.stats.eventCounts[collection] || 0) + 1;
			console.log(`Processing ${event.commit.operation} event for collection: ${collection}`);
		}

		// Send to Cloudflare Queue instead of webhook
		try {
			const queueMessage: QueueMessage = {
				event: event,
				queuedAt: new Date().toISOString(),
				retryCount: 0
			};

			await this.env.JETSTREAM_QUEUE.send(queueMessage);

			console.log(`Event queued successfully: ${event.time_us}`);
		} catch (error) {
			console.error("Error sending to queue:", error);
			// Note: Queue failures are more serious than webhook failures
			// You might want to implement additional error handling here
		}

		// Persist stats every 100 events to avoid too frequent writes
		if (this.stats.totalEvents % 100 === 0) {
			await this.ctx.storage.put("stats", this.stats);
		}
	}

	/**
	 * Get current processing statistics
	 */
	async getStats(): Promise<StoredStats> {
		// Ensure we have the latest stats
		await this.ctx.storage.put("stats", this.stats);
		return this.stats;
	}

	/**
	 * Reset statistics (useful for testing)
	 */
	async resetStats(): Promise<void> {
		this.stats = {
			cursor: 0,
			eventCounts: {},
			totalEvents: 0,
			totalReceived: 0,
			lastEventTime: new Date().toISOString()
		};
		await this.ctx.storage.put("stats", this.stats);
	}

	/**
	 * Get connection status
	 */
	getConnectionStatus(): { connected: boolean; readyState?: number } {
		return {
			connected: this.websocket?.readyState === WebSocket.OPEN,
			readyState: this.websocket?.readyState
		};
	}

	/**
	 * Force reconnection (useful for debugging)
	 */
	async forceReconnect(): Promise<void> {
		if (this.websocket) {
			this.websocket.close();
		}
		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}
		this.connectToJetstream();
	}
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		
		// Create a single instance of the Jetstream processor
		const id: DurableObjectId = env.JETSTREAM_PROCESSOR.idFromName("main");
		const stub = env.JETSTREAM_PROCESSOR.get(id);

		// Handle different routes
		if (url.pathname === "/stats") {
			const stats = await stub.getStats();
			return new Response(JSON.stringify(stats, null, 2), {
				headers: { "Content-Type": "application/json" }
			});
		}

		if (url.pathname === "/stats/html") {
			const stats = await stub.getStats();
			const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Jetstream Statistics</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            max-width: 800px; 
            margin: 2rem auto; 
            padding: 0 1rem;
            background: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 2rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 { color: #333; margin-bottom: 2rem; }
        .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
        .stat-card { background: #f8f9fa; padding: 1rem; border-radius: 6px; border-left: 4px solid #007bff; }
        .stat-value { font-size: 1.5rem; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; font-size: 0.9rem; }
        .collections { margin-top: 2rem; }
        .collection-item { padding: 0.5rem; margin: 0.25rem 0; background: #e9ecef; border-radius: 4px; display: flex; justify-content: space-between; }
        .refresh-btn { 
            background: #007bff; 
            color: white; 
            border: none; 
            padding: 0.5rem 1rem; 
            border-radius: 4px; 
            cursor: pointer; 
            margin-bottom: 1rem;
        }
        .refresh-btn:hover { background: #0056b3; }
    </style>
    <script>
        function refreshStats() {
            window.location.reload();
        }
        setInterval(refreshStats, 30000); // Auto-refresh every 30 seconds
    </script>
</head>
<body>
    <div class="container">
        <h1>🚀 Jetstream Event Processor</h1>
        <button class="refresh-btn" onclick="refreshStats()">Refresh Stats</button>
        
        <div class="stat-grid">
            <div class="stat-card">
                <div class="stat-value">${stats.totalEvents.toLocaleString()}</div>
                <div class="stat-label">Commit Events Processed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalReceived.toLocaleString()}</div>
                <div class="stat-label">Total Events Received</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.totalReceived > 0 ? ((stats.totalEvents / stats.totalReceived) * 100).toFixed(1) + '%' : '0%'}</div>
                <div class="stat-label">Processing Efficiency</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${Object.keys(stats.eventCounts).length}</div>
                <div class="stat-label">Unique Collections</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${stats.cursor > 0 ? new Date(stats.cursor / 1000).toLocaleString() : 'N/A'}</div>
                <div class="stat-label">Last Event Time</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${new Date(stats.lastEventTime).toLocaleString()}</div>
                <div class="stat-label">Last Processed</div>
            </div>
        </div>

        <div class="collections">
            <h3>Events by Collection</h3>
            ${Object.entries(stats.eventCounts)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .map(([collection, count]) => `
                    <div class="collection-item">
                        <span>${collection}</span>
                        <span><strong>${(count as number).toLocaleString()}</strong></span>
                    </div>
                `).join('')}
        </div>
    </div>
</body>
</html>`;
			return new Response(html, {
				headers: { "Content-Type": "text/html" }
			});
		}

		if (url.pathname === "/status") {
			const status = await stub.getConnectionStatus();
			return new Response(JSON.stringify(status, null, 2), {
				headers: { "Content-Type": "application/json" }
			});
		}

		if (url.pathname === "/reset" && request.method === "POST") {
			await stub.resetStats();
			return new Response(JSON.stringify({ message: "Stats reset successfully" }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		if (url.pathname === "/reconnect" && request.method === "POST") {
			await stub.forceReconnect();
			return new Response(JSON.stringify({ message: "Reconnection initiated" }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		if (url.pathname === "/health") {
			return new Response(JSON.stringify({
				status: "healthy",
				worker: "jetstream-unified",
				timestamp: new Date().toISOString()
			}), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Default route - show basic info
		return new Response(JSON.stringify({
			message: "Jetstream Event Processor (Unified)",
			endpoints: {
				"/stats": "Get processing statistics (JSON)",
				"/stats/html": "Get processing statistics (HTML dashboard)",
				"/status": "Get WebSocket connection status",
				"/health": "Health check endpoint",
				"POST /reset": "Reset statistics",
				"POST /reconnect": "Force WebSocket reconnection"
			}
		}, null, 2), {
			headers: { "Content-Type": "application/json" }
		});
	},

	// Queue consumer handler - processes events from the queue
	async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(`Processing batch of ${batch.messages.length} messages`);

		// Process messages in batch for efficiency
		const webhookPromises = batch.messages.map(async (message) => {
			try {
				// Cast the unknown message body to our QueueMessage type
				const queueMessage = message.body as QueueMessage;
				await sendToWebhook(queueMessage.event);
				
				// Acknowledge successful processing
				message.ack();
				
				console.log(`Successfully processed event ${queueMessage.event.time_us} for collection: ${queueMessage.event.commit?.collection || 'non-commit'}`);
			} catch (error) {
				console.error(`Failed to process queue message:`, error);
				
				// Let the message retry (don't ack)
				// Cloudflare Queues will automatically retry based on configuration
				message.retry();
			}
		});

		// Wait for all webhook calls to complete
		await Promise.allSettled(webhookPromises);
	}
} satisfies ExportedHandler<Env>;

async function sendToWebhook(event: JetstreamEvent): Promise<void> {
	const webhookUrl = "https://doingtunnel.doing.work/api/webhooks/jetstream-event";
	
	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "Jetstream-Unified/1.0"
		},
		body: JSON.stringify(event),
	});

	if (!response.ok) {
		// This will cause the message to retry
		throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
	}
}
