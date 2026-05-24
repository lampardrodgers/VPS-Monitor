import {
  Activity,
  Bell,
  LogOut,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Server,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Wifi,
  WifiOff,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const TOKEN_KEY = "vpsmonitor.appToken";
const REFRESH_KEY = "vpsmonitor.refreshSeconds";
const DEFAULT_PAGE_REFRESH_SECONDS = 60;

type NavSection = "overview" | "nodes" | "alerts" | "settings";
type NodeStatus = "ok" | "warning" | "critical" | "offline" | "paused";

type Summary = {
  node_count: number;
  active_node_count: number;
  status_counts: Record<string, number>;
  total_quota_bytes: number;
  total_used_bytes: number;
  total_remaining_bytes: number | null;
  alerts_open: number;
};

type NodeView = {
  id: string;
  name: string;
  provider: string;
  country: string;
  quota_bytes: number | null;
  cycle_day: number;
  counting_mode: string;
  last_reported_at: string | null;
  status: NodeStatus;
  stale: boolean;
  monitoring_enabled: boolean;
  monitoring_paused_at: string | null;
  check_interval_seconds_override: number | null;
  effective_check_interval_seconds: number;
  applied_check_interval_seconds: number | null;
  check_interval_applied_at: string | null;
  check_interval_synced: boolean;
  cpu_percent: number | null;
  memory_total_bytes: number | null;
  memory_used_bytes: number | null;
  memory_used_percent: number | null;
  disk_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_used_percent: number | null;
  rx_bytes: number | null;
  tx_bytes: number | null;
  period_started_at: string | null;
  period_used_bytes: number | null;
  traffic_remaining_bytes: number | null;
  traffic_used_percent: number | null;
  traffic_remaining_percent: number | null;
  forecast_exhaustion_at: string | null;
  average_daily_bytes: number | null;
  history?: ReportPoint[];
};

type ReportPoint = {
  collected_at: string;
  cpu_percent: number | null;
  memory_used_bytes: number | null;
  memory_total_bytes: number | null;
  disk_used_bytes: number | null;
  disk_total_bytes: number | null;
  period_rx_bytes: number | null;
  period_tx_bytes: number | null;
};

type Alert = {
  id: number;
  node_id: string;
  node_name: string;
  kind: string;
  level: string;
  message: string;
  opened_at: string;
  resolved_at: string | null;
};

type SettingsResponse = {
  default_check_interval_seconds: number;
  min_check_interval_seconds: number;
  max_check_interval_seconds: number;
};

type LoadState = {
  loading: boolean;
  error: string | null;
};

const navItems: Array<{ id: NavSection; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "概览", icon: Activity },
  { id: "nodes", label: "节点", icon: Server },
  { id: "alerts", label: "告警", icon: Bell },
  { id: "settings", label: "设置", icon: Settings },
];

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [tokenDraft, setTokenDraft] = useState("");
  const [section, setSection] = useState<NavSection>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [nodes, setNodes] = useState<NodeView[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeView | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [refreshSeconds, setRefreshSeconds] = useState(() => readStoredNumber(REFRESH_KEY, DEFAULT_PAGE_REFRESH_SECONDS));
  const [state, setState] = useState<LoadState>({ loading: false, error: null });
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const authenticated = token.trim().length > 0;

  const loadNode = useCallback(
    async (nodeId: string) => {
      const detail = await apiFetch<NodeView>(`/api/v1/app/nodes/${encodeURIComponent(nodeId)}`, token);
      setSelectedNode(detail);
      setSelectedNodeId(detail.id);
      return detail;
    },
    [token],
  );

  const loadAll = useCallback(
    async (preferredNodeId?: string | null) => {
      if (!token) return;
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [nextSummary, nextNodes, nextAlerts, nextSettings] = await Promise.all([
          apiFetch<Summary>("/api/v1/app/summary", token),
          apiFetch<NodeView[]>("/api/v1/app/nodes", token),
          apiFetch<Alert[]>(`/api/v1/app/alerts?include_resolved=${includeResolved ? "true" : "false"}`, token),
          apiFetch<SettingsResponse>("/api/v1/app/settings", token),
        ]);
        setSummary(nextSummary);
        setNodes(nextNodes);
        setAlerts(nextAlerts);
        setSettings(nextSettings);

        const wantedId = preferredNodeId || selectedNodeId;
        const nextSelection =
          nextNodes.find((node) => node.id === wantedId) ||
          nextNodes.find((node) => node.monitoring_enabled) ||
          nextNodes[0] ||
          null;
        if (nextSelection) {
          await loadNode(nextSelection.id);
        } else {
          setSelectedNode(null);
          setSelectedNodeId(null);
        }
        setLastLoadedAt(new Date());
        setState({ loading: false, error: null });
      } catch (error) {
        setState({ loading: false, error: errorMessage(error) });
      }
    },
    [includeResolved, loadNode, selectedNodeId, token],
  );

  useEffect(() => {
    if (!authenticated) return;
    void loadAll();
  }, [authenticated, includeResolved]);

  useEffect(() => {
    if (!authenticated || refreshSeconds <= 0) return;
    const interval = window.setInterval(() => void loadAll(), refreshSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [authenticated, loadAll, refreshSeconds]);

  const handleLogin = (event: FormEvent) => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();
    if (!nextToken) return;
    localStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setTokenDraft("");
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setSummary(null);
    setNodes([]);
    setSelectedNode(null);
    setSelectedNodeId(null);
    setAlerts([]);
    setSettings(null);
  };

  const patchNodeSettings = async (nodeId: string, payload: Record<string, unknown>) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const updated = await apiFetch<NodeView>(`/api/v1/app/nodes/${encodeURIComponent(nodeId)}/settings`, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await loadAll(updated.id);
    } catch (error) {
      setState({ loading: false, error: errorMessage(error) });
    }
  };

  const updateGlobalInterval = async (seconds: number) => {
    if (!settings) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const nextSettings = await apiFetch<SettingsResponse>("/api/v1/app/settings/check-interval", token, {
        method: "PUT",
        body: JSON.stringify({ seconds }),
      });
      setSettings(nextSettings);
      await loadAll(selectedNodeId);
    } catch (error) {
      setState({ loading: false, error: errorMessage(error) });
    }
  };

  const updateRefreshSeconds = (seconds: number) => {
    const bounded = Math.max(5, Math.min(3600, Math.round(seconds)));
    localStorage.setItem(REFRESH_KEY, String(bounded));
    setRefreshSeconds(bounded);
  };

  if (!authenticated) {
    return <LoginView tokenDraft={tokenDraft} onChange={setTokenDraft} onSubmit={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">VM</div>
          <div>
            <strong>VPSMonitor</strong>
            <span>Controller</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={`nav-item ${section === item.id ? "active" : ""}`}
                key={item.id}
                onClick={() => setSection(item.id)}
                type="button"
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button className="logout-button" onClick={handleLogout} type="button">
          <LogOut size={17} />
          退出 Token
        </button>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{sectionTitle(section)}</h1>
            <p>
              已连接
              {lastLoadedAt ? ` / 最近刷新 ${formatTime(lastLoadedAt.toISOString())}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <span className="connection-pill">
              <Wifi size={15} />
              已连接
            </span>
            <button className="icon-text-button" onClick={() => void loadAll()} type="button" disabled={state.loading}>
              <RefreshCw size={17} className={state.loading ? "spin" : ""} />
              手动刷新
            </button>
          </div>
        </header>

        {state.error ? <div className="error-banner">{state.error}</div> : null}

        {section === "overview" ? (
          <Overview
            summary={summary}
            nodes={nodes}
            selectedNode={selectedNode}
            alerts={alerts}
            onSelectNode={(nodeId) => void loadNode(nodeId)}
            onToggleNode={(node) => void patchNodeSettings(node.id, { monitoring_enabled: !node.monitoring_enabled })}
          />
        ) : null}

        {section === "nodes" ? (
          <NodesSection
            nodes={nodes}
            selectedNode={selectedNode}
            onSelectNode={(nodeId) => void loadNode(nodeId)}
            onPatchNode={patchNodeSettings}
          />
        ) : null}

        {section === "alerts" ? (
          <AlertsSection
            alerts={alerts}
            includeResolved={includeResolved}
            onIncludeResolvedChange={setIncludeResolved}
          />
        ) : null}

        {section === "settings" && settings ? (
          <SettingsSection
            settings={settings}
            nodes={nodes}
            refreshSeconds={refreshSeconds}
            onRefreshSecondsChange={updateRefreshSeconds}
            onUpdateGlobalInterval={updateGlobalInterval}
            onPatchNode={patchNodeSettings}
          />
        ) : null}
      </main>
    </div>
  );
}

function LoginView({
  tokenDraft,
  onChange,
  onSubmit,
}: {
  tokenDraft: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark">VM</div>
          <div>
            <strong>VPSMonitor</strong>
            <span>Web 控制台</span>
          </div>
        </div>
        <h1>连接监控控制端</h1>
        <p>输入 controller 创建的 app bearer token，进入 VPS 监控控制台。</p>
        <form onSubmit={onSubmit} className="login-form">
          <label htmlFor="token">App Token</label>
          <input
            id="token"
            value={tokenDraft}
            onChange={(event) => onChange(event.target.value)}
            type="password"
            autoComplete="off"
            placeholder="app_xxx"
          />
          <button type="submit">进入控制台</button>
        </form>
      </section>
    </main>
  );
}

function Overview({
  summary,
  nodes,
  selectedNode,
  alerts,
  onSelectNode,
  onToggleNode,
}: {
  summary: Summary | null;
  nodes: NodeView[];
  selectedNode: NodeView | null;
  alerts: Alert[];
  onSelectNode: (nodeId: string) => void;
  onToggleNode: (node: NodeView) => void;
}) {
  return (
    <div className="content-grid">
      <SummaryStrip summary={summary} />
      <section className="panel table-panel">
        <PanelHeading icon={Server} title="节点状态" detail={`${nodes.length} 个节点`} />
        <NodeTable nodes={nodes} selectedNodeId={selectedNode?.id || null} onSelectNode={onSelectNode} onToggleNode={onToggleNode} />
      </section>
      <NodeDetail node={selectedNode} />
      <section className="panel alerts-panel">
        <PanelHeading icon={Bell} title="未解决告警" detail={`${alerts.filter((alert) => !alert.resolved_at).length} 条`} />
        <AlertList alerts={alerts.slice(0, 6)} />
      </section>
    </div>
  );
}

function NodesSection({
  nodes,
  selectedNode,
  onSelectNode,
  onPatchNode,
}: {
  nodes: NodeView[];
  selectedNode: NodeView | null;
  onSelectNode: (nodeId: string) => void;
  onPatchNode: (nodeId: string, payload: Record<string, unknown>) => void;
}) {
  return (
    <div className="content-grid">
      <section className="panel table-panel wide">
        <PanelHeading icon={Server} title="全部节点" detail="点击行查看历史和同步状态" />
        <NodeTable
          nodes={nodes}
          selectedNodeId={selectedNode?.id || null}
          onSelectNode={onSelectNode}
          onToggleNode={(node) => onPatchNode(node.id, { monitoring_enabled: !node.monitoring_enabled })}
        />
      </section>
      <NodeDetail node={selectedNode} />
    </div>
  );
}

function AlertsSection({
  alerts,
  includeResolved,
  onIncludeResolvedChange,
}: {
  alerts: Alert[];
  includeResolved: boolean;
  onIncludeResolvedChange: (value: boolean) => void;
}) {
  return (
    <section className="panel full-panel">
      <div className="panel-heading spread">
        <div className="heading-title">
          <ShieldAlert size={19} />
          <div>
            <h2>告警</h2>
            <p>{alerts.length} 条记录</p>
          </div>
        </div>
        <label className="inline-toggle">
          <input checked={includeResolved} onChange={(event) => onIncludeResolvedChange(event.target.checked)} type="checkbox" />
          包含已解决
        </label>
      </div>
      <AlertList alerts={alerts} />
    </section>
  );
}

function SettingsSection({
  settings,
  nodes,
  refreshSeconds,
  onRefreshSecondsChange,
  onUpdateGlobalInterval,
  onPatchNode,
}: {
  settings: SettingsResponse;
  nodes: NodeView[];
  refreshSeconds: number;
  onRefreshSecondsChange: (value: number) => void;
  onUpdateGlobalInterval: (seconds: number) => void;
  onPatchNode: (nodeId: string, payload: Record<string, unknown>) => void;
}) {
  const [globalDraft, setGlobalDraft] = useState(settings.default_check_interval_seconds);
  const [refreshDraft, setRefreshDraft] = useState(refreshSeconds);

  useEffect(() => setGlobalDraft(settings.default_check_interval_seconds), [settings.default_check_interval_seconds]);
  useEffect(() => setRefreshDraft(refreshSeconds), [refreshSeconds]);

  return (
    <div className="settings-layout">
      <section className="panel settings-panel">
        <PanelHeading icon={SlidersHorizontal} title="全局采集频率" detail="真实 agent 上报间隔" />
        <div className="form-row">
          <label htmlFor="globalInterval">默认频率</label>
          <div className="input-with-unit">
            <input
              id="globalInterval"
              min={settings.min_check_interval_seconds}
              max={settings.max_check_interval_seconds}
              value={globalDraft}
              onChange={(event) => setGlobalDraft(Number(event.target.value))}
              type="number"
            />
            <span>s</span>
          </div>
          <button type="button" onClick={() => onUpdateGlobalInterval(globalDraft)}>
            保存
          </button>
        </div>
        <p className="hint">允许范围 {settings.min_check_interval_seconds}s-{settings.max_check_interval_seconds}s。</p>
        {globalDraft < 60 ? <p className="warning-hint">低于 60s 会显著增加采集、HTTP 请求和 SQLite 写入压力。</p> : null}
      </section>

      <section className="panel settings-panel">
        <PanelHeading icon={RefreshCw} title="页面刷新" detail="只影响浏览器拉取 API" />
        <div className="form-row">
          <label htmlFor="pageRefresh">刷新间隔</label>
          <div className="input-with-unit">
            <input
              id="pageRefresh"
              min={5}
              max={3600}
              value={refreshDraft}
              onChange={(event) => setRefreshDraft(Number(event.target.value))}
              type="number"
            />
            <span>s</span>
          </div>
          <button type="button" onClick={() => onRefreshSecondsChange(refreshDraft)}>
            保存
          </button>
        </div>
      </section>

      <section className="panel full-panel">
        <PanelHeading icon={Server} title="节点覆盖设置" detail="关闭监控后上报会被接受但不写入历史" />
        <div className="node-settings-list">
          {nodes.map((node) => (
            <NodeSettingsRow key={node.id} node={node} settings={settings} onPatchNode={onPatchNode} />
          ))}
        </div>
      </section>
    </div>
  );
}

function NodeSettingsRow({
  node,
  settings,
  onPatchNode,
}: {
  node: NodeView;
  settings: SettingsResponse;
  onPatchNode: (nodeId: string, payload: Record<string, unknown>) => void;
}) {
  const [draft, setDraft] = useState(node.check_interval_seconds_override ?? node.effective_check_interval_seconds);

  useEffect(() => setDraft(node.check_interval_seconds_override ?? node.effective_check_interval_seconds), [
    node.check_interval_seconds_override,
    node.effective_check_interval_seconds,
  ]);

  return (
    <div className="node-settings-row">
      <div>
        <strong>{node.name}</strong>
        <span>
          {node.provider || "未填写供应商"} / {node.country || "未填写地区"}
        </span>
        <CountryBadge country={node.country} />
      </div>
      <StatusBadge status={node.status} />
      <label className="switch">
        <input
          checked={node.monitoring_enabled}
          onChange={() => onPatchNode(node.id, { monitoring_enabled: !node.monitoring_enabled })}
          type="checkbox"
        />
        <span />
      </label>
      <div className="inline-interval">
        <input
          min={settings.min_check_interval_seconds}
          max={settings.max_check_interval_seconds}
          value={draft}
          onChange={(event) => setDraft(Number(event.target.value))}
          type="number"
        />
        <button type="button" onClick={() => onPatchNode(node.id, { check_interval_seconds_override: draft })}>
          覆盖
        </button>
        <button className="ghost-button" type="button" onClick={() => onPatchNode(node.id, { check_interval_seconds_override: null })}>
          <RotateCcw size={15} />
          默认
        </button>
      </div>
      <span className={node.check_interval_synced ? "sync-ok" : "sync-pending"}>
        {node.check_interval_synced ? "已同步" : "待同步"}
      </span>
    </div>
  );
}

function SummaryStrip({ summary }: { summary: Summary | null }) {
  const counts = summary?.status_counts || {};
  const cards = [
    { label: "节点总数", value: summary ? `${summary.active_node_count}/${summary.node_count}` : "-", detail: "启用 / 全部" },
    { label: "在线", value: String(counts.ok || 0), detail: "正常节点" },
    { label: "告警", value: String(summary?.alerts_open ?? "-"), detail: "未解决" },
    {
      label: "本月已用流量",
      value: summary ? formatBytes(summary.total_used_bytes) : "-",
      detail: summary ? `总额度 ${formatBytes(summary.total_quota_bytes)}` : "等待数据",
    },
  ];
  return (
    <section className="summary-strip">
      {cards.map((card) => (
        <div className="metric-card" key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <small>{card.detail}</small>
        </div>
      ))}
    </section>
  );
}

function NodeTable({
  nodes,
  selectedNodeId,
  onSelectNode,
  onToggleNode,
}: {
  nodes: NodeView[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onToggleNode: (node: NodeView) => void;
}) {
  if (!nodes.length) {
    return <EmptyState title="暂无节点" body="通过 CLI 创建节点后，这里会显示最新上报状态。" />;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>状态</th>
            <th>节点</th>
            <th>供应商</th>
            <th>国家/地区</th>
            <th>CPU</th>
            <th>内存</th>
            <th>磁盘</th>
            <th>月流量</th>
            <th>最近上报</th>
            <th>监控</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => (
            <tr className={selectedNodeId === node.id ? "selected" : ""} key={node.id} onClick={() => onSelectNode(node.id)}>
              <td>
                <StatusBadge status={node.status} />
              </td>
              <td>
                <strong>{node.name}</strong>
                <small>{node.id}</small>
              </td>
              <td>{node.provider || "-"}</td>
              <td>
                <CountryBadge country={node.country} />
              </td>
              <td>{formatPercent(node.cpu_percent)}</td>
              <td>{formatPercent(node.memory_used_percent)}</td>
              <td>{formatPercent(node.disk_used_percent)}</td>
              <td>{formatPercent(node.traffic_used_percent)}</td>
              <td>{formatTime(node.last_reported_at)}</td>
              <td>
                <button
                  className={`toggle-button ${node.monitoring_enabled ? "enabled" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleNode(node);
                  }}
                  type="button"
                  title={node.monitoring_enabled ? "关闭监控" : "开启监控"}
                >
                  {node.monitoring_enabled ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeDetail({ node }: { node: NodeView | null }) {
  if (!node) {
    return (
      <section className="panel detail-panel">
        <EmptyState title="未选择节点" body="选择一个节点查看流量、资源和同步状态。" />
      </section>
    );
  }
  const history = node.history || [];
  return (
    <section className="panel detail-panel">
      <div className="detail-heading">
        <div>
          <h2>{node.name}</h2>
          <div className="detail-meta">
            <span>{node.provider || "未填写供应商"}</span>
            <CountryBadge country={node.country} />
          </div>
        </div>
        <StatusBadge status={node.status} />
      </div>

      <div className="quota-block">
        <div>
          <span>月流量</span>
          <strong>{formatBytes(node.period_used_bytes)} / {formatBytes(node.quota_bytes)}</strong>
        </div>
        <Progress value={node.traffic_used_percent} status={node.status} />
        <small>剩余 {formatBytes(node.traffic_remaining_bytes)} / 预计耗尽 {formatDate(node.forecast_exhaustion_at)}</small>
      </div>

      <div className="mini-grid">
        <MiniMeter label="CPU" value={node.cpu_percent} />
        <MiniMeter label="内存" value={node.memory_used_percent} />
        <MiniMeter label="磁盘" value={node.disk_used_percent} />
        <MiniMeter label="日均" value={null} text={formatBytes(node.average_daily_bytes)} />
      </div>

      <TrafficChart history={history} />

      <div className="sync-grid">
        <InfoRow label="采集频率" value={`${node.effective_check_interval_seconds}s`} />
        <InfoRow label="覆盖频率" value={node.check_interval_seconds_override ? `${node.check_interval_seconds_override}s` : "使用全局"} />
        <InfoRow label="同步状态" value={node.check_interval_synced ? "已同步" : "待同步"} />
        <InfoRow label="最后同步" value={formatTime(node.check_interval_applied_at)} />
        <InfoRow label="最后上报" value={formatTime(node.last_reported_at)} />
        <InfoRow label="国家/地区" value={countryLabel(node.country)} />
        <InfoRow label="监控开关" value={node.monitoring_enabled ? "开启" : `关闭于 ${formatTime(node.monitoring_paused_at)}`} />
      </div>
    </section>
  );
}

function TrafficChart({ history }: { history: ReportPoint[] }) {
  const points = useMemo(() => {
    return history
      .map((item) => ({
        time: item.collected_at,
        used: (item.period_rx_bytes || 0) + (item.period_tx_bytes || 0),
      }))
      .filter((item) => item.used > 0);
  }, [history]);

  const path = useMemo(() => makeLinePath(points.map((point) => point.used), 420, 150), [points]);
  const latest = points[points.length - 1];

  return (
    <div className="chart-block">
      <div className="chart-heading">
        <span>历史流量</span>
        <small>{latest ? `${formatBytes(latest.used)} / ${formatTime(latest.time)}` : "暂无历史点"}</small>
      </div>
      <svg viewBox="0 0 420 150" role="img" aria-label="历史流量趋势">
        <line x1="0" x2="420" y1="130" y2="130" />
        <line x1="0" x2="420" y1="80" y2="80" />
        <line x1="0" x2="420" y1="30" y2="30" />
        {path ? <path d={path} /> : null}
      </svg>
    </div>
  );
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) {
    return <EmptyState title="暂无告警" body="当前没有匹配的告警记录。" />;
  }
  return (
    <div className="alert-list">
      {alerts.map((alert) => (
        <article className={`alert-item ${alert.resolved_at ? "resolved" : ""}`} key={alert.id}>
          <div className={`alert-dot ${alert.level}`} />
          <div>
            <strong>{alert.node_name}</strong>
            <p>{alert.message}</p>
            <span>
              {alert.kind} / {formatTime(alert.opened_at)}
              {alert.resolved_at ? ` / 已解决 ${formatTime(alert.resolved_at)}` : ""}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function PanelHeading({ icon: Icon, title, detail }: { icon: typeof Activity; title: string; detail: string }) {
  return (
    <div className="panel-heading">
      <div className="heading-title">
        <Icon size={19} />
        <div>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: NodeStatus }) {
  return <span className={`status-badge ${status}`}>{statusText(status)}</span>;
}

function CountryBadge({ country }: { country: string | null | undefined }) {
  const label = countryLabel(country);
  return (
    <span className={`country-badge ${label === "未填写" ? "empty" : ""}`}>
      <span aria-hidden="true">{countryFlag(country)}</span>
      {label}
    </span>
  );
}

function Progress({ value, status }: { value: number | null; status: NodeStatus }) {
  const bounded = Math.max(0, Math.min(value || 0, 100));
  return (
    <div className={`progress ${status}`}>
      <span style={{ width: `${bounded}%` }} />
    </div>
  );
}

function MiniMeter({ label, value, text }: { label: string; value: number | null; text?: string }) {
  return (
    <div className="mini-meter">
      <span>{label}</span>
      <strong>{text || formatPercent(value)}</strong>
      <Progress value={value} status={value && value > 90 ? "warning" : "ok"} />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <WifiOff size={24} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}

function makeLinePath(values: number[], width: number, height: number) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 20 - ((value - min) / spread) * (height - 38);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function readStoredNumber(key: string, fallback: number) {
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "请求失败";
}

function sectionTitle(section: NavSection) {
  if (section === "nodes") return "节点";
  if (section === "alerts") return "告警";
  if (section === "settings") return "设置";
  return "监控概览";
}

function statusText(status: NodeStatus) {
  if (status === "ok") return "正常";
  if (status === "warning") return "预警";
  if (status === "critical") return "严重";
  if (status === "offline") return "离线";
  return "暂停";
}

function countryLabel(country: string | null | undefined) {
  const trimmed = (country || "").trim();
  return trimmed || "未填写";
}

function countryFlag(country: string | null | undefined) {
  const code = (country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "◇";
  return Array.from(code)
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 10) / 10}%`;
}

function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const digits = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatTime(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
