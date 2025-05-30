#!/bin/bash

echo "Setting up Cloudflare Queues for Jetstream events..."

# Create the main queue
echo "Creating jetstream-events queue..."
pnpm wrangler queues create jetstream-events

# Create the dead letter queue
echo "Creating dead letter queue..."
pnpm wrangler queues create jetstream-events-dlq

echo "Queue setup complete!"
echo ""
echo "Next steps:"
echo "1. Run 'pnpm run cf-typegen' to update types"
echo "2. Run 'pnpm run deploy' to deploy both workers"
echo "3. Test with 'curl http://localhost:8787/stats' to trigger events" 