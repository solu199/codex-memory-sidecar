import Database from "better-sqlite3";

export interface SqliteOpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

export interface SqliteStatement<Result = unknown> {
  run(...params: unknown[]): Result;
  get(...params: unknown[]): Result;
  all(...params: unknown[]): Result[];
}

export interface SqliteDatabaseAdapter {
  prepare<Result = unknown>(sql: string): SqliteStatement<Result>;
  exec(sql: string): void;
  pragma(name: string, options?: Database.PragmaOptions): unknown;
  transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  backup(path: string): Promise<void>;
  close(): void;
}

export interface SqliteAdapterFactory {
  open(path: string, options?: SqliteOpenOptions): SqliteDatabaseAdapter;
}

class BetterSqlite3Statement<Result = unknown> implements SqliteStatement<Result> {
  constructor(private readonly statement: Database.Statement) {}

  run(...params: unknown[]): Result {
    return this.statement.run(...params) as Result;
  }

  get(...params: unknown[]): Result {
    return this.statement.get(...params) as Result;
  }

  all(...params: unknown[]): Result[] {
    return this.statement.all(...params) as Result[];
  }
}

class BetterSqlite3DatabaseAdapter implements SqliteDatabaseAdapter {
  constructor(private readonly db: Database.Database) {}

  prepare<Result = unknown>(sql: string): SqliteStatement<Result> {
    return new BetterSqlite3Statement<Result>(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(name: string, options?: Database.PragmaOptions): unknown {
    return this.db.pragma(name, options);
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return this.db.transaction(fn) as unknown as T;
  }

  async backup(path: string): Promise<void> {
    await this.db.backup(path);
  }

  close(): void {
    this.db.close();
  }
}

export class BetterSqlite3AdapterFactory implements SqliteAdapterFactory {
  open(path: string, options?: SqliteOpenOptions): SqliteDatabaseAdapter {
    return new BetterSqlite3DatabaseAdapter(new Database(path, options));
  }
}
