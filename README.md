# Jetstream Event Processor

A Cloudflare Worker with Durable Objects that connects to the Bluesky Jetstream to process AT Protocol events and forward them to a webhook endpoint via Cloudflare Queues.

## Features

- **Real-time Event Processing**: Connects to Bluesky Jetstream WebSocket to receive live AT Protocol events
- **Filtered Collections**: Subscribes specifically to `work.doing.*` and `blue.2048.*` collections
- **Queue-based Architecture**: Uses Cloudflare Queues for reliable event processing
- **Webhook Integration**: Dedicated consumer worker forwards events to webhook endpoint
- **Cursor Tracking**: Maintains cursor position for gapless playback during reconnections
- **Statistics Collection**: Tracks event counts per collection and total processing stats
- **Web Dashboard**: Beautiful HTML interface to view processing statistics
- **Auto-Reconnection**: Handles WebSocket disconnections with exponential backoff
- **Persistent Storage**: Uses Durable Object storage to maintain state across deployments
- **Shared Types**: Common TypeScript interfaces for consistency across workers

## Endpoints

- **`GET /`** - API information and available endpoints
- **`GET /stats`** - JSON statistics of processed events
- **`GET /stats/html`** - HTML dashboard with real-time statistics (auto-refreshes every 30s)
- **`GET /status`** - WebSocket connection status
- **`POST /reset`** - Reset all statistics
- **`POST /reconnect`** - Force WebSocket reconnection

## Development

```bash
# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Generate types after configuration changes
pnpm run cf-typegen

# Deploy to Cloudflare
pnpm run deploy
```

## Architecture

### Durable Object: `JetstreamProcessor`

The core processing logic runs in a single Durable Object instance that:

1. **Establishes WebSocket Connection**: Connects to `wss://jetstream1.us-west.bsky.network/subscribe`
2. **Filters Events**: Only receives events from specified collections using query parameters
3. **Processes Events**: For each received commit event:
   - Skips identity and account events (only processes commits)
   - Updates the cursor with the event's `time_us`
   - Increments collection-specific counters
   - Posts the complete event to the webhook endpoint
   - Persists statistics every 100 events
4. **Handles Reconnections**: Automatically reconnects on disconnection with cursor for gapless playback

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
  lastEventTime: string;    // ISO timestamp of last processing
}
```

## Configuration

The Jetstream connection is configured to:

- Subscribe to collections: `work.doing.*`, `blue.2048.*`
- Use cursor-based replay for gapless processing
- Apply 5-second buffer on reconnection to prevent missed events

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

- **Commit events processed** - Only the events we care about
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

# Force reconnection if needed
curl -X POST http://localhost:8787/reconnect
```

## Webhook Integration

Each commit event is posted to the webhook endpoint as JSON:

```typescript
POST https://doingtunnel.doing.work/api/webhooks/jetstream-event
Content-Type: application/json

{
  "did": "did:plc:...",
  "time_us": 1725911162329308,
  "kind": "commit",
  "commit": {
    "rev": "3l3qo2vutsw2b",
    "operation": "create",
    "collection": "work.doing.task",
    "rkey": "3l3qo2vuowo2b",
    "record": {
      "$type": "work.doing.task",
      "createdAt": "2024-09-09T19:46:02.102Z",
      // ... record data
    },
    "cid": "bafyreidwaivazkwu67xztlmuobx35hs2lnfh3kolmgfmucldvhd3sgzcqi"
  }
}
```

## Error Handling

- **WebSocket Errors**: Automatic reconnection with exponential backoff
- **Webhook Failures**: Logged but don't stop processing
- **Parse Errors**: Individual event failures don't crash the processor
- **Storage Errors**: Graceful degradation with in-memory fallback

## Deployment

The worker automatically starts processing events upon deployment. The Durable Object ensures only one instance runs globally, maintaining connection state across worker invocations.

```bash
# Deploy to production
pnpm run deploy
```

## License

MIT 