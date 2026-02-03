#!/bin/bash
#
# PM Agent Health Check Runner
#
# Usage: ./scripts/run-pm-check.sh [--prod]
#
# Options:
#   --prod    Run against production URL instead of localhost
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== PM Agent Health Check ===${NC}"
echo ""

# Load environment variables
ENV_FILE=""
if [ -f ".env.development.local" ]; then
    ENV_FILE=".env.development.local"
elif [ -f ".env.local" ]; then
    ENV_FILE=".env.local"
elif [ -f ".env" ]; then
    ENV_FILE=".env"
fi

if [ -z "$ENV_FILE" ]; then
    echo -e "${RED}Error: No .env file found${NC}"
    exit 1
fi

echo "Loading environment from: $ENV_FILE"

# Export environment variables (handle Vercel's escaped newlines)
while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue

    # Extract key and value
    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        # Remove surrounding quotes
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"

        # Remove trailing \n from Vercel
        value="${value%\\n}"

        export "$key=$value"
    fi
done < "$ENV_FILE"

# Parse arguments
USE_PROD=false
for arg in "$@"; do
    case $arg in
        --prod)
            USE_PROD=true
            shift
            ;;
    esac
done

# Set base URL
if [ "$USE_PROD" = true ]; then
    export TEST_BASE_URL="${NEXT_PUBLIC_APP_URL:-https://notes.sunhomes.io}"
    echo -e "Target: ${YELLOW}PRODUCTION${NC} ($TEST_BASE_URL)"
else
    export TEST_BASE_URL="http://localhost:3000"
    echo -e "Target: ${GREEN}LOCALHOST${NC} ($TEST_BASE_URL)"

    # Check if dev server is running
    if ! curl -s -o /dev/null -w '' "http://localhost:3000/api/health" 2>/dev/null; then
        echo ""
        echo -e "${YELLOW}Warning: Dev server not responding at localhost:3000${NC}"
        echo "Start the dev server with: npm run dev"
        echo ""
        read -p "Press Enter to continue anyway, or Ctrl+C to abort..."
    fi
fi

echo ""

# Run the health check
echo "Running health check..."
echo ""

npx tsx "$SCRIPT_DIR/pm-health-check.ts"
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}=== Health Check PASSED ===${NC}"
else
    echo -e "${RED}=== Health Check FAILED ===${NC}"
fi

exit $EXIT_CODE
