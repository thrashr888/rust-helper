use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use sysinfo::{Pid, Process, Signal, System, MINIMUM_CPU_UPDATE_INTERVAL};

const BUILD_SUBCOMMANDS: &[&str] = &[
    "bench", "build", "check", "clippy", "doc", "install", "nextest", "run", "test",
];

#[derive(Debug, Clone, Serialize)]
pub struct BuildProcess {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub process_name: String,
    pub command: String,
    pub cargo_command: Option<String>,
    pub working_directory: Option<String>,
    pub project_name: Option<String>,
    pub phase: String,
    pub state: String,
    pub elapsed_seconds: u64,
    pub cpu_percent: f32,
    pub memory_percent: f32,
    pub child_count: usize,
    pub start_time: u64,
    pub restartable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestartedBuildProcess {
    pub pid: u32,
}

#[derive(Debug, Clone)]
struct ProcessSnapshot {
    pid: u32,
    parent_pid: Option<u32>,
    name: String,
    command: Vec<String>,
    executable: Option<PathBuf>,
    working_directory: Option<PathBuf>,
    environment: Vec<String>,
    status: String,
    start_time: u64,
    elapsed_seconds: u64,
    cpu_percent: f32,
    memory_bytes: u64,
}

impl ProcessSnapshot {
    fn from_process(pid: Pid, process: &Process) -> Self {
        Self {
            pid: pid.as_u32(),
            parent_pid: process.parent().map(Pid::as_u32),
            name: process.name().to_string(),
            command: process.cmd().to_vec(),
            executable: process.exe().map(Path::to_path_buf),
            working_directory: process.cwd().map(Path::to_path_buf),
            environment: process.environ().to_vec(),
            status: format!("{:?}", process.status()),
            start_time: process.start_time(),
            elapsed_seconds: process.run_time(),
            cpu_percent: process.cpu_usage(),
            memory_bytes: process.memory(),
        }
    }
}

fn process_snapshots(system: &System) -> HashMap<u32, ProcessSnapshot> {
    system
        .processes()
        .iter()
        .map(|(pid, process)| {
            let snapshot = ProcessSnapshot::from_process(*pid, process);
            (snapshot.pid, snapshot)
        })
        .collect()
}

fn normalized_process_name(process: &ProcessSnapshot) -> String {
    Path::new(&process.name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&process.name)
        .trim_start_matches('-')
        .to_ascii_lowercase()
}

fn cargo_subcommand(command: &[String]) -> Option<String> {
    let executable = command.first()?;
    let executable_name = Path::new(executable)
        .file_name()
        .and_then(|name| name.to_str())?
        .trim_start_matches('-');

    if executable_name != "cargo" {
        return None;
    }

    let mut skip_option_value = false;
    for argument in command.iter().skip(1) {
        if skip_option_value {
            skip_option_value = false;
            continue;
        }

        if matches!(
            argument.as_str(),
            "--color" | "--config" | "--explain" | "-Z"
        ) {
            skip_option_value = true;
            continue;
        }

        if argument.starts_with('-') || argument.starts_with('+') {
            continue;
        }

        return BUILD_SUBCOMMANDS
            .contains(&argument.as_str())
            .then(|| argument.clone());
    }

    None
}

fn detected_cargo_subcommand(process: &ProcessSnapshot) -> Option<String> {
    cargo_subcommand(&process.command)
}

fn is_rustc(process: &ProcessSnapshot) -> bool {
    normalized_process_name(process) == "rustc"
}

fn descendant_pids(processes: &HashMap<u32, ProcessSnapshot>, root_pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    let mut frontier = vec![root_pid];

    while let Some(parent_pid) = frontier.pop() {
        for process in processes.values() {
            if process.parent_pid == Some(parent_pid) && !descendants.contains(&process.pid) {
                descendants.push(process.pid);
                frontier.push(process.pid);
            }
        }
    }

    descendants
}

fn ancestor_pids(processes: &HashMap<u32, ProcessSnapshot>, pid: u32) -> HashSet<u32> {
    let mut ancestors = HashSet::new();
    let mut cursor = Some(pid);

    while let Some(current_pid) = cursor {
        if !ancestors.insert(current_pid) {
            break;
        }
        cursor = processes
            .get(&current_pid)
            .and_then(|process| process.parent_pid);
    }

    ancestors
}

fn phase_for_process(
    root: &ProcessSnapshot,
    cargo_command: Option<&str>,
    descendants: &[&ProcessSnapshot],
) -> String {
    if descendants.iter().any(|process| is_rustc(process)) || is_rustc(root) {
        return "Compiling".to_string();
    }

    if descendants.iter().any(|process| {
        matches!(
            normalized_process_name(process).as_str(),
            "cc" | "clang" | "clang++" | "ld" | "ld64" | "link"
        )
    }) {
        return "Linking".to_string();
    }

    if descendants
        .iter()
        .any(|process| normalized_process_name(process).contains("build-script"))
    {
        return "Running build scripts".to_string();
    }

    match cargo_command {
        Some("bench") => "Running benchmarks",
        Some("check") => "Checking",
        Some("clippy") => "Linting",
        Some("doc") => "Building documentation",
        Some("install") => "Installing",
        Some("nextest") | Some("test") => "Running tests",
        Some("run") => "Running",
        Some("build") => "Building",
        _ => "Active",
    }
    .to_string()
}

fn project_name(working_directory: Option<&Path>) -> Option<String> {
    let working_directory = working_directory?;
    let manifest_name = fs::read_to_string(working_directory.join("Cargo.toml"))
        .ok()
        .and_then(|manifest| manifest.parse::<toml::Table>().ok())
        .and_then(|manifest| {
            manifest
                .get("package")?
                .as_table()?
                .get("name")?
                .as_str()
                .map(str::to_string)
        });

    manifest_name.or_else(|| {
        working_directory
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_string)
    })
}

