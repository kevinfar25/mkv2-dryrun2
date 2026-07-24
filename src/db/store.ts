import pg from "pg";

export type Player = { id: string; name: string };
export type Score = {
  id: string;
  playerId: string;
  points: number;
  createdAt: Date;
};

/**
 * The persistence seam. Unit tests + CI run against InMemoryStore (hermetic, no DB).
 * Runtime / switch-on / prod-test set DATABASE_URL and run against PgStore (a real
 * Postgres container). Feature phases extend this interface as they add tables.
 */
export interface Store {
  addPlayer(name: string): Promise<Player>;
  getPlayer(id: string): Promise<Player | null>;
  addScore(playerId: string, points: number): Promise<Score>;
  topScores(limit?: number | null): Promise<Score[]>;
  health(): Promise<boolean>;
}

/**
 * Shared validation/normalization so InMemoryStore and PgStore stay
 * BEHAVIOURALLY IDENTICAL (repo rule).
 */

// `scores.points` is Postgres `int not null` -> a signed 32-bit integer.
// Reject anything Postgres itself would reject so the two stores agree: not
// only NaN/Infinity/floats, but also integers outside int32 range (e.g.
// 2147483648, 1e100, > MAX_SAFE_INTEGER) which InMemory would silently accept
// while Postgres errors. Number.isSafeInteger() rules out NaN/Infinity/floats
// and anything above MAX_SAFE_INTEGER; the range check enforces int32.
export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;
export function assertValidPoints(points: number): void {
  if (!Number.isSafeInteger(points) || points < INT32_MIN || points > INT32_MAX) {
    throw new Error(
      `invalid points: ${points} (must be an int32 integer in [${INT32_MIN}, ${INT32_MAX}])`,
    );
  }
}

// limit contract: a finite value is clamped to a non-negative integer; any
// non-finite value (undefined/null/NaN/Infinity) means "no limit" — return ALL
// rows, represented as `null` (Postgres reads `LIMIT NULL` as unbounded and
// InMemoryStore skips the slice).
//
// Oversized FINITE limits are also mapped to `null` (unbounded): an in-memory
// `slice(0, 1e100)` silently returns everything, but Postgres `LIMIT 1e100`
// overflows bigint and errors — divergent behaviour. Any request for more than
// MAX_LIMIT rows means "give me everything" in both stores, so both collapse to
// the same unbounded query and stay identical.
export const MAX_LIMIT = 1_000_000;
export function normalizeLimit(limit?: number | null): number | null {
  if (limit == null || !Number.isFinite(limit)) return null;
  const n = Math.max(0, Math.trunc(limit));
  return n > MAX_LIMIT ? null : n;
}

// Deterministic ordering contract, IDENTICAL in both stores:
//   points DESC, created_at ASC, id ASC
// The final `id` tie-break is what makes equal-points/equal-created_at rows
// deterministic; it must not rely on fabricated strictly-increasing timestamps.
function compareScores(a: Score, b: Score): number {
  return (
    b.points - a.points ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export class InMemoryStore implements Store {
  private players = new Map<string, Player>();
  private scores: Score[] = [];
  private seq = 0;
  private scoreSeq = 0;

  // All in-memory scores share one created_at. Postgres `now()` is the
  // transaction timestamp, so scores inserted in the same instant/transaction
  // collide on created_at and fall through to the `id` tie-break — exactly the
  // parity edge a fabricated strictly-increasing clock would hide. A constant
  // clock makes that the common case, so the id tie-break is genuinely
  // exercised and insertion order is preserved via the `s1 < s2 < ...` ids.
  private static readonly CLOCK = new Date(0);

  async addPlayer(name: string): Promise<Player> {
    const id = `p${++this.seq}`;
    const player: Player = { id, name };
    this.players.set(id, player);
    return player;
  }

  async getPlayer(id: string): Promise<Player | null> {
    return this.players.get(id) ?? null;
  }

  async addScore(playerId: string, points: number): Promise<Score> {
    assertValidPoints(points);
    // Enforce the same FK contract PgStore gets for free from
    // scores.player_id -> players.id: unknown players are rejected.
    if (!this.players.has(playerId)) {
      throw new Error(`unknown player: ${playerId}`);
    }
    const n = ++this.scoreSeq;
    const score: Score = {
      id: `s${n}`,
      playerId,
      points,
      createdAt: InMemoryStore.CLOCK,
    };
    this.scores.push(score);
    return score;
  }

  async topScores(limit?: number | null): Promise<Score[]> {
    const n = normalizeLimit(limit);
    const sorted = [...this.scores].sort(compareScores);
    return n === null ? sorted : sorted.slice(0, n);
  }

  async health(): Promise<boolean> {
    return true;
  }
}

export class PgStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async addPlayer(name: string): Promise<Player> {
    const { rows } = await this.pool.query<Player>(
      "INSERT INTO players(name) VALUES($1) RETURNING id, name",
      [name],
    );
    return rows[0];
  }

  async getPlayer(id: string): Promise<Player | null> {
    const { rows } = await this.pool.query<Player>(
      "SELECT id, name FROM players WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  }

  async addScore(playerId: string, points: number): Promise<Score> {
    // Same points contract as InMemoryStore.
    assertValidPoints(points);
    try {
      const { rows } = await this.pool.query<{
        id: string;
        player_id: string;
        points: number;
        created_at: Date;
      }>(
        "INSERT INTO scores(player_id, points) VALUES($1, $2) RETURNING id, player_id, points, created_at",
        [playerId, points],
      );
      const r = rows[0];
      return { id: r.id, playerId: r.player_id, points: r.points, createdAt: r.created_at };
    } catch (err) {
      // Normalize the unknown-player rejection to the SAME domain error
      // InMemoryStore throws. Postgres surfaces a missing FK as 23503
      // (foreign_key_violation) and a malformed UUID as 22P02
      // (invalid_text_representation); both mean "unknown player".
      const code = (err as { code?: string })?.code;
      if (code === "23503" || code === "22P02") {
        throw new Error(`unknown player: ${playerId}`);
      }
      throw err;
    }
  }

  async topScores(limit?: number | null): Promise<Score[]> {
    const { rows } = await this.pool.query<{
      id: string;
      player_id: string;
      points: number;
      created_at: Date;
    }>(
      // Deterministic, identical to InMemoryStore: points desc, then created_at
      // asc (earliest first), then id as the final stable tie-break.
      // LIMIT NULL is unbounded in Postgres, matching normalizeLimit's "all
      // rows" contract for non-finite / oversized input.
      "SELECT id, player_id, points, created_at FROM scores ORDER BY points DESC, created_at ASC, id ASC LIMIT $1",
      [normalizeLimit(limit)],
    );
    return rows.map((r) => ({
      id: r.id,
      playerId: r.player_id,
      points: r.points,
      createdAt: r.created_at,
    }));
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
