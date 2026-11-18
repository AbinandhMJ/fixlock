<?php
/**
 * Tools > fixlock: what's locked, what an update or edit undid (with the diff), lock a new fix, settings.
 *
 * @package fixlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Admin screens.
 */
final class Fixlock_Admin {

	const CAP = 'manage_options';

	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_notices', array( __CLASS__, 'notice' ) );
		add_action( 'admin_post_fixlock', array( __CLASS__, 'handle' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( FIXLOCK_FILE ), array( __CLASS__, 'action_links' ) );
	}

	public static function menu() {
		add_management_page( __( 'fixlock', 'fixlock' ), __( 'fixlock', 'fixlock' ), self::CAP, 'fixlock', array( __CLASS__, 'page' ) );
	}

	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'tools.php?page=fixlock' ) ) . '">' . esc_html__( 'Locks', 'fixlock' ) . '</a>' );
		return $links;
	}

	/** On every admin screen except ours: a locked fix was undone and nobody has looked yet. */
	public static function notice() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( $screen && 'tools_page_fixlock' === $screen->id ) {
			return;
		}
		$n = count( Fixlock_Checker::unacknowledged() );
		if ( ! $n ) {
			return;
		}
		printf(
			'<div class="notice notice-error"><p><strong>fixlock:</strong> %s <a href="%s">%s</a></p></div>',
			esc_html(
				sprintf(
					/* translators: %d: number of fixes */
					_n( '%d locked fix is no longer in your files, usually because an update replaced a patched file.', '%d locked fixes are no longer in your files, usually because an update replaced patched files.', $n, 'fixlock' ),
					$n
				)
			),
			esc_url( admin_url( 'tools.php?page=fixlock' ) ),
			esc_html__( 'See what changed', 'fixlock' )
		);
	}

	/** Form posts: add, remove, acknowledge, check, settings. */
	public static function handle() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to change fixlock locks.', 'fixlock' ), 403 );
		}
		check_admin_referer( 'fixlock' );
		$do  = isset( $_POST['do'] ) ? sanitize_key( wp_unslash( $_POST['do'] ) ) : '';
		$msg = '';
		$err = '';
		switch ( $do ) {
			case 'add':
				$lock = Fixlock_Store::add_lock(
					isset( $_POST['component'] ) ? sanitize_text_field( wp_unslash( $_POST['component'] ) ) : '',
					isset( $_POST['file'] ) ? sanitize_text_field( wp_unslash( $_POST['file'] ) ) : '',
					isset( $_POST['start'] ) ? absint( $_POST['start'] ) : 0,
					isset( $_POST['end'] ) ? absint( $_POST['end'] ) : 0,
					isset( $_POST['title'] ) ? sanitize_text_field( wp_unslash( $_POST['title'] ) ) : '',
					isset( $_POST['reason'] ) ? sanitize_textarea_field( wp_unslash( $_POST['reason'] ) ) : '',
					isset( $_POST['kind'] ) ? sanitize_key( wp_unslash( $_POST['kind'] ) ) : 'bug'
				);
				if ( is_wp_error( $lock ) ) {
					$err = $lock->get_error_message();
				} else {
					Fixlock_Checker::run( __( 'new lock', 'fixlock' ) );
					/* translators: 1: lock id, 2: number of lines */
					$msg = sprintf( __( 'Locked as %1$s (%2$d lines). fixlock will tell you if an update or edit undoes it.', 'fixlock' ), $lock['id'], count( $lock['snippet'] ) );
				}
				break;
			case 'remove':
				$id = isset( $_POST['id'] ) ? sanitize_text_field( wp_unslash( $_POST['id'] ) ) : '';
				Fixlock_Store::remove_lock( $id );
				/* translators: %s: lock id */
				$msg = sprintf( __( 'Removed %s.', 'fixlock' ), $id );
				break;
			case 'acknowledge':
				Fixlock_Checker::acknowledge( isset( $_POST['key'] ) ? sanitize_text_field( wp_unslash( $_POST['key'] ) ) : '' );
				$msg = __( 'Marked as seen. It stays on this page until the fix is back or you remove the lock.', 'fixlock' );
				break;
			case 'check':
				Fixlock_Checker::run( __( 'checked by hand', 'fixlock' ) );
				$msg = __( 'Checked every lock.', 'fixlock' );
				break;
			case 'settings':
				Fixlock_Store::save_settings( array( 'email' => ! empty( $_POST['email'] ), 'block_editor' => ! empty( $_POST['block_editor'] ) ) );
				$msg = __( 'Settings saved.', 'fixlock' );
				break;
		}
		$args = array( 'page' => 'fixlock' );
		if ( $msg ) {
			$args['fixlock_msg'] = rawurlencode( $msg );
		}
		if ( $err ) {
			$args['fixlock_err'] = rawurlencode( $err );
		}
		wp_safe_redirect( add_query_arg( $args, admin_url( 'tools.php' ) ) );
		exit;
	}

	private static function form_open( $do ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline">';
		echo '<input type="hidden" name="action" value="fixlock"><input type="hidden" name="do" value="' . esc_attr( $do ) . '">';
		wp_nonce_field( 'fixlock' );
	}

	private static function state_label( $state ) {
		$labels = array(
			'intact'  => array( '#2E7D32', __( 'Intact', 'fixlock' ) ),
			'undone'  => array( '#C2362B', __( 'Undone', 'fixlock' ) ),
			'missing' => array( '#C2362B', __( 'File gone', 'fixlock' ) ),
		);
		$l = isset( $labels[ $state ] ) ? $labels[ $state ] : array( '#646970', $state );
		return '<strong style="color:' . esc_attr( $l[0] ) . '">' . esc_html( $l[1] ) . '</strong>';
	}

	public static function page() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$results    = Fixlock_Checker::run( __( 'fixlock page opened', 'fixlock' ) );
		$state      = Fixlock_Store::state();
		$components = Fixlock_Store::components();
		$settings   = Fixlock_Store::settings();
		$broken     = array_filter( $results, function ( $r ) { return 'intact' !== $r['state']; } );

		echo '<div class="wrap"><h1>' . esc_html__( 'fixlock', 'fixlock' ) . '</h1>';
		echo '<p>' . esc_html__( 'Lock the fixes you patched into a plugin or theme. When an update, the file editor, a deploy or an AI-written change undoes one, fixlock tells you, by email and here.', 'fixlock' ) . '</p>';
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only, set by our own redirect.
		if ( ! empty( $_GET['fixlock_msg'] ) ) {
			echo '<div class="notice notice-success"><p>' . esc_html( rawurldecode( sanitize_text_field( wp_unslash( $_GET['fixlock_msg'] ) ) ) ) . '</p></div>';
		}
		if ( ! empty( $_GET['fixlock_err'] ) ) {
			echo '<div class="notice notice-error"><p>' . esc_html( rawurldecode( sanitize_text_field( wp_unslash( $_GET['fixlock_err'] ) ) ) ) . '</p></div>';
		}
		// phpcs:enable

		if ( $broken ) {
			echo '<h2>' . esc_html__( 'Needs a look', 'fixlock' ) . '</h2>';
			foreach ( $broken as $r ) {
				$s = isset( $state[ $r['key'] ] ) ? $state[ $r['key'] ] : array();
				echo '<div class="card" style="max-width:none;border-left:4px solid #C2362B">';
				echo '<h3>' . esc_html( $r['id'] . ': ' . $r['title'] ) . ' ' . self::state_label( $r['state'] ) . '</h3>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- state_label escapes.
				echo '<p>' . esc_html( $r['component_name'] . ' / ' . $r['file'] );
				if ( ! empty( $s['since'] ) ) {
					/* translators: %s: time ago */
					echo ' · ' . esc_html( sprintf( __( 'since %s ago', 'fixlock' ), human_time_diff( $s['since'] ) ) );
				}
				if ( ! empty( $s['version'] ) ) {
					/* translators: %s: version */
					echo ' · ' . esc_html( sprintf( __( 'now version %s', 'fixlock' ), $s['version'] ) );
				}
				echo '</p>';
				if ( '' !== $r['reason'] ) {
					echo '<p><em>' . esc_html( $r['reason'] ) . '</em></p>';
				}
				// The locked lines next to what the file has there now.
				$now = '';
				if ( null !== $r['content'] && $r['at'] ) {
					$lines = Fixlock_Matcher::lines( $r['content'] );
					$from  = max( 1, min( $r['at'] ) - 2 );
					$to    = min( count( $lines ), max( $r['at'] ) + 2 );
					$now   = implode( "\n", array_slice( $lines, $from - 1, $to - $from + 1 ) );
				}
				$diff = function_exists( 'wp_text_diff' ) ? wp_text_diff( implode( "\n", $r['snippet'] ), $now, array( 'title_left' => __( 'Locked lines', 'fixlock' ), 'title_right' => null === $r['content'] ? __( 'The file is gone', 'fixlock' ) : __( 'In the file now', 'fixlock' ) ) ) : '';
				echo $diff ? wp_kses_post( $diff ) : '<pre>' . esc_html( implode( "\n", $r['missing'] ) ) . '</pre>';
				echo '<p>' . esc_html__( 'To fix: apply your patch again (the locked lines are on the left), or ask the plugin or theme author to include it. If the update fixed the problem another way, remove the lock.', 'fixlock' ) . '</p><p>';
				if ( empty( $s['acknowledged'] ) ) {
					self::form_open( 'acknowledge' );
					echo '<input type="hidden" name="key" value="' . esc_attr( $r['key'] ) . '">';
					submit_button( __( 'Mark as seen', 'fixlock' ), 'secondary', 'submit', false );
					echo '</form> ';
				}
				if ( 'site' === $r['source'] ) {
					self::form_open( 'remove' );
					echo '<input type="hidden" name="id" value="' . esc_attr( $r['id'] ) . '">';
					submit_button( __( 'Remove lock', 'fixlock' ), 'delete', 'submit', false );
					echo '</form>';
				}
				echo '</p></div>';
			}
		}

		echo '<h2>' . esc_html__( 'Locks', 'fixlock' ) . '</h2>';
		if ( ! $results ) {
			echo '<p>' . esc_html__( 'Nothing is locked yet. Lock your first fix below.', 'fixlock' ) . '</p>';
		} else {
			echo '<table class="widefat striped"><thead><tr><th>' . esc_html__( 'Lock', 'fixlock' ) . '</th><th>' . esc_html__( 'Where', 'fixlock' ) . '</th><th>' . esc_html__( 'Made by', 'fixlock' ) . '</th><th>' . esc_html__( 'State', 'fixlock' ) . '</th><th></th></tr></thead><tbody>';
			foreach ( $results as $r ) {
				echo '<tr><td><strong>' . esc_html( $r['id'] ) . '</strong> ' . esc_html( $r['title'] ) . '</td>';
				echo '<td>' . esc_html( $r['component_name'] ) . '<br><code>' . esc_html( $r['file'] ) . ( $r['at'] ? ':' . (int) min( $r['at'] ) . '-' . (int) max( $r['at'] ) : '' ) . '</code></td>';
				echo '<td>' . ( 'developer' === $r['source'] ? esc_html__( 'Its developers', 'fixlock' ) : esc_html( $r['by'] ? $r['by'] : __( 'This site', 'fixlock' ) ) ) . '</td>';
				echo '<td>' . self::state_label( $r['state'] ) . '</td><td>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- state_label escapes.
				if ( 'site' === $r['source'] ) {
					self::form_open( 'remove' );
					echo '<input type="hidden" name="id" value="' . esc_attr( $r['id'] ) . '">';
					submit_button( __( 'Remove', 'fixlock' ), 'link delete', 'submit', false );
					echo '</form>';
				}
				echo '</td></tr>';
			}
			echo '</tbody></table><p>';
			self::form_open( 'check' );
			submit_button( __( 'Check now', 'fixlock' ), 'secondary', 'submit', false );
			echo '</form></p>';
		}

		echo '<h2>' . esc_html__( 'Lock a fix', 'fixlock' ) . '</h2>';
		echo '<p>' . esc_html__( 'Patched a bug in a plugin or theme? Lock the lines you changed. Line numbers are in the theme and plugin file editors, or any code editor.', 'fixlock' ) . '</p>';
		self::form_open( 'add' );
		echo '<table class="form-table"><tr><th><label for="fixlock-component">' . esc_html__( 'Plugin or theme', 'fixlock' ) . '</label></th><td><select id="fixlock-component" name="component" required><option value="">' . esc_html__( 'Choose', 'fixlock' ) . '</option>';
		foreach ( $components as $key => $c ) {
			echo '<option value="' . esc_attr( $key ) . '">' . esc_html( ( 'plugin' === $c['type'] ? __( 'Plugin', 'fixlock' ) : __( 'Theme', 'fixlock' ) ) . ': ' . $c['name'] ) . '</option>';
		}
		echo '</select></td></tr>';
		echo '<tr><th><label for="fixlock-file">' . esc_html__( 'File', 'fixlock' ) . '</label></th><td><input id="fixlock-file" name="file" class="regular-text code" placeholder="includes/class-cart.php" required><p class="description">' . esc_html__( 'Path inside the plugin or theme folder.', 'fixlock' ) . '</p></td></tr>';
		echo '<tr><th>' . esc_html__( 'Lines', 'fixlock' ) . '</th><td><input name="start" type="number" min="1" class="small-text" required aria-label="' . esc_attr__( 'First line', 'fixlock' ) . '"> ' . esc_html__( 'to', 'fixlock' ) . ' <input name="end" type="number" min="1" class="small-text" required aria-label="' . esc_attr__( 'Last line', 'fixlock' ) . '"></td></tr>';
		echo '<tr><th><label for="fixlock-title">' . esc_html__( 'What it fixes', 'fixlock' ) . '</label></th><td><input id="fixlock-title" name="title" class="regular-text" placeholder="' . esc_attr__( 'Stop double charges on refunds', 'fixlock' ) . '" required></td></tr>';
		echo '<tr><th><label for="fixlock-reason">' . esc_html__( 'Why it matters', 'fixlock' ) . '</label></th><td><textarea id="fixlock-reason" name="reason" rows="2" class="large-text" placeholder="' . esc_attr__( 'Customers were charged twice when a refund failed. Support ticket #482.', 'fixlock' ) . '"></textarea></td></tr>';
		echo '<tr><th>' . esc_html__( 'Kind', 'fixlock' ) . '</th><td><label><input type="radio" name="kind" value="bug" checked> ' . esc_html__( 'Bug fix', 'fixlock' ) . '</label> &nbsp; <label><input type="radio" name="kind" value="feature"> ' . esc_html__( 'Finished feature', 'fixlock' ) . '</label></td></tr></table>';
		submit_button( __( 'Lock these lines', 'fixlock' ) );
		echo '</form>';

		$events = Fixlock_Store::events();
		if ( $events ) {
			echo '<h2>' . esc_html__( 'Recent changes', 'fixlock' ) . '</h2><ul>';
			foreach ( array_slice( $events, 0, 15 ) as $e ) {
				/* translators: 1: time ago, 2: lock id and title, 3: old state, 4: new state, 5: what happened */
				echo '<li>' . esc_html( sprintf( __( '%1$s ago: %2$s went from %3$s to %4$s%5$s', 'fixlock' ), human_time_diff( $e['time'] ), $e['id'] . ' ' . $e['title'], $e['from'], $e['to'], '' !== $e['context'] ? ' (' . $e['context'] . ')' : '' ) ) . '</li>';
			}
			echo '</ul>';
		}

		echo '<h2>' . esc_html__( 'Settings', 'fixlock' ) . '</h2>';
		self::form_open( 'settings' );
		echo '<p><label><input type="checkbox" name="email" value="1"' . checked( $settings['email'], true, false ) . '> ' . esc_html__( 'Email the site admin when a locked fix is undone', 'fixlock' ) . '</label></p>';
		echo '<p><label><input type="checkbox" name="block_editor" value="1"' . checked( $settings['block_editor'], true, false ) . '> ' . esc_html__( 'Refuse theme and plugin file editor saves that would undo a locked fix', 'fixlock' ) . '</label></p>';
		submit_button( __( 'Save settings', 'fixlock' ), 'secondary' );
		echo '</form>';

		echo '<h2>' . esc_html__( 'For developers', 'fixlock' ) . '</h2><p>';
		printf(
			/* translators: %s: link to the docs */
			esc_html__( 'Plugins and themes built with the fixlock command-line tool ship their locks in .fixlock/registry.json; this site checks those too. See %s.', 'fixlock' ),
			'<a href="https://abinandhmj.github.io/fixlock/integrations/wordpress">' . esc_html__( 'fixlock for WordPress developers', 'fixlock' ) . '</a>'
		);
		echo '</p><p class="description">fixlock · ' . esc_html__( 'fixed stays fixed', 'fixlock' ) . ' · ' . esc_html__( 'a product of Algotricz', 'fixlock' ) . '</p></div>';
	}
}
