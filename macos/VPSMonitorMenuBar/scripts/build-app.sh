#!/bin/zsh

set -euo pipefail

SCRIPT_DIR=${0:A:h}
PROJECT_DIR=${SCRIPT_DIR:h}
cd "$PROJECT_DIR"

ARCHS_STRING="${VPSMON_ARCHS:-arm64 x86_64}"
read -rA ARCHS <<< "$ARCHS_STRING"
if (( ${#ARCHS[@]} == 0 )); then
    echo "VPSMON_ARCHS must contain at least one architecture." >&2
    exit 1
fi

BINARIES=()
for ARCH in "${ARCHS[@]}"; do
    case "$ARCH" in
        arm64|x86_64)
            ;;
        *)
            echo "VPSMON_ARCHS supports arm64 and x86_64; got $ARCH." >&2
            exit 1
            ;;
    esac

    SCRATCH_PATH="$PROJECT_DIR/.build-$ARCH"
    swift build -c release --arch "$ARCH" --scratch-path "$SCRATCH_PATH"
    BIN_DIR=$(swift build -c release --arch "$ARCH" --scratch-path "$SCRATCH_PATH" --show-bin-path)
    BINARY="$BIN_DIR/VPSMonitorMenuBar"
    if [[ ! -f "$BINARY" ]]; then
        echo "SwiftPM did not produce $BINARY." >&2
        exit 1
    fi
    BINARIES+=("$BINARY")
done

APP_DIR="$PROJECT_DIR/dist/VPS Monitor.app"
CONTENTS_DIR="$APP_DIR/Contents"

rm -rf "$APP_DIR"
mkdir -p "$CONTENTS_DIR/MacOS" "$CONTENTS_DIR/Resources"
if (( ${#BINARIES[@]} == 1 )); then
    cp "${BINARIES[1]}" "$CONTENTS_DIR/MacOS/VPSMonitorMenuBar"
else
    lipo -create "${BINARIES[@]}" -output "$CONTENTS_DIR/MacOS/VPSMonitorMenuBar"
fi
cp "$PROJECT_DIR/Support/Info.plist" "$CONTENTS_DIR/Info.plist"
cp "$PROJECT_DIR/Support/AppIcon.icns" "$CONTENTS_DIR/Resources/AppIcon.icns"
SIGNING_IDENTITY="${VPSMON_CODESIGN_IDENTITY:--}"
PROVISIONING_PROFILE="${VPSMON_PROVISIONING_PROFILE:-}"
CLOUDKIT_ENVIRONMENT="${VPSMON_CLOUDKIT_ENVIRONMENT:-Development}"
HARDENED_RUNTIME="${VPSMON_HARDENED_RUNTIME:-0}"
KEYCHAIN_PATH="${VPSMON_KEYCHAIN:-}"

if [[ "$CLOUDKIT_ENVIRONMENT" != "Development" && "$CLOUDKIT_ENVIRONMENT" != "Production" ]]; then
    echo "VPSMON_CLOUDKIT_ENVIRONMENT must be Development or Production." >&2
    exit 1
fi

if [[ "$HARDENED_RUNTIME" != "0" && "$HARDENED_RUNTIME" != "1" ]]; then
    echo "VPSMON_HARDENED_RUNTIME must be 0 or 1." >&2
    exit 1
fi

if [[ "$SIGNING_IDENTITY" == "-" ]]; then
    # CloudKit entitlements are restricted and macOS refuses to launch an
    # ad-hoc signed app that contains them. Keep the local UI/build usable;
    # CloudKit becomes active only in a properly provisioned build.
    codesign --force --deep --sign "$SIGNING_IDENTITY" "$APP_DIR"
    echo "Ad-hoc build: CloudKit entitlements omitted; iCloud sync requires a provisioned Apple-signed build."
else
    if [[ -z "$PROVISIONING_PROFILE" || ! -f "$PROVISIONING_PROFILE" ]]; then
        echo "VPSMON_PROVISIONING_PROFILE must point to a matching macOS provisioning profile when using a non-ad-hoc signing identity." >&2
        exit 1
    fi

    cp "$PROVISIONING_PROFILE" "$CONTENTS_DIR/embedded.provisionprofile"

    ENTITLEMENTS_PATH="$PROJECT_DIR/.build/VPSMonitorMenuBar.$CLOUDKIT_ENVIRONMENT.entitlements"
    mkdir -p "${ENTITLEMENTS_PATH:h}"
    cp "$PROJECT_DIR/Support/VPSMonitorMenuBar.entitlements" "$ENTITLEMENTS_PATH"
    /usr/libexec/PlistBuddy -c \
        "Set :com.apple.developer.icloud-container-environment $CLOUDKIT_ENVIRONMENT" \
        "$ENTITLEMENTS_PATH"
    if [[ "$CLOUDKIT_ENVIRONMENT" == "Production" ]]; then
        /usr/libexec/PlistBuddy -c \
            "Delete :com.apple.developer.icloud-container-development-container-identifiers" \
            "$ENTITLEMENTS_PATH" 2>/dev/null || true
    fi

    CODESIGN_ARGS=(
        --force
        --deep
        --entitlements "$ENTITLEMENTS_PATH"
        --sign "$SIGNING_IDENTITY"
    )
    if [[ -n "$KEYCHAIN_PATH" ]]; then
        if [[ ! -f "$KEYCHAIN_PATH" ]]; then
            echo "VPSMON_KEYCHAIN must point to an existing keychain file." >&2
            exit 1
        fi
        CODESIGN_ARGS+=(--keychain "$KEYCHAIN_PATH")
    fi
    if [[ "$HARDENED_RUNTIME" == "1" ]]; then
        CODESIGN_ARGS+=(--options runtime --timestamp)
    fi
    codesign "${CODESIGN_ARGS[@]}" "$APP_DIR"
fi

echo "$APP_DIR"
