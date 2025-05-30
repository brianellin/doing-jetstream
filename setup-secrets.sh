#!/bin/bash

echo "🔐 Setting up Cloudflare Worker Configuration"
echo "============================================="
echo ""

echo "This script will help you set up both environment variables and secrets."
echo ""

echo "📋 Setting up environment variables..."
echo "Setting WEBHOOK_URL (your webhook endpoint):"
read -p "Enter webhook URL: " webhook_url
wrangler secret put WEBHOOK_URL --value "$webhook_url"

echo ""
echo "Setting JETSTREAM_COLLECTIONS (comma-separated AT Protocol collections):"
echo "Examples: work.doing.*,blue.2048.* or app.bsky.feed.post,app.bsky.graph.follow"
read -p "Enter collections to watch: " collections
wrangler secret put JETSTREAM_COLLECTIONS --value "$collections"

echo ""
echo "🔐 Setting up secrets..."
echo "Setting WEBHOOK_BEARER_TOKEN (this will prompt you to enter securely):"
pnpm wrangler secret put WEBHOOK_BEARER_TOKEN

echo ""
echo "✅ Configuration setup complete!"
echo ""
echo "Your worker is now configured with:"
echo "- WEBHOOK_URL: $webhook_url"
echo "- JETSTREAM_COLLECTIONS: $collections"
echo "- WEBHOOK_BEARER_TOKEN: [securely stored]"
echo ""
echo "For local development, create a .dev.vars file:"
echo "cp .dev.vars.example .dev.vars"
echo "# Then edit .dev.vars with your local values" 