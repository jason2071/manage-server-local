use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fs,
    io::{BufRead, BufReader},
    net::{TcpStream, ToSocketAddrs},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};
use url::Url;
use uuid::Uuid;

const MAX_LOG_LINES: usize = 800;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ServerProfile {
    id: String,
    name: String,
    runtime: String,
    working_directory: String,
    command: String,
    arguments: Vec<String>,
    #[serde(default)]
    health_url: Option<String>,
    #[serde(default)]
    environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServerView {
    profile: ServerProfile,
    status: String,
    pid: Option<u32>,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResult {
    healthy: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeScript {
    name: String,
    command: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PythonPreset {
    name: String,
    command: String,
    arguments: Vec<String>,
    health_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NodePackage {
    #[serde(default)]
    scripts: BTreeMap<String, String>,
}

struct ManagedProcess {
    child: Child,
}

struct AppState {
    profiles: Mutex<Vec<ServerProfile>>,
    processes: Mutex<HashMap<String, ManagedProcess>>,
    logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    last_exit: Mutex<HashMap<String, String>>,
    storage_path: PathBuf,
}

impl AppState {
    fn load(storage_path: PathBuf) -> Self {
        let profiles = fs::read_to_string(&storage_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default();
        Self {
            profiles: Mutex::new(profiles),
            processes: Mutex::new(HashMap::new()),
            logs: Arc::new(Mutex::new(HashMap::new())),
            last_exit: Mutex::new(HashMap::new()),
            storage_path,
        }
    }

    fn persist(&self) -> Result<(), String> {
        let profiles = self.profiles.lock().map_err(|_| "profile lock failed")?;
        let content =
            serde_json::to_string_pretty(&*profiles).map_err(|error| error.to_string())?;
        fs::write(&self.storage_path, content).map_err(|error| error.to_string())
    }
}

fn push_log(logs: &Arc<Mutex<HashMap<String, VecDeque<String>>>>, id: &str, line: String) {
    if let Ok(mut all_logs) = logs.lock() {
        let server_logs = all_logs.entry(id.to_string()).or_default();
        if server_logs.len() >= MAX_LOG_LINES {
            server_logs.pop_front();
        }
        server_logs.push_back(line);
    }
}

fn capture_output<R: std::io::Read + Send + 'static>(
    reader: R,
    logs: Arc<Mutex<HashMap<String, VecDeque<String>>>>,
    id: String,
    source: &'static str,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            push_log(&logs, &id, format!("[{source}] {line}"));
        }
    });
}

fn refresh_finished(state: &AppState) {
    let mut finished = Vec::new();
    if let Ok(mut processes) = state.processes.lock() {
        for (id, process) in processes.iter_mut() {
            if let Ok(Some(status)) = process.child.try_wait() {
                let detail = if status.success() {
                    "process exited normally".to_string()
                } else {
                    format!("process exited with {status}")
                };
                finished.push((id.clone(), detail));
            }
        }
        for (id, _) in &finished {
            processes.remove(id);
        }
    }
    if let Ok(mut last_exit) = state.last_exit.lock() {
        for (id, status) in finished {
            last_exit.insert(id.clone(), status.clone());
            push_log(
                &state.logs,
                &id,
                format!("[manager] process exited: {status}"),
            );
        }
    }
}

fn profile_by_id(state: &AppState, id: &str) -> Result<ServerProfile, String> {
    state
        .profiles
        .lock()
        .map_err(|_| "profile lock failed")?
        .iter()
        .find(|profile| profile.id == id)
        .cloned()
        .ok_or_else(|| "ไม่พบ server นี้".to_string())
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn hide_console(_: &mut Command) {}

/// Build the platform `Command` that actually launches the profile's program.
///
/// On Windows, command-line tools such as `npm`, `npx`, `pnpm` and `yarn` are
/// shipped as `.cmd` batch files. `CreateProcess` (which Rust's `Command` uses)
/// cannot launch a `.cmd`/`.bat` file directly — it returns "program not found"
/// even when the file is on `PATH` — and resolving it by hand does not help when
/// the app is spawned without a console. Going through `cmd.exe /c` lets Windows
/// resolve the wrapper via `PATHEXT` and run it reliably.
fn build_command(command: &str, arguments: &[String]) -> Command {
    let command = command.trim();
    #[cfg(windows)]
    {
        let mut wrapper = Command::new("cmd.exe");
        wrapper.arg("/c").arg(command).args(arguments);
        wrapper
    }
    #[cfg(not(windows))]
    {
        let mut direct = Command::new(command);
        direct.args(arguments);
        direct
    }
}

fn start_inner(state: &AppState, id: &str) -> Result<(), String> {
    refresh_finished(state);
    if state
        .processes
        .lock()
        .map_err(|_| "process lock failed")?
        .contains_key(id)
    {
        return Err("server นี้กำลังทำงานอยู่".to_string());
    }
    let profile = profile_by_id(state, id)?;
    if profile.command.trim().is_empty() {
        return Err("ต้องระบุคำสั่งเริ่มต้น".to_string());
    }
    if !PathBuf::from(&profile.working_directory).is_dir() {
        return Err("ไม่พบโฟลเดอร์โปรเจกต์".to_string());
    }

    let mut command = build_command(&profile.command, &profile.arguments);
    command
        .current_dir(&profile.working_directory)
        .envs(&profile.environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("เริ่ม `{}` ไม่สำเร็จ: {error}", profile.command))?;
    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        capture_output(stdout, state.logs.clone(), id.to_string(), "out");
    }
    if let Some(stderr) = child.stderr.take() {
        capture_output(stderr, state.logs.clone(), id.to_string(), "err");
    }
    push_log(
        &state.logs,
        id,
        format!(
            "[manager] started PID {pid}: {} {}",
            profile.command,
            profile.arguments.join(" ")
        ),
    );
    state
        .processes
        .lock()
        .map_err(|_| "process lock failed")?
        .insert(id.to_string(), ManagedProcess { child });
    state
        .last_exit
        .lock()
        .map_err(|_| "exit lock failed")?
        .remove(id);
    Ok(())
}

fn stop_inner(state: &AppState, id: &str) -> Result<(), String> {
    let process = state
        .processes
        .lock()
        .map_err(|_| "process lock failed")?
        .remove(id);
    let Some(mut process) = process else {
        return Ok(());
    };
    let pid = process.child.id();
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|error| format!("หยุด process ไม่สำเร็จ: {error}"))?;
        if !status.success() {
            return Err("Windows ไม่สามารถหยุด process tree ได้".to_string());
        }
    }
    #[cfg(not(windows))]
    process
        .child
        .kill()
        .map_err(|error| format!("หยุด process ไม่สำเร็จ: {error}"))?;
    let _ = process.child.wait();
    push_log(&state.logs, id, format!("[manager] stopped PID {pid}"));
    Ok(())
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> Result<Vec<ServerView>, String> {
    refresh_finished(&state);
    let profiles = state
        .profiles
        .lock()
        .map_err(|_| "profile lock failed")?
        .clone();
    let processes = state.processes.lock().map_err(|_| "process lock failed")?;
    let last_exit = state.last_exit.lock().map_err(|_| "exit lock failed")?;
    Ok(profiles
        .into_iter()
        .map(|profile| match processes.get(&profile.id) {
            Some(process) => ServerView {
                profile,
                status: "running".into(),
                pid: Some(process.child.id()),
                detail: None,
            },
            None => {
                let detail = last_exit.get(&profile.id).cloned();
                let status = if detail
                    .as_ref()
                    .is_some_and(|text| text != "process exited normally")
                {
                    "error"
                } else {
                    "stopped"
                };
                ServerView {
                    profile,
                    status: status.into(),
                    pid: None,
                    detail,
                }
            }
        })
        .collect())
}

#[tauri::command]
fn save_server(state: State<'_, AppState>, mut profile: ServerProfile) -> Result<(), String> {
    profile.name = profile.name.trim().to_string();
    profile.working_directory = profile.working_directory.trim().to_string();
    profile.command = profile.command.trim().to_string();
    if profile.name.trim().is_empty() {
        return Err("ต้องระบุชื่อ server".to_string());
    }
    if profile.working_directory.trim().is_empty() {
        return Err("ต้องระบุโฟลเดอร์โปรเจกต์".to_string());
    }
    if profile.id.is_empty() {
        profile.id = Uuid::new_v4().to_string();
    }
    let mut profiles = state.profiles.lock().map_err(|_| "profile lock failed")?;
    if let Some(index) = profiles.iter().position(|current| current.id == profile.id) {
        profiles[index] = profile;
    } else {
        profiles.push(profile);
    }
    drop(profiles);
    state.persist()
}

#[tauri::command]
fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    stop_inner(&state, &id)?;
    state
        .profiles
        .lock()
        .map_err(|_| "profile lock failed")?
        .retain(|profile| profile.id != id);
    state
        .logs
        .lock()
        .map_err(|_| "log lock failed")?
        .remove(&id);
    state
        .last_exit
        .lock()
        .map_err(|_| "exit lock failed")?
        .remove(&id);
    state.persist()
}

