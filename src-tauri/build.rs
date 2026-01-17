fn main() {
    println!("cargo:rustc-check-cfg=cfg(rust_analyzer)");
    tauri_build::build()
}
