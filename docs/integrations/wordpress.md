---
title: WordPress
---

# WordPress

fixlock helps WordPress in two ways:

- **On a live site**, the fixlock plugin guards the fixes you patched into plugins and themes. When an update, the file editor, a deploy or an AI-written change undoes one, you get an email and a notice in wp-admin, with the locked lines next to the file as it is now.
- **For plugin and theme developers**, fixlock works in your git repository like in any other project: it stops pull requests and AI coding assistants from undoing fixes before they ship. The locks you make there travel with your plugin, and sites running the fixlock plugin check them too.

## On a live site: the fixlock plugin

### Install

In wp-admin, go to **Plugins**, **Add New**, search for **fixlock** and click **Install Now**, then **Activate**. (Until it's listed on WordPress.org: zip the [`extensions/wordpress/fixlock`](https://github.com/AbinandhMJ/fixlock/tree/main/extensions/wordpress/fixlock) folder and upload it under **Plugins**, **Add New**, **Upload Plugin**.)

### Lock a fix

1. Go to **Tools**, **fixlock**.
2. Under **Lock a fix**, choose the plugin or theme, type the file's path inside it (such as `includes/class-cart.php`) and the first and last line of your patch. The theme and plugin file editors show line numbers.
3. Say what it fixes and why it matters, then click **Lock these lines**.

### What happens next

fixlock checks every lock:

| When | Why |
|---|---|
| Right after a plugin or theme update | Updates replace patched files |
| When a file is saved in the theme or plugin file editor | Before the save: a save that would undo a locked fix is refused with a message saying which fix |
| Once a day | Catches FTP uploads, deploys, hosting tools and AI-written edits |
| When you open Tools, fixlock | So the page is always current |

When a locked fix is undone, the site admin gets one email and a notice on every wp-admin page until someone clicks **Mark as seen**. The fixlock page shows the locked lines next to what the file has there now, so you can re-apply the patch, ask the author to include it, or remove the lock if the update fixed the problem another way.

Whitespace and indentation don't count as a change. Nothing leaves your server.

### Settings

On the fixlock page:

- **Email the site admin when a locked fix is undone** (on by default).
- **Refuse theme and plugin file editor saves that would undo a locked fix** (on by default).

Deleting the plugin removes all its data.

## For plugin and theme developers

Use fixlock in your plugin or theme's git repository like any other project. No Node.js needed:

```bash
pipx install fixlock        # or: npx @abinandhmj/fixlock quickstart
fixlock quickstart
```

`quickstart` locks the past fixes it's surest about, connects your AI assistants (Claude Code, Cursor, Copilot, Codex, Junie), installs commit hooks and adds the GitHub PR check. After that, a pull request that changes a locked fix needs its owner's approval, and AI assistants are told which lines to leave alone. fixlock understands PHP structurally, so reformatting doesn't count as a change. See [Getting started](../getting-started.md).

### Ship your locks with the plugin

Keep the `.fixlock/` folder in the plugin or theme you release (don't exclude it from your build zip). Sites running the fixlock plugin then check your locks too: if a site owner or their developer edits your file and removes one of your fixes, they're told, and the file editor refuses the save. The locks show as **Its developers** on their fixlock page.

If you'd rather not ship it, add `.fixlock` to `.distignore` (WP-CLI `dist-archive`) or your build's exclude list.

### In the IDE

PhpStorm: install the [fixlock plugin for JetBrains IDEs](https://abinandhmj.github.io/fixlock/integrations/jetbrains). VS Code: the [VS Code extension](vscode.md).
