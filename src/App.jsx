import React, { useState, useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Plus,
  X,
  Pencil,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Activity,
  Radio,
  Terminal,
  Copy,
  Trash,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Config por defecto — plantillas de petición.
// Si los nombres de campo reales de la API no coinciden, edítalos desde
// "Configuración avanzada" en el formulario de cada proyecto: no hace falta
// tocar código.
// ---------------------------------------------------------------------------
const DEFAULT_LOGIN_TEMPLATE =
  '{"project":"{{proyecto}}","username":"{{usuario}}","password":"{{password}}"}';
const DEFAULT_REQUEST_LIST_TEMPLATE =
  '{"modifiedstatusfromutc":"{{fromDate}}","module":{{module}},"onlycount":false,"pagesize":50,"pageindex":{{pageIndex}}}';
const DEFAULT_ORDER_LIST_TEMPLATE =
  '{"modifiedfromutcdate":"{{fromDate}}","module":{{module}},"onlycount":false,"pagesize":50,"pageindex":{{pageIndex}}}';

const MODULES = [
  { id: 1, label: "Mantenimiento" },
  { id: 2, label: "Limpieza" },
  { id: 3, label: "Jardinería" },
];

const METRIC_META = [
  { key: "requestsCreated", label: "Solicitudes creadas", color: "#4FD8C4" },
  { key: "requestsModified", label: "Solicitudes modificadas", color: "#2FA69A" },
  { key: "ordersCreated", label: "Órdenes creadas", color: "#F2A65A" },
  { key: "ordersModified", label: "Órdenes modificadas", color: "#E0793C" },
];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    const safe = JSON.stringify(String(v ?? "")).slice(1, -1);
    out = out.split(`{{${k}}}`).join(safe);
  }
  return out;
}

function redactBody(bodyText) {
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object") {
      for (const k of Object.keys(parsed)) {
        if (/pass/i.test(k)) parsed[k] = "••••••";
      }
    }
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return bodyText;
  }
}

function snippet(text, max = 600) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "… (truncado)" : text;
}

function computeFromDateISO(period) {
  const now = new Date();
  const from = new Date(now);
  if (period === "week") from.setDate(now.getDate() - 7);
  else from.setMonth(now.getMonth() - 1);
  return from.toISOString().replace(/\.\d+Z$/, "");
}

function classify(items, fromDate, createdField, modifiedField) {
  let created = 0;
  let modified = 0;
  for (const it of items) {
    const c = it?.[createdField] ? new Date(it[createdField]) : null;
    const m = it?.[modifiedField] ? new Date(it[modifiedField]) : null;
    if (c && !isNaN(c) && c >= fromDate) created++;
    if (m && !isNaN(m) && m >= fromDate) modified++;
  }
  return { created, modified };
}


