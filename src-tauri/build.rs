fn main() {
    // `tauri dev` runs the bare binary, which has no Info.plist of its own. macOS stops a program
    // that asks for the microphone or speech recognition without saying why, so embed the reasons
    // in debug builds (a bundled app gets Info.plist merged in by Tauri).
    println!("cargo:rerun-if-changed=Info.plist");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") && std::env::var("PROFILE").as_deref() == Ok("debug") {
        let plist = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is always set by cargo")).join("Info.plist");
        println!("cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{}", plist.display());
    }
    tauri_build::build()
}
