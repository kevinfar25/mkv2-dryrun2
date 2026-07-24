import pg from "pg";

export type Player = { id: string; name: string };
export type Season = {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
};
export type Score = {
  id: string;
  playerId: string;
  points: number;
  createdAt: Date;
  // Nullable season tag (P4). `null` = not attached to any season. Only
  // referenced when a caller opts into season-scoped writes/reads; the default
  // paths ignore it entirely so old code + pre-migration schema keep working.
  seasonId: string | null;
};

/**
 * The persistence seam. Unit tests + CI run against InMemoryStore (hermetic, no DB).
 * Runtime / switch-on / prod-test set DATABASE_URL and run against PgStore (a real
 * Postgres container). Feature phases extend this interface as they add tables.
 */
export interface Store {
  addPlayer(name: string): Promise<Player>;
  getPlayer(id: string): Promise<Player | null>;
  // Register a season so scores can be attached to it. Mirrors the `seasons`
  // table (id uuid pk, name/starts_at/ends_at not null). Needed so BOTH stores
  // can enforce the same "season must exist" contract that Postgres gets from
  // the scores.season_id FK — without it InMemoryStore would accept a seasonId
  // Postgres would reject, breaking store parity.
  addSeason(name: string, startsAt: Date, endsAt: Date): Promise<Season>;
  addScore(playerId: string, points: number, seasonId?: string | null): Promise<Score>;
  // topScores filters by season ONLY when a non-null seasonId is passed.
  // Omitting it OR passing null (the no-filter path) must not touch the
  // season_id column at all, so pre-migration schema + old code stay correct
  // (expand/contract — migrations deploy separately from code).
  topScores(limit?: number | null, seasonId?: string | null): Promise<Score[]>;
  // A player's points, most-recent-first (created_at DESC, id DESC tie-break).
  // Pure read: references no season/other columns (expand/contract safe). An
  // unknown player yields `[]` in BOTH stores (identical behavior) — the HTTP
  // layer uses getPlayer to distinguish unknown from a player with no scores.
  scoresForPlayer(playerId: string): Promise<number[]>;
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

// `scores.season_id` is a Postgres `uuid` column. Postgres rejects a malformed
// UUID literal with 22P02 (invalid_text_representation) BEFORE the FK is ever
// checked, so InMemoryStore must reject the same shapes up front or a seasonal
// write could pass a unit test yet fail against Postgres. Validate in shared
// code so both stores throw the SAME domain error on the SAME input, without
// InMemoryStore depending on Postgres error codes. Canonical hyphenated 8-4-4-4-12
// hex (case-insensitive) — the form every caller here uses.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertValidSeasonId(seasonId: string): void {
  if (!UUID_RE.test(seasonId)) {
    throw new Error(`invalid seasonId: ${seasonId} (must be a UUID)`);
  }
}

// Postgres `uuid` stores/compares in canonical LOWERCASE, so `A1B2...` and
// `a1b2...` are the SAME value there. InMemoryStore keeps season_id as a raw
// string, so without folding case an uppercase-spelled seasonId would miss a
// season Postgres would match. Fold to lowercase before storing/comparing so
// both stores agree. Assumes a UUID-shaped input (validate first).
export function normalizeSeasonId(seasonId: string): string {
  return seasonId.toLowerCase();
}

// Shared season-date sanity check so InMemoryStore and PgStore reject the SAME
// inputs. InMemoryStore would otherwise store an Invalid Date (getTime() NaN)
// that Postgres rejects on serialization — a parity break. Also forbids
// inverted/empty ranges (endsAt <= startsAt), which both stores previously
// accepted. Throws a stable domain Error BEFORE any store mutation.
export function assertValidSeasonDates(startsAt: Date, endsAt: Date): void {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw new Error(
      `invalid season dates: startsAt/endsAt must be valid Dates`,
    );
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new Error(
      `invalid season dates: endsAt must be after startsAt`,
    );
  }
}

