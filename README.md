# Jetstream Event Processor

A Cloudflare Worker with Durable Objects that connects to the Bluesky Jetstream to process AT Protocol events and forward them to a webhook endpoint via Cloudflare Queues.

Why might this be useful? This is an experimental setup for small atproto apps that running on serverless systems that still want to "subscribe" to realtime events from the firehose/jetstream, but may not want to run their own server and are expecting low volumes traffic. 

## Features

- **Real-time Event Processing**: Connects to Bluesky Jetstream WebSocket to receive live AT Protocol events
- **Configurable Collections**: Subscribe to any AT Protocol collections via environment variables
- **Queue-based Architecture**: Uses Cloudflare Queues for reliable event processing and delivery
- **Webhook Integration**: Forwards events to your webhook endpoint with optional bearer token authentication
- **Cursor Tracking**: Maintains cursor position for gapless playback during reconnections
- **Statistics Collection**: Tracks event counts per collection and total processing stats
- **Web Dashboard**: Beautiful HTML interface to view processing statistics
- **Auto-Reconnection**: Handles WebSocket disconnections with exponential backoff
- **Persistent Storage**: Uses Durable Object storage to maintain state across deployments
- **Fully Configurable**: No hardcoded URLs or collections - easy to adapt for any project

## Quick Start

### Local Development

```bash
# 1. Clone and install dependencies
pnpm install

# 2. Set up local environment
pnpm run setup-local
# This creates .dev.vars from template

# 3. Edit .dev.vars with your configuration
nano .dev.vars

# 4. Create Cloudflare Queues (one-time setup)
pnpm run setup-queues

# 5. Start development server
pnpm run dev

# 6. View dashboard
open http://localhost:8787/stats/html
```

### Production Deployment

```bash
# 1. Configure environment variables and secrets
pnpm run setup-config

# 2. Deploy to Cloudflare
pnpm run deploy
```

## Configuration

This worker is fully configurable via environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `WEBHOOK_URL` | **Required** - Your webhook endpoint | `https://example.com/api/webhooks/jetstream` |
| `JETSTREAM_COLLECTIONS` | **Required** - Collections to watch (comma-separated) | `app.bsky.feed.post,app.bsky.graph.follow` |
| `WEBHOOK_BEARER_TOKEN` | **Optional** - Bearer token for webhook authentication | `your-secret-token` |

### Example Collections

```bash
# Social media activity
JETSTREAM_COLLECTIONS=app.bsky.feed.post,app.bsky.graph.follow,app.bsky.feed.like

# Profile updates
JETSTREAM_COLLECTIONS=app.bsky.actor.profile

# Custom AT Protocol collections
JETSTREAM_COLLECTIONS=com.example.app.*,org.myproject.data.*

# Watch everything (high volume!)
JETSTREAM_COLLECTIONS=*
```

### Local Development (.dev.vars)

```bash
# Copy template and edit
cp .dev.vars.example .dev.vars

# Example configuration
WEBHOOK_URL=https://example.com/api/webhooks/jetstream-event
JETSTREAM_COLLECTIONS=app.bsky.feed.post,app.bsky.graph.follow
WEBHOOK_BEARER_TOKEN=your-development-token
```

### Production (Cloudflare Secrets)

```bash
# Set via interactive script
pnpm run setup-config

# Or manually
wrangler secret put WEBHOOK_URL
wrangler secret put JETSTREAM_COLLECTIONS
wrangler secret put WEBHOOK_BEARER_TOKEN
```

## Endpoints

- **`GET /`** - API information and available endpoints
- **`GET /stats`** - JSON statistics of processed events
- **`GET /stats/html`** - HTML dashboard with real-time statistics (auto-refreshes every 30s)
- **`GET /status`** - WebSocket connection status
- **`GET /health`** - Health check endpoint
- **`POST /reset`** - Reset all statistics
- **`POST /reconnect`** - Force WebSocket reconnection

## Architecture

### Unified Worker Design

This worker handles both event processing and queue consumption in a single deployment:

1. **Jetstream Processing** (Durable Object): WebSocket connection, event filtering, queueing
2. **Queue Consumption** (Queue Handler): Batch processing and webhook delivery
3. **HTTP API** (Fetch Handler): Stats, dashboard, and control endpoints

```
Jetstream Events → Durable Object → Cloudflare Queue → Queue Handler → Your Webhook
```

### Durable Object: `JetstreamProcessor`

The core processing logic runs in a single Durable Object instance that:

1. **Establishes WebSocket Connection**: Connects to `wss://jetstream1.us-west.bsky.network/subscribe`
2. **Filters Events**: Only receives events from collections specified in `JETSTREAM_COLLECTIONS`
3. **Processes Events**: For each received commit event:
   - Skips identity and account events (only processes commits)
   - Updates the cursor with the event's `time_us`
   - Increments collection-specific counters
   - Queues the event for webhook delivery
   - Persists statistics every 100 events
