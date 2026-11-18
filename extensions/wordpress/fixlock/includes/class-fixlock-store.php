<?php
/**
 * Where locks live: locks made on this site (an option), and locks shipped by a plugin or theme's
 * developers in its .fixlock/registry.json. Also the plugins and themes a lock can point into.
 *
 * @package fixlock
 */

defined( 'ABSPATH' ) || defined( 'FIXLOCK_TESTING' ) || exit;

/**
 * Lock storage.
 */
final class Fixlock_Store {

	const LOCKS    = 'fixlock_locks';
	const STATE    = 'fixlock_state';
	const EVENTS   = 'fixlock_events';
	const SETTINGS = 'fixlock_settings';
	const MAX_EVENTS = 50;

	/** Settings with their defaults. */
	public static function settings() {
		$s = get_option( self::SETTINGS, array() );
		return array_merge(
			array(
				'email'        => true, // Email the site admin when a locked fix is undone.
				'block_editor' => true, // Refuse theme/plugin file editor saves that undo a locked fix.
			),
			is_array( $s ) ? $s : array()
		);
	}

	public static function save_settings( array $s ) {
		update_option( self::SETTINGS, array( 'email' => ! empty( $s['email'] ), 'block_editor' => ! empty( $s['block_editor'] ) ), false );
	}

