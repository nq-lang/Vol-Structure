#!/usr/bin/env bash
# Syntax checks: node --check on every JS file, python compile of tools/tests, then JS unit tests.
set -e; cd "$(dirname "$0")/.."; n=0
for f in $(find web tests/js preview -name '*.js' -not -path '*/node_modules/*'); do node --check "$f"; n=$((n+1)); done; echo "js syntax ok ($n files)"
python3 -m py_compile $(find tools tests preview -name '*.py') && echo "python syntax ok"
node tests/js/test_stream.js
