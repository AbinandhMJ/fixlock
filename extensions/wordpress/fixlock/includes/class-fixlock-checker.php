<?php
/**
 * Checks every lock against the files on disk, records what changed, and alerts the site admin.
 * Runs after plugin and theme updates, after theme/plugin file editor saves, once a day (so FTP, deploys
 * and AI-written edits are caught too), and whenever the fixlock page is opened.
 *
 * @package fixlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lock checks and alerts.
 */
final class Fixlock_Checker {

	/**
	 * Check all locks. $context says what happened ("after updating WooCommerce to 9.4", "daily check").
	 *
	 * @return array[] Each lock with 'state', 'missing', 'at' (current line numbers), 'path', 'component_name'.
	 */
	public static function run( $context = '' ) {
		$components = Fixlock_Store::components();
		$locks      = Fixlock_Store::all_locks( $components );
		$state      = Fixlock_Store::state();
		$events     = array();
		$undone     = array();
		$results    = array();
		$now        = time();
		$seen       = array();

		foreach ( $locks as $lock ) {
			$path    = Fixlock_Store::path_of( $lock, $components );
			$content = ( $path && is_readable( $path ) ) ? (string) file_get_contents( $path ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
			$now_is  = Fixlock_Matcher::state( $lock['snippet'], $content );
			$key     = $lock['key'];
			$seen[ $key ] = true;
			$before  = isset( $state[ $key ]['state'] ) ? $state[ $key ]['state'] : null;
			$version = isset( $components[ $lock['component'] ] ) ? $components[ $lock['component'] ]['version'] : '';

			if ( null !== $before && $before !== $now_is ) {
				$events[] = array(
					'time'    => $now,
					'key'     => $key,
					'id'      => $lock['id'],
					'title'   => $lock['title'],
					'from'    => $before,
					'to'      => $now_is,
					'context' => (string) $context,
					'version' => $version,
				);
				if ( 'intact' === $before ) {
					$undone[] = $lock;
				}
			}
			$state[ $key ] = array(
				'state'        => $now_is,
				'checked'      => $now,
				'since'        => ( $before === $now_is && isset( $state[ $key ]['since'] ) ) ? $state[ $key ]['since'] : $now,
				'version'      => $version,
				// A newly undone lock needs a look; it stays flagged until someone acknowledges it or it's restored.
				'acknowledged' => 'intact' === $now_is ? true : ( $before === $now_is && ! empty( $state[ $key ]['acknowledged'] ) ),
			);
			$results[] = array_merge(
				$lock,
				array(
					'state'          => $now_is,
					'missing'        => Fixlock_Matcher::missing( $lock['snippet'], $content ),
					'at'             => Fixlock_Matcher::locate( $lock['snippet'], $content ),
					'path'           => $path,
					'content'        => $content,
					'component_name' => isset( $components[ $lock['component'] ] ) ? $components[ $lock['component'] ]['name'] : $lock['component'],
				)
			);
		}
		$state = array_intersect_key( $state, $seen ); // Forget locks that no longer exist.
		update_option( Fixlock_Store::STATE, $state, false );
		Fixlock_Store::add_events( $events );
		if ( $undone ) {
			self::email( $undone, $context );
		}
		return $results;
	}

	/** Locks that are undone and nobody has looked at yet (for the admin notice). */
	public static function unacknowledged() {
		$out = array();
		foreach ( Fixlock_Store::state() as $key => $s ) {
			if ( 'intact' !== $s['state'] && empty( $s['acknowledged'] ) ) {
				$out[] = $key;
			}
		}
		return $out;
	}

	public static function acknowledge( $key ) {
		$state = Fixlock_Store::state();
		if ( isset( $state[ $key ] ) ) {
			$state[ $key ]['acknowledged'] = true;
			update_option( Fixlock_Store::STATE, $state, false );
		}
	}

	/**
	 * Locks in $abs_path that $new_content would undo (for refusing a file editor save).
	 *
	 * @return array[]
	 */
	public static function would_undo( $abs_path, $new_content ) {
		$components = Fixlock_Store::components();
		$real       = realpath( $abs_path );
		$hits       = array();
		foreach ( Fixlock_Store::all_locks( $components ) as $lock ) {
			$p = Fixlock_Store::path_of( $lock, $components );
			if ( ! $p || realpath( $p ) !== $real ) {
				continue;
			}
			$old = is_readable( $p ) ? (string) file_get_contents( $p ) : null; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
			if ( 'intact' === Fixlock_Matcher::state( $lock['snippet'], $old ) && 'intact' !== Fixlock_Matcher::state( $lock['snippet'], $new_content ) ) {
				$hits[] = $lock;
			}
		}
		return $hits;
	}

	private static function email( array $undone, $context ) {
		$settings = Fixlock_Store::settings();
		if ( empty( $settings['email'] ) ) {
			return;
		}
		$site  = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
		$lines = array();
		foreach ( $undone as $l ) {
			$lines[] = '- ' . $l['id'] . ': ' . $l['title'] . ' (' . $l['file'] . ')' . ( '' !== $l['reason'] ? "\n  Why it's locked: " . $l['reason'] : '' );
		}
		$subject = sprintf(
			/* translators: 1: site name, 2: number of fixes */
			_n( '[%1$s] %2$d locked fix was undone', '[%1$s] %2$d locked fixes were undone', count( $undone ), 'fixlock' ),
			$site,
			count( $undone )
		);
		$body = sprintf(
			/* translators: 1: what happened, 2: list of fixes, 3: admin URL */
			__( "fixlock noticed that these fixes are no longer in your site's files%1\$s:\n\n%2\$s\n\nThis usually means a plugin or theme update replaced a file you had patched. See what changed and what to do:\n%3\$s\n\nfixlock: fixed stays fixed. A product of Algotricz.", 'fixlock' ),
			'' !== $context ? ' (' . $context . ')' : '',
			implode( "\n", $lines ),
			admin_url( 'tools.php?page=fixlock' )
		);
		wp_mail( get_option( 'admin_email' ), $subject, $body );
	}
}
