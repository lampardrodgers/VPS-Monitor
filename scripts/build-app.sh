#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
cd "$PROJECT_DIR"

swift build -c release
BIN_DIR=$(swift build -c release --show-bin-path)
APP_DIR="$PROJECT_DIR/dist/VPS Monitor.app"
CONTENTS_DIR="$APP_DIR/Contents"

rm -rf "$APP_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
cp "$BIN_DIR/VPSMonitorMenuBar" "$CONTENTS_DIR/MacOS/VPSMonitorMenuBar"
cp "$PROJECT_DIR/Support/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/Support/AppIcon.icns" "$CONTENTS_DIR/Resources/AppIcon.icns"
codesign --force --deep --sign - "$APP_DIR"

echo "$APP_DIR"
