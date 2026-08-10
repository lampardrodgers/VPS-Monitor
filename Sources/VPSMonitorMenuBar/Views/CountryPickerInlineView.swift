import SwiftUI

struct CountryPickerInlineView: View {
    let instance: MonitoredInstance
    @ObservedObject var store: MonitorStore
    let onClose: () -> Void
    @State private var searchText = ""

    private var options: [VPSCountry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return CountryCatalog.all }
        return CountryCatalog.all.filter {
            $0.name.localizedCaseInsensitiveContains(query) ||
                $0.code.localizedCaseInsensitiveContains(query)
        }
    }

    private var selectedCode: String? {
        store.effectiveCountryCode(for: instance)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("选择国家或地区", systemImage: "flag")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Button("完成", action: onClose)
            }

            if let apiCode = store.apiCountryCode(for: instance),
               let apiCountry = CountryCatalog.country(for: apiCode) {
                HStack(spacing: 6) {
                    Text("API 默认：\(apiCountry.flag) \(apiCountry.name)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if store.countryOverride(for: instance) != nil {
                        Button("恢复 API 默认") {
                            store.setCountryOverride(nil, for: instance)
                            onClose()
                        }
                        .font(.caption)
                    }
                }
            } else {
                Text("API 未提供国家信息，请手动选择。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            TextField("搜索国家或地区", text: $searchText)
                .textFieldStyle(.roundedBorder)

            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(options) { country in
                        Button {
                            store.setCountryOverride(country.code, for: instance)
                            onClose()
                        } label: {
                            HStack(spacing: 9) {
                                Text(country.flag)
                                    .font(.title3)
                                    .frame(width: 27)
                                Text(country.name)
                                    .lineLimit(1)
                                Text(country.code)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.tertiary)
                                Spacer()
                                if selectedCode == country.code {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color.accentColor)
                                }
                            }
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                            .background(
                                selectedCode == country.code ? Color.accentColor.opacity(0.10) : Color.clear,
                                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .frame(height: 220)

            if store.countryOverride(for: instance) != nil,
               store.apiCountryCode(for: instance) == nil {
                Button("清除国旗") {
                    store.setCountryOverride(nil, for: instance)
                    onClose()
                }
                .font(.caption)
            }
        }
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.accentColor.opacity(0.28), lineWidth: 1)
        }
    }
}
