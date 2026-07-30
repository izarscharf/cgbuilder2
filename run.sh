#!/usr/bin/env bash
# Launch the CGBuilder2 dev server.
set -e
cd "$(dirname "$0")"

# node/npm may live in a conda env rather than on PATH.
if ! command -v npm >/dev/null 2>&1; then
    if [ -f "$HOME/anaconda3/etc/profile.d/conda.sh" ]; then
        source "$HOME/anaconda3/etc/profile.d/conda.sh"
        conda activate nodejs
    fi
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found. Install Node.js (>=18) or 'conda activate nodejs' first." >&2
    exit 1
fi

[ -d node_modules ] || npm install

exec npm run dev
