import Foundation

struct VPSCountry: Identifiable, Hashable, Sendable {
    let code: String
    let name: String

    var id: String { code }
    var flag: String { CountryCatalog.flag(for: code) }
}

enum CountryCatalog {
    private static let featuredCodes = [
        "CN", "HK", "TW", "JP", "SG", "US", "CA", "GB", "DE", "FR",
        "NL", "FI", "SE", "NO", "CH", "AU", "KR", "IN", "AE", "RU",
        "BR", "ZA", "IT", "ES", "PL", "AT", "BE", "IE", "NZ", "TH",
        "MY", "ID", "PH", "VN", "TR", "MX"
    ]

    static let all: [VPSCountry] = {
        let locale = Locale(identifier: "zh-Hans")
        let codes = Set(Locale.Region.isoRegions.map(\.identifier).filter { $0.count == 2 })
        let featured = featuredCodes.filter(codes.contains)
        let remaining = codes.subtracting(featured).sorted {
            countryName(for: $0, locale: locale).localizedStandardCompare(
                countryName(for: $1, locale: locale)
            ) == .orderedAscending
        }
        return (featured + remaining).map {
            VPSCountry(code: $0, name: countryName(for: $0, locale: locale))
        }
    }()

    private static let validCodes = Set(all.map(\.code))
    private static let commonAPINames: [String: String] = [
        "china": "CN", "mainlandchina": "CN", "hongkong": "HK", "macao": "MO", "macau": "MO",
        "taiwan": "TW", "japan": "JP", "singapore": "SG", "southkorea": "KR", "korearepublicof": "KR",
        "unitedstates": "US", "unitedstatesofamerica": "US", "usa": "US", "unitedkingdom": "GB", "uk": "GB",
        "russia": "RU", "russianfederation": "RU", "unitedarabemirates": "AE", "uae": "AE",
        "vietnam": "VN", "viet nam": "VN", "czechrepublic": "CZ", "czechia": "CZ"
    ]

    static func country(for code: String?) -> VPSCountry? {
        guard let code else { return nil }
        return all.first { $0.code == code.uppercased() }
    }

    static func flag(for code: String) -> String {
        let upper = code.uppercased()
        guard upper.count == 2 else { return "" }
        var result = ""
        for scalar in upper.unicodeScalars {
            guard let regionalIndicator = UnicodeScalar(127_397 + scalar.value) else { return "" }
            result.unicodeScalars.append(regionalIndicator)
        }
        return result
    }

    /// Only consumes explicit country fields supplied by the API. Region and
    /// datacenter text are intentionally not guessed.
    static func apiCountryCode(for observation: InstanceObservation) -> String? {
        if let raw = observation.countryCode, let code = code(fromAPIValue: raw) { return code }
        if let raw = observation.country, let code = code(fromAPIValue: raw) { return code }
        return explicitCountryCode(in: observation.metadata)
    }

    private static func explicitCountryCode(in values: [String: JSONValue]) -> String? {
        let explicitKeys = Set([
            "country", "countrycode", "countryiso", "countryisocode",
            "isocountry", "isocountrycode"
        ])

        for (key, value) in values {
            let normalizedKey = key.lowercased().filter(\.isLetter)
            guard explicitKeys.contains(normalizedKey) else { continue }
            if let raw = value.string, let code = code(fromAPIValue: raw) { return code }
            if case let .object(object) = value {
                for nestedKey in ["code", "iso", "iso_code", "name"] {
                    if let raw = object[nestedKey]?.string,
                       let code = code(fromAPIValue: raw) {
                        return code
                    }
                }
            }
        }

        for containerKey in ["geo", "geography", "location_info"] {
            if case let .object(object) = values[containerKey],
               let code = explicitCountryCode(in: object) {
                return code
            }
        }
        return nil
    }

    private static func code(fromAPIValue raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = trimmed.uppercased()
        if validCodes.contains(upper) { return upper }
        let normalizedName = trimmed.lowercased().filter { $0.isLetter || $0.isNumber }
        if let commonCode = commonAPINames[normalizedName] { return commonCode }

        let locales = [Locale(identifier: "zh-Hans"), Locale(identifier: "en_US")]
        for code in validCodes {
            for locale in locales where countryName(for: code, locale: locale)
                .compare(trimmed, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame {
                return code
            }
        }
        return nil
    }

    private static func countryName(for code: String, locale: Locale) -> String {
        locale.localizedString(forRegionCode: code) ?? code
    }
}
