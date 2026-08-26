import React, { FormEvent, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
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
  const [notice, setNotice] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

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

  const showLogs = async (server: ServerView) => {
    setLogsFor(server);
    try {
      setLogs(await invoke<string[]>("get_logs", { id: server.profile.id }));
    } catch (error) {
      setLogs([`อ่าน log ไม่สำเร็จ: ${String(error)}`]);
    }
  };

  const removeServer = async (server: ServerView) => {
    if (!window.confirm(`ลบ “${server.profile.name}” และหยุด process นี้หรือไม่?`)) return;
    setBusy(`delete:${server.profile.id}`);
    try {
      await invoke("delete_server", { id: server.profile.id });
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
          <button className="primary" onClick={() => setEditing(blankProfile())}>+ เพิ่มเซิร์ฟเวอร์</button>
        </header>

        <div className="summary-row">
          <div className="summary-card"><span className="dot running" /><div><small>กำลังทำงาน</small><strong>{running}</strong></div></div>
          <div className="summary-card"><span className="dot muted" /><div><small>ทั้งหมด</small><strong>{servers.length}</strong></div></div>
          <p className="tray-note">ปิดหน้าต่างเพื่อซ่อนแอปได้ server จะยังรันอยู่</p>
        </div>

        {notice && <div className="notice"><span>i</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

        <section className="server-list">
          {servers.length === 0 ? <EmptyState onAdd={() => setEditing(blankProfile())} /> : servers.map((server) => (
            <ServerCard key={server.profile.id} server={server} busy={busy} onAction={runAction} onTest={testHealth} onLogs={showLogs} onEdit={() => setEditing(server.profile)} onDelete={() => removeServer(server)} />
          ))}
        </section>
      </section>

      {editing && <ServerDialog profile={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setNotice("บันทึกการตั้งค่าแล้ว"); await loadServers(); }} />}
      {logsFor && <LogDialog server={logsFor} logs={logs} onClose={() => setLogsFor(null)} onRefresh={() => void showLogs(logsFor)} />}
    </main>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><div className="empty-icon">◈</div><h2>ยังไม่มีเซิร์ฟเวอร์</h2><p>เพิ่มโปรเจกต์ Node หรือ Python เพื่อเริ่มควบคุมจากแอปนี้</p><button className="primary" onClick={onAdd}>+ เพิ่มเซิร์ฟเวอร์แรก</button></div>;
}

function ServerCard({ server, busy, onAction, onTest, onLogs, onEdit, onDelete }: { server: ServerView; busy: string | null; onAction: (id: string, action: "start" | "stop" | "restart") => void; onTest: (server: ServerView) => void; onLogs: (server: ServerView) => void; onEdit: () => void; onDelete: () => void }) {
  const { profile, status, pid, detail } = server;
  const pending = (action: string) => busy === `${action}:${profile.id}`;
  return <article className="server-card">
    <div className={`runtime-icon ${profile.runtime}`}>{profile.runtime === "node" ? "JS" : profile.runtime === "python" ? "PY" : "⌘"}</div>
    <div className="server-main"><div className="server-title"><h2>{profile.name}</h2><span className={`status ${status}`}><i />{status === "running" ? "กำลังทำงาน" : status === "error" ? "ผิดพลาด" : "หยุดอยู่"}</span></div><p className="command"><code>{profile.command} {profile.arguments.join(" ")}</code></p><p className="location">⌁ {profile.workingDirectory}{pid ? `  ·  PID ${pid}` : ""}</p>{detail && <p className="detail">{detail}</p>}</div>
    <div className="card-actions">
      {status === "running" ? <button className="action stop" disabled={pending("stop")} onClick={() => onAction(profile.id, "stop")}>{pending("stop") ? "…" : "■ หยุด"}</button> : <button className="action start" disabled={pending("start")} onClick={() => onAction(profile.id, "start")}>{pending("start") ? "…" : "▶ เริ่ม"}</button>}
      <button className="icon-button" title="รีสตาร์ต" disabled={pending("restart")} onClick={() => onAction(profile.id, "restart")}>↻</button>
      <button className="icon-button" title="ดู Log" onClick={() => onLogs(server)}>≡</button>
      {profile.healthUrl && <button className="icon-button" title="ตรวจ URL" disabled={pending("health")} onClick={() => onTest(server)}>⌁</button>}
      <button className="icon-button" title="แก้ไข" onClick={onEdit}>⋯</button>
      <button className="icon-button danger" title="ลบ" disabled={pending("delete")} onClick={onDelete}>×</button>
    </div>
  </article>;
}

function ServerDialog({ profile, onClose, onSaved }: { profile: ServerProfile; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const [args, setArgs] = useState(profile.arguments.join(" "));
  const [environment, setEnvironment] = useState(Object.entries(profile.environment).map(([key, value]) => `${key}=${value}`).join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const title = profile.id ? "แก้ไขเซิร์ฟเวอร์" : "เพิ่มเซิร์ฟเวอร์";

  const changeRuntime = (runtime: Runtime) => {
    const presets: Record<Runtime, [string, string]> = { node: ["npm", "run dev"], python: ["python", ""], other: ["", ""] };
    setDraft({ ...draft, runtime, command: presets[runtime][0] });
    setArgs(presets[runtime][1]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    const env = Object.fromEntries(environment.split(/\r?\n/).filter(Boolean).map((line) => { const index = line.indexOf("="); return index === -1 ? [line.trim(), ""] : [line.slice(0, index).trim(), line.slice(index + 1)]; }));
    try { await invoke("save_server", { profile: { ...draft, arguments: splitArguments(args), environment: env, healthUrl: draft.healthUrl || null } }); await onSaved(); } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}><form className="dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="dialog-heading"><div><p className="eyebrow">SERVER PROFILE</p><h2>{title}</h2></div><button type="button" className="close" onClick={onClose}>×</button></div>
    <label>ชื่อที่แสดง<input required autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="เช่น My API" /></label>
    <div><span className="label-title">Runtime</span><div className="runtime-tabs">{(["node", "python", "other"] as Runtime[]).map((runtime) => <button type="button" key={runtime} className={draft.runtime === runtime ? "selected" : ""} onClick={() => changeRuntime(runtime)}>{runtime === "node" ? "Node.js" : runtime === "python" ? "Python" : "คำสั่งอื่น"}</button>)}</div></div>
    <label>โฟลเดอร์โปรเจกต์<input required value={draft.workingDirectory} onChange={(e) => setDraft({ ...draft, workingDirectory: e.target.value })} placeholder="D:\\work\\my-api" /></label>
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
