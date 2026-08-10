// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "VPSMonitorMenuBar",
    defaultLocalization: "zh-Hans",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "VPSMonitorMenuBar", targets: ["VPSMonitorMenuBar"])
    ],
    targets: [
        .executableTarget(
            name: "VPSMonitorMenuBar",
            path: "Sources/VPSMonitorMenuBar"
        ),
        .testTarget(
            name: "VPSMonitorMenuBarTests",
            dependencies: ["VPSMonitorMenuBar"]
        )
    ]
)
