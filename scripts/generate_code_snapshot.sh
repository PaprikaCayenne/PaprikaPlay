#!/bin/bash

# File: scripts/generate_code_snapshot.sh
# Version: v1.2.0 — Auto-increments version and saves to snapshot folder

DATE=$(date +%F)
SNAPSHOT_DIR="scripts/snapshot"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

mkdir -p "$SNAPSHOT_DIR"

# Get the latest version number for today’s date
last_version=$(ls "$SNAPSHOT_DIR" 2>/dev/null | grep "project_snapshot_${DATE}_" | \
  sed -E "s/^project_snapshot_${DATE}_v//; s/\.txt$//" | \
  sort -V | tail -n1)

if [[ -z "$last_version" ]]; then
  VERSION="v1.0.0"
else
  IFS='.' read -r major minor patch <<< "$last_version"
  patch=$((patch + 1))
  VERSION="v${major}.${minor}.${patch}"
fi

OUTPUT="$SNAPSHOT_DIR/project_snapshot_${DATE}_${VERSION}.txt"

echo "📦 Generating full source snapshot for kd_race_app" > "$OUTPUT"
echo "Timestamp: $(date)" >> "$OUTPUT"
echo "Root: $ROOT" >> "$OUTPUT"
echo "Version: $VERSION" >> "$OUTPUT"
echo "==================================================" >> "$OUTPUT"

find "$ROOT" \
  -type f \
  \( -name "*.js" -o -name "*.jsx" -o -name "*.ts" -o -name "*.tsx" -o -name "*.json" \
     -o -name "*.html" -o -name "*.css" -o -name "Dockerfile" -o -name "docker-compose.yml" \
     -o -name "*.conf" -o -name ".env" -o -name "*.sh" \) \
  ! -path "*/node_modules/*" \
  ! -path "$ROOT/volumes/*" \
  ! -path "$ROOT/frontend/dist/*" \
  ! -path "$ROOT/frontend_dist_temp/*" \
  | sort | while read -r file; do
    rel_path="${file#$ROOT/}"
    echo -e "\n\n==== FILE: $rel_path ====\n" >> "$OUTPUT"
    cat "$file" >> "$OUTPUT"
done

echo "✅ Snapshot written to: $OUTPUT"
