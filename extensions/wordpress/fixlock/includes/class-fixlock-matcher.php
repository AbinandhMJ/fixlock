<?php
/**
 * Finds locked lines in a file. Pure PHP with no WordPress calls, so it can be tested on its own.
 *
 * Same rules as fixlock's text matching: whitespace doesn't matter, lines made only of brackets and
 * semicolons are ignored, and a lock is intact when every one of its lines is still in the file.
 *
 * @package fixlock
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Lock matching.
 */
final class Fixlock_Matcher {

	/** Collapse whitespace and trim. */
	public static function norm( $line ) {
		return trim( preg_replace( '/\s+/u', ' ', (string) $line ) );
	}

	/** A line with nothing to lock: blank, or only brackets, parentheses, semicolons and commas. */
	public static function trivial( $line ) {
		return 1 === preg_match( '/^[\s{}()\[\];,]*$/', (string) $line );
	}

	/** Split file content into lines (any line ending). */
	public static function lines( $content ) {
		return preg_split( '/\r\n|\r|\n/', (string) $content );
	}

	/**
	 * The lines worth locking out of lines $start..$end (1-based, inclusive) of $content.
	 *
	 * @return string[]
	 */
	public static function snippet( $content, $start, $end ) {
		$lines = self::lines( $content );
		$start = max( 1, (int) $start );
		$end   = min( count( $lines ), (int) $end );
		$out   = array();
		for ( $i = $start; $i <= $end; $i++ ) {
			if ( ! self::trivial( $lines[ $i - 1 ] ) ) {
				$out[] = rtrim( $lines[ $i - 1 ] );
			}
		}
		return $out;
	}

	/**
	 * Locked lines that are no longer in $content.
	 *
	 * @param string[]    $snippet Locked lines.
	 * @param string|null $content File content, or null if the file is gone.
	 * @return string[]
	 */
	public static function missing( array $snippet, $content ) {
		if ( null === $content ) {
			return $snippet;
		}
		$have = array();
		foreach ( self::lines( $content ) as $l ) {
			$have[ self::norm( $l ) ] = true;
		}
		$out = array();
		foreach ( $snippet as $l ) {
			if ( ! isset( $have[ self::norm( $l ) ] ) ) {
				$out[] = $l;
			}
		}
		return $out;
	}

	/**
	 * Where the locked lines are now: 1-based line numbers of the tightest run that matches them in order.
	 *
	 * @return int[]
	 */
	public static function locate( array $snippet, $content ) {
		if ( null === $content || ! $snippet ) {
			return array();
		}
		$n    = array_map( array( __CLASS__, 'norm' ), self::lines( $content ) );
		$snip = array_map( array( __CLASS__, 'norm' ), $snippet );
		$starts = array_keys( $n, $snip[0], true );
		if ( ! $starts ) {
			$starts = array( 0 );
		}
		$best = array();
		foreach ( $starts as $s0 ) {
			$found = array();
			$from  = $s0;
			$count = count( $n );
			foreach ( $snip as $s ) {
				for ( $i = $from; $i < $count; $i++ ) {
					if ( $n[ $i ] === $s ) {
						$found[] = $i + 1;
						$from    = $i + 1;
						break;
					}
				}
			}
			if ( count( $found ) > count( $best ) || ( count( $found ) === count( $best ) && $found && ( end( $found ) - $found[0] ) < ( end( $best ) - $best[0] ) ) ) {
				$best = $found;
			}
		}
		return $best;
	}

	/**
	 * State of a lock in $content: 'intact', 'undone' (some locked lines are gone) or 'missing' (no file).
	 */
	public static function state( array $snippet, $content ) {
		if ( null === $content ) {
			return 'missing';
		}
		return self::missing( $snippet, $content ) ? 'undone' : 'intact';
	}
}
