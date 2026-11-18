<?php
/**
 * Removes fixlock's data when the plugin is deleted.
 *
 * @package fixlock
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

foreach ( array( 'fixlock_locks', 'fixlock_state', 'fixlock_events', 'fixlock_settings' ) as $fixlock_option ) {
	delete_option( $fixlock_option );
}
wp_clear_scheduled_hook( 'fixlock_daily_check' );
