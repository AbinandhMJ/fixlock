<?php
/**
 * Tests for the fixlock WordPress plugin, against a minimal stand-in for WordPress (no database or
 * server needed): php extensions/wordpress/tests/run.php
 */

define( 'ABSPATH', sys_get_temp_dir() . '/fixlock-wp-abspath/' );
error_reporting( E_ALL );
set_error_handler( function ( $no, $str, $file, $line ) { throw new ErrorException( $str, 0, $no, $file, $line ); } );

$GLOBALS['tmp'] = sys_get_temp_dir() . '/fixlock-wp-' . getmypid();
@mkdir( $GLOBALS['tmp'] . '/plugins', 0777, true );
@mkdir( $GLOBALS['tmp'] . '/themes', 0777, true );
define( 'WP_PLUGIN_DIR', $GLOBALS['tmp'] . '/plugins' );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'FIXLOCK_FILE', __DIR__ . '/../fixlock/fixlock.php' );

/* ---- the slice of WordPress the plugin uses ---- */
$GLOBALS['options'] = array(); $GLOBALS['mails'] = array(); $GLOBALS['actions'] = array(); $GLOBALS['caps'] = array( 'manage_options' => true, 'edit_plugins' => true, 'edit_themes' => true );
$GLOBALS['plugins'] = array(); $GLOBALS['themes'] = array();
class WP_Error { private $m; public function __construct( $c = '', $m = '' ) { $this->m = $m; } public function get_error_message() { return $this->m; } }
class Fixlock_Test_Theme { public $d; public function __construct( $d ) { $this->d = $d; } public function get( $k ) { return $this->d[ $k ]; } public function get_stylesheet_directory() { return $this->d['dir']; } public function exists() { return true; } }
class Fixlock_Json_Sent extends Exception { public $data; public function __construct( $d ) { $this->data = $d; parent::__construct( 'json' ); } }
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['options'] ) ? $GLOBALS['options'][ $k ] : $d; }
function update_option( $k, $v, $a = null ) { $GLOBALS['options'][ $k ] = $v; return true; }
function delete_option( $k ) { unset( $GLOBALS['options'][ $k ] ); }
function get_plugins() { return $GLOBALS['plugins']; }
function wp_get_themes() { $o = array(); foreach ( $GLOBALS['themes'] as $s => $d ) { $o[ $s ] = new Fixlock_Test_Theme( $d ); } return $o; }
function wp_get_theme( $s ) { return new Fixlock_Test_Theme( $GLOBALS['themes'][ $s ] ); }
function is_wp_error( $x ) { return $x instanceof WP_Error; }
function __( $s, $d = null ) { return $s; }
function esc_html__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function esc_attr__( $s, $d = null ) { return htmlspecialchars( $s, ENT_QUOTES ); }
function _n( $a, $b, $n, $d = null ) { return 1 === $n ? $a : $b; }
function esc_html( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_attr( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function esc_url( $s ) { return htmlspecialchars( (string) $s, ENT_QUOTES ); }
function wp_kses_post( $s ) { return $s; }
function wp_specialchars_decode( $s, $q = null ) { return $s; }
function get_bloginfo( $k ) { return 'Test Shop'; }
function admin_url( $p = '' ) { return 'https://shop.test/wp-admin/' . $p; }
function wp_mail( $to, $s, $b ) { $GLOBALS['mails'][] = compact( 'to', 's', 'b' ); return true; }
function wp_get_current_user() { return new class() { public $user_login = 'abi'; public function exists() { return true; } }; }
function add_action( $h, $cb, $p = 10, $a = 1 ) { $GLOBALS['actions'][ $h ][] = $cb; }
function add_filter( $h, $cb, $p = 10, $a = 1 ) {}
function current_user_can( $c ) { return ! empty( $GLOBALS['caps'][ $c ] ); }
function wp_unslash( $v ) { return $v; }
function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function sanitize_key( $v ) { return preg_replace( '/[^a-z0-9_\-]/', '', strtolower( (string) $v ) ); }
function wp_send_json_error( $d ) { throw new Fixlock_Json_Sent( $d ); }
function wp_next_scheduled( $h ) { return false; }
function wp_schedule_event( $t, $r, $h ) { $GLOBALS['scheduled'] = $h; }
function wp_clear_scheduled_hook( $h ) { unset( $GLOBALS['scheduled'] ); }
function human_time_diff( $t ) { return '1 min'; }
function wp_nonce_field( $a ) { echo '<input type="hidden" name="_wpnonce" value="n">'; }
function submit_button( $t = '', $c = '', $n = '', $w = true ) { echo '<button>' . esc_html( $t ) . '</button>'; }
function checked( $a, $b = true, $e = true ) { return $a === $b ? ' checked' : ''; }
function plugin_basename( $f ) { return 'fixlock/fixlock.php'; }
function get_current_screen() { return null; }

require __DIR__ . '/../fixlock/includes/class-fixlock-matcher.php';
require __DIR__ . '/../fixlock/includes/class-fixlock-store.php';
require __DIR__ . '/../fixlock/includes/class-fixlock-checker.php';
require __DIR__ . '/../fixlock/includes/class-fixlock-admin.php';
require __DIR__ . '/../fixlock/includes/class-fixlock-hooks.php';

$passed = 0;
function ok( $cond, $msg, $extra = '' ) {
	global $passed;
	if ( ! $cond ) { fwrite( STDERR, "FAIL $msg\n" . ( $extra ? print_r( $extra, true ) . "\n" : '' ) ); fwrite( STDERR, "WORDPRESS FAIL\n" ); exit( 1 ); }
	$passed++;
}
function write( $path, $content ) { if ( ! is_dir( dirname( $path ) ) ) { mkdir( dirname( $path ), 0777, true ); } file_put_contents( $path, $content ); }

/* ---- matcher ---- */
$code = "<?php\nfunction refund( \$order ) {\n\tif ( \$order->refunded ) {\n\t\treturn false; // never refund twice\n\t}\n\treturn gateway_refund( \$order );\n}\n";
ok( Fixlock_Matcher::snippet( $code, 3, 5 ) === array( "\tif ( \$order->refunded ) {", "\t\treturn false; // never refund twice" ), 'snippet keeps the lines worth locking (drops a lone brace)', Fixlock_Matcher::snippet( $code, 3, 5 ) );
$snip = Fixlock_Matcher::snippet( $code, 3, 5 );
ok( 'intact' === Fixlock_Matcher::state( $snip, str_replace( "\t", '    ', $code ) ), 'indentation changes keep a lock intact' );
ok( 'undone' === Fixlock_Matcher::state( $snip, "<?php\nfunction refund( \$order ) {\n\treturn gateway_refund( \$order );\n}\n" ), 'removing the guard undoes the lock' );
ok( 'missing' === Fixlock_Matcher::state( $snip, null ), 'deleted file: missing' );
ok( Fixlock_Matcher::locate( $snip, "a\n" . $code ) === array( 4, 5 ), 'locate finds the lines where they are now', Fixlock_Matcher::locate( $snip, "a\n" . $code ) );
ok( 'intact' === Fixlock_Matcher::state( $snip, str_replace( "\n", "\r\n", $code ) ), 'Windows line endings are fine' );

/* ---- a site with a plugin and a theme ---- */
$pdir = WP_PLUGIN_DIR . '/shop-gateway';
write( "$pdir/includes/refunds.php", $code );
write( "$pdir/shop-gateway.php", "<?php\n// Plugin Name: Shop Gateway\n" );
$GLOBALS['plugins'] = array( 'shop-gateway/shop-gateway.php' => array( 'Name' => 'Shop Gateway', 'Version' => '2.1.0' ), 'hello.php' => array( 'Name' => 'Hello Dolly', 'Version' => '1.7' ) );
$tdir = $GLOBALS['tmp'] . '/themes/storefront';
write( "$tdir/functions.php", "<?php\nadd_filter( 'x', '__return_true' );\nremove_action( 'wp_head', 'wp_generator' ); // hide version\n" );
write( "$tdir/.fixlock/registry.json", json_encode( array( 'version' => 2, 'locks' => array( array( 'id' => 'FIX-001', 'type' => 'bug', 'title' => 'hide the WordPress version', 'file' => 'functions.php', 'snippet' => array( "remove_action( 'wp_head', 'wp_generator' ); // hide version" ), 'owner' => '@themedev' ) ) ) ) );
$GLOBALS['themes'] = array( 'storefront' => array( 'Name' => 'Storefront', 'Version' => '4.0', 'dir' => $tdir ) );

$c = Fixlock_Store::components();
ok( isset( $c['plugin:shop-gateway'], $c['theme:storefront'] ) && ! isset( $c['plugin:.'] ) && count( $c ) === 2, 'components: folder plugins and themes (single-file plugins left out)', array_keys( $c ) );

/* ---- locking ---- */
ok( is_wp_error( Fixlock_Store::add_lock( 'plugin:shop-gateway', '../../../wp-config.php', 1, 2, 't', '' ) ), 'path traversal is refused' );
ok( is_wp_error( Fixlock_Store::add_lock( 'plugin:shop-gateway', 'nope.php', 1, 2, 't', '' ) ), 'a file that does not exist is refused' );
ok( is_wp_error( Fixlock_Store::add_lock( 'plugin:nope', 'includes/refunds.php', 1, 2, 't', '' ) ), 'an unknown plugin is refused' );
ok( is_wp_error( Fixlock_Store::add_lock( 'plugin:shop-gateway', 'includes/refunds.php', 5, 3, 't', '' ) ), 'end before start is refused' );
ok( is_wp_error( Fixlock_Store::add_lock( 'plugin:shop-gateway', 'includes/refunds.php', 3, 5, '  ', '' ) ), 'a title is required' );
$lock = Fixlock_Store::add_lock( 'plugin:shop-gateway', '/includes/refunds.php', 3, 5, 'Never refund twice <b>', 'Customers were refunded twice. Ticket #482.' );
ok( ! is_wp_error( $lock ) && 'WP-001' === $lock['id'] && 'includes/refunds.php' === $lock['file'] && 2 === count( $lock['snippet'] ) && '2.1.0' === $lock['version'] && 'abi' === $lock['by'], 'locks lines 3-5 of a plugin file as WP-001', $lock );

/* ---- checks ---- */
$r = Fixlock_Checker::run( 'first' );
ok( 2 === count( $r ) && 'intact' === $r[0]['state'] && 'developer' === $r[1]['source'] && 'intact' === $r[1]['state'], 'site lock and the theme\'s shipped lock are both checked', $r );
ok( ! $GLOBALS['mails'] && ! Fixlock_Checker::unacknowledged(), 'nothing undone: no email, no notice' );

// A plugin update replaces the patched file.
write( "$pdir/includes/refunds.php", "<?php\nfunction refund( \$order ) {\n\treturn gateway_refund( \$order );\n}\n" );
$GLOBALS['plugins']['shop-gateway/shop-gateway.php']['Version'] = '2.2.0';
Fixlock_Hooks::after_update( null, array( 'type' => 'plugin', 'action' => 'update', 'plugins' => array( 'shop-gateway/shop-gateway.php' ) ) );
$st = Fixlock_Store::state();
ok( 'undone' === $st['site:WP-001']['state'] && '2.2.0' === $st['site:WP-001']['version'], 'after the update the lock is undone', $st );
ok( 1 === count( $GLOBALS['mails'] ) && false !== strpos( $GLOBALS['mails'][0]['s'], '1 locked fix was undone' ) && false !== strpos( $GLOBALS['mails'][0]['b'], 'after updating shop-gateway' ) && false !== strpos( $GLOBALS['mails'][0]['b'], 'Ticket #482' ), 'the admin gets one email saying what and why', $GLOBALS['mails'] );
$ev = Fixlock_Store::events();
ok( 'WP-001' === $ev[0]['id'] && 'intact' === $ev[0]['from'] && 'undone' === $ev[0]['to'] && 'after updating shop-gateway' === $ev[0]['context'], 'the change is logged', $ev );
ok( array( 'site:WP-001' ) === Fixlock_Checker::unacknowledged(), 'an admin notice until someone looks' );
Fixlock_Checker::run( 'daily check' );
ok( 1 === count( $GLOBALS['mails'] ), 'still undone the next day: no second email' );
Fixlock_Checker::acknowledge( 'site:WP-001' );
ok( ! Fixlock_Checker::unacknowledged() && 'undone' === Fixlock_Store::state()['site:WP-001']['state'], 'mark as seen: notice gone, still listed as undone' );

/* ---- the page ---- */
ob_start();
Fixlock_Admin::page();
$html = ob_get_clean();
ok( false !== strpos( $html, 'Needs a look' ) && false !== strpos( $html, 'WP-001: Never refund twice &lt;b&gt;' ) && false === strpos( $html, 'twice <b>' ), 'page: undone lock first, titles escaped', $html );
ok( false !== strpos( $html, 'return false; // never refund twice' ) && false !== strpos( $html, 'FIX-001' ) && false !== strpos( $html, 'Its developers' ), 'page: the locked lines and the shipped lock' );
ok( false !== strpos( $html, 'name="_wpnonce"' ) && substr_count( $html, '<form' ) >= 4, 'page: every form has a nonce' );
ok( false === strpos( $html, "\u{1F512}" ), 'no emojis on the page' );

// Patch applied again → intact, no email.
write( "$pdir/includes/refunds.php", $code );
Fixlock_Checker::run( 'daily check' );
ok( 'intact' === Fixlock_Store::state()['site:WP-001']['state'] && 1 === count( $GLOBALS['mails'] ) && 'intact' === Fixlock_Store::events()[0]['to'], 'fix re-applied: intact again, logged, no email' );

/* ---- the theme/plugin file editor ---- */
$_POST = array( 'action' => 'edit-theme-plugin-file', 'plugin' => 'shop-gateway/shop-gateway.php', 'file' => 'shop-gateway/includes/refunds.php', 'newcontent' => "<?php\nfunction refund( \$o ) { return gateway_refund( \$o ); }\n" );
$sent = null;
try { Fixlock_Hooks::before_editor_save(); } catch ( Fixlock_Json_Sent $e ) { $sent = $e->data; }
ok( $sent && 'fixlock_locked' === $sent['code'] && false !== strpos( $sent['message'], 'WP-001' ), 'file editor: a save that undoes a locked fix is refused with a message', $sent );
$_POST['newcontent'] = "<?php\n// tidy\n" . $code;
$GLOBALS['actions'] = array(); $sent = null;
try { Fixlock_Hooks::before_editor_save(); } catch ( Fixlock_Json_Sent $e ) { $sent = $e->data; }
ok( null === $sent && ! empty( $GLOBALS['actions']['shutdown'] ), 'file editor: a save that keeps the fix goes through (checked afterwards)' );
$_POST = array( 'theme' => 'storefront', 'file' => 'functions.php', 'newcontent' => "<?php\n" );
$sent = null;
try { Fixlock_Hooks::before_editor_save(); } catch ( Fixlock_Json_Sent $e ) { $sent = $e->data; }
ok( $sent && false !== strpos( $sent['message'], 'FIX-001' ), "theme editor: the theme developers' locks are protected too" );
Fixlock_Store::save_settings( array( 'email' => true, 'block_editor' => false ) );
$sent = null;
try { Fixlock_Hooks::before_editor_save(); } catch ( Fixlock_Json_Sent $e ) { $sent = $e->data; }
ok( null === $sent, 'block_editor off: the save is allowed' );
$GLOBALS['caps']['edit_themes'] = false; Fixlock_Store::save_settings( array( 'email' => true, 'block_editor' => true ) );
$sent = null;
try { Fixlock_Hooks::before_editor_save(); } catch ( Fixlock_Json_Sent $e ) { $sent = $e->data; }
ok( null === $sent, 'users who cannot edit themes are left to core (nothing read)' );
$GLOBALS['caps']['edit_themes'] = true;

/* ---- removing, cron, uninstall ---- */
Fixlock_Store::remove_lock( 'WP-001' );
ok( ! Fixlock_Store::site_locks() && ! isset( Fixlock_Store::state()['site:WP-001'] ), 'removing a lock forgets its state' );
Fixlock_Hooks::activate();
ok( Fixlock_Hooks::CRON === $GLOBALS['scheduled'], 'activation schedules the daily check' );
Fixlock_Hooks::deactivate();
ok( ! isset( $GLOBALS['scheduled'] ), 'deactivation removes it' );
define( 'WP_UNINSTALL_PLUGIN', true );
require __DIR__ . '/../fixlock/uninstall.php';
ok( ! array_filter( array_keys( $GLOBALS['options'] ), function ( $k ) { return 0 === strpos( $k, 'fixlock_' ); } ), 'uninstall deletes every fixlock option', array_keys( $GLOBALS['options'] ) );

exec( 'rm -rf ' . escapeshellarg( $GLOBALS['tmp'] ) );
echo "WORDPRESS PASS ($passed checks)\n";
