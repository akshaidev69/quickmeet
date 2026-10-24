#!/usr/bin/env bash
set -euo pipefail
cd '/mnt/p/google meet clone'

if ! git diff --cached --quiet || ! git diff --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  git add -A
fi

if git diff --cached --quiet; then
  echo "Nothing to commit"
else
  git commit -m "$(cat <<'EOF'
Ship LetsConnect meeting room polish and auth.

Finalize Catch-Up UI, mute badges, circular controls, and Firebase-ready production build for Render.
EOF
)"
fi

GIT_SSH_COMMAND='ssh -i ~/.ssh/quickmeet_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  git push origin main

git status -sb
git log -1 --oneline
