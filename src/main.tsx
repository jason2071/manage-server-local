import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import "./styles.css";

type Runtime = "node" | "python" | "other";
type Status = "running" | "stopped" | "error";

type ServerProfile = {
  id: string;
  name: string;
  runtime: Runtime;
  workingDirectory: string;
  command: string;
  arguments: string[];
  healthUrl?: string;
  environment: Record<string, string>;
};

type ServerView = {
  profile: ServerProfile;
  status: Status;
  pid?: number;
  detail?: string;
};

type HealthResult = { healthy: boolean; message: string };
type NodeScript = { name: string; command: string };
type PythonPreset = { name: string; command: string; arguments: string[]; healthUrl?: string };

const blankProfile = (): ServerProfile => ({
  id: "",
  name: "",
  runtime: "node",
  workingDirectory: "",
  command: "npm",
  arguments: ["run", "dev"],
  healthUrl: "",
  environment: {},
});

function splitArguments(value: string) {
  return value.trim() ? value.trim().split(/\s+/) : [];
}

function App() {
  const [servers, setServers] = useState<ServerView[]>([]);
  const [editing, setEditing] = useState<ServerProfile | null>(null);
  const [logsFor, setLogsFor] = useState<ServerView | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<ServerView | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const loadServers = async () => {
    try {
      setServers(await invoke<ServerView[]>("list_servers"));
    } catch (error) {
      setNotice(`เปิดรายการ server ไม่สำเร็จ: ${String(error)}`);
    }
  };

  useEffect(() => {
    void loadServers();
    const interval = window.setInterval(() => void loadServers(), 2500);
    return () => window.clearInterval(interval);
  }, []);

  const checkForUpdate = async (showNoUpdate = true) => {
    try {
      const update = await check();
      if (!update?.available) {
        if (showNoUpdate) setNotice("คุณกำลังใช้ Server Nest เวอร์ชันล่าสุดแล้ว");
        return;
      }
      setAvailableUpdate(update.version);
      if (showNoUpdate) setNotice(`พบ Server Nest เวอร์ชัน ${update.version}`);
    } catch (error) {
      if (showNoUpdate) setNotice(`ตรวจสอบ update ไม่สำเร็จ: ${String(error)}`);
    }
  };

  const installUpdate = async () => {
    setUpdating(true);
    try {
      const update = await check();
      if (!update?.available) {
        setAvailableUpdate(null);
        setNotice("คุณกำลังใช้ Server Nest เวอร์ชันล่าสุดแล้ว");
        return;
      }
      setNotice(`กำลังดาวน์โหลดและติดตั้งเวอร์ชัน ${update.version}…`);
      await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      setNotice(`ติดตั้ง update ไม่สำเร็จ: ${String(error)}`);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    void checkForUpdate(false);
  }, []);

  const runAction = async (id: string, action: "start" | "stop" | "restart") => {
    setBusy(`${action}:${id}`);
    try {
      await invoke(`${action}_server`, { id });
      setNotice(action === "start" ? "เริ่ม server แล้ว" : action === "stop" ? "หยุด server แล้ว" : "รีสตาร์ต server แล้ว");
      await loadServers();
    } catch (error) {
      setNotice(`ทำรายการไม่สำเร็จ: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const testHealth = async (server: ServerView) => {
    if (!server.profile.healthUrl) {
      setNotice("ยังไม่ได้กำหนด URL สำหรับตรวจสอบ");
      return;
    }
    setBusy(`health:${server.profile.id}`);
    try {
      const result = await invoke<HealthResult>("health_check", { id: server.profile.id });
      setNotice(result.message);
    } catch (error) {
      setNotice(`ตรวจสอบ URL ไม่สำเร็จ: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const openInBrowser = async (server: ServerView) => {
    if (!server.profile.healthUrl) return;
    try {
      await openUrl(server.profile.healthUrl);
    } catch (error) {
      setNotice(`เปิดเบราว์เซอร์ไม่สำเร็จ: ${String(error)}`);
    }
  };

  const showLogs = async (server: ServerView) => {
    setLogsFor(server);
    try {
      setLogs(await invoke<string[]>("get_logs", { id: server.profile.id }));
    } catch (error) {
      setLogs([`อ่าน log ไม่สำเร็จ: ${String(error)}`]);
    }
  };

  const removeServer = async () => {
    const server = deleteTarget;
    if (!server) return;
    setBusy(`delete:${server.profile.id}`);
    try {
      await invoke("delete_server", { id: server.profile.id });
      setDeleteTarget(null);
      setNotice("ลบ server แล้ว");
      await loadServers();
    } catch (error) {
      setNotice(`ลบไม่สำเร็จ: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const running = servers.filter((server) => server.status === "running").length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◈</span><span>Server Nest</span></div>
        <nav><button className="nav-item active">▦ <span>เซิร์ฟเวอร์</span><b>{servers.length}</b></button></nav>
        <div className="sidebar-tip"><span>●</span><div><strong>ทำงานเบื้องหลัง</strong><small>กด X เพื่อซ่อนลง tray</small></div></div>
      </aside>

      <section className="content">
        <header>
          <div><p className="eyebrow">LOCAL PROCESS MANAGER</p><h1>เซิร์ฟเวอร์ของคุณ</h1><p className="subtitle">ควบคุม Node, Python และคำสั่งอื่น ๆ จากที่เดียว</p></div>
          <div className="header-actions"><button className="secondary update-button" disabled={updating} onClick={() => void (availableUpdate ? installUpdate() : checkForUpdate())}>{updating ? "กำลังอัปเดต…" : availableUpdate ? `อัปเดต v${availableUpdate}` : "ตรวจ update"}</button><button className="primary" onClick={() => setEditing(blankProfile())}>+ เพิ่มเซิร์ฟเวอร์</button></div>
        </header>

        <div className="summary-row">
          <div className="summary-card"><span className="dot running" /><div><small>กำลังทำงาน</small><strong>{running}</strong></div></div>
          <div className="summary-card"><span className="dot muted" /><div><small>ทั้งหมด</small><strong>{servers.length}</strong></div></div>
          <p className="tray-note">ปิดหน้าต่างเพื่อซ่อนแอปได้ server จะยังรันอยู่</p>
        </div>

        {notice && <div className="notice"><span>i</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

        <section className="server-list">
          {servers.length === 0 ? <EmptyState onAdd={() => setEditing(blankProfile())} /> : <><div className="server-table-head" role="row"><span>เซิร์ฟเวอร์</span><span>คำสั่ง</span><span className="table-directory">โฟลเดอร์</span><span>URL</span><span className="table-actions">จัดการ</span></div>{servers.map((server) => (
            <ServerCard key={server.profile.id} server={server} busy={busy} onAction={runAction} onTest={testHealth} onOpen={openInBrowser} onLogs={showLogs} onEdit={() => setEditing(server.profile)} onDelete={() => setDeleteTarget(server)} />
          ))}</>}
        </section>
      </section>

      {editing && <ServerDialog profile={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice("บันทึกการตั้งค่าแล้ว"); await loadServers(); }} />}
      {logsFor && <LogDialog server={logsFor} logs={logs} onClose={() => setLogsFor(null)} onRefresh={() => void showLogs(logsFor)} />}
      {deleteTarget && <DeleteConfirmDialog server={deleteTarget} deleting={busy === `delete:${deleteTarget.profile.id}`} onClose={() => setDeleteTarget(null)} onConfirm={() => void removeServer()} />}
    </main>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><div className="empty-icon">◈</div><h2>ยังไม่มีเซิร์ฟเวอร์</h2><p>เพิ่มโปรเจกต์ Node หรือ Python เพื่อเริ่มควบคุมจากแอปนี้</p><button className="primary" onClick={onAdd}>+ เพิ่มเซิร์ฟเวอร์แรก</button></div>;
}

function ServerCard({ server, busy, onAction, onTest, onOpen, onLogs, onEdit, onDelete }: { server: ServerView; busy: string | null; onAction: (id: string, action: "start" | "stop" | "restart") => void; onTest: (server: ServerView) => void; onOpen: (server: ServerView) => void; onLogs: (server: ServerView) => void; onEdit: () => void; onDelete: () => void }) {
  const { profile, status, pid, detail } = server;
  const pending = (action: string) => busy === `${action}:${profile.id}`;
  const healthLabel = profile.healthUrl?.replace(/^https?:\/\//, "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusLabel = status === "running" ? "กำลังทำงาน" : status === "error" ? "ผิดพลาด" : "หยุดอยู่";

  useEffect(() => {
    if (!menuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [menuOpen]);

  const runFromMenu = (action: () => void) => {
    action();
    setMenuOpen(false);
  };

  return <article className="server-card">
    <div className="server-identity"><div className={`runtime-icon ${profile.runtime}`}>{profile.runtime === "node" ? "JS" : profile.runtime === "python" ? "PY" : "⌘"}</div><div><div className="server-title"><h2 title={profile.name}>{profile.name}</h2><span className={`status ${status}`}><i />{statusLabel}</span></div>{detail && <p className="detail" title={detail}>{detail}</p>}</div></div>
    <p className="command" title={`${profile.command} ${profile.arguments.join(" ")}`}><code>{profile.command} {profile.arguments.join(" ")}</code></p>
    <p className="location server-directory" title={profile.workingDirectory}>⌁ {profile.workingDirectory}</p>
    <div className="server-endpoint">{profile.healthUrl ? <button type="button" className="health-link" title={`เปิด ${profile.healthUrl}`} onClick={() => onOpen(server)}>↗ {healthLabel}</button> : <span>—</span>}</div>
    <div className="card-actions">
      {status === "running" ? <button className="action stop" disabled={pending("stop")} onClick={() => onAction(profile.id, "stop")}>{pending("stop") ? "…" : "■ หยุด"}</button> : <button className="action start" disabled={pending("start")} onClick={() => onAction(profile.id, "start")}>{pending("start") ? "…" : "▶ เริ่ม"}</button>}
      <div className="action-menu" ref={menuRef}><button className="icon-button menu-trigger" aria-label={`เมนู ${profile.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>⋮</button>{menuOpen && <div className="overflow-menu" role="menu">
        {profile.healthUrl && <><button role="menuitem" onClick={() => runFromMenu(() => onOpen(server))}>↗ เปิดในเบราว์เซอร์</button><button role="menuitem" disabled={pending("health")} onClick={() => runFromMenu(() => onTest(server))}>⌁ ตรวจ URL</button></>}
        <button role="menuitem" onClick={() => runFromMenu(() => onLogs(server))}>≡ ดู log</button>
        <button role="menuitem" disabled={pending("restart")} onClick={() => runFromMenu(() => onAction(profile.id, "restart"))}>↻ รีสตาร์ต</button>
        <span className="menu-divider" />
        <button role="menuitem" onClick={() => runFromMenu(onEdit)}>✎ แก้ไข</button>
        <button role="menuitem" className="menu-danger" disabled={pending("delete")} onClick={() => runFromMenu(onDelete)}>× ลบเซิร์ฟเวอร์</button>
      </div>}</div>
    </div>
  </article>;
}

function DeleteConfirmDialog({ server, deleting, onClose, onConfirm }: { server: ServerView; deleting: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop" role="presentation"><section className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
    <div className="dialog-heading"><div><p className="eyebrow">DELETE SERVER</p><h2 id="delete-title">ลบเซิร์ฟเวอร์นี้?</h2></div><button className="close" disabled={deleting} onClick={onClose}>×</button></div>
    <p>“{server.profile.name}” จะถูกลบออกจากรายการ และหากกำลังทำงานอยู่ process จะถูกหยุดด้วย</p>
    <div className="dialog-actions"><button className="secondary" disabled={deleting} onClick={onClose}>ยกเลิก</button><button className="action stop" disabled={deleting} onClick={onConfirm}>{deleting ? "กำลังลบ…" : "ลบเซิร์ฟเวอร์"}</button></div>
  </section></div>;
}

function ServerDialog({ profile, onClose, onSaved }: { profile: ServerProfile; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const [args, setArgs] = useState(profile.arguments.join(" "));
  const [environment, setEnvironment] = useState(Object.entries(profile.environment).map(([key, value]) => `${key}=${value}`).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [nodeScripts, setNodeScripts] = useState<NodeScript[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [pythonPresets, setPythonPresets] = useState<PythonPreset[]>([]);
  const [loadingPython, setLoadingPython] = useState(false);
  const title = profile.id ? "แก้ไขเซิร์ฟเวอร์" : "เพิ่มเซิร์ฟเวอร์";

  const loadNodeScripts = async (directory = draft.workingDirectory) => {
    if (!directory.trim()) return;
    setLoadingScripts(true);
    try {
      setNodeScripts(await invoke<NodeScript[]>("get_node_scripts", { workingDirectory: directory }));
    } catch {
      setNodeScripts([]);
    } finally {
      setLoadingScripts(false);
    }
  };

  const loadPythonPresets = async (directory = draft.workingDirectory) => {
    if (!directory.trim()) return;
    setLoadingPython(true);
    try {
      setPythonPresets(await invoke<PythonPreset[]>("get_python_presets", { workingDirectory: directory }));
    } catch {
      setPythonPresets([]);
    } finally {
      setLoadingPython(false);
    }
  };

  useEffect(() => {
    if (profile.runtime === "node" && profile.workingDirectory) void loadNodeScripts(profile.workingDirectory);
    if (profile.runtime === "python" && profile.workingDirectory) void loadPythonPresets(profile.workingDirectory);
  }, []);

  const chooseFolder = async () => {
    const selected = await open({
      title: "เลือกโฟลเดอร์โปรเจกต์",
      directory: true,
      multiple: false,
      defaultPath: draft.workingDirectory || undefined,
    });
    if (!selected || Array.isArray(selected)) return;
    setDraft((current) => ({ ...current, workingDirectory: selected }));
    if (draft.runtime === "node") void loadNodeScripts(selected);
    if (draft.runtime === "python") void loadPythonPresets(selected);
  };

  const changeRuntime = (runtime: Runtime) => {
    const presets: Record<Runtime, [string, string]> = { node: ["npm", "run dev"], python: ["python", ""], other: ["", ""] };
    setDraft({ ...draft, runtime, command: presets[runtime][0] });
    setArgs(presets[runtime][1]);
    if (runtime === "python" && draft.workingDirectory) void loadPythonPresets(draft.workingDirectory);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const env = Object.fromEntries(environment.split(/\r?\n/).filter(Boolean).map((line) => { const index = line.indexOf("="); return index === -1 ? [line.trim(), ""] : [line.slice(0, index).trim(), line.slice(index + 1)]; }));
    try { await invoke("save_server", { profile: { ...draft, arguments: splitArguments(args), environment: env, healthUrl: draft.healthUrl || null } }); await onSaved(); } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}><form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">SERVER PROFILE</p><h2>{title}</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>
    <label>ชื่อที่แสดง<input required autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="เช่น My API" /></label>
    <div><span className="label-title">Runtime</span><div className="runtime-tabs">{(["node", "python", "other"] as Runtime[]).map((runtime) => <button type="button" key={runtime} className={draft.runtime === runtime ? "selected" : ""} onClick={() => changeRuntime(runtime)}>{runtime === "node" ? "Node.js" : runtime === "python" ? "Python" : "คำสั่งอื่น"}</button>)}</div></div>
    <label>โฟลเดอร์โปรเจกต์<div className="path-picker"><input required value={draft.workingDirectory} onChange={(e) => setDraft({ ...draft, workingDirectory: e.target.value })} placeholder="D:\\work\\my-api" /><button type="button" className="browse-button" onClick={() => void chooseFolder()}>เลือกโฟลเดอร์…</button></div></label>
    {draft.runtime === "node" && <div className="node-scripts"><div className="script-heading"><span>คำสั่งจาก package.json</span><button type="button" className="scan-button" disabled={loadingScripts || !draft.workingDirectory} onClick={() => void loadNodeScripts()}>{loadingScripts ? "กำลังอ่าน…" : "↻ อ่านใหม่"}</button></div>{nodeScripts.length > 0 ? <div className="script-list">{nodeScripts.map((script) => <button type="button" key={script.name} title={script.command} onClick={() => { setDraft({ ...draft, command: "npm" }); setArgs(`run ${script.name}`); }}>npm run {script.name}</button>)}</div> : <small>{draft.workingDirectory ? "ไม่พบ scripts ใน package.json หรือโฟลเดอร์นี้ไม่ใช่ Node project" : "เลือกโฟลเดอร์เพื่ออ่าน scripts อัตโนมัติ"}</small>}</div>}
    {draft.runtime === "python" && <div className="node-scripts"><div className="script-heading"><span>คำสั่ง Python ที่แนะนำ</span><button type="button" className="scan-button" disabled={loadingPython || !draft.workingDirectory} onClick={() => void loadPythonPresets()}>{loadingPython ? "กำลังตรวจ…" : "↻ ตรวจโปรเจกต์"}</button></div>{pythonPresets.length > 0 ? <div className="script-list">{pythonPresets.map((preset) => <button type="button" key={preset.name} onClick={() => { setDraft({ ...draft, command: preset.command, healthUrl: preset.healthUrl ?? "" }); setArgs(preset.arguments.join(" ")); }}>{preset.name}</button>)}</div> : <small>{draft.workingDirectory ? "ไม่พบ entry point ของ Python ในโฟลเดอร์นี้" : "เลือกโฟลเดอร์เพื่อหา virtual environment และคำสั่งรัน"}</small>}</div>}
    <div className="two-col"><label>คำสั่ง<input required value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="npm" /></label><label>อาร์กิวเมนต์<input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="run dev" /></label></div>
    <label>URL สำหรับตรวจสอบ <em>(ไม่บังคับ)</em><input type="url" value={draft.healthUrl ?? ""} onChange={(e) => setDraft({ ...draft, healthUrl: e.target.value })} placeholder="http://127.0.0.1:3000" /></label>
    <label>Environment variables <em>(หนึ่งรายการต่อบรรทัด)</em><textarea value={environment} onChange={(e) => setEnvironment(e.target.value)} placeholder="PORT=3000" rows={3} /></label>
    {error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>ยกเลิก</button><button className="primary" disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกเซิร์ฟเวอร์"}</button></div>
  </form></div>;
}

function LogDialog({ server, logs, onClose, onRefresh }: { server: ServerView; logs: string[]; onClose: () => void; onRefresh: () => void }) {
  const output = useMemo(() => logs.length ? logs.join("\n") : "ยังไม่มี output จาก process นี้", [logs]);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="dialog log-dialog" onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">PROCESS OUTPUT</p><h2>{server.profile.name}</h2></div><div><button className="secondary small" onClick={onRefresh}>รีเฟรช</button><button className="close" onClick={onClose}>×</button></div></div><pre>{output}</pre></section></div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