	/**
	 * Plugins and themes installed as folders: [ 'plugin:akismet' => [ type, slug, name, version, dir ] ].
	 */
	public static function components() {
		$out = array();
		if ( ! function_exists( 'get_plugins' ) && defined( 'ABSPATH' ) && file_exists( ABSPATH . 'wp-admin/includes/plugin.php' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		foreach ( (array) get_plugins() as $basename => $data ) {
			$slug = dirname( $basename );
			if ( '.' === $slug ) {
				continue; // Single-file plugins (no folder) can't be locked yet.
			}
			$out[ 'plugin:' . $slug ] = array(
				'type'    => 'plugin',
				'slug'    => $slug,
				'name'    => isset( $data['Name'] ) ? $data['Name'] : $slug,
				'version' => isset( $data['Version'] ) ? $data['Version'] : '',
				'dir'     => WP_PLUGIN_DIR . '/' . $slug,
			);
		}
		foreach ( (array) wp_get_themes() as $slug => $theme ) {
			$out[ 'theme:' . $slug ] = array(
				'type'    => 'theme',
				'slug'    => $slug,
				'name'    => $theme->get( 'Name' ),
				'version' => $theme->get( 'Version' ),
				'dir'     => $theme->get_stylesheet_directory(),
			);
		}
		return $out;
	}

	/** Locks made on this site. */
	public static function site_locks() {
		$l = get_option( self::LOCKS, array() );
		return is_array( $l ) ? array_values( $l ) : array();
	}

	/**
	 * Locks a plugin or theme ships in .fixlock/registry.json (made by its developers with fixlock).
	 */
	public static function shipped_locks( array $components ) {
		$out = array();
		foreach ( $components as $key => $c ) {
			$file = $c['dir'] . '/.fixlock/registry.json';
			if ( ! is_readable( $file ) ) {
				continue;
			}
			$reg = json_decode( (string) file_get_contents( $file ), true ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
			if ( ! is_array( $reg ) || empty( $reg['locks'] ) || ! is_array( $reg['locks'] ) ) {
				continue;
			}
			foreach ( $reg['locks'] as $l ) {
				if ( empty( $l['id'] ) || empty( $l['file'] ) || empty( $l['snippet'] ) || ! is_array( $l['snippet'] ) ) {
					continue;
				}
				$out[] = array(
					'key'       => 'dev:' . $key . ':' . $l['id'],
					'id'        => (string) $l['id'],
					'title'     => isset( $l['title'] ) ? (string) $l['title'] : '',
					'reason'    => isset( $l['reason'] ) ? (string) $l['reason'] : '',
					'kind'      => ( isset( $l['type'] ) && 'feature' === $l['type'] ) ? 'feature' : 'bug',
					'component' => $key,
					'file'      => (string) $l['file'],
					'snippet'   => array_map( 'strval', $l['snippet'] ),
					'source'    => 'developer',
					'by'        => isset( $l['owner'] ) ? (string) $l['owner'] : '',
				);
			}
		}
		return $out;
	}

	/** Every lock this site checks: its own, then the shipped ones. */
	public static function all_locks( array $components = null ) {
		$components = null === $components ? self::components() : $components;
		$own = array();
		foreach ( self::site_locks() as $l ) {
			$l['key']    = 'site:' . $l['id'];
			$l['source'] = 'site';
			$own[]       = $l;
		}
		return array_merge( $own, self::shipped_locks( $components ) );
	}

	/**
	 * Absolute path of a file inside a component, or a WP_Error if it isn't one (outside it, missing, not a file).
	 */
	public static function resolve( array $component, $file ) {
		$file = ltrim( str_replace( '\\', '/', (string) $file ), '/' );
		if ( '' === $file || false !== strpos( $file, '..' ) || false !== strpos( $file, "\0" ) ) {
			return new WP_Error( 'fixlock_path', __( 'Give a file path inside the plugin or theme folder, such as includes/class-cart.php.', 'fixlock' ) );
		}
		$base = realpath( $component['dir'] );
		$abs  = realpath( $component['dir'] . '/' . $file );
		if ( false === $base || false === $abs || 0 !== strpos( $abs, $base . DIRECTORY_SEPARATOR ) || ! is_file( $abs ) ) {
			/* translators: %s: file path */
			return new WP_Error( 'fixlock_path', sprintf( __( 'No file %s in that plugin or theme.', 'fixlock' ), $file ) );
		}
		return $abs;
	}

	/** Absolute path of a lock's file (it may not exist any more). */
	public static function path_of( array $lock, array $components ) {
		if ( ! isset( $components[ $lock['component'] ] ) ) {
			return null;
		}
		return $components[ $lock['component'] ]['dir'] . '/' . ltrim( $lock['file'], '/' );
	}

	/**
	 * Lock lines $start..$end of a file in a plugin or theme. Returns the new lock or a WP_Error.
	 */
	public static function add_lock( $component_key, $file, $start, $end, $title, $reason, $kind = 'bug' ) {
		$components = self::components();
		if ( ! isset( $components[ $component_key ] ) ) {
			return new WP_Error( 'fixlock_component', __( 'Choose a plugin or theme.', 'fixlock' ) );
		}
		$start = (int) $start;
		$end   = (int) $end;
		if ( $start < 1 || $end < $start ) {
			return new WP_Error( 'fixlock_lines', __( 'Give the first and last line of the fix, such as 120 and 126.', 'fixlock' ) );
		}
		if ( $end - $start > 200 ) {
			return new WP_Error( 'fixlock_lines', __( 'Lock at most 200 lines at once: the lines of the fix itself.', 'fixlock' ) );
		}
		$abs = self::resolve( $components[ $component_key ], $file );
		if ( is_wp_error( $abs ) ) {
			return $abs;
		}
		$content = (string) file_get_contents( $abs ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$snippet = Fixlock_Matcher::snippet( $content, $start, $end );
		if ( ! $snippet ) {
			return new WP_Error( 'fixlock_lines', __( 'Those lines are empty. Check the line numbers.', 'fixlock' ) );
		}
		$title = trim( (string) $title );
		if ( '' === $title ) {
			return new WP_Error( 'fixlock_title', __( 'Say what the fix does, such as "Stop double charges on refunds".', 'fixlock' ) );
		}
		$locks = self::site_locks();
		$n     = 0;
		foreach ( $locks as $l ) {
			if ( preg_match( '/^WP-(\d+)$/', $l['id'], $m ) ) {
				$n = max( $n, (int) $m[1] );
			}
		}
		$user = function_exists( 'wp_get_current_user' ) ? wp_get_current_user() : null;
		$lock = array(
			'id'        => sprintf( 'WP-%03d', $n + 1 ),
			'title'     => $title,
			'reason'    => trim( (string) $reason ),
			'kind'      => 'feature' === $kind ? 'feature' : 'bug',
			'component' => $component_key,
			'file'      => ltrim( str_replace( '\\', '/', substr( $abs, strlen( realpath( $components[ $component_key ]['dir'] ) ) ) ), '/' ),
			'snippet'   => $snippet,
			'lines'     => array( $start, $end ),
			'version'   => $components[ $component_key ]['version'],
			'created'   => time(),
			'by'        => $user && $user->exists() ? $user->user_login : '',
		);
		$locks[] = $lock;
		update_option( self::LOCKS, $locks, false );
		return $lock;
	}

	public static function remove_lock( $id ) {
		$locks = array_values( array_filter( self::site_locks(), function ( $l ) use ( $id ) { return $l['id'] !== $id; } ) );
		update_option( self::LOCKS, $locks, false );
		$state = self::state();
		unset( $state[ 'site:' . $id ] );
		update_option( self::STATE, $state, false );
	}

	/** Last known state per lock key: [ state, checked, since, version, acknowledged ]. */
	public static function state() {
		$s = get_option( self::STATE, array() );
		return is_array( $s ) ? $s : array();
	}

	public static function events() {
		$e = get_option( self::EVENTS, array() );
		return is_array( $e ) ? $e : array();
	}

	public static function add_events( array $new ) {
		if ( ! $new ) {
			return;
		}
		$all = array_slice( array_merge( $new, self::events() ), 0, self::MAX_EVENTS );
		update_option( self::EVENTS, $all, false );
	}
}
