# dsh-BMAD-Method

Ships the whole of [BMAD-Method](https://github.com/bmad-code-org/BMAD-METHOD) inside dsh. Install the plugin and you are done — no `npx bmad-method install`.

Both READMEs live side by side: this one is English, [README.md](./README.md) is 简体中文.

![dsh](https://img.shields.io/badge/dsh-0.2.0--rc.1%20~%200.2.2--rc.1-blue) ![license](https://img.shields.io/badge/license-MIT-green)

---

## What this is

BMAD-Method is a "think it through before you write code" development method. It hands work to different roles: an analyst does research, a product manager writes the PRD, an architect sets the design, a developer writes code, a test architect gates it — producing a documented trail from idea to implementation.

Upstream expects you to install it yourself, pick modules yourself, and keep track of a pile of scattered files. This plugin brings the whole thing along:

- **All 7 modules ship inside the plugin package** — nothing to install on your machine
- **90 roles and workflows**, from "help me brainstorm" to "review this code"
- **Laid down on first open**, 46 ms, no installer run, no network
- **Turn a module off** and its skills disappear; not a single file is deleted
- **Updating the plugin is updating BMAD** — one version to track

---

## What you can do after installing

Just say what you want; the matching skill picks it up:

| You say | It does |
| --- | --- |
| "Write me a PRD" | Runs `bmad-prd`, produces a structured requirements doc |
| "Have Winston look at this architecture" | Switches to the architect role, `bmad-agent-architect` |
| "Run a code review" | Runs `bmad-code-review`, several reviewers in parallel |
| "Break this into stories" | Runs `bmad-create-epics-and-stories` |
| "How do we test this feature?" | Runs `bmad-testarch-test-design` |
| "I have an idea, pressure-test it" | Runs `bmad-forge-idea` |

Typing `/bmad-` lists all 90.

---

## Install

### Requirements

- dsh **0.2.x** (`>=0.2.0-rc.1 <0.2.1 || >=0.2.1-rc.1 <0.2.2 || >=0.2.2-rc.1 <0.3.0-0`, prereleases like `0.2.1-rc.x` and `0.2.2-rc.x` included)
- **Restart dsh once** afterwards, or the plugin will not load

### Option 1: plugin marketplace (easiest)

1. **Settings → Plugins → Marketplace**
2. Search `BMAD`, pick the one by `ph1996-cn`
3. Install, then **restart dsh**

### Option 2: install from GitHub (desktop)

1. **Settings → Plugins**
2. Click **Install from GitHub** (some versions label it "Add plugin")
3. Enter `ph1996-cn/dsh-BMAD-Method`
4. Confirm, wait for the download, then **restart dsh**

### Option 3: command line

```bash
# from GitHub
dsh plugin --profile desktop add github:ph1996-cn/dsh-BMAD-Method

# or from npm (same package, either route works)
dsh plugin --profile desktop add dsh-bmad-method
```

`--profile` is the profile you actually use — `desktop` on the desktop app. Restart dsh afterwards.

### Checking it worked

Open **Settings → Plugins → dsh-BMAD-Method**. Three blocks mean you are good:

| Block | What you should see |
| --- | --- |
| Settings | User name, language, workspace output folder — three inputs |
| Module switches | One row per module, 7 of them (`core` is absent: it is the foundation and cannot be turned off) |
| Included components | Exactly one row, the plugin itself |

The first time you open this card the plugin lays the BMAD runtime down into `~/.dsh/bmad-method` (46 ms, offline) — no button to press, no command to run.

### Pinning a version

To stop updates from moving you, pin it in the profile's `dependencies`:

```jsonc
// installed from GitHub
"dsh-bmad-method": "github:ph1996-cn/dsh-BMAD-Method#v0.2.4"

// installed from npm
"dsh-bmad-method": "^0.2.4"
```

> `0.2.3` is the latest stable on npm right now (`0.2.4` is still in the publish queue). Swap `0.2.4` for `0.2.3` if you need it pinned immediately.

### Package name vs display name

The npm package is `dsh-bmad-method` (npm only accepts lowercase), while the repo and the UI show `dsh-BMAD-Method`.

**Upgrading from 0.1.x** requires uninstalling the old package first — `dsh-BMAD-Method` and `dsh-bmad-method` are two different plugins to dsh, and having both loads everything twice.

---

## First open

After the restart, open **Settings → Plugins → dsh-BMAD-Method**. You get three blocks.

### 1. Settings

| Field | Meaning |
| --- | --- |
| **User name** | Written into BMAD's `user_name`; it addresses you by this name |
| **Language** | Language for conversation and documents, default 简体中文 |
| **Workspace output folder** | Where artifacts go, default `_bmad-output` (relative to your workspace) |

Save and it applies immediately.

### 2. Module switches

One row per module, a switch on the right. See "Module toggles" below.

### 3. Included components

Exactly one row here: the plugin itself. That is dsh's fixed page structure — the module switches live in the block above, not here.

> The first time you open the card, the plugin lays the BMAD runtime down into `~/.dsh/bmad-method` (46 ms, offline). No button to press, no command to run.

---

## Module toggles

A switch only decides **whether that module takes part**. No files move.

- Turn `bmm` off → its 21 skills vanish from the skill catalog, the model cannot see them
- Turn it back on → they return
- **Not a single module file is deleted**; you can always switch back

State lives in dsh's profile config (`cordis.patch.yml`), using the very `disabled: true` field dsh's own plugin switches use. So the state survives restarts, and there is no second state store.

`core` is the foundation module and has no switch — with it off, the other modules' scripts lose the shared config.

> Turning a module off **does not need a dsh restart**: the skill catalog re-reads the patch on every build. Editing the plugin's own code still needs one.

---

## What the 90 skills are

All of them ship in the package and **land in none of your directories** (`~/.dsh/skills` should hold zero bmad/gds skills).

| Module | Skills | What they cover |
| --- | --- | --- |
| `bmm` | 21 | The workhorse: PRD, architecture, stories, code review, retrospective, brainstorming |
| `gds` | 33 | Game dev: GDD, game architecture, playtest plans, game testing |
| `cis` | 10 | Creative: design thinking, innovation strategy, storytelling, problem solving |
| `tea` | 10 | Test architecture: test design, ATDD, CI pipeline, traceability matrix |
| `core` | 8 | Shared: help, brainstorming, customization, deep recon, review |
| `bmb` | 5 | Module building: build an agent, build a workflow, build a module |
| `bmad-loop` | 3 | Unattended development loop |

---

## Update

**Updating the plugin is updating BMAD**, one command:

```bash
dsh plugin --profile desktop update dsh-bmad-method
```

Swap `--profile` for the one you actually use (`desktop` on the desktop app). Restart dsh afterwards.

Uninstalling and reinstalling is not the way — dsh's "install" refuses an already-installed plugin (`already-installed`), so updates go through the package manager.

---

## Uninstall

Click Uninstall on the plugin page. dsh removes the npm package and the profile declaration, but it does **not** touch this:

| Location | What it is | After uninstall |
| --- | --- | --- |
| `~/.dsh/bmad-method/` | BMAD runtime + your `custom/` overrides | **stays** (~34 KB) |

That is deliberate: your `custom/` overrides live in there, and wiping it while removing the plugin would lose them for good. dsh's uninstall also never executes plugin code (just `pnpm remove` + a profile edit), so the plugin gets no chance to clean up after itself.

For a truly clean removal, delete it yourself:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\bmad-method"
```

**Want to keep your customizations?** Copy them out first:

```powershell
Copy-Item -Recurse "$env:USERPROFILE\.dsh\bmad-method\_bmad\custom" "$env:USERPROFILE\Desktop\bmad-custom-backup"
```

> Those 34 KB are only the files that get written: `config.toml`, the seven modules' `config.yaml`, `custom/`, `render/`. The two big trees (`scripts/` and `_config/`, 309 KB together) are **directory junctions** back into the plugin package — they cost you no space, follow the package when it upgrades, and deleting `~/.dsh/bmad-method` removes only the links, never the package's files.
>
> In the rare case a link cannot be created (plugin installed on another drive, non-NTFS, reparse points disabled by policy), it falls back to copying those 309 KB — same behaviour, a bit more disk.

---

## Supported dsh versions

| Item | Value |
| --- | --- |
| **dsh** | `>=0.2.0-rc.1 <0.2.1 \|\| >=0.2.1-rc.1 <0.2.2 \|\| >=0.2.2-rc.1 <0.3.0-0` (all of 0.2.x, prereleases included) |
| **Tested on** | `0.2.1-rc.3`, `0.2.1-rc.5`, `0.2.2-rc.1` |
| **Node** | `^22.19.0 \|\| >=24` |

Declared in `package.json`:

```json
"engines": { "node": "^22.19.0 || >=24", "dsh": ">=0.2.0-rc.1 <0.2.1 || >=0.2.1-rc.1 <0.2.2 || >=0.2.2-rc.1 <0.3.0-0" }
```

> **Why such a convoluted range**: node-semver only admits a prerelease version (`0.2.1-rc.5`, `0.2.2-rc.1`) when the range contains a comparator with the *same tuple* carrying its own prerelease tag. The prettier `>=0.2.0-rc.1 <0.3.0` only mentions the tuples `0.2.0` and `0.3.0`, so it **does not match `0.2.1-rc.5`**. Every `0.2.x` segment has to be spelled out.

The plugin relies only on dsh's **public contracts**, touches no private internals, and pins no `@deepseek-ai/dsh-*` dependency:

| Capability | How |
| --- | --- |
| Register tools | `ctx.tools.register()` |
| Provide skills | `ctx.skills.registerProvider()` |
| Settings form | `export const Config` (Schemastery schema) |
| Browser half | `dsh.client` + `ctx.slots.inject()` |
| Card API | `ctx.webServer.register({ kind: 'prefix' })` |

All five were checked line by line against both the `0.2.1-rc.5` and `0.2.2-rc.1` publishes; none of the signatures moved. Patch releases inside 0.2.x therefore need no version bump here.

---

## The three tools (the model can call them too)

| Tool | Args | What it does |
| --- | --- | --- |
| `bmad_modules_list` | `projectRoot?` `registryPath?` | Lists installed / installable modules, versions, switch state |
| `bmad_module_toggle` | `module` `enabled` | Turns one module on or off (state only, no files touched) |
| `bmad_update` | `userName?` `modules?` `channel?` `language?` | Runs the official installer to update or add modules |

You rarely need `bmad_update` — the runtime travels with the plugin. Two cases only: upstream shipped a new version, or you want to add an external module that was skipped during a degraded install.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No BMAD settings card on the plugin page | Plugin not loaded | Check it is enabled under **Settings → Plugins**, then restart dsh |
| Every module shows "not installed" | Runtime not laid down yet on first open | Refresh the card (opening it bootstraps), or call `bmad_modules_list` once |
| Module switch does nothing | Profile patch not found | The card footer states the reason; check the plugin is installed in a profile |
| Artifacts land in the system temp dir | Bug in an old version | Update to `0.1.1` or later |
| Skill reports `TOML file not found` | Placeholders not expanded in an old version | Update to `0.1.1` or later |
| Still old code after updating | `add` never updates an installed package, it only installs when missing | Use `dsh plugin --profile desktop update dsh-bmad-method` |
| External module fails to install | The installer has to `git clone` each module repo | Make sure GitHub is reachable; a failure degrades to the built-in module and BMAD still works |

One common misunderstanding: BMAD lives in `~/.dsh/bmad-method` (**global**) and never creates `_bmad/` inside your project. The only thing that appears in your project is the `_bmad-output/` artifact folder.

---

## For maintainers

### Layout

```
index.js              plugin entry: the three tools + the card API
client.js             browser half: settings card + module switches
cordis.patch.yml      bundled patch, mounts exactly one control row
bmad-home/_bmad/      BMAD runtime template (345 KB / 31 files): config is copied out, scripts/_config are linked
skills/               90 skills + manifest.json (skill → module ownership map)
lib/bmad.js           BMAD discovery, installer invocation, runtime materialization
lib/patch.js          line-level read/write of the profile patch (never eats your comments)
lib/skills.js         the SkillProvider implementation
lib/template.js       template materialization (junctions + config rewrite), duplicate-key disambiguation
lib/registry/         bmad-modules.yaml offline fallback when the dependency is missing
```

### Moving to a new BMAD version

```bash
node scripts/sync-bmad.mjs            # compare the three versions: 0 = current, 10 = update available
node scripts/sync-bmad.mjs --apply    # rebuild bmad-home/ and skills/ if behind
node scripts/sync-bmad.mjs --publish  # rebuild and release (only if npm test passes)
```

The script does four things: bump the `bmad-method` dependency → run the official installer into a temp dir → carry the old snapshot's project name / language / user name over and replace both snapshot trees → regenerate `skills/manifest.json` from `skill-manifest.csv`, with `npm test` as the gate.

If the template version and `node_modules/bmad-method` disagree, the plugin falls back to running the installer rather than laying an old structure over a new version.

### Patch write safety

- `cordis.patch.yml` is always **edited line by line**, never round-tripped through a YAML serializer — your comments and entries survive verbatim (a test guards this)
- Writes go through a temp file + rename, then read back and verify; a failed verification restores the original bytes and returns `write-failed`
- The tools **cache nothing**: `enabled` is read fresh from the patch file every time

### Tests

```bash
npm test     # 17 cases, 1.5 s
```

Runs `apply()` for real against a fake ctx, covering: tool registration, module discovery, switch read/write, idempotent double-disable, user comments preserved, `core` not toggleable, write failure rollback, command assembly, global install leaving the workspace alone, fresh-environment bootstrap, the template laying down 7 modules in 46 ms, skills disappearing after a module is disabled, the card API (including a cross-site 403), all `Config` fields being `.volatile()`, and `engines.dsh` covering the prerelease segment.

> `.volatile()` is mandatory: dsh's `volatileForm()` only admits fields marked `.volatile()` into the settings page, and drops the whole entry if none are.

> Note: `node` on this machine's PATH is v16, whose test runner only reports file-level results. Use dsh's bundled Node 24 to see the per-case report: `& "D:\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" --test`

### Release

```bash
npm version 0.1.3 --no-git-tag-version
git commit -am "chore: release v0.1.3"
git tag v0.1.3                    # ← never add -a
git push origin main v0.1.3
```

**The tag must be lightweight (never `git tag -a`).** An annotated tag's SHA in `refs/tags/` is the tag object's own hash, not the commit it points at; the marketplace matches commits by SHA, so an annotated tag never matches and the version shows up as `v<40-char hash>` instead of `v0.1.3`.

`v0.1.0` ~ `v0.1.2` were annotated historically (which is why the marketplace showed `v64339e3dad…`), left as is; **use lightweight from the next release on**.

---

## License

The code in this repository is MIT, see [LICENSE](./LICENSE).

The BMAD-Method content distributed with the package (`bmad-home/`, `skills/`) is copyright **BMad Code, LLC** and also MIT — the copyright line, the upstream repo list, and what we changed are all in [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

This plugin is an **unofficial** community project, not affiliated with or endorsed by BMad Code, LLC.
