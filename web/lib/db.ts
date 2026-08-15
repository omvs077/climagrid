import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// This pool should connect using the `web_readonly` Postgres role
// (SELECT-only grants — see README.md). Even a bug or dependency
// vulnerability in /web inherits a connection that cannot write.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
