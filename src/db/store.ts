import pg from "pg";

export type Player = { id: string; name: string };

/**
 * The persistence seam. Unit tests + CI run against InMemoryStore (hermetic, no DB).
 * Runtime / switch-on / prod-test set DATABASE_URL and run against PgStore (a real
 * Postgres container). Feature phases extend this interface as they add tables.
 */
export interface Store {
  addPlayer(name: string): Promise<Player>;
  getPlayer(id: string): Promise<Player | null>;
  health(): Promise<boolean>;
}

export class InMemoryStore implements Store {
  private players = new Map<string, Player>();
  private seq = 0;

  async addPlayer(name: string): Promise<Player> {
    const id = `p${++this.seq}`;
    const player: Player = { id, name };
    this.players.set(id, player);
    return player;
  }

  async getPlayer(id: string): Promise<Player | null> {
    return this.players.get(id) ?? null;
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

  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
