=== fixlock ===
Contributors: algotricz
Tags: security, maintenance, updates, monitoring, developer
Requires at least: 6.2
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.9.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Lock the fixes you patched into plugins and themes. When an update or an edit undoes one, fixlock tells you and shows what changed.

== Description ==

You patched a bug in a plugin or theme: a refund that charged twice, a checkout field that broke on mobile. Then an update replaced the file, and the bug came back without anyone noticing.

fixlock stops that from happening quietly.

* **Lock a fix in a minute.** Pick the plugin or theme, the file and the lines you changed, and say why. That's the lock.
* **Know when it's undone.** After every plugin and theme update, after every save in the theme and plugin file editors, and once a day (to catch FTP uploads, deploys and AI-written edits), fixlock checks that your locked lines are still there. If not, the site admin gets an email and a notice in wp-admin.
* **See exactly what changed.** The fixlock page shows the locked lines next to what the file has now, so re-applying the patch takes a minute.
* **Stop accidental edits.** A save in the theme or plugin file editor that would remove a locked fix is refused with a message saying which fix and why (you can turn this off).
* **Developer locks included.** Plugins and themes built with the fixlock command-line tool ship their locks in `.fixlock/registry.json`, and this site checks those too.

Whitespace and indentation changes don't count as undoing a fix. Nothing is sent anywhere: fixlock reads your plugin and theme files on your own server.

fixlock is also a command-line tool, a GitHub check, and an IDE plugin for teams who build WordPress plugins and themes in git: it stops pull requests and AI coding assistants from undoing fixes before they ship. See the [documentation](https://abinandhmj.github.io/fixlock/integrations/wordpress).

A product of Algotricz.

== Installation ==

1. Install and activate fixlock from Plugins, Add New, or upload the zip.
2. Go to Tools, fixlock.
3. Under "Lock a fix", choose the plugin or theme, the file and the line numbers of your patch, and describe it.

== Frequently Asked Questions ==

= Does fixlock stop plugin updates? =

No. Updates run as usual. fixlock tells you right after an update if it replaced a file you had patched, and shows the lines to put back.

= Will fixlock re-apply my patch automatically? =

No. A new version of a plugin may have changed the code around your patch, so a person should decide. fixlock shows the locked lines and what the file has now, side by side.

= Where are the locks stored? =

In your site's database (options starting with fixlock_). Deleting the plugin removes them.

= Can I lock files in a single-file plugin, like Hello Dolly? =

Not yet: fixlock locks files inside plugin and theme folders.

= What does "undone" mean exactly? =

At least one of the locked lines is no longer in the file. Changes to whitespace and indentation don't count.

== Screenshots ==

1. The fixlock page after an update undid a patch: the locked lines next to the file as it is now.
2. Locking a fix: plugin or theme, file, lines and why.

== Changelog ==

= 0.9.0 =
* First release: lock lines in plugin and theme files, checks after updates, file editor saves and daily, email and admin notice when a fix is undone, side-by-side view, file editor protection, and developer locks from .fixlock/registry.json.