4. **Handles Reconnections**: Automatically reconnects on disconnection with cursor for gapless playback

### Queue Consumer

The queue handler processes events in batches and delivers them to your webhook with:
- **Batch processing**: Up to 10 events per batch
- **Automatic retries**: 3 retry attempts with dead letter queue
- **Bearer token authentication**: Optional secure webhook delivery

### Event Types Processed

The processor handles Jetstream events with these `kind` values:

- **`commit`**: Repository commits with operations (create, update, delete) - **PROCESSED**
- **`identity`**: Identity/handle updates - **SKIPPED**
- **`account`**: Account status changes - **SKIPPED**

### Data Persistence

Statistics are stored in Durable Object storage:

```typescript
interface StoredStats {
  cursor: number;           // Latest time_us for reconnection
  eventCounts: Record<string, number>; // Events per collection
  totalEvents: number;      // Total commit events processed
  totalReceived: number;    // Total events received (including skipped)
  lastEventTime: string;    // ISO timestamp of last processing
}
```

### Event Filtering Limitations

**Important Note**: Jetstream always sends identity and account events to all subscribers, regardless of `wantedCollections` filters. This is documented behavior and cannot be changed.

Our implementation handles this by:
- ✅ **Efficiently skipping** non-commit events at the processing level
- ✅ **Tracking volume metrics** to show received vs processed events
- ✅ **Maintaining cursor position** for all events to ensure gapless replay
- ✅ **Silent handling** - no console spam from skipped events

**Processing Efficiency**: In practice, you may see a low efficiency percentage (e.g., 0-5%) because most events are identity/account updates rather than commits to your target collections.

## Monitoring

### Real-time Dashboard

Visit `/stats/html` for a beautiful web interface showing:

- **Commit events processed** - Only the events you care about
- **Total events received** - All events from Jetstream (including skipped)
- **Processing efficiency** - Percentage of useful vs total events
- **Unique collections** - Number of different collections processed
- **Last event timestamp** - When the most recent event was received
- **Events breakdown by collection** - Detailed stats per collection
- **Auto-refresh every 30 seconds**

### API Monitoring

```bash
# Check connection status
curl http://localhost:8787/status

# Get current statistics
curl http://localhost:8787/stats

# Check health
curl http://localhost:8787/health

# Force reconnection if needed
curl -X POST http://localhost:8787/reconnect
```

## Webhook Integration

Each commit event is posted to your webhook endpoint as JSON with optional bearer token authentication:

```http
POST {WEBHOOK_URL}
Content-Type: application/json
Authorization: Bearer {WEBHOOK_BEARER_TOKEN}
User-Agent: Jetstream-Unified/1.0

{
  "did": "did:plc:...",
  "time_us": 1725911162329308,
  "kind": "commit",
  "commit": {
    "rev": "3l3qo2vutsw2b",
    "operation": "create",
    "collection": "app.bsky.feed.post",
    "rkey": "3l3qo2vuowo2b",
    "record": {
      "$type": "app.bsky.feed.post",
      "createdAt": "2024-09-09T19:46:02.102Z",
      "text": "Hello, world!",
      // ... record data
    },
    "cid": "bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi"
  }
}
```

## Error Handling

- **WebSocket Errors**: Automatic reconnection with exponential backoff
- **Webhook Failures**: Automatic retries via Cloudflare Queues with dead letter queue
- **Parse Errors**: Individual event failures don't crash the processor
- **Storage Errors**: Graceful degradation with in-memory fallback
- **Configuration Errors**: Clear error messages for missing required environment variables

## Development Commands

```bash
# Local development
pnpm run dev              # Start development server
pnpm run setup-local      # Set up local environment

# Configuration
pnpm run setup-config     # Interactive production setup
pnpm run setup-queues     # Create Cloudflare Queues (one-time)

# Deployment
pnpm run deploy           # Deploy to Cloudflare
pnpm run cf-typegen       # Regenerate TypeScript types
```

## Project Structure

```
src/
├── types.ts              # Shared TypeScript interfaces
└── index.ts              # Main worker (Durable Object + Queue Consumer)

wrangler.jsonc            # Cloudflare Worker configuration
.dev.vars.example         # Environment variables template
setup-*.sh               # Setup scripts for queues and configuration
```

## Deployment

The worker automatically starts processing events upon deployment. The Durable Object ensures only one instance runs globally, maintaining connection state across worker invocations.

## Adapting for Your Project

This worker is designed to be easily adaptable:

1. **Fork the repository**
2. **Configure your environment variables**:
   - Set your webhook URL
   - Choose your AT Protocol collections
   - Add authentication if needed
3. **Deploy to Cloudflare**
4. **Monitor via the dashboard**

No code changes required - everything is configurable via environment variables!

## License

MIT 