fn build_processes_from_snapshots(
    processes: &HashMap<u32, ProcessSnapshot>,
    total_memory: u64,
    excluded_pids: &HashSet<u32>,
) -> Vec<BuildProcess> {
    let cargo_roots: HashMap<u32, String> = processes
        .values()
        .filter_map(|process| {
            detected_cargo_subcommand(process).map(|command| (process.pid, command))
        })
        .collect();

    let mut roots: Vec<&ProcessSnapshot> = processes
        .values()
        .filter(|process| {
            if excluded_pids.contains(&process.pid) {
                return false;
            }

            if cargo_roots.contains_key(&process.pid) {
                return !ancestor_pids(processes, process.pid)
                    .iter()
                    .any(|pid| *pid != process.pid && cargo_roots.contains_key(pid));
            }

            is_rustc(process)
                && !ancestor_pids(processes, process.pid)
                    .iter()
                    .any(|pid| cargo_roots.contains_key(pid))
        })
        .collect();

    let mut builds = Vec::with_capacity(roots.len());
    for root in roots.drain(..) {
        let child_pids = descendant_pids(processes, root.pid);
        let descendants: Vec<&ProcessSnapshot> = child_pids
            .iter()
            .filter_map(|pid| processes.get(pid))
            .collect();
        let cargo_command = cargo_roots.get(&root.pid).cloned();
        let cpu_percent = root.cpu_percent
            + descendants
                .iter()
                .map(|process| process.cpu_percent)
                .sum::<f32>();
        let memory_bytes = root.memory_bytes
            + descendants
                .iter()
                .map(|process| process.memory_bytes)
                .sum::<u64>();
        let memory_percent = if total_memory == 0 {
            0.0
        } else {
            memory_bytes as f32 / total_memory as f32 * 100.0
        };

        builds.push(BuildProcess {
            pid: root.pid,
            parent_pid: root.parent_pid,
            process_name: root.name.clone(),
            command: root.command.join(" "),
            cargo_command: cargo_command.clone(),
            working_directory: root
                .working_directory
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            project_name: project_name(root.working_directory.as_deref()),
            phase: phase_for_process(root, cargo_command.as_deref(), &descendants),
            state: root.status.clone(),
            elapsed_seconds: root.elapsed_seconds,
            cpu_percent,
            memory_percent,
            child_count: descendants.len(),
            start_time: root.start_time,
            restartable: cargo_command.is_some()
                && root.working_directory.is_some()
                && (!root.command.is_empty() || root.executable.is_some()),
        });
    }

    builds.sort_by(|left, right| {
        right
            .cpu_percent
            .total_cmp(&left.cpu_percent)
            .then_with(|| left.pid.cmp(&right.pid))
    });
    builds
}