#[tauri::command]
fn start_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    start_inner(&state, &id)
}

#[tauri::command]
fn stop_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    stop_inner(&state, &id)
}

#[tauri::command]
fn restart_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    stop_inner(&state, &id)?;
    start_inner(&state, &id)
}

#[tauri::command]
fn get_logs(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    Ok(state
        .logs
        .lock()
        .map_err(|_| "log lock failed")?
        .get(&id)
        .map(|lines| lines.iter().cloned().collect())
        .unwrap_or_default())
}

#[tauri::command]
fn health_check(state: State<'_, AppState>, id: String) -> Result<HealthResult, String> {
    let profile = profile_by_id(&state, &id)?;
    let value = profile
        .health_url
        .ok_or_else(|| "ยังไม่ได้กำหนด URL".to_string())?;
    let url = Url::parse(&value).map_err(|_| "URL ไม่ถูกต้อง".to_string())?;
    let host = url
        .host_str()
        .ok_or_else(|| "URL ต้องมี hostname".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "ไม่พบ port ของ URL".to_string())?;
    let address = format!("{host}:{port}")
        .to_socket_addrs()
        .map_err(|error| format!("หา hostname ไม่สำเร็จ: {error}"))?
        .next()
        .ok_or_else(|| "ไม่พบปลายทาง".to_string())?;
    let outcome = TcpStream::connect_timeout(&address, Duration::from_millis(900));
    let (healthy, message) = match outcome {
        Ok(_) => (true, format!("เข้าถึง {host}:{port} ได้")),
        Err(error) => (false, format!("เข้าถึง {host}:{port} ไม่ได้: {error}")),
    };
    Ok(HealthResult { healthy, message })
}

