import Foundation
import Network

struct InstanceIPAddresses: Equatable, Sendable {
    let ipv4: [String]
    let ipv6: [String]
}

enum IPAddressPrivacy {
    static func masked(_ rawAddress: String) -> String {
        let address = IPAddressParser.normalizedAddress(from: rawAddress) ?? rawAddress
        if let ipv4 = IPv4Address(address) {
            let bytes = [UInt8](ipv4.rawValue)
            guard bytes.count == 4 else { return rawAddress }
            return "\(bytes[0]).\(bytes[1]).*.*"
        }
        if let ipv6 = IPv6Address(address) {
            let bytes = [UInt8](ipv6.rawValue)
            guard bytes.count == 16 else { return rawAddress }
            let first = (UInt16(bytes[0]) << 8) | UInt16(bytes[1])
            let second = (UInt16(bytes[2]) << 8) | UInt16(bytes[3])
            return "\(String(first, radix: 16)):\(String(second, radix: 16)):****:****:****:****:****:****"
        }
        return rawAddress
    }
}

enum IPAddressParser {
    private enum Version {
        case ipv4
        case ipv6
    }

    private static let preferredMetadataKeys = [
        "ip", "ipv4", "public_ip", "public_ipv4", "public_ip_address",
        "ip_address", "ip_addresses", "ips", "primary_ip",
        "private_ip", "private_ipv4", "inner_ip", "inner_ip_address",
        "ipv6", "public_ipv6", "private_ipv6", "ipv4_address",
        "ipv4_addresses", "ipv6_address", "ipv6_addresses"
    ]
    private static let metadataIPKeys = Set(preferredMetadataKeys)
    private static let ignoredNestedKeys: Set<String> = [
        "gateway", "netmask", "mask", "prefix", "prefix_length", "cidr",
        "dns", "nameserver", "broadcast"
    ]

    static func addresses(in metadata: [String: JSONValue]) -> InstanceIPAddresses {
        var values: [(String, Version)] = []
        var visitedKeys: Set<String> = []

        for preferredKey in preferredMetadataKeys {
            for key in metadata.keys where normalizedKey(key) == preferredKey {
                visitedKeys.insert(key)
                collect(metadata[key], into: &values)
            }
        }
        for key in metadata.keys.sorted() where !visitedKeys.contains(key) && isMetadataIPKey(key) {
            collect(metadata[key], into: &values)
        }

        var seen: Set<String> = []
        let unique = values.filter { address, _ in
            seen.insert(address.lowercased()).inserted
        }
        return InstanceIPAddresses(
            ipv4: unique.compactMap { address, version in version == .ipv4 ? address : nil },
            ipv6: unique.compactMap { address, version in version == .ipv6 ? address : nil }
        )
    }

    static func isMetadataIPKey(_ key: String) -> Bool {
        metadataIPKeys.contains(normalizedKey(key))
    }

    static func normalizedAddress(from rawValue: String) -> String? {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        value = value.trimmingCharacters(in: CharacterSet(charactersIn: "[](){}<>\"'"))
        if let slash = value.firstIndex(of: "/") {
            value = String(value[..<slash])
        }
        if let percent = value.firstIndex(of: "%") {
            value = String(value[..<percent])
        }
        if let address = IPv4Address(value) { return String(describing: address) }
        if let address = IPv6Address(value) { return String(describing: address) }
        return nil
    }

    private static func collect(_ value: JSONValue?, into result: inout [(String, Version)]) {
        guard let value else { return }
        switch value {
        case let .string(rawValue):
            let separators = CharacterSet.whitespacesAndNewlines.union(
                CharacterSet(charactersIn: ",;|[](){}<>\"'")
            )
            for part in rawValue.components(separatedBy: separators) where !part.isEmpty {
                guard let address = normalizedAddress(from: part) else { continue }
                if IPv4Address(address) != nil {
                    result.append((address, .ipv4))
                } else if IPv6Address(address) != nil {
                    result.append((address, .ipv6))
                }
            }
        case let .array(values):
            for value in values { collect(value, into: &result) }
        case let .object(values):
            for key in values.keys.sorted() where !ignoredNestedKeys.contains(normalizedKey(key)) {
                collect(values[key], into: &result)
            }
        case .number, .bool, .null:
            break
        }
    }

    private static func normalizedKey(_ key: String) -> String {
        key.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "-", with: "_")
    }
}

extension InstanceObservation {
    var ipAddresses: InstanceIPAddresses {
        IPAddressParser.addresses(in: metadata)
    }
}