fn current_system(measure_cpu: bool) -> (System, HashMap<u32, ProcessSnapshot>) {
    let mut system = System::new_all();
    if measure_cpu {
        std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
        system.refresh_processes();
    }
    let snapshots = process_snapshots(&system);
    (system, snapshots)
}

fn verified_build_process(
    processes: &HashMap<u32, ProcessSnapshot>,
    pid: u32,
    expected_start_time: u64,
) -> Result<&ProcessSnapshot, String> {
    let process = processes
        .get(&pid)
        .ok_or_else(|| format!("Process {pid} is no longer running"))?;

    if process.start_time != expected_start_time {
        return Err(format!(
            "Process {pid} changed before the action could be applied"
        ));
    }

    if detected_cargo_subcommand(process).is_none() && !is_rustc(process) {
        return Err("The selected process is no longer a Rust build process".to_string());
    }

    let excluded = ancestor_pids(processes, std::process::id());
    if excluded.contains(&pid) {
        return Err("Rust Helper cannot stop its own process tree".to_string());
    }

    Ok(process)
}

fn terminate_process_tree(
    system: &System,
    processes: &HashMap<u32, ProcessSnapshot>,
    root_pid: u32,
) -> Result<(), String> {
    let mut descendants = descendant_pids(processes, root_pid);
    descendants.reverse();
    let mut pids = vec![root_pid];
    pids.extend(descendants);

    let mut failures = Vec::new();
    for pid in pids {
        if let Some(process) = system.process(Pid::from_u32(pid)) {
            match process.kill_with(Signal::Term) {
                Some(true) => {}
                Some(false) => failures.push(pid),
                None if process.kill() => {}
                None => failures.push(pid),
            }
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Could not stop process{} {}",
            if failures.len() == 1 { "" } else { "es" },
            failures
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

fn wait_for_process_exit(pid: u32, expected_start_time: u64, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let mut system = System::new_all();

    loop {
        system.refresh_processes();
        match system.process(Pid::from_u32(pid)) {
            None => return true,
            Some(process) if process.start_time() != expected_start_time => return true,
            Some(_) if Instant::now() >= deadline => return false,
            Some(_) => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}

#[tauri::command]
pub async fn get_build_processes() -> Vec<BuildProcess> {
    tokio::task::spawn_blocking(|| {
        let (system, processes) = current_system(true);
        let excluded_pids = ancestor_pids(&processes, std::process::id());
        build_processes_from_snapshots(&processes, system.total_memory(), &excluded_pids)
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn stop_build_process(pid: u32, expected_start_time: u64) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let (system, processes) = current_system(false);
        verified_build_process(&processes, pid, expected_start_time)?;
        terminate_process_tree(&system, &processes, pid)
    })
    .await
    .map_err(|error| format!("Failed to stop build process: {error}"))?
}

#[tauri::command]
pub async fn restart_build_process(
    pid: u32,
    expected_start_time: u64,
) -> Result<RestartedBuildProcess, String> {
    tokio::task::spawn_blocking(move || {
        let (system, processes) = current_system(false);
        let process = verified_build_process(&processes, pid, expected_start_time)?;
        if detected_cargo_subcommand(process).is_none() {
            return Err("Only Cargo processes can be restarted safely".to_string());
        }

        let working_directory = process
            .working_directory
            .clone()
            .ok_or_else(|| "The process working directory is unavailable".to_string())?;
        let program = process
            .executable
            .clone()
            .or_else(|| process.command.first().map(PathBuf::from))
            .ok_or_else(|| "The process executable is unavailable".to_string())?;
        let arguments = if process.command.is_empty() {
            Vec::new()
        } else {
            process.command[1..].to_vec()
        };
        let environment = process.environment.clone();

        terminate_process_tree(&system, &processes, pid)?;
        if !wait_for_process_exit(pid, expected_start_time, Duration::from_secs(2)) {
            return Err(
                "The stop signal was sent, but the build is still running; restart was not launched"
                    .to_string(),
            );
        }

        let mut command = Command::new(program);
        command
            .args(arguments)
            .current_dir(working_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        for value in environment {
            if let Some((key, value)) = value.split_once('=') {
                command.env(key, value);
            }
        }

        let child = command
            .spawn()
            .map_err(|error| format!("The build stopped but could not restart: {error}"))?;
        Ok(RestartedBuildProcess { pid: child.id() })
    })
    .await
    .map_err(|error| format!("Failed to restart build process: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(
        pid: u32,
        parent_pid: Option<u32>,
        name: &str,
        command: &[&str],
    ) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            parent_pid,
            name: name.to_string(),
            command: command.iter().map(|part| part.to_string()).collect(),
            executable: Some(PathBuf::from(command.first().copied().unwrap_or(name))),
            working_directory: Some(PathBuf::from("/Users/example/Workspace/demo")),
            environment: Vec::new(),
            status: "Run".to_string(),
            start_time: 100,
            elapsed_seconds: 10,
            cpu_percent: 5.0,
            memory_bytes: 100,
        }
    }

    #[test]
    fn recognizes_supported_cargo_commands_and_toolchains() {
        assert_eq!(
            cargo_subcommand(&["cargo".into(), "build".into(), "--release".into()]),
            Some("build".into())
        );
        assert_eq!(
            cargo_subcommand(&["cargo".into(), "+nightly".into(), "clippy".into()]),
            Some("clippy".into())
        );
        assert_eq!(
            cargo_subcommand(&[
                "cargo".into(),
                "--color".into(),
                "always".into(),
                "build".into(),
            ]),
            Some("build".into())
        );
        assert_eq!(cargo_subcommand(&["cargo".into(), "metadata".into()]), None);
        assert_eq!(
            cargo_subcommand(&["cargo".into(), "tauri".into(), "build".into()]),
            None
        );
    }

    #[test]
    fn collects_nested_descendants_once() {
        let processes = HashMap::from([
            (10, snapshot(10, None, "cargo", &["cargo", "build"])),
            (11, snapshot(11, Some(10), "rustc", &["rustc"])),
            (12, snapshot(12, Some(11), "cc", &["cc"])),
            (20, snapshot(20, None, "cargo", &["cargo", "test"])),
        ]);

        let mut descendants = descendant_pids(&processes, 10);
        descendants.sort_unstable();
        assert_eq!(descendants, vec![11, 12]);
    }

    #[test]
    fn groups_rustc_children_under_their_cargo_root() {
        let processes = HashMap::from([
            (10, snapshot(10, None, "cargo", &["cargo", "build"])),
            (11, snapshot(11, Some(10), "rustc", &["rustc"])),
            (20, snapshot(20, None, "rustc", &["rustc"])),
        ]);

        let builds = build_processes_from_snapshots(&processes, 1_000, &HashSet::new());
        assert_eq!(builds.len(), 2);
        let cargo = builds.iter().find(|process| process.pid == 10).unwrap();
        assert_eq!(cargo.phase, "Compiling");
        assert_eq!(cargo.child_count, 1);
        assert!(cargo.restartable);
        assert!(builds.iter().any(|process| process.pid == 20));
    }

    #[test]
    fn excludes_the_app_process_ancestry() {
        let processes = HashMap::from([
            (10, snapshot(10, None, "cargo", &["cargo", "build"])),
            (11, snapshot(11, Some(10), "rust-helper", &["rust-helper"])),
            (20, snapshot(20, None, "cargo", &["cargo", "test"])),
        ]);

        let excluded = ancestor_pids(&processes, 11);
        let builds = build_processes_from_snapshots(&processes, 1_000, &excluded);
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].pid, 20);
    }

    #[test]
    fn rejects_pid_reuse_and_non_build_processes() {
        let cargo = snapshot(10, None, "cargo", &["cargo", "build"]);
        let shell = snapshot(20, None, "zsh", &["zsh"]);
        let processes = HashMap::from([(10, cargo), (20, shell)]);

        assert!(verified_build_process(&processes, 10, 101).is_err());
        assert!(verified_build_process(&processes, 20, 100).is_err());
    }

    #[test]
    fn current_process_is_visible_to_the_system_snapshot() {
        let (_, processes) = current_system(false);
        assert!(processes.contains_key(&std::process::id()));
    }
}