#[tauri::command]
fn get_node_scripts(working_directory: String) -> Result<Vec<NodeScript>, String> {
    let package_path = PathBuf::from(working_directory).join("package.json");
    let content = fs::read_to_string(&package_path)
        .map_err(|_| format!("ไม่พบ package.json ใน {}", package_path.display()))?;
    let package: NodePackage =
        serde_json::from_str(&content).map_err(|error| format!("package.json ไม่ถูกต้อง: {error}"))?;
    Ok(package
        .scripts
        .into_iter()
        .map(|(name, command)| NodeScript { name, command })
        .collect())
}

#[tauri::command]
fn get_python_presets(working_directory: String) -> Result<Vec<PythonPreset>, String> {
    let directory = PathBuf::from(working_directory);
    if !directory.is_dir() {
        return Err("ไม่พบโฟลเดอร์โปรเจกต์".to_string());
    }

    let python = [".venv", "venv", "env"]
        .iter()
        .map(|name| directory.join(name).join("Scripts").join("python.exe"))
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "python".to_string());
    let mut presets = Vec::new();

    if directory.join("web").join("server.py").is_file() {
        presets.push(PythonPreset {
            name: "FastAPI web.server:app (port 8000)".to_string(),
            command: python.clone(),
            arguments: vec![
                "-m".to_string(),
                "uvicorn".to_string(),
                "web.server:app".to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                "8000".to_string(),
            ],
            health_url: Some("http://127.0.0.1:8000".to_string()),
        });
    }
    if directory.join("main.py").is_file() {
        presets.push(PythonPreset {
            name: "Run main.py".to_string(),
            command: python.clone(),
            arguments: vec!["main.py".to_string()],
            health_url: None,
        });
    }
    if directory.join("app.py").is_file() {
        presets.push(PythonPreset {
            name: "Run app.py".to_string(),
            command: python.clone(),
            arguments: vec!["app.py".to_string()],
            health_url: None,
        });
    }
    if directory.join("manage.py").is_file() {
        presets.push(PythonPreset {
            name: "Django runserver (port 8000)".to_string(),
            command: python.clone(),
            arguments: vec![
                "manage.py".to_string(),
                "runserver".to_string(),
                "127.0.0.1:8000".to_string(),
            ],
            health_url: Some("http://127.0.0.1:8000".to_string()),
        });
    }
    if presets.is_empty() {
        presets.push(PythonPreset {
            name: "Python command".to_string(),
            command: python,
            arguments: Vec::new(),
            health_url: None,
        });
    }
    Ok(presets)
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn stop_all(state: &AppState) {
    let ids = state
        .processes
        .lock()
        .map(|processes| processes.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for id in ids {
        let _ = stop_inner(state, &id);
    }
}

#[tauri::command]
fn quit_app(app: AppHandle, state: State<'_, AppState>) {
    stop_all(&state);
    app.exit(0);
}

pub fn run() {
    tauri::Builder::default()
        // Register first so a second launch can activate the existing hidden window
        // before the application creates another tray icon or process manager.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            app.manage(AppState::load(data_dir.join("servers.json")));
            let show = MenuItem::with_id(app, "show", "เปิด Server Nest", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "ออกและหยุด server", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let tray_icon = app.default_window_icon().unwrap().clone();
            TrayIconBuilder::with_id("server-nest-tray")
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_window(app),
                    "quit" => {
                        stop_all(app.state::<AppState>().inner());
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_servers,
            save_server,
            delete_server,
            start_server,
            stop_server,
            restart_server,
            get_logs,
            health_check,
            get_node_scripts,
            get_python_presets,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running Server Nest");
}
