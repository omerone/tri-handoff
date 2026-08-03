#!/bin/bash
# Auto-deploy script: Commits and pushes changes every minute
# Usage: scripts/auto-deploy.sh

set -e

echo "[Auto-Deploy] Starting auto-deploy watcher..."
echo "[Auto-Deploy] Checking for changes every 10 seconds..."

while true; do
  # Check if there are uncommitted changes
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "[Auto-Deploy] $(date +'%Y-%m-%d %H:%M:%S') - Changes detected, committing..."

    # Stage all changes
    git add -A

    # Create commit with timestamp
    git commit -m "auto: update $(date +'%Y-%m-%d %H:%M:%S')" || {
      echo "[Auto-Deploy] Nothing to commit"
      sleep 10
      continue
    }

    # Push to remote
    echo "[Auto-Deploy] Pushing to remote..."
    git push -u origin master 2>&1 || git push -u origin main 2>&1 || {
      echo "[Auto-Deploy] Push failed, will retry in 10 seconds"
      sleep 10
      continue
    }

    echo "[Auto-Deploy] ✓ Deployed successfully"
  fi

  sleep 10
done
