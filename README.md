# AI Editor

Visual editor for local web pages powered by Claude. Select any element on the page, describe the change you want, and the source file on disk is edited automatically — no manual file hunting required.

Works on static HTML, Laravel Blade templates, and Vue/React SPAs.

## How it works

1. An Express server (port 3333) receives edit requests from the browser
2. The server resolves the source file for the selected element from the URL and project config
3. It spawns a `claude` subprocess with read/edit access scoped to that project directory
4. Claude locates the element in the source, applies the change, and reports back
5. The edited element updates live in the page — no reload needed for most changes

## Requirements

- [Claude Code](https://claude.ai/code) CLI installed and authenticated
- Node.js 18+
- Tampermonkey (recommended) or browser console access

## Installation

```bash
git clone https://github.com/PauloFragaDev/ai-editor
cd ai-editor
npm install
npm start
```

Then install the browser userscript:

1. Open `http://localhost:3333/userscript.user.js` in your browser
2. Tampermonkey will prompt you to install it — accept
3. The editor will auto-inject on any `localhost` page and local `file://` pages

**Alternative (no Tampermonkey):** paste this in the browser console:

```js
var s = document.createElement('script');
s.src = 'http://localhost:3333/inject.js';
document.head.appendChild(s);
```

## Usage

| Action | Result |
|--------|--------|
| `Alt+E` | Toggle edit mode on/off |
| Hover over element | Highlights it |
| Click element | Opens edit panel |
| Type instruction + Apply | Edits the source file and updates the page |
| `Escape` | Exit edit mode |

The edit panel has two selection modes (switchable from the toolbar):

- **Element** — click to select a single DOM element
- **Area** — drag a rectangle to select the containing element

After each edit, the history panel (bottom-left) shows what changed. If a backup was captured before the edit, a revert button appears to restore the previous file content.

## Project configuration

For projects served on non-standard ports (Laravel on `:8000`, Vite on `:5173`, etc.), add a route to `projects.config.json`:

```json
{
  "docRoot": "/var/www/html",
  "routes": [
    { "match": "http://localhost:8000", "projectRoot": "/var/www/html/my-laravel-app", "kind": "laravel" },
    { "match": "http://localhost:5173", "projectRoot": "/var/www/html/my-vue-app",    "kind": "spa" }
  ]
}
```

**Supported kinds:**

| Kind | Where Claude looks |
|------|--------------------|
| `laravel` | `resources/views/` (Blade templates) |
| `spa` | `src/` (Vue/React components) |
| `static` | project root (`.html` files) |

Projects served through Apache on port 80 are detected automatically from the URL path — no config needed.

## Fallback behaviour

| Situation | What happens |
|-----------|--------------|
| Element found in a shared template/loop | Edit proceeds, warning shown ("affects all instances") |
| Source file cannot be located | Panel offers a temporary DOM-only edit (not saved to disk) |
| Claude returns no visual diff | File is saved, message shown — reload manually to see layout/CSS changes |

## Security

The spawned `claude` process is restricted to the resolved project directory via `--add-dir`. Shell access (`Bash`) is disabled. Permission mode is `acceptEdits` — Claude can only read and edit files, not execute arbitrary commands.

## Tests

```bash
node --test
```

25 tests covering the Express endpoints, project resolution, prompt builder, and report parser.
