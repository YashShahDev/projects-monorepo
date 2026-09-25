---
id: SETUP
title: Local setup and verification
type: guide
status: active
date: 2026-09-26
updated: 2026-09-26
summary: Pinned tools, install steps and verification for the Linux reference machine.
---

# Local setup and verification

Run project commands from `projects/formula-racer` unless marked repository-root.
P0 installs tools and verifies their individual capabilities; P1 integrates the browser
application. No Go, Rust compiler, React, Vite or ESLint installation is needed.

## Versions and locations

| Tool                     | Pin / tested version     | Location or purpose                                       |
| ------------------------ | ------------------------ | --------------------------------------------------------- |
| mise                     | 2026.9.9 on this machine | Existing system runtime manager                           |
| Bun                      | 1.4.2                    | Project `mise.toml`; packages, tests and bundling         |
| Node                     | 24.21.0 LTS              | Project `mise.toml`; Playwright/asset CLIs                |
| GitHub CLI               | 2.101.0                  | Project `mise.toml`; draft PR operations                  |
| Blender                  | 4.5.14 LTS               | User-local portable install                               |
| KTX Software             | 4.4.2                    | User-local `toktx` and `ktx`                              |
| Git LFS                  | 3.8.0                    | User-local executable; repository-local Git configuration |
| TypeScript               | 7.0.2                    | `tsc --noEmit`                                            |
| Oxlint / Oxfmt           | 1.85.0 / 0.70.0          | Lint and format checks                                    |
| Playwright               | 1.63.0                   | Chromium 153.0.8010.12, Firefox 155.0                     |
| Three.js / Rapier compat | 0.186.1 / 0.21.0         | Installed, browser integration deferred to P1             |
| glTF Transform CLI       | 4.5.0                    | Model inspection/optimization                             |

`mise.toml`, `toolchain.json`, `package.json` and `bun.lock` are the source of the
pins; update them together when deliberately upgrading. Browser revisions follow
the Playwright package rather than a separately maintained browser version pin.

## Bun dependencies and browsers

