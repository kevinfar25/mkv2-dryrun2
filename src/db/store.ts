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
  topScores(limit: number): Promise<Score[]>;
  health(): Promise<boolean>;
}

/**
 * Shared validation/normalization so InMemoryStore and PgStore stay
 * BEHAVIOURALLY IDENTICAL (repo rule).
 */

// `scores.points` is `int not null`. Reject anything that is not a finite
// integer (this also rejects NaN/Infinity/floats) so NaN can never reach the
// sort comparator `b.points - a.points`.
export function assertValidPoints(points: number): void {
  if (!Number.isInteger(points)) {
    throw new Error(`invalid points: ${points} (must be a finite integer)`);
  }
}

// limit contract: a finite value is clamped to a non-negative integer; any
// non-finite value (including undefined/NaN/Infinity) means "no limit" —
// return ALL rows. Represented as `null`: Postgres reads `LIMIT NULL` as
// unbounded, and InMemoryStore skips the slice.
export function normalizeLimit(limit: number): number | null {
  return Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : null;
}

export class InMemoryStore implements Store {
  private players = new Map<string, Player>();
  private scores: Score[] = [];
  private seq = 0;
  private scoreSeq = 0;

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
    // Monotonic created_at per insertion so ordering is deterministic and
    // mirrors Postgres, where each INSERT's now() advances.
    const score: Score = {
      id: `s${n}`,
      playerId,
      points,
      createdAt: new Date(n),
    };
    this.scores.push(score);
    return score;
  }

  async topScores(limit: number): Promise<Score[]> {
    const n = normalizeLimit(limit);
    const sorted = [...this.scores].sort(
      (a, b) =>
        b.points - a.points ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
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
    // Same points contract as InMemoryStore. Unknown players are rejected by
    // the scores.player_id -> players.id FK (the query throws).
    assertValidPoints(points);
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
  }

  async topScores(limit: number): Promise<Score[]> {
    const { rows } = await this.pool.query<{
      id: string;
      player_id: string;
      points: number;
      created_at: Date;
    }>(
      // Deterministic, identical to InMemoryStore: points desc, then created_at
      // asc (earliest first), then id as a final stable tie-break.
      // LIMIT NULL is unbounded in Postgres, matching normalizeLimit's "all
      // rows" contract for non-finite input.
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
