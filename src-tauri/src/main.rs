// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by an AI app as its MCP server: no window, just stdin and stdout.
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(milo_lib::run_mcp());
    }
    milo_lib::run()
}