async function tracedFetch(onTrace, { label, url, method, headers, body }) {
  const startedAt = performance.now();
  const baseEntry = {
    id: uid(),
    time: new Date(),
    label,
    method,
    url,
    requestHeaders: headers,
    requestBody: body ? redactBody(body) : null,
  };
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    onTrace({
      ...baseEntry,
      ok: false,
      networkError: true,
      errorMessage: e.message || String(e),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw new Error(
      `${label}: fallo de red (posible CORS, DNS o servidor caído). Detalle del navegador: "${e.message}". Abre la consola de trazas para más detalle.`
    );
  }
  const durationMs = Math.round(performance.now() - startedAt);
  const clone = res.clone();
  let bodyText = "";
  try {
    bodyText = await clone.text();
  } catch (e) {
    bodyText = "(no se pudo leer el cuerpo de la respuesta)";
  }
  onTrace({
    ...baseEntry,
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    responseHeaders: Object.fromEntries(res.headers.entries()),
    responseBody: snippet(bodyText),
    durationMs,
  });
  return { res, bodyText };
}

const DEFAULT_PAGE_SIZE = 50;

async function fetchListItems(onTrace, { label, url, headers, template, fromISO, module, errorLabel }) {
  const items = [];
  let pageIndex = 0;

  while (true) {
    let bodyText;
    try {
      const filled = fillTemplate(template, {
        fromDate: fromISO,
        pageIndex: String(pageIndex),
        module: String(module),
      });
      bodyText = JSON.stringify(JSON.parse(filled));
    } catch (e) {
      throw new Error(
        `La plantilla de ${errorLabel} no es un JSON válido. Revísala en 'Configuración avanzada'.`
      );
    }

    const { res, bodyText: respText } = await tracedFetch(onTrace, {
      label: `${label} (página ${pageIndex + 1})`,
      url,
      method: "POST",
      headers,
      body: bodyText,
    });

    if (!res.ok) {
      throw new Error(`${label}: HTTP ${res.status} ${res.statusText}. Ver consola de trazas.`);
    }

    let data;
    try {
      data = JSON.parse(respText);
    } catch (e) {
      throw new Error(`La respuesta de ${label} no es JSON válido. Ver consola de trazas.`);
    }

    if (data?.success === false) {
      throw new Error(data?.error?.errormessages?.[0] || `Error desconocido en ${label}`);
    }

    const pageItems = data?.entity?.items || [];
    items.push(...pageItems);

    const total = data?.totalitemcount;
    const isLastPage =
      pageItems.length === 0 ||
      pageItems.length < DEFAULT_PAGE_SIZE ||
      (typeof total === "number" && items.length >= total);

    if (isLastPage) break;
    pageIndex++;
  }

  return items;
}

async function fetchProjectUsage(project, period, onTrace) {
  const base = project.baseUrl.replace(/\/+$/, "");
  const fromISO = computeFromDateISO(period);
  const fromDate = new Date(fromISO);

  let loginBodyText;
  try {
    const filled = fillTemplate(project.loginTemplate, {
      proyecto: project.projectCode,
      usuario: project.username,
      password: project.password,
    });
    loginBodyText = JSON.stringify(JSON.parse(filled));
  } catch (e) {
    throw new Error(
      "La plantilla de login no es un JSON válido. Revísala en 'Configuración avanzada'."
    );
  }

  const { res: loginRes, bodyText: loginBodyResponse } = await tracedFetch(onTrace, {
    label: "Login",
    url: `${base}/api/webapiloginservice/loginuser`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: loginBodyText,
  });

  if (!loginRes.ok) {
    throw new Error(
      `Login falló (HTTP ${loginRes.status} ${loginRes.statusText}). Revisa usuario/contraseña/código de proyecto, o los nombres de campo de la plantilla de login. Abre la consola de trazas para ver la respuesta exacta del servidor.`
    );
  }

  let token = loginBodyResponse;
  try {
    const parsed = JSON.parse(token);
    if (typeof parsed === "string") token = parsed;
    else if (parsed && typeof parsed === "object" && typeof parsed.entity === "string") {
      token = parsed.entity;
    }
  } catch (e) {
    /* ya era texto plano */
  }
  token = token.replace(/^"+|"+$/g, "").trim();
  if (!token) {
    throw new Error(
      "El login respondió HTTP 200 pero el cuerpo estaba vacío o no era un token utilizable. Mira la traza de Login para ver la respuesta cruda."
    );
  }

  const headers = {
    "Content-Type": "application/json",
    "x-manttest-loginid": token,
  };

  const byModule = {};
  const total = { requestsCreated: 0, requestsModified: 0, ordersCreated: 0, ordersModified: 0 };

  for (const module of MODULES) {
    const reqItems = await fetchListItems(onTrace, {
      label: `Solicitudes (RequestList) · ${module.label}`,
      url: `${base}/api/webapirequest/list`,
      headers,
      template: project.requestListTemplate,
      fromISO,
      module: module.id,
      errorLabel: `listado de solicitudes (${module.label})`,
    });
    const ordItems = await fetchListItems(onTrace, {
      label: `Órdenes (WorkorderList) · ${module.label}`,
      url: `${base}/api/webapiworkorder/list`,
      headers,
      template: project.orderListTemplate,
      fromISO,
      module: module.id,
      errorLabel: `listado de órdenes (${module.label})`,
    });

    const reqStats = classify(reqItems, fromDate, "localcreatefirstticketdate", "utcmodificationdate");
    const ordStats = classify(ordItems, fromDate, "localordertdate", "utcmodificationdate");

    const moduleResult = {
      requestsCreated: reqStats.created,
      requestsModified: reqStats.modified,
      ordersCreated: ordStats.created,
      ordersModified: ordStats.modified,
    };

    byModule[module.id] = moduleResult;
    total.requestsCreated += moduleResult.requestsCreated;
    total.requestsModified += moduleResult.requestsModified;
    total.ordersCreated += moduleResult.ordersCreated;
    total.ordersModified += moduleResult.ordersModified;
  }

  return { ...total, byModule };
}

const emptyForm = {
  id: null,
  name: "",
  baseUrl: "",
  projectCode: "",
  username: "",
  password: "",
  loginTemplate: DEFAULT_LOGIN_TEMPLATE,
  requestListTemplate: DEFAULT_REQUEST_LIST_TEMPLATE,
  orderListTemplate: DEFAULT_ORDER_LIST_TEMPLATE,
};

export default function ManttestUsageMonitor() {
  const [projects, setProjects] = useState([]);
  const [period, setPeriod] = useState("week");
  const [results, setResults] = useState({});
  const [status, setStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState({});

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(true);

  const [traces, setTraces] = useState([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [expandedTraceId, setExpandedTraceId] = useState(null);

  const addTrace = useCallback((projectName, entry) => {
    setTraces((prev) => [{ ...entry, projectName }, ...prev].slice(0, 100));
  }, []);

  const clearTraces = () => {
    setTraces([]);
    setExpandedTraceId(null);
  };

  const copyTraces = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(traces, null, 2));
    } catch (e) {
      /* silencioso: el portapapeles puede no estar disponible */
    }
  };

  const openNewForm = () => {
    setForm(emptyForm);
    setAdvancedOpen(false);
    setFormOpen(true);
  };

  const openEditForm = (p) => {
    setForm({ ...p });
    setAdvancedOpen(false);
    setFormOpen(true);
  };

  const closeForm = () => setFormOpen(false);

  const saveForm = () => {
    if (!form.name.trim() || !form.baseUrl.trim() || !form.projectCode.trim()) return;
    if (form.id) {
      setProjects((prev) => prev.map((p) => (p.id === form.id ? { ...form } : p)));
    } else {
      setProjects((prev) => [...prev, { ...form, id: uid() }]);
    }
    setFormOpen(false);
  };

  const removeProject = (id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setResults((prev) => {
      const c = { ...prev };
      delete c[id];
      return c;
    });
    setStatus((prev) => {
      const c = { ...prev };
      delete c[id];
      return c;
    });
    setErrors((prev) => {
      const c = { ...prev };
      delete c[id];
      return c;
    });
  };

  const fetchOne = useCallback(
    async (project, activePeriod) => {
      setStatus((prev) => ({ ...prev, [project.id]: "loading" }));
      setErrors((prev) => ({ ...prev, [project.id]: null }));
      try {
        const data = await fetchProjectUsage(project, activePeriod, (entry) =>
          addTrace(project.name, entry)
        );
        setResults((prev) => ({ ...prev, [project.id]: data }));
        setStatus((prev) => ({ ...prev, [project.id]: "success" }));
        setLastUpdated((prev) => ({ ...prev, [project.id]: new Date() }));
      } catch (e) {
        setStatus((prev) => ({ ...prev, [project.id]: "error" }));
        setErrors((prev) => ({ ...prev, [project.id]: e.message || "Error desconocido" }));
      }
    },
    [addTrace]
  );

  const fetchAll = useCallback(() => {
    projects.forEach((p) => fetchOne(p, period));
  }, [projects, period, fetchOne]);

  const chartData = useMemo(
    () =>
      projects.map((p) => {
        const r = results[p.id];
        return {
          name: p.name,
          requestsCreated: r?.requestsCreated ?? 0,
          requestsModified: r?.requestsModified ?? 0,
          ordersCreated: r?.ordersCreated ?? 0,
          ordersModified: r?.ordersModified ?? 0,
        };
      }),
    [projects, results]
  );

  const hasAnySuccess = Object.values(status).some((s) => s === "success");

  return (
    <div className="mum-root">
      <style>{`
        .mum-root {
          --bg: #10141b;
          --surface: #1a2029;
          --surface-alt: #212836;
          --border: #2b3342;
          --text: #edeff3;
          --text-dim: #939cac;
          --text-faint: #5c6577;
          --teal: #4fd8c4;
          --teal-dark: #2fa69a;
          --amber: #f2a65a;
          --amber-dark: #e0793c;
          --danger: #f2668b;
          --radius: 10px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--bg);
          color: var(--text);
          border-radius: 16px;
          padding: 28px;
          min-height: 100%;
          box-sizing: border-box;
        }
        .mum-root * { box-sizing: border-box; }
        .mum-mono {
          font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .mum-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .mum-title-block { display: flex; align-items: center; gap: 12px; }
        .mum-pulse-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: var(--teal);
          box-shadow: 0 0 0 0 rgba(79,216,196,0.6);
          animation: mum-pulse 2.4s infinite;
          flex-shrink: 0;
        }
        @keyframes mum-pulse {
          0% { box-shadow: 0 0 0 0 rgba(79,216,196,0.55); }
          70% { box-shadow: 0 0 0 9px rgba(79,216,196,0); }
          100% { box-shadow: 0 0 0 0 rgba(79,216,196,0); }
        }
        .mum-title {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0;
        }
        .mum-subtitle {
          font-size: 13px;
          color: var(--text-dim);
          margin: 2px 0 0 0;
        }
        .mum-eyebrow {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .mum-banner {
          background: var(--surface);
          border: 1px solid var(--border);
          border-left: 3px solid var(--amber);
          border-radius: var(--radius);
          padding: 12px 14px;
          font-size: 12.5px;
          color: var(--text-dim);
          display: flex;
          gap: 10px;
          align-items: flex-start;
          margin-bottom: 20px;
          line-height: 1.5;
        }
        .mum-banner-close {
          background: none; border: none; color: var(--text-faint);
          cursor: pointer; padding: 2px; margin-left: auto; flex-shrink: 0;
        }
        .mum-controls {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .mum-segmented {
          display: inline-flex;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 3px;
          gap: 2px;
        }
        .mum-seg-btn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          border: none;
          background: transparent;
          color: var(--text-dim);
          padding: 6px 14px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .mum-seg-btn.active {
          background: var(--surface-alt);
          color: var(--teal);
        }
        .mum-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
          border-radius: 8px;
          padding: 8px 14px;
          cursor: pointer;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text);
          transition: all 0.15s ease;
        }
        .mum-btn:hover { background: var(--surface-alt); border-color: #3a4356; }
        .mum-btn.primary {
          background: var(--teal);
          border-color: var(--teal);
          color: #0a1310;
          font-weight: 600;
        }
        .mum-btn.primary:hover { background: #63e0cd; }
        .mum-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .mum-btn.ghost { background: transparent; }
        .mum-btn.icon-only { padding: 8px; }

        .mum-empty {
          border: 1px dashed var(--border);
          border-radius: var(--radius);
          padding: 40px 20px;
          text-align: center;
          color: var(--text-dim);
          font-size: 13.5px;
        }

        .mum-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 14px;
          margin-bottom: 28px;
        }
        .mum-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 16px;
        }
        .mum-card-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }
        .mum-card-name { font-weight: 600; font-size: 14.5px; margin: 0; }
        .mum-card-url {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10.5px;
          color: var(--text-faint);
          margin: 2px 0 0 0;
          word-break: break-all;
        }
        .mum-card-actions { display: flex; gap: 4px; flex-shrink: 0; }
        .mum-icon-btn {
          background: transparent;
          border: none;
          color: var(--text-faint);
          cursor: pointer;
          padding: 4px;
          border-radius: 5px;
          display: flex;
        }
        .mum-icon-btn:hover { color: var(--text); background: var(--surface-alt); }

        .mum-status-row {
          display: flex; align-items: center; gap: 6px;
          font-size: 11.5px; color: var(--text-dim); margin-bottom: 12px;
        }

        .mum-pulse-strip {
          display: flex; align-items: flex-end; gap: 4px; height: 44px; margin-bottom: 12px;
        }
        .mum-pulse-bar {
          flex: 1;
          border-radius: 3px 3px 0 0;
          min-height: 3px;
          transition: height 0.4s ease;
        }

        .mum-metrics {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .mum-metric {
          background: var(--surface-alt);
          border-radius: 7px;
          padding: 8px 10px;
        }
        .mum-metric-value {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 18px;
          font-weight: 600;
          line-height: 1.1;
        }
        .mum-metric-label {
          font-size: 10px;
          color: var(--text-dim);
          margin-top: 2px;
        }
        .mum-module-table { margin-top: 10px; overflow-x: auto; }
        .mum-module-table table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        .mum-module-table th, .mum-module-table td {
          padding: 5px 6px; text-align: right; white-space: nowrap;
        }
        .mum-module-table th:first-child, .mum-module-table td:first-child { text-align: left; }
        .mum-module-table thead th {
          color: var(--text-faint); font-weight: 500; border-bottom: 1px solid var(--border);
        }
        .mum-module-table tbody td { color: var(--text-dim); }
        .mum-module-table tbody tr:not(:last-child) td { border-bottom: 1px solid #1c222c; }
        .mum-error-box {
          background: rgba(242,102,139,0.08);
          border: 1px solid rgba(242,102,139,0.35);
          color: var(--danger);
          font-size: 11.5px;
          border-radius: 7px;
          padding: 8px 10px;
          line-height: 1.4;
        }

        .mum-chart-section {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 20px;
        }
        .mum-chart-title { font-size: 14px; font-weight: 600; margin: 0 0 4px 0; }
        .mum-chart-sub { font-size: 12px; color: var(--text-dim); margin: 0 0 16px 0; }

        .mum-overlay {
          position: fixed; inset: 0;
          background: rgba(6,8,11,0.7);
          display: flex; align-items: center; justify-content: center;
          z-index: 50; padding: 20px;
        }
        .mum-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          width: 100%; max-width: 480px;
          max-height: 90vh;
          overflow-y: auto;
          padding: 22px;
        }
        .mum-modal-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .mum-modal-title { font-size: 16px; font-weight: 600; margin: 0; }
        .mum-field { margin-bottom: 12px; }
        .mum-label {
          display: block; font-size: 11.5px; color: var(--text-dim);
          margin-bottom: 5px; font-weight: 500;
        }
        .mum-input {
          width: 100%;
          background: var(--surface-alt);
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 9px 10px;
          color: var(--text);
          font-size: 13px;
          font-family: inherit;
        }
        .mum-input:focus { outline: none; border-color: var(--teal); }
        .mum-textarea {
          width: 100%;
          background: var(--surface-alt);
          border: 1px solid var(--border);
          border-radius: 7px;
          padding: 9px 10px;
          color: var(--text);
          font-size: 11.5px;
          font-family: 'IBM Plex Mono', monospace;
          resize: vertical;
          min-height: 56px;
        }
        .mum-advanced-toggle {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: var(--text-dim);
          background: none; border: none; cursor: pointer;
          padding: 6px 0; margin-bottom: 4px;
        }
        .mum-hint { font-size: 10.5px; color: var(--text-faint); margin-top: 4px; line-height: 1.4; }
        .mum-modal-actions {
          display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;
        }
        .mum-footer-note {
          font-size: 11px; color: var(--text-faint); margin-top: 18px; text-align: center;
        }

        .mum-btn.small { padding: 5px 9px; font-size: 11.5px; }

        .mum-console {
          background: #0c0f14;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          margin-bottom: 20px;
          overflow: hidden;
        }
        .mum-console-head {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          background: var(--surface);
        }
        .mum-console-title {
          display: flex; align-items: center; gap: 6px;
          font-size: 12.5px; font-weight: 600; color: var(--text-dim);
        }
        .mum-console-empty {
          padding: 24px; text-align: center; font-size: 12px; color: var(--text-faint);
          line-height: 1.5;
        }
        .mum-console-list {
          max-height: 420px;
          overflow-y: auto;
        }
        .mum-trace-item { border-bottom: 1px solid #1c222c; }
        .mum-trace-item:last-child { border-bottom: none; }
        .mum-trace-row {
          width: 100%;
          display: flex; align-items: center; gap: 10px;
          padding: 9px 14px;
          background: none; border: none; cursor: pointer;
          color: var(--text);
          text-align: left;
        }
        .mum-trace-row:hover { background: var(--surface); }
        .mum-trace-badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          border: 1px solid;
          border-radius: 4px;
          padding: 1px 5px;
          flex-shrink: 0;
        }
        .mum-trace-label { font-size: 12.5px; font-weight: 500; flex-shrink: 0; }
        .mum-trace-project {
          font-size: 11px; color: var(--text-faint);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .mum-trace-method { font-size: 10.5px; color: var(--text-dim); flex-shrink: 0; }
        .mum-trace-time {
          font-size: 10.5px; color: var(--text-faint);
          margin-left: auto; flex-shrink: 0;
        }
        .mum-trace-detail {
          padding: 4px 14px 14px 14px;
          background: #0a0d12;
        }
        .mum-trace-detail-row { margin-top: 8px; }
        .mum-trace-detail-key {
          display: block;
          font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--text-faint); margin-bottom: 4px;
        }
        .mum-trace-detail-val {
          font-size: 11.5px; color: var(--text-dim); word-break: break-all;
        }
        .mum-trace-pre {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: var(--text-dim);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 8px 10px;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 220px;
          overflow-y: auto;
        }
      `}</style>

      {/* Header */}
      <div className="mum-header">
        <div className="mum-title-block">
          <span className="mum-pulse-dot" />
          <div>
            <div className="mum-eyebrow">manttest · uso multiproyecto</div>
            <h1 className="mum-title">Monitor de uso</h1>
            <p className="mum-subtitle">
              Solicitudes y órdenes creadas/modificadas por proyecto
            </p>
          </div>
        </div>
      </div>

      {bannerOpen && (
        <div className="mum-banner">
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: "var(--amber)" }} />
          <div>
            Las peticiones salen directamente desde tu navegador hacia cada servidor manttest.
            Si el servidor no permite CORS desde este origen, las llamadas fallarán con un
            error de red — en ese caso, contacta con quien administre manttest para habilitarlo.
            Las credenciales solo viven en esta sesión: no se guardan en ningún sitio.
          </div>
          <button className="mum-banner-close" onClick={() => setBannerOpen(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="mum-controls">
        <div className="mum-segmented">
          <button
            className={`mum-seg-btn ${period === "week" ? "active" : ""}`}
            onClick={() => setPeriod("week")}
          >
            Última semana
          </button>
          <button
            className={`mum-seg-btn ${period === "month" ? "active" : ""}`}
            onClick={() => setPeriod("month")}
          >
            Último mes
          </button>
        </div>

        <button className="mum-btn primary" onClick={fetchAll} disabled={projects.length === 0}>
          <RefreshCw size={14} /> Actualizar todos
        </button>

        <button className="mum-btn" onClick={openNewForm}>
          <Plus size={14} /> Añadir proyecto
        </button>

        <button
          className="mum-btn ghost"
          style={{ marginLeft: "auto" }}
          onClick={() => setConsoleOpen(!consoleOpen)}
        >
          <Terminal size={14} /> Consola de trazas {traces.length > 0 ? `(${traces.length})` : ""}
        </button>
      </div>

      {consoleOpen && (
        <div className="mum-console">
          <div className="mum-console-head">
            <span className="mum-console-title">
              <Terminal size={13} /> Trazas de peticiones
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="mum-btn ghost small" onClick={copyTraces} disabled={traces.length === 0}>
                <Copy size={12} /> Copiar todo
              </button>
              <button className="mum-btn ghost small" onClick={clearTraces} disabled={traces.length === 0}>
                <Trash size={12} /> Limpiar
              </button>
            </div>
          </div>

          {traces.length === 0 ? (
            <div className="mum-console-empty">
              Aún no hay trazas. Pulsa "Actualizar" en un proyecto y aparecerá aquí el detalle
              de cada petición (login, solicitudes, órdenes): URL, cabeceras, cuerpo enviado y
              respuesta del servidor.
            </div>
          ) : (
            <div className="mum-console-list">
              {traces.map((t) => {
                const isOpen = expandedTraceId === t.id;
                const badgeColor = t.networkError
                  ? "var(--danger)"
                  : t.ok
                  ? "var(--teal)"
                  : "var(--danger)";
                const badgeText = t.networkError ? "RED/CORS" : t.status ?? "?";
                return (
                  <div className="mum-trace-item" key={t.id}>
                    <button
                      className="mum-trace-row"
                      onClick={() => setExpandedTraceId(isOpen ? null : t.id)}
                    >
                      <span className="mum-trace-badge" style={{ color: badgeColor, borderColor: badgeColor }}>
                        {badgeText}
                      </span>
                      <span className="mum-trace-label">{t.label}</span>
                      <span className="mum-trace-project">{t.projectName}</span>
                      <span className="mum-trace-method mum-mono">{t.method}</span>
                      <span className="mum-trace-time mum-mono">
                        {t.time.toLocaleTimeString("es-ES")} · {t.durationMs}ms
                      </span>
                      {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                    {isOpen && (
                      <div className="mum-trace-detail">
                        <div className="mum-trace-detail-row">
                          <span className="mum-trace-detail-key">URL</span>
                          <span className="mum-mono mum-trace-detail-val">{t.url}</span>
                        </div>
                        {t.networkError && (
                          <div className="mum-trace-detail-row">
                            <span className="mum-trace-detail-key">Error del navegador</span>
                            <span className="mum-mono mum-trace-detail-val" style={{ color: "var(--danger)" }}>
                              {t.errorMessage}
                            </span>
                          </div>
                        )}
                        {t.requestHeaders && (
                          <div className="mum-trace-detail-row">
                            <span className="mum-trace-detail-key">Cabeceras enviadas</span>
                            <pre className="mum-trace-pre">{JSON.stringify(t.requestHeaders, null, 2)}</pre>
                          </div>
                        )}
                        {t.requestBody && (
                          <div className="mum-trace-detail-row">
                            <span className="mum-trace-detail-key">Cuerpo enviado</span>
                            <pre className="mum-trace-pre">{t.requestBody}</pre>
                          </div>
                        )}
                        {t.responseHeaders && (
                          <div className="mum-trace-detail-row">
                            <span className="mum-trace-detail-key">Cabeceras de respuesta</span>
                            <pre className="mum-trace-pre">{JSON.stringify(t.responseHeaders, null, 2)}</pre>
                          </div>
                        )}
                        {t.responseBody !== undefined && (
                          <div className="mum-trace-detail-row">
                            <span className="mum-trace-detail-key">Cuerpo de respuesta</span>
                            <pre className="mum-trace-pre">{t.responseBody || "(vacío)"}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Project cards */}
      {projects.length === 0 ? (
        <div className="mum-empty">
          Todavía no hay proyectos monitorizados. Añade el primero con la URL base de la API,
          el código de proyecto y las credenciales.
        </div>
      ) : (
        <div className="mum-grid">
          {projects.map((p) => {
            const r = results[p.id];
            const st = status[p.id] || "idle";
            const err = errors[p.id];
            const maxVal = r
              ? Math.max(1, r.requestsCreated, r.requestsModified, r.ordersCreated, r.ordersModified)
              : 1;
            return (
              <div className="mum-card" key={p.id}>
                <div className="mum-card-head">
                  <div>
                    <p className="mum-card-name">{p.name}</p>
                    <p className="mum-card-url">{p.baseUrl}</p>
                  </div>
                  <div className="mum-card-actions">
                    <button className="mum-icon-btn" onClick={() => fetchOne(p, period)} title="Actualizar">
                      {st === "loading" ? (
                        <Loader2 size={14} className="mum-spin" style={{ animation: "spin 0.8s linear infinite" }} />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </button>
                    <button className="mum-icon-btn" onClick={() => openEditForm(p)} title="Editar">
                      <Pencil size={14} />
                    </button>
                    <button className="mum-icon-btn" onClick={() => removeProject(p.id)} title="Eliminar">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="mum-status-row">
                  {st === "success" && <CheckCircle2 size={12} style={{ color: "var(--teal)" }} />}
                  {st === "error" && <AlertTriangle size={12} style={{ color: "var(--danger)" }} />}
                  {st === "loading" && <Radio size={12} style={{ color: "var(--amber)" }} />}
                  <span className="mum-mono">
                    {st === "idle" && "Sin datos todavía"}
                    {st === "loading" && "Consultando…"}
                    {st === "success" &&
                      `Actualizado ${lastUpdated[p.id]?.toLocaleTimeString("es-ES", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`}
                    {st === "error" && "Error en la consulta"}
                  </span>
                </div>

                {st === "error" && err && <div className="mum-error-box">{err}</div>}

                {r && st !== "error" && (
                  <>
                    <div className="mum-pulse-strip">
                      {METRIC_META.map((m) => (
                        <div
                          key={m.key}
                          className="mum-pulse-bar"
                          style={{
                            height: `${Math.max(6, (r[m.key] / maxVal) * 44)}px`,
                            background: m.color,
                          }}
                          title={`${m.label}: ${r[m.key]}`}
                        />
                      ))}
                    </div>
                    <div className="mum-metrics">
                      {METRIC_META.map((m) => (
                        <div className="mum-metric" key={m.key}>
                          <div className="mum-metric-value" style={{ color: m.color }}>
                            {r[m.key]}
                          </div>
                          <div className="mum-metric-label">{m.label}</div>
                        </div>
                      ))}
                    </div>

                    {r.byModule && (
                      <div className="mum-module-table">
                        <table>
                          <thead>
                            <tr>
                              <th>Módulo</th>
                              <th>Sol. creadas</th>
                              <th>Sol. modificadas</th>
                              <th>Órd. creadas</th>
                              <th>Órd. modificadas</th>
                            </tr>
                          </thead>
                          <tbody>
                            {MODULES.map((module) => {
                              const mr = r.byModule[module.id];
                              return (
                                <tr key={module.id}>
                                  <td>{module.label}</td>
                                  <td>{mr?.requestsCreated ?? 0}</td>
                                  <td>{mr?.requestsModified ?? 0}</td>
                                  <td>{mr?.ordersCreated ?? 0}</td>
                                  <td>{mr?.ordersModified ?? 0}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Comparison chart */}
      {hasAnySuccess && (
        <div className="mum-chart-section">
          <p className="mum-chart-title">Comparativa entre proyectos</p>
          <p className="mum-chart-sub">
            {period === "week" ? "Última semana" : "Último mes"} · creadas vs. modificadas
          </p>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3342" />
              <XAxis dataKey="name" stroke="#939cac" fontSize={12} />
              <YAxis stroke="#939cac" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "#1a2029",
                  border: "1px solid #2b3342",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "#edeff3" }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {METRIC_META.map((m) => (
                <Bar key={m.key} dataKey={m.key} name={m.label} fill={m.color} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="mum-footer-note">
        Los datos viven solo en esta sesión del navegador — al recargar tendrás que añadir los
        proyectos de nuevo.
      </p>

      {/* Modal form */}
      {formOpen && (
        <div className="mum-overlay" onClick={closeForm}>
          <div className="mum-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mum-modal-head">
              <p className="mum-modal-title">{form.id ? "Editar proyecto" : "Añadir proyecto"}</p>
              <button className="mum-icon-btn" onClick={closeForm}>
                <X size={16} />
              </button>
            </div>

            <div className="mum-field">
              <label className="mum-label">Nombre del proyecto</label>
              <input
                className="mum-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Cliente Norte"
              />
            </div>

            <div className="mum-field">
              <label className="mum-label">URL base de la API</label>
              <input
                className="mum-input"
                value={form.baseUrl}
                onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                placeholder="https://saas.manttest.net/MTW_xxxx"
              />
            </div>

            <div className="mum-field">
              <label className="mum-label">Código de proyecto</label>
              <input
                className="mum-input"
                value={form.projectCode}
                onChange={(e) => setForm({ ...form, projectCode: e.target.value })}
              />
            </div>

            <div className="mum-field">
              <label className="mum-label">Usuario</label>
              <input
                className="mum-input"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>

            <div className="mum-field">
              <label className="mum-label">Contraseña</label>
              <input
                className="mum-input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <button className="mum-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
              {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              Configuración avanzada (plantillas de petición)
            </button>

            {advancedOpen && (
              <>
                <div className="mum-field">
                  <label className="mum-label">Plantilla del body de login</label>
                  <textarea
                    className="mum-textarea"
                    value={form.loginTemplate}
                    onChange={(e) => setForm({ ...form, loginTemplate: e.target.value })}
                  />
                  <p className="mum-hint">
                    Placeholders disponibles: {"{{proyecto}}"}, {"{{usuario}}"}, {"{{password}}"}.
                    Ajusta los nombres de los campos JSON si no coinciden con tu API.
                  </p>
                </div>
                <div className="mum-field">
                  <label className="mum-label">Plantilla del body de listado (solicitudes)</label>
                  <textarea
                    className="mum-textarea"
                    value={form.requestListTemplate}
                    onChange={(e) => setForm({ ...form, requestListTemplate: e.target.value })}
                  />
                  <p className="mum-hint">
                    Placeholders disponibles: {"{{fromDate}}"} (fecha ISO en UTC calculada según el
                    periodo seleccionado), {"{{pageIndex}}"} (número de página, empezando en 0; la
                    app recorre todas las páginas automáticamente) y {"{{module}}"} (la app hace una
                    llamada independiente por cada módulo: 1, 2 y 3).
                  </p>
                </div>
                <div className="mum-field">
                  <label className="mum-label">Plantilla del body de listado (órdenes)</label>
                  <textarea
                    className="mum-textarea"
                    value={form.orderListTemplate}
                    onChange={(e) => setForm({ ...form, orderListTemplate: e.target.value })}
                  />
                  <p className="mum-hint">
                    Placeholders disponibles: {"{{fromDate}}"} (fecha ISO en UTC calculada según el
                    periodo seleccionado), {"{{pageIndex}}"} (número de página, empezando en 0; la
                    app recorre todas las páginas automáticamente) y {"{{module}}"} (la app hace una
                    llamada independiente por cada módulo: 1, 2 y 3).
                  </p>
                </div>
              </>
            )}

            <div className="mum-modal-actions">
              <button className="mum-btn ghost" onClick={closeForm}>
                Cancelar
              </button>
              <button className="mum-btn primary" onClick={saveForm}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
