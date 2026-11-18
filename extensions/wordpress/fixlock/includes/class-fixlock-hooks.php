<?php
/**
 * When fixlock checks: after plugin and theme updates, around theme/plugin file editor saves, and daily.
 *
 * @package fixlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Hooks into WordPress.
 */
final class Fixlock_Hooks {

	const CRON = 'fixlock_daily_check';

	public static function init() {
		add_action( 'upgrader_process_complete', array( __CLASS__, 'after_update' ), 20, 2 );
		add_action( self::CRON, array( __CLASS__, 'daily' ) );
		// Before core's handler (priority 1) so a save that undoes a locked fix can be refused.
		add_action( 'wp_ajax_edit-theme-plugin-file', array( __CLASS__, 'before_editor_save' ), 0 );
	}

	public static function activate() {
		if ( ! wp_next_scheduled( self::CRON ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CRON );
		}
	}

	public static function deactivate() {
		wp_clear_scheduled_hook( self::CRON );
	}

	public static function daily() {
		Fixlock_Checker::run( __( 'daily check', 'fixlock' ) );
	}

	/** After plugins or themes were updated, installed or replaced. */
	public static function after_update( $upgrader, $extra ) {
		if ( ! is_array( $extra ) || empty( $extra['type'] ) || ! in_array( $extra['type'], array( 'plugin', 'theme' ), true ) ) {
			return;
		}
		$names = array();
		if ( ! empty( $extra['plugins'] ) ) {
			$names = array_map( 'dirname', (array) $extra['plugins'] );
		} elseif ( ! empty( $extra['plugin'] ) ) {
			$names = array( dirname( $extra['plugin'] ) );
		} elseif ( ! empty( $extra['themes'] ) ) {
			$names = (array) $extra['themes'];
		} elseif ( ! empty( $extra['theme'] ) ) {
			$names = array( $extra['theme'] );
		}
		$what = $names ? implode( ', ', $names ) : $extra['type'];
		/* translators: %s: plugin or theme names */
		Fixlock_Checker::run( sprintf( __( 'after updating %s', 'fixlock' ), $what ) );
	}

	/**
	 * Theme/plugin file editor: refuse a save that undoes a locked fix (setting "block_editor"); otherwise
	 * check after the save.
	 */
	public static function before_editor_save() {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- read-only here; core verifies the nonce before it writes.
		if ( empty( $_POST['file'] ) || ! isset( $_POST['newcontent'] ) ) {
			return;
		}
		$file = wp_unslash( $_POST['file'] ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- a path, compared after realpath().
		$abs  = null;
		if ( ! empty( $_POST['plugin'] ) && current_user_can( 'edit_plugins' ) ) {
			$abs = WP_PLUGIN_DIR . '/' . ltrim( (string) $file, '/' );
		} elseif ( ! empty( $_POST['theme'] ) && current_user_can( 'edit_themes' ) ) {
			$theme = wp_get_theme( sanitize_text_field( wp_unslash( $_POST['theme'] ) ) );
			$abs   = $theme->exists() ? $theme->get_stylesheet_directory() . '/' . ltrim( (string) $file, '/' ) : null;
		}
		if ( ! $abs || false === realpath( $abs ) ) {
			return;
		}
		$settings = Fixlock_Store::settings();
		if ( ! empty( $settings['block_editor'] ) ) {
			$hits = Fixlock_Checker::would_undo( $abs, wp_unslash( $_POST['newcontent'] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- file content, compared only.
			if ( $hits ) {
				$ids = implode( ', ', array_map( function ( $l ) { return $l['id'] . ' (' . $l['title'] . ')'; }, $hits ) );
				wp_send_json_error(
					array(
						'code'    => 'fixlock_locked',
						/* translators: %s: lock ids and titles */
						'message' => sprintf( __( 'Not saved: this change undoes a locked fix: %s. If that is intended, remove the lock in Tools > fixlock first, then save again.', 'fixlock' ), $ids ),
					)
				);
			}
		}
		// phpcs:enable
		add_action( 'shutdown', function () {
			Fixlock_Checker::run( __( 'after a file editor save', 'fixlock' ) );
		} );
	}
}