Install mise using its [official instructions](https://mise.jdx.dev/getting-started.html)
if absent. Read the project configuration before trusting it:

```sh
mise trust
mise install
make setup
```

`make setup` runs a frozen Bun install followed by Playwright Chromium/Firefox
downloads. It does not install native tools or system packages. `make install` is
the dependencies-only operation. Normal build/test/lint/doctor commands do not
silently install missing runtimes or dependencies. `make clean` removes generated
outputs, not dependencies, browser caches, source assets or user-local toolchains.

Arch Linux is outside Playwright's listed supported distributions. Here Playwright
selected its Ubuntu 24.04 fallback builds; both launched successfully using existing
native libraries. If launch reports a missing library, map that error to the Arch
package and install only the required dependency with `pkexec pacman -S --needed ...`.
Do not run the Debian-oriented `install-deps` helper blindly on this machine.

## Portable Blender, KTX and Git LFS

Native tools live under `~/.local/share/formula-racer/toolchains`, exposed through
symlinks in `~/.local/bin` (already on this machine's PATH). No system packages or
shell startup files were changed. Existing commands must not be overwritten silently.

For a fresh Linux x86_64 installation, download these official archives into a working
directory, verify SHA256, then extract into the user-local tool directory. Required
base utilities: curl, tar with xz/bzip2/gzip support, and sha256sum.

```sh
mkdir -p /tmp/formula-racer-downloads
cd /tmp/formula-racer-downloads
curl -fL --retry 2 -O https://download.blender.org/release/Blender4.5/blender-4.5.14-linux-x64.tar.xz
curl -fL --retry 2 -O https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Linux-x86_64.tar.bz2
curl -fL --retry 2 -O https://github.com/git-lfs/git-lfs/releases/download/v3.8.0/git-lfs-linux-amd64-v3.8.0.tar.gz
sha256sum -c <<'CHECKSUMS'
9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3  blender-4.5.14-linux-x64.tar.xz
a8781bad05f9624edbf910b7f258cd0a4ba7d3e63b49ecc0a0ab440bf6a0a245  KTX-Software-4.4.2-Linux-x86_64.tar.bz2
e455e00f15d9b95661b8d53498ffb0c3367962cf1ec73c31ab7369516cd6ab8d  git-lfs-linux-amd64-v3.8.0.tar.gz
CHECKSUMS
```

Continue only if all three checksums pass. Blender's checksum was checked against
its official `.sha256` file; KTX and Git LFS against GitHub release-asset SHA256 metadata.

```sh
mkdir -p "$HOME/.local/share/formula-racer/toolchains/ktx-4.4.2"
mkdir -p "$HOME/.local/share/formula-racer/toolchains/git-lfs-3.8.0"
mkdir -p "$HOME/.local/bin"
tar -xJf blender-4.5.14-linux-x64.tar.xz -C "$HOME/.local/share/formula-racer/toolchains"
tar -xjf KTX-Software-4.4.2-Linux-x86_64.tar.bz2 -C "$HOME/.local/share/formula-racer/toolchains/ktx-4.4.2"
tar -xzf git-lfs-linux-amd64-v3.8.0.tar.gz -C "$HOME/.local/share/formula-racer/toolchains/git-lfs-3.8.0"
ln -s "$HOME/.local/share/formula-racer/toolchains/blender-4.5.14-linux-x64/blender" "$HOME/.local/bin/blender"
ln -s "$HOME/.local/share/formula-racer/toolchains/ktx-4.4.2/KTX-Software-4.4.2-Linux-x86_64/bin/toktx" "$HOME/.local/bin/toktx"
ln -s "$HOME/.local/share/formula-racer/toolchains/ktx-4.4.2/KTX-Software-4.4.2-Linux-x86_64/bin/ktx" "$HOME/.local/bin/ktx"
ln -s "$HOME/.local/share/formula-racer/toolchains/git-lfs-3.8.0/git-lfs-3.8.0/git-lfs" "$HOME/.local/bin/git-lfs"
```

The symlink commands intentionally fail if destinations exist. On a repeat setup,
verify existing targets instead of replacing them. On other machines, ensure
`~/.local/bin` is on PATH for the current shell and use platform-appropriate archives.
Do not reuse these x86_64/Linux checksums on another platform.

From the repository, initialize LFS locally:

```sh
git lfs install --local
git lfs env
```

Project `.gitattributes` marks Blender/source images and runtime GLB/KTX assets for LFS.
The authenticated GitHub LFS batch endpoint was verified (HTTP 200 with the expected
missing-object response). **Actual object upload/download is deferred until P4's
first small asset probe**, before adding large sources. No binary was uploaded in P0.

## Verification and everyday commands

```sh
make doctor
make verify-prerequisites
make test
make lint
make build
mise exec -- bun run format
```

- `doctor`: non-mutating version/presence checks; returns nonzero for missing or
  mismatched pins. It resolves managed binaries via `mise which` to avoid PATH wrappers
  that install/upgrade even for `--version`. It does not launch browsers or contact GitHub.
- `verify-prerequisites`: launches isolated headless Chromium and Firefox, executes a
  DOM page, exports a disposable GLB/PNG with Blender, encodes KTX2 and inspects the GLB.
  Temporary fixtures are removed in a `finally` block, including on failures.
- `test`: `bun test tests`; currently setup diagnostic/link-validation behavior tests.
- `lint`: strict TypeScript, Oxlint, Oxfmt check and local documentation-file links.
  The link checker does not validate external sites or heading anchors.
- `dev`: Bun dev server with HTML bundling and hot reload at `http://localhost:3000/`
  (`PORT` overrides). Serves `public/` for runtime assets.
- `build`: minified browser bundle plus copied `public/` assets in `dist/`. Bundle URLs
  are relative, so `dist/` can be hosted at any URL subpath.
- `preview`: serves `dist/` at port 4173; `make preview BASE=/games/formula-racer/`
  checks subpath hosting. A bare subpath redirects to its trailing-slash form because
  relative URLs need it; real static hosts need the same redirect.
- `format`: writes Oxfmt formatting. Lint never silently rewrites files.

From repository root:

```sh
make test PROJECT=formula-racer
make lint PROJECT=formula-racer
make build PROJECT=formula-racer
```

Browser tests arrive in P1-C3; asset export and benchmark targets in P4/P5. They
are not success-returning placeholder tests. Headless browser success does not verify
hardware rendering, Blender interactive GUI behavior or game FPS.

GitHub operations should use the installed executable resolved by `mise which gh`.
This machine's `~/.local/bin/gh` wrapper invokes `mise use -g` on every call; the
project doctor bypasses it so a read-only check does not modify global configuration.

See [P0 evidence](checkpoints/P0.md) and [next phase](phases/P1-technical.md).
