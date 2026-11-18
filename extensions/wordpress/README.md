# fixlock for WordPress

The WordPress plugin: lock fixes patched into plugins and themes on a live site, and get told when an update or edit undoes one. Users' docs: [WordPress](https://abinandhmj.github.io/fixlock/integrations/wordpress). The WordPress.org listing text is `fixlock/readme.txt`.

- `fixlock/`: the plugin as it ships (zip this folder).
- `tests/run.php`: tests against a small stand-in for WordPress: `php extensions/wordpress/tests/run.php`.

CI (`.github/workflows/wordpress-plugin.yml`) lints and tests on PHP 7.4 and 8.3, runs WordPress.org's Plugin Check, and builds `fixlock.zip`.

## Publishing on WordPress.org

1. Submit `fixlock.zip` at https://wordpress.org/plugins/developers/add/ (signed in as the account that will own it). Review takes a few days to a few weeks.
2. Once approved, WordPress.org gives you an SVN repository. Put the contents of `fixlock/` in `trunk/`, copy `trunk` to `tags/0.9.0`, and add the banner, icon and screenshots to `assets/`.
