// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Route integration tests to the dedicated test database so they never touch
// development data. DATABASE_URL_TEST is defined in .env (a separate
// `portside_test` database on the same local Postgres server).
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
}
