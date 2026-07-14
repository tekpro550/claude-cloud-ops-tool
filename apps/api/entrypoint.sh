#!/bin/sh
set -e

# Single-instance deployment (docker-compose.prod.yml runs exactly one api
# container), so running migrations on every start is safe -- TypeORM
# migrations are tracked and idempotent, and there's no second replica that
# could race against this one. depends_on: condition: service_healthy on
# postgres in the compose file means this only runs once Postgres is
# actually accepting connections.
echo "Running database migrations..."
pnpm run migration:run

echo "Starting API..."
exec "$@"
