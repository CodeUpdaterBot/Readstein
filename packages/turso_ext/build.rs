fn main() {
    // Must use CARGO_CFG_TARGET_OS, not cfg!(target_os = "windows").
    // build.rs is compiled for the *host*, so cfg!(windows) is always true
    // when cross-compiling Android from a Windows PC and incorrectly injects
    // -ladvapi32 into the NDK link line (ld.lld: unable to find library -ladvapi32).
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
