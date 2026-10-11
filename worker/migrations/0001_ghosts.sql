-- One row per player per day per crew: their best verified lap.
CREATE TABLE ghosts (
  date TEXT NOT NULL,          -- 'YYYY-MM-DD', Central time
  crew TEXT NOT NULL,          -- crew code, 'public' by default
  player TEXT NOT NULL,        -- random id from the player's browser
  pid TEXT NOT NULL,           -- public hash of player, so clients can spot their own row
  name TEXT NOT NULL,
  ms INTEGER NOT NULL,         -- lap time, as re-simulated by the server
  inputs TEXT NOT NULL,        -- encoded steering inputs (the ghost)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, crew, player)
);

CREATE INDEX ghosts_board ON ghosts (date, crew, ms);