// limit contract: a finite value is clamped to a non-negative integer and
// preserved AS-IS (floats truncated via Math.trunc, negatives -> 0); any
// non-finite value (undefined/null/NaN/Infinity) means "no limit" — return ALL
// rows, represented as `null` (Postgres reads `LIMIT NULL` as unbounded and
// InMemoryStore skips the slice).
//
// A large finite limit is a genuine bound, NOT a request for everything:
// `topScores(2_000_000)` must cap at 2,000,000 rows in both stores. Only
// non-finite input collapses to unbounded. A finite limit is clamped to the
// Postgres-legal safe range `[0, Number.MAX_SAFE_INTEGER]`: every value in that
// range is a legal Postgres `LIMIT`, so InMemoryStore and PgStore agree for ALL
// inputs (absurd values like 1e100 clamp to MAX_SAFE_INTEGER instead of
// diverging — Postgres cannot accept `LIMIT 1e100`).
export function normalizeLimit(limit?: number | null): number | null {
  const n = Number.isFinite(limit)
    ? Math.min(Math.max(0, Math.trunc(limit as number)), Number.MAX_SAFE_INTEGER)
    : null;
  return n;
}

// Deterministic ordering contract, IDENTICAL in both stores:
//   points DESC, created_at ASC, id ASC
// The final `id` tie-break is what makes equal-points/equal-created_at rows
// deterministic; it must not rely on fabricated strictly-increasing timestamps.
export function compareScores(a: Score, b: Score): number {
  return (
    b.points - a.points ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// Deep-copy a Score (including its Date) so InMemoryStore never shares mutable
// state with callers — matching PgStore, which materializes fresh objects per
// query.
function clone(s: Score): Score {
  return { ...s, createdAt: new Date(s.createdAt.getTime()) };
}

// Deterministic UUID-format id from a counter, so InMemoryStore-minted season
// ids pass the same `uuid`-shape validation Postgres enforces (and stay stable
// across test runs — no Math.random). `00000000-0000-0000-0000-<seq>`.
function seqToUuid(n: number): string {
  return `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
}

export class InMemoryStore implements Store {
  private players = new Map<string, Player>();
  private seasons = new Map<string, Season>();
  private scores: Score[] = [];
  private seq = 0;
  private seasonSeq = 0;
  private scoreSeq = 0;

  // All in-memory scores share one created_at VALUE. Postgres `now()` is the
  // transaction timestamp, so scores inserted in the same instant/transaction
  // collide on created_at and fall through to the `id` tie-break — exactly the
  // parity edge a fabricated strictly-increasing clock would hide. A constant
  // clock value makes that the common case, so the id tie-break is genuinely
  // exercised and insertion order is preserved via the `s1 < s2 < ...` ids.
  // NB: this is a numeric epoch, not a shared Date instance — each row gets its
  // own fresh Date so a caller mutating a returned `createdAt` can't leak into
  // stored state (PgStore hands back fresh Dates per query too).
  private static readonly CLOCK_MS = 0;

  async addPlayer(name: string): Promise<Player> {
    const id = `p${++this.seq}`;
    const player: Player = { id, name };
    this.players.set(id, player);
    return player;
  }

  async getPlayer(id: string): Promise<Player | null> {
    return this.players.get(id) ?? null;
  }

  async addSeason(name: string, startsAt: Date, endsAt: Date): Promise<Season> {
    assertValidSeasonDates(startsAt, endsAt);
    const id = seqToUuid(++this.seasonSeq);
    const season: Season = {
      id,
      name,
      startsAt: new Date(startsAt.getTime()),
      endsAt: new Date(endsAt.getTime()),
    };
    this.seasons.set(id, season);
    return { ...season };
  }

  async addScore(
    playerId: string,
    points: number,
    seasonId: string | null = null,
  ): Promise<Score> {
    assertValidPoints(points);
    // ONE shared validation ORDER across both stores: validate input FORMAT
    // first (points, then seasonId shape), THEN existence (player, then season).
    // PgStore validates the seasonId shape in JS before the DB ever checks the
    // player FK, so a bad player + malformed seasonId must surface the SAME
    // `invalid seasonId` error here — hence the shape check precedes the player
    // existence check. The default path (seasonId null) needs no season.
    if (seasonId != null) {
      assertValidSeasonId(seasonId);
    }
    // Enforce the same FK contract PgStore gets for free from
    // scores.player_id -> players.id: unknown players are rejected.
    if (!this.players.has(playerId)) {
      throw new Error(`unknown player: ${playerId}`);
    }
    // Season existence parity (scores.season_id FK). Canonicalize case first so
    // an uppercase-spelled id matches its registered (lowercase) season, exactly
    // as Postgres' `uuid` column would. The unknown-season error still reports
    // the caller's original spelling, matching PgStore's message.
    let normalizedSeason: string | null = null;
    if (seasonId != null) {
      normalizedSeason = normalizeSeasonId(seasonId);
      if (!this.seasons.has(normalizedSeason)) {
        throw new Error(`unknown season: ${seasonId}`);
      }
    }
    const n = ++this.scoreSeq;
    const score: Score = {
      id: `s${n}`,
      playerId,
      points,
      createdAt: new Date(InMemoryStore.CLOCK_MS),
      // Store the canonical (lowercase) form, mirroring Postgres' `uuid` column
      // and its RETURNING season_id (so addScore hands back the same value Pg
      // would even when the caller passed uppercase).
      seasonId: normalizedSeason,
    };
    // Store an immutable snapshot; return an independent clone so a caller
    // mutating either the returned object or its Date can't corrupt store state.
    this.scores.push(clone(score));
    return clone(score);
  }

  async topScores(
    limit?: number | null,
    seasonId?: string | null,
  ): Promise<Score[]> {
    const n = normalizeLimit(limit);
    // A non-null read filter is compared against the `uuid` column, so Postgres
    // rejects a malformed id (22P02) before returning rows — validate the same
    // shape here for parity. `null` filters the season-less rows (no shape).
    if (seasonId != null) {
      assertValidSeasonId(seasonId);
    }
    // Canonicalize the filter's case so an uppercase-spelled id matches the
    // stored (lowercase) season_id, exactly as Postgres' `uuid` column would.
    const normalizedFilter =
      seasonId == null ? null : normalizeSeasonId(seasonId);
    // Season filter is opt-in: null is treated as NO filter (expand/contract
    // safe); only a non-null seasonId references season_id. The no-filter path
    // is byte-for-byte the old behavior (mirrors PgStore, whose default query
    // never names season_id).
    const source =
      seasonId == null
        ? this.scores
        : this.scores.filter((s) => s.seasonId === normalizedFilter);
    const sorted = [...source].sort(compareScores);
    const rows = n === null ? sorted : sorted.slice(0, n);
    // Match PgStore's projection exactly: the default path never surfaces
    // season_id (Pg can't select it without breaking expand/contract), so it
    // reports null; the filtered path reports the CANONICAL (lowercase) season
    // it filtered on — identical to the value addScore returns for that id.
    const outSeason = normalizedFilter;
    return rows.map((s) => ({ ...clone(s), seasonId: outSeason }));
  }

  // A player's points, most-recent-first: created_at DESC, then id DESC as the
  // deterministic tie-break (identical string/text ordering to PgStore). All
  // in-memory scores share CLOCK_MS, so the id DESC tie-break carries the
  // ordering — exactly the parity edge topScores exercises, mirrored here.
  // Unknown player -> [] (a player with no scores also yields []).
  async scoresForPlayer(playerId: string): Promise<number[]> {
    return this.scores
      .filter((s) => s.playerId === playerId)
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .map((s) => s.points);
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
    try {
      const { rows } = await this.pool.query<Player>(
        "SELECT id, name FROM players WHERE id = $1",
        [id],
      );
      return rows[0] ?? null;
    } catch (err) {
      // A malformed id (22P02 invalid_text_representation, e.g. a non-uuid
      // string against the uuid `players.id` column) names no player -> null,
      // matching InMemoryStore's `get(id) ?? null`. Without this the two stores
      // diverge: InMemory returns null while Pg throws, which would surface as a
      // 500 instead of a clean unknown-player result. Mirrors the 22P02 handling
      // in addScore / scoresForPlayer.
      const code = (err as { code?: string })?.code;
      if (code === "22P02") return null;
      throw err;
    }
  }

  async addSeason(name: string, startsAt: Date, endsAt: Date): Promise<Season> {
    assertValidSeasonDates(startsAt, endsAt);
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      starts_at: Date;
      ends_at: Date;
    }>(
      "INSERT INTO seasons(name, starts_at, ends_at) VALUES($1, $2, $3) RETURNING id, name, starts_at, ends_at",
      [name, startsAt, endsAt],
    );
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    };
  }

  async addScore(
    playerId: string,
    points: number,
    seasonId: string | null = null,
  ): Promise<Score> {
    // Same points contract as InMemoryStore.
    assertValidPoints(points);
    // Same seasonId shape contract: reject malformed ids up front (identical
    // domain error to InMemoryStore) instead of relying on Postgres' 22P02.
    if (seasonId != null) {
      assertValidSeasonId(seasonId);
    }
    try {
      // Expand/contract: the DEFAULT path never names season_id, so this store
      // still writes cleanly against the pre-migration schema. Only a caller
      // that explicitly attaches a season opts into the season_id column.
      const withSeason = seasonId != null;
      const sql = withSeason
        ? "INSERT INTO scores(player_id, points, season_id) VALUES($1, $2, $3) RETURNING id, player_id, points, created_at, season_id"
        : "INSERT INTO scores(player_id, points) VALUES($1, $2) RETURNING id, player_id, points, created_at";
      const params = withSeason ? [playerId, points, seasonId] : [playerId, points];
      const { rows } = await this.pool.query<{
        id: string;
        player_id: string;
        points: number;
        created_at: Date;
        season_id?: string | null;
      }>(sql, params);
      const r = rows[0];
      return {
        id: r.id,
        playerId: r.player_id,
        points: r.points,
        createdAt: r.created_at,
        seasonId: r.season_id ?? null,
      };
    } catch (err) {
      // Normalize FK/format rejections to the SAME domain errors InMemoryStore
      // throws. 23503 (foreign_key_violation) can come from EITHER fkey, so the
      // constraint name disambiguates unknown-season from unknown-player; a
      // malformed player UUID surfaces as 22P02 (season ids are pre-validated
      // above, so 22P02 here can only be the player id).
      const e = err as { code?: string; constraint?: string };
      if (e.code === "23503" && e.constraint?.includes("season")) {
        throw new Error(`unknown season: ${seasonId}`);
      }
      if (e.code === "23503" || e.code === "22P02") {
        throw new Error(`unknown player: ${playerId}`);
      }
      throw err;
    }
  }

  async topScores(
    limit?: number | null,
    seasonId?: string | null,
  ): Promise<Score[]> {
    // Expand/contract (critical): the DEFAULT query never references season_id,
    // so it runs unchanged against the pre-migration schema. null is treated as
    // NO filter (expand/contract safe); a WHERE season_id clause is added ONLY
    // when a non-null seasonId is passed — only then do we reference season_id.
    // The selected columns stay identical either way.
    const filtered = seasonId != null;
    // Parity with InMemoryStore: a non-null read filter is validated up front so
    // a malformed id fails identically instead of as a raw Postgres 22P02.
    if (seasonId != null) {
      assertValidSeasonId(seasonId);
    }
    const where = filtered ? "WHERE season_id IS NOT DISTINCT FROM $2 " : "";
    // Deterministic, identical to InMemoryStore: points desc, then created_at
    // asc (earliest first), then id as the final stable tie-break.
    // LIMIT NULL is unbounded in Postgres, matching normalizeLimit's "all
    // rows" contract for non-finite / oversized input.
    const sql =
      `SELECT id, player_id, points, created_at FROM scores ${where}` +
      "ORDER BY points DESC, created_at ASC, id ASC LIMIT $1";
    const params = filtered
      ? [normalizeLimit(limit), seasonId]
      : [normalizeLimit(limit)];
    const { rows } = await this.pool.query<{
      id: string;
      player_id: string;
      points: number;
      created_at: Date;
    }>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      playerId: r.player_id,
      points: r.points,
      createdAt: r.created_at,
      // The default projection doesn't select season_id; callers that need it
      // pass a seasonId (and already know which season they filtered on). Report
      // the CANONICAL (lowercase) form so it matches the value addScore returns
      // for the same id, even when the caller passed uppercase.
      seasonId: seasonId == null ? null : normalizeSeasonId(seasonId),
    }));
  }

  // A player's points, most-recent-first. Deterministic, identical to
  // InMemoryStore: created_at DESC, then id DESC. Pure read of scores.points;
  // references no other/new columns (expand/contract safe). An unknown player
  // simply matches no rows and returns [] — same as a player with no scores.
  async scoresForPlayer(playerId: string): Promise<number[]> {
    try {
      const { rows } = await this.pool.query<{ points: number }>(
        "SELECT points FROM scores WHERE player_id = $1 ORDER BY created_at DESC, id DESC",
        [playerId],
      );
      return rows.map((r) => r.points);
    } catch (err) {
      // A malformed player id (22P02 invalid_text_representation) is treated as
      // an unknown player -> no rows, matching InMemoryStore's [] behavior.
      const code = (err as { code?: string })?.code;
      if (code === "22P02") return [];
      throw err;
    }
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
