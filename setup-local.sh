#!/bin/bash

echo "🏠 Setting up Local Development Environment"
echo "=========================================="
echo ""

if [ ! -f .dev.vars ]; then
    echo "Creating .dev.vars from template..."
    cp .dev.vars.example .dev.vars
    echo "✅ Created .dev.vars file"
    echo ""
    echo "📝 Please edit .dev.vars with your configuration:"
    echo "   - WEBHOOK_URL: Your webhook endpoint"
    echo "   - JETSTREAM_COLLECTIONS: Collections to watch"
    echo "   - WEBHOOK_BEARER_TOKEN: Your auth token (optional)"
    echo ""
    echo "Example collections to watch:"
    echo "   - app.bsky.feed.post           (all Bluesky posts)"
    echo "   - app.bsky.graph.follow        (all follows)"
    echo "   - app.bsky.actor.profile       (profile updates)"
else
    echo "⚠️  .dev.vars already exists"
    echo "   Edit it manually if you need to update your config"
fi

echo ""
echo "🎯 Next steps:"
echo "1. Edit .dev.vars with your configuration"
echo "2. Run: pnpm run dev"
echo "3. Test: curl http://localhost:8787/stats" 