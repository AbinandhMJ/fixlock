<?php
/**
 * Plugin Name:       fixlock
 * Plugin URI:        https://abinandhmj.github.io/fixlock/integrations/wordpress
 * Description:       Lock the fixes you patched into plugins and themes. When an update, the file editor or a deploy undoes one, fixlock tells you and shows what changed.
 * Version:           0.9.0
 * Requires at least: 6.2
 * Requires PHP:      7.4
 * Author:            Algotricz
 * Author URI:        https://github.com/AbinandhMJ/fixlock
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Text Domain:       fixlock
 *
 * @package fixlock
 */

defined( 'ABSPATH' ) || exit;

define( 'FIXLOCK_VERSION', '0.9.0' );
define( 'FIXLOCK_FILE', __FILE__ );

require_once __DIR__ . '/includes/class-fixlock-matcher.php';
require_once __DIR__ . '/includes/class-fixlock-store.php';
require_once __DIR__ . '/includes/class-fixlock-checker.php';
require_once __DIR__ . '/includes/class-fixlock-admin.php';
require_once __DIR__ . '/includes/class-fixlock-hooks.php';

Fixlock_Hooks::init();
if ( is_admin() ) {
	Fixlock_Admin::init();
}

register_activation_hook( __FILE__, array( 'Fixlock_Hooks', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Fixlock_Hooks', 'deactivate' ) );
