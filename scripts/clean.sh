#!/usr/bin/env bash

set -e

targets=(
    node_modules
    dist
    src/generated
    var/test
)

for target in "${targets[@]}"; do
    if [ -e "$target" ]; then
        echo "removing $target"
        rm -rf "$target"
    fi
done

echo "clean, run"
echo "npm run bootstrap"
echo "to set the project up again"

exit 0
