#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
node update-content.js
firebase deploy --only hosting
