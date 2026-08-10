import AppKit
import SwiftUI

struct MenuContentView: View {
    @ObservedObject var store: MonitorStore
    @State private var isImporting = false
    @State private var isReordering = false
    @State private var isCustomIntervalPresented = false
    @State private var searchText = ""
    @State private var draggedInstanceID: String?
    @State private var reorderFrames: [String: CGRect] = [:]

    private var visibleInstances: [MonitoredInstance] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return store.instances }
        return store.instances.filter {
            store.displayName(for: $0).localizedCaseInsensitiveContains(query) ||
            $0.observation.displayName.localizedCaseInsensitiveContains(query) ||
            $0.observation.provider.localizedCaseInsensitiveContains(query) ||
            ($0.observation.metadataText("region", "location", "datacenter")?.localizedCaseInsensitiveContains(query) == true)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Divider()
                ScrollView {
                    LazyVStack(spacing: 10) {
                        summaryStrip
                        if let message = store.connectionMessage {
                            ConnectionBanner(message: message)
                        }
                        if let message = store.liveRefreshError {
                            AliyunLiveErrorBanner(message: message)
                        }
                        if store.instances.isEmpty, !store.isRefreshing {
                            EmptyServersView(isOffline: store.connectionMessage != nil) {
                                isImporting = true
                            }
                        } else {
                            serverList
                        }
                    }
                    .padding(12)
                }
                // MenuBarExtra 的 window 样式不会为 ScrollView 推导可靠的固有高度。
                // 只给 maxHeight 时，真实菜单栏弹窗可能把内容区压缩为 0，只剩顶栏和底栏。
                .frame(height: 500)
                .coordinateSpace(name: "serverReorderArea")
                .onPreferenceChange(InstanceFramePreferenceKey.self) {
                    reorderFrames = $0
                }
                Divider()
                footer
            }
            .frame(width: 430)
            .background {
                VisualEffectBackground(material: .underWindowBackground)
                    .ignoresSafeArea()
            }
            .sheet(isPresented: $isImporting) {
                ImportSourceView(store: store)
            }
            .sheet(isPresented: $isCustomIntervalPresented) {
                CustomIntervalView(current: store.liveRefreshSchedule) {
                    store.setLiveRefreshSchedule($0)
                }
            }
            .onAppear {
                store.startLiveRefreshLoop()
            }
            .task {
                await store.refresh()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(60))
                    if Task.isCancelled { break }
                    await store.refresh()
                }
            }
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .fill(Color.accentColor.opacity(0.14))
                    Image(systemName: "server.rack")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.accentColor)
                }
                .frame(width: 31, height: 31)

                VStack(alignment: .leading, spacing: 1) {
                    Text("VPS Monitor")
                        .font(.headline)
                    Text(statusLine)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                intervalMenu
                Button {
                    isReordering.toggle()
                } label: {
                    Image(systemName: isReordering ? "checkmark" : "arrow.up.arrow.down")
                }
                .help(isReordering ? "完成排序" : "调整 VPS 顺序")
                .buttonStyle(.borderless)

                Button {
                    isImporting = true
                } label: {
                    Image(systemName: "plus")
                }
                .help("导入 VPS 监控源")
                .buttonStyle(.borderless)

                Button {
                    Task { await store.refreshAll() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .rotationEffect(isAnyRefreshing ? .degrees(360) : .zero)
                        .animation(
                            isAnyRefreshing ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default,
                            value: isAnyRefreshing
                        )
                }
                .disabled(isAnyRefreshing)
                .help("刷新缓存数据并实时查询阿里云")
                .buttonStyle(.borderless)
            }

            if store.instances.count > 5 || !searchText.isEmpty {
                TextField("搜索名称、备注、供应商或区域", text: $searchText)
                    .textFieldStyle(.roundedBorder)
            }
        }
        .padding(12)
    }

    private var intervalMenu: some View {
        Menu {
            Section("阿里云实时刷新") {
                ForEach(LiveRefreshSchedule.presets) { option in
                    Button {
                        store.setLiveRefreshSchedule(option)
                    } label: {
                        if store.liveRefreshSchedule == option {
                            Label(option.title, systemImage: "checkmark")
                        } else {
                            Text(option.title)
                        }
                    }
                }
            }
            Divider()
            Button {
                isCustomIntervalPresented = true
            } label: {
                if store.liveRefreshSchedule.presetSeconds == nil {
                    Label("自定义…", systemImage: "checkmark")
                } else {
                    Label("自定义…", systemImage: "slider.horizontal.3")
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "timer")
                Text(store.liveRefreshSchedule.compactTitle)
                    .monospacedDigit()
            }
            .font(.caption)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .help("设置阿里云实时查询间隔")
    }

    private var summaryStrip: some View {
        HStack(spacing: 8) {
            SummaryCell(
                title: "在线",
                value: "\(store.onlineCount) / \(store.totalCount)",
                symbol: "checkmark.circle.fill",
                color: store.onlineCount == store.totalCount && store.totalCount > 0 ? .green : .secondary
            )
            SummaryCell(
                title: "供应商",
                value: "\(store.providersSummary.ok) / \(store.providersSummary.total)",
                symbol: "building.2.fill",
                color: store.providersSummary.ok == store.providersSummary.total && store.providersSummary.total > 0 ? .green : .orange
            )
            SummaryCell(
                title: "流量",
                value: trafficLabel,
                symbol: "arrow.up.arrow.down",
                color: .blue
            )
        }
    }

    @ViewBuilder
    private var serverList: some View {
        if visibleInstances.isEmpty {
            ContentUnavailableView("没有匹配的 VPS", systemImage: "magnifyingglass", description: Text("换一个关键词试试"))
                .frame(height: 220)
        } else {
            ForEach(visibleInstances) { instance in
                if isReordering {
                    HStack(spacing: 8) {
                        Image(systemName: "line.3.horizontal")
                            .foregroundStyle(.tertiary)
                            .frame(width: 20)
                            .padding(.vertical, 28)
                            .contentShape(Rectangle())
                            .gesture(reorderGesture(for: instance))
                        ServerRowView(
                            instance: instance,
                            displayName: store.displayName(for: instance),
                            countryCode: store.effectiveCountryCode(for: instance),
                            effectiveResetTime: store.effectiveResetTime(for: instance)
                        )
                        VStack(spacing: 4) {
                            Button {
                                withAnimation(.easeInOut(duration: 0.16)) {
                                    store.moveInstance(instance.id, by: -1)
                                }
                            } label: {
                                Image(systemName: "chevron.up")
                            }
                            .disabled(store.instances.first?.id == instance.id)
                            .help("上移")

                            Button {
                                withAnimation(.easeInOut(duration: 0.16)) {
                                    store.moveInstance(instance.id, by: 1)
                                }
                            } label: {
                                Image(systemName: "chevron.down")
                            }
                            .disabled(store.instances.last?.id == instance.id)
                            .help("下移")
                        }
                        .buttonStyle(.borderless)
                    }
                    .padding(.leading, 4)
                    .contentShape(Rectangle())
                    .opacity(draggedInstanceID == instance.id ? 0.72 : 1)
                    .background {
                        GeometryReader { proxy in
                            Color.clear.preference(
                                key: InstanceFramePreferenceKey.self,
                                value: [instance.id: proxy.frame(in: .named("serverReorderArea"))]
                            )
                        }
                    }
                } else {
                    NavigationLink {
                        ServerDetailView(instance: instance, store: store)
                    } label: {
                        ServerRowView(
                            instance: instance,
                            displayName: store.displayName(for: instance),
                            countryCode: store.effectiveCountryCode(for: instance),
                            effectiveResetTime: store.effectiveResetTime(for: instance)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(store.sourceErrors.isEmpty ? Color.green : Color.orange)
                .frame(width: 6, height: 6)
            Text(refreshLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            SettingsLink {
                Image(systemName: "gearshape")
            }
            .buttonStyle(.borderless)
            .help("设置")
            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Image(systemName: "power")
            }
            .buttonStyle(.borderless)
            .help("退出 VPS Monitor")
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
    }

    private func reorderGesture(for instance: MonitoredInstance) -> some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .named("serverReorderArea"))
            .onChanged { value in
                draggedInstanceID = instance.id
                guard let target = reorderFrames.min(by: {
                    abs($0.value.midY - value.location.y) < abs($1.value.midY - value.location.y)
                })?.key,
                target != instance.id else { return }
                withAnimation(.easeInOut(duration: 0.14)) {
                    store.moveInstance(instance.id, to: target)
                }
            }
            .onEnded { _ in
                draggedInstanceID = nil
            }
    }

    private var statusLine: String {
        if store.isRefreshingAliyun { return "正在实时查询阿里云…" }
        if store.isRefreshing { return "正在刷新监控数据…" }
        if store.liveRefreshError != nil { return "阿里云实时查询失败 · 显示上次数据" }
        if let date = store.lastAliyunLiveAt {
            let duration = store.lastAliyunDurationMs.map {
                " · \((Double($0) / 1_000).formatted(.number.precision(.fractionLength(1)))) 秒"
            } ?? ""
            return "阿里云实时更新于 \(VPSFormat.relative(date.ISO8601Format()))\(duration)"
        }
        if store.sourceErrors.isEmpty {
            return store.staleCount > 0 ? "\(store.staleCount) 台数据陈旧" : "所有数据已同步"
        }
        return "连接异常 · 显示缓存数据"
    }

    private var isAnyRefreshing: Bool {
        store.isRefreshing || store.isRefreshingAliyun
    }

    private var refreshLabel: String {
        guard let date = store.lastRefreshAt else { return "等待首次刷新" }
        return "更新于 \(date.formatted(date: .omitted, time: .shortened))"
    }

    private var trafficLabel: String {
        let traffic = store.trafficSummary
        if traffic.total > 0 { return "\(VPSFormat.bytes(traffic.used)) / \(VPSFormat.bytes(traffic.total))" }
        if traffic.unlimited > 0 { return "\(traffic.unlimited) 台无限" }
        return VPSFormat.empty
    }
}

private struct InstanceFramePreferenceKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]

    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct SummaryCell: View {
    let title: String
    let value: String
    let symbol: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.caption2)
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }
}

private struct ConnectionBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "cable.connector.slash")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(message)
                    .font(.subheadline.weight(.medium))
                Text("请确认 SSH 端口转发与 vpsmonitor-api 服务正在运行。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.orange.opacity(0.08))
                .allowsHitTesting(false)
        }
    }
}

private struct AliyunLiveErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "icloud.slash")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("阿里云实时查询失败")
                    .font(.subheadline.weight(.medium))
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                Text("已保留上一次成功数据，将按当前间隔再次查询。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color.orange.opacity(0.28), lineWidth: 1)
        }
    }
}

private struct EmptyServersView: View {
    let isOffline: Bool
    let importAction: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: isOffline ? "cable.connector.slash" : "server.rack")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text(isOffline ? "暂时无法读取 VPS" : "还没有 VPS")
                .font(.headline)
            Text(isOffline ? "连接恢复后会自动刷新，也可以导入另一个监控源。" : "从只读监控 API 导入 VPS 信息。")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 260)
            Button("导入监控源", action: importAction)
        }
        .frame(maxWidth: .infinity, minHeight: 230)
    }
}
