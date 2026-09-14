#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
cd "$PROJECT_DIR"

if [[ "${VPSMON_REQUIRE_NOTARIZATION:-0}" == "1" && -z "${VPSMON_NOTARY_PROFILE:-}" ]]; then
    echo "正式发布需要 VPSMON_NOTARY_PROFILE；请先用 xcrun notarytool store-credentials 保存公证凭据。" >&2
    exit 1
fi
if [[ -n "${VPSMON_NOTARY_PROFILE:-}" && "${VPSMON_CODESIGN_IDENTITY:--}" == "-" ]]; then
    echo "配置了公证凭据，但未配置 VPSMON_CODESIGN_IDENTITY；公证必须使用 Developer ID 签名。" >&2
    exit 1
fi

if [[ "${VPSMON_SKIP_BUILD:-0}" != "1" ]]; then
    "$SCRIPT_DIR/build-app.sh"
fi

APP_DIR="$PROJECT_DIR/dist/VPS Monitor.app"
if [[ ! -d "$APP_DIR" ]]; then
    echo "未找到 $APP_DIR，请先构建应用。" >&2
    exit 1
fi

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_DIR/Contents/Info.plist")
DMG_PATH="${VPSMON_DMG_PATH:-$PROJECT_DIR/dist/VPS Monitor $VERSION.dmg}"
VOLUME_NAME="VPS Monitor"
STAGING_DIR=$(mktemp -d "$PROJECT_DIR/.dmg-staging.XXXXXX")

cleanup() {
    rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

ditto "$APP_DIR" "$STAGING_DIR/VPS Monitor.app"
ln -s /Applications "$STAGING_DIR/Applications"

hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$STAGING_DIR" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -ov \
    "$DMG_PATH"

SIGNING_IDENTITY="${VPSMON_CODESIGN_IDENTITY:--}"
if [[ "$SIGNING_IDENTITY" != "-" ]]; then
    codesign --force --sign "$SIGNING_IDENTITY" --timestamp "$DMG_PATH"
fi

if [[ -n "${VPSMON_NOTARY_PROFILE:-}" ]]; then
    xcrun notarytool submit "$DMG_PATH" \
        --keychain-profile "$VPSMON_NOTARY_PROFILE" \
        --wait
    xcrun stapler staple "$DMG_PATH"
else
    echo "警告：此 DMG 尚未 Apple 公证；正式分发请设置 VPSMON_NOTARY_PROFILE。" >&2
fi

hdiutil verify "$DMG_PATH"
echo "$DMG_PATH"
