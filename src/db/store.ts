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
  /** Top scores: points DESC, tie-break created_at ASC (older first). */
  topScores(limit: number): Promise<Score[]>;
  health(): Promise<boolean>;
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
    const n = ++this.scoreSeq;
    // Strictly increasing createdAt so insertion order == created_at order,
    // keeping the points-DESC / created_at-ASC tie-break deterministic (mirrors
    // sequential now() defaults in PgStore).
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
    return [...this.scores]
      .sort(
        (a, b) =>
          b.points - a.points ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      )
      .slice(0, limit);
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
    const { rows } = await this.pool.query(
      `INSERT INTO scores(player_id, points)
       VALUES($1, $2)
       RETURNING id, player_id, points, created_at`,
      [playerId, points],
    );
    return this.rowToScore(rows[0]);
  }

  async topScores(limit: number): Promise<Score[]> {
    const { rows } = await this.pool.query(
      `SELECT id, player_id, points, created_at
       FROM scores
       ORDER BY points DESC, created_at ASC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.rowToScore(r));
  }

  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  private rowToScore(row: {
    id: string;
    player_id: string;
    points: number;
    created_at: Date;
  }): Score {
    return {
      id: row.id,
      playerId: row.player_id,
      points: row.points,
      createdAt: row.created_at,
    };
  }
}
