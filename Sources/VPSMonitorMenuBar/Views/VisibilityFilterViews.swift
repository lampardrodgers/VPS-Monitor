import SwiftUI

struct StatusVisibilityView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: MonitorStore
    @Binding var hiddenStates: Set<ServerState>

    var body: some View {
        filterPage(title: "在线状态", description: "选择首页需要显示的运行状态") {
            ForEach(ServerState.allCases, id: \.self) { state in
                let instances = store.instances.filter { $0.observation.normalizedState == state }
                SelectionGroupCard(
                    title: state.label,
                    count: instances.count,
                    symbol: symbol(for: state),
                    color: state.color,
                    isSelected: !hiddenStates.contains(state),
                    itemNames: instances.map { displayLabel(for: $0) }
                ) {
                    if hiddenStates.contains(state) {
                        hiddenStates.remove(state)
                    } else {
                        hiddenStates.insert(state)
                    }
                }
            }
        } showAll: {
            hiddenStates.removeAll()
        } hideAll: {
            hiddenStates = Set(ServerState.allCases)
        }
        .navigationTitle("在线状态")
    }

    private func symbol(for state: ServerState) -> String {
        switch state {
        case .online: "checkmark.circle.fill"
        case .offline: "xmark.circle.fill"
        case .transitional: "clock.arrow.circlepath"
        case .unknown: "questionmark.circle.fill"
        }
    }

    private func displayLabel(for instance: MonitoredInstance) -> String {
        let flag = store.effectiveCountryCode(for: instance).map(CountryCatalog.flag(for:)) ?? ""
        return [flag, store.displayName(for: instance)].filter { !$0.isEmpty }.joined(separator: " ")
    }

    private func filterPage<Content: View>(
        title: String,
        description: String,
        @ViewBuilder content: @escaping () -> Content,
        showAll: @escaping () -> Void,
        hideAll: @escaping () -> Void
    ) -> some View {
        VisibilityFilterPage(
            title: title,
            description: description,
            dismiss: { dismiss() },
            showAll: showAll,
            hideAll: hideAll,
            content: content
        )
    }
}

struct ProviderVisibilityView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: MonitorStore
    @Binding var hiddenInstanceIDs: Set<String>

    private var groups: [(key: String, name: String, instances: [MonitoredInstance])] {
        Dictionary(grouping: store.instances, by: { $0.observation.provider })
            .map { key, instances in
                (
                    key: key,
                    name: instances.first?.observation.providerDisplayName ?? key,
                    instances: instances
                )
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        VisibilityFilterPage(
            title: "供应商",
            description: "可按供应商整组选择，也可以单独选择每台 VPS",
            dismiss: { dismiss() },
            showAll: { hiddenInstanceIDs.removeAll() },
            hideAll: { hiddenInstanceIDs = Set(store.instances.map(\.id)) }
        ) {
            ForEach(groups, id: \.key) { group in
                ProviderSelectionCard(
                    name: group.name,
                    instances: group.instances,
                    store: store,
                    hiddenInstanceIDs: $hiddenInstanceIDs
                )
            }
        }
        .navigationTitle("供应商")
    }
}

private struct VisibilityFilterPage<Content: View>: View {
    let title: String
    let description: String
    let dismiss: () -> Void
    let showAll: () -> Void
    let hideAll: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button(action: dismiss) {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .help("返回所有 VPS")

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.headline)
                    Text(description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(12)

            Divider()

            ScrollView {
                LazyVStack(spacing: 10) {
                    HStack(spacing: 8) {
                        Button("全部显示", action: showAll)
                        Button("全部隐藏", action: hideAll)
                        Spacer()
                    }
                    .buttonStyle(.bordered)

                    content()
                }
                .padding(12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background {
            VisualEffectBackground(material: .underWindowBackground)
                .ignoresSafeArea()
        }
    }
}

private struct SelectionGroupCard: View {
    let title: String
    let count: Int
    let symbol: String
    let color: Color
    let isSelected: Bool
    let itemNames: [String]
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                    Image(systemName: symbol)
                        .foregroundStyle(color)
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(count) 台")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }

                if itemNames.isEmpty {
                    Text("当前没有 VPS")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .padding(.leading, 30)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(itemNames, id: \.self) { name in
                            Text(name)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .padding(.leading, 30)
                }
            }
            .padding(11)
            .contentShape(Rectangle())
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(Color.primary.opacity(0.08), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct ProviderSelectionCard: View {
    let name: String
    let instances: [MonitoredInstance]
    @ObservedObject var store: MonitorStore
    @Binding var hiddenInstanceIDs: Set<String>

    private var visibleCount: Int {
        instances.count { !hiddenInstanceIDs.contains($0.id) }
    }

    private var groupSymbol: String {
        if visibleCount == 0 { return "square" }
        if visibleCount == instances.count { return "checkmark.square.fill" }
        return "minus.square.fill"
    }

    var body: some View {
        VStack(spacing: 0) {
            Button(action: toggleGroup) {
                HStack(spacing: 8) {
                    Image(systemName: groupSymbol)
                        .font(.title3)
                        .foregroundStyle(visibleCount == 0 ? Color.secondary : Color.accentColor)
                    Image(systemName: "building.2.fill")
                        .foregroundStyle(.orange)
                    Text(name)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text("\(visibleCount) / \(instances.count) 台")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                .padding(11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Divider()
                .padding(.leading, 11)

            ForEach(Array(instances.enumerated()), id: \.element.id) { index, instance in
                Button {
                    toggleInstance(instance.id)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: hiddenInstanceIDs.contains(instance.id) ? "square" : "checkmark.square.fill")
                            .foregroundStyle(hiddenInstanceIDs.contains(instance.id) ? Color.secondary : Color.accentColor)
                        Text(flag(for: instance))
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(store.displayName(for: instance))
                                .font(.subheadline)
                                .lineLimit(1)
                            if store.displayName(for: instance) != instance.observation.displayName {
                                Text(instance.observation.displayName)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                        }
                        Spacer()
                        Text(instance.observation.normalizedState.label)
                            .font(.caption)
                            .foregroundStyle(instance.observation.normalizedState.color)
                    }
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if index < instances.count - 1 {
                    Divider()
                        .padding(.leading, 43)
                }
            }
        }
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func toggleGroup() {
        let ids = Set(instances.map(\.id))
        if visibleCount == instances.count {
            hiddenInstanceIDs.formUnion(ids)
        } else {
            hiddenInstanceIDs.subtract(ids)
        }
    }

    private func toggleInstance(_ id: String) {
        if hiddenInstanceIDs.contains(id) {
            hiddenInstanceIDs.remove(id)
        } else {
            hiddenInstanceIDs.insert(id)
        }
    }

    private func flag(for instance: MonitoredInstance) -> String {
        store.effectiveCountryCode(for: instance).map(CountryCatalog.flag(for:)) ?? "🏳️"
    }
}
