// Demo fixture source file. Reads three env vars; only two are in .env.example.
const dbUrl = process.env.DATABASE_URL;
const apiKey = process.env.API_KEY;
const sessionSecret = process.env.SESSION_SECRET; // never declared anywhere - this is the catch
