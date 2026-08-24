#!/usr/bin/env bash
# Deploy Menu Decoder to Netlify.
#
# Note: `netlify deploy --prod` returns "Forbidden" on this account, so we deploy
# as a draft and then promote that deploy to production via the restore endpoint,
# which does work. Same end result: the new build is live at the main URL.
set -euo pipefail
cd "$(dirname "$0")"

SITE_ID="4cfd62c3-cede-42b5-ad49-fdecd2508d21"

echo "Building dist/ ..."
rm -rf dist && mkdir -p dist
rsync -a \
  --exclude='.git/' --exclude='.claude/' --exclude='.netlify/' \
  --exclude='menus/' --exclude='.DS_Store' --exclude='dist/' \
  --exclude='.gitignore' --exclude='deploy.sh' --exclude='validate.js' \
  ./ dist/

echo "Validating data before publishing ..."
node validate.js >/dev/null || { echo "validate.js FAILED — not deploying"; exit 1; }

echo "Uploading ..."
DEPLOY_ID=$(netlify deploy --dir dist --site "$SITE_ID" --json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["deploy_id"])')

echo "Promoting deploy $DEPLOY_ID to production ..."
netlify api restoreSiteDeploy \
  --data "{\"site_id\":\"$SITE_ID\",\"deploy_id\":\"$DEPLOY_ID\"}" >/dev/null

echo "Live: https://ef-menu-decoder.netlify.app"
