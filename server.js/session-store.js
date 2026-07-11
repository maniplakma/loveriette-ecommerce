'use strict';

const { Store } = require('express-session');

/**
 * SQLite-backed session store so logins survive server restarts and browser reopens.
 * Uses the same node:sqlite database as the rest of the app.
 */
class SqliteSessionStore extends Store {
  constructor(database) {
    super();
    this.db = database;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions(expire);
    `);
    this.getStmt = this.db.prepare('SELECT sess FROM user_sessions WHERE sid = ? AND expire > ?');
    this.setStmt = this.db.prepare(`
      INSERT INTO user_sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
    `);
    this.destroyStmt = this.db.prepare('DELETE FROM user_sessions WHERE sid = ?');
    this.touchStmt = this.db.prepare('UPDATE user_sessions SET expire = ? WHERE sid = ?');
    this.cleanupStmt = this.db.prepare('DELETE FROM user_sessions WHERE expire <= ?');
  }

  expireAt(sess) {
    const maxAge = Number(sess?.cookie?.maxAge);
    if (Number.isFinite(maxAge) && maxAge > 0) return Date.now() + maxAge;
    return Date.now() + (30 * 24 * 60 * 60 * 1000);
  }

  get(sid, cb) {
    try {
      this.cleanupStmt.run(Date.now());
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expireAt(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.touchStmt.run(this.expireAt(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = { SqliteSessionStore };
