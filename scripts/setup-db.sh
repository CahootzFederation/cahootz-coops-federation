#!/bin/bash

# Database Setup Script for Cahootz
# This script creates the PostgreSQL database and runs migrations

set -e  # Exit on error

echo "🗄️  Setting up Cahootz Database..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Database configuration
DB_NAME="soulaancoop_dev"
DB_USER="deonrobinson"
DB_HOST="localhost"
DB_PORT="5432"

# Check if database exists
echo "📋 Checking if database '$DB_NAME' exists..."
if psql -lqt -U $DB_USER -h $DB_HOST -p $DB_PORT | cut -d \| -f 1 | grep -qw $DB_NAME; then
    echo "✅ Database '$DB_NAME' already exists"
else
    echo "🔨 Creating database '$DB_NAME'..."
    createdb -U $DB_USER -h $DB_HOST -p $DB_PORT $DB_NAME
    echo "✅ Database '$DB_NAME' created successfully"
fi

# Set DATABASE_URL for migrations
export DATABASE_URL="postgresql://$DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"

echo ""
echo "📝 Your DATABASE_URL is:"
echo "   $DATABASE_URL"
echo ""
echo "💡 Add this to your apps/api/.env file:"
echo "   DATABASE_URL=\"$DATABASE_URL\""
echo ""

# Run Prisma migrations
echo "🔄 Running Prisma migrations..."
cd "$(dirname "$0")/../packages/db"
pnpm prisma migrate dev --name init || pnpm prisma migrate deploy

echo ""
echo "✅ Database setup complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next steps:"
echo "   1. Add DATABASE_URL to apps/api/.env:"
echo "      DATABASE_URL=\"$DATABASE_URL\""
echo "   2. Restart your API server:"
echo "      cd apps/api && pnpm dev"
echo ""

