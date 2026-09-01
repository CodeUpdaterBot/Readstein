# Readstein managed project runbook

## Identity

- Project name: Readstein
- Source seed: `C:/Users/PC/Downloads/readest-main`
- Managed path: `C:/Users/PC/Documents/Coding Projects/Readstein`
- GitHub repo: `CodeUpdaterBot/Readstein`
- Visibility: private
- Upstream ancestry: fork/derivative of Readest with substantial local modifications around TTS, storage, library/family/home usage, plus an included landing page folder for context.

## Repository scope

This repository intentionally keeps the main app and the nested `Landing-page/` source together for context. The website is also split into a separate deployable repo at `CodeUpdaterBot/Readstein-Website`.

Generated dependencies/build outputs and local secrets are excluded from git.

Do not commit:

- `node_modules/`
- Rust/Tauri `target/` outputs
- `dist/`, `build/`, `.next/`, `.vercel/`, caches
- `.env*` except example files
- mobile signing/certificate material
- generated Android JNI libraries under `apps/readest-app/src-tauri/gen/android/app/src/main/jniLibs/`

## Tooling

- Package manager declared by the monorepo: `pnpm@11.1.1`
- Main app commands are defined in root `package.json` and package-level manifests.
- This initial onboarding is a repository archival/control-plane setup, not a full app release.

## Workflow

Use repo-local identity `Steven <runcomps@gmail.com>`. Before future app changes, inspect the relevant package and run the narrowest available checks/builds for that package.
