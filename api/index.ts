import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Pool } from 'pg'

const app = new Hono()
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barideal2026'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// CORS abierto para GitHub Pages
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type']
}))

// ── INIT TABLES ──
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS picks (
      id SERIAL PRIMARY KEY,
      player_name TEXT NOT NULL,
      pick_key TEXT NOT NULL,
      team_code TEXT NOT NULL,
      picked_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(player_name, pick_key)
    );
  `)
  console.log('DB ready')
}

// ── HEALTH ──
app.get('/', (c) => c.json({ ok: true, service: 'Mundial 2026 API' }))

// ── REGISTRAR / actualizar picks de un jugador ──
app.post('/picks', async (c) => {
  try {
    const { player, picks } = await c.req.json()
    if (!player || !picks) return c.json({ error: 'Faltan datos' }, 400)

    // upsert player
    await pool.query(
      `INSERT INTO players (name, updated_at) VALUES ($1, NOW())
       ON CONFLICT (name) DO UPDATE SET updated_at = NOW()`,
      [player]
    )

    // upsert each pick
    for (const [key, team] of Object.entries(picks)) {
      if (team) {
        await pool.query(
          `INSERT INTO picks (player_name, pick_key, team_code, picked_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (player_name, pick_key) DO UPDATE SET team_code = $3, picked_at = NOW()`,
          [player, key, team]
        )
      } else {
        await pool.query(
          `DELETE FROM picks WHERE player_name = $1 AND pick_key = $2`,
          [player, key]
        )
      }
    }

    return c.json({ ok: true })
  } catch (e: any) {
    console.error(e)
    return c.json({ error: e.message }, 500)
  }
})

// ── OBTENER picks de un jugador ──
app.get('/picks/:player', async (c) => {
  try {
    const player = decodeURIComponent(c.req.param('player'))
    const res = await pool.query(
      `SELECT pick_key, team_code FROM picks WHERE player_name = $1`,
      [player]
    )
    const picks: Record<string, string> = {}
    res.rows.forEach(r => { picks[r.pick_key] = r.team_code })
    return c.json({ player, picks })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ── ADMIN: ver todos los jugadores y sus picks ──
app.get('/admin', async (c) => {
  const pwd = c.req.query('pwd')
  if (pwd !== ADMIN_PASSWORD) return c.json({ error: 'No autorizado' }, 401)

  try {
    const players = await pool.query(
      `SELECT name, created_at, updated_at FROM players ORDER BY created_at DESC`
    )
    const picks = await pool.query(
      `SELECT player_name, pick_key, team_code, picked_at FROM picks ORDER BY player_name, pick_key`
    )

    // agrupar picks por jugador
    const byPlayer: Record<string, any> = {}
    players.rows.forEach(p => {
      byPlayer[p.name] = {
        name: p.name,
        joined: p.created_at,
        last_activity: p.updated_at,
        picks: {}
      }
    })
    picks.rows.forEach(r => {
      if (byPlayer[r.player_name]) {
        byPlayer[r.player_name].picks[r.pick_key] = r.team_code
      }
    })

    return c.json({
      total_players: players.rows.length,
      players: Object.values(byPlayer)
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

initDB().then(() => {
  console.log('Mundial 2026 API corriendo en puerto', process.env.PORT || 3000)
})

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch
}
