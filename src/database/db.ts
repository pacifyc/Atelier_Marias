import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export const initDatabase = async () => {
  if (db) return db;

  db = await SQLite.openDatabaseAsync('atelier.db');
  
  // Enable foreign keys
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Create tables
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      image TEXT,
      category_id INTEGER,
      stock INTEGER DEFAULT 0,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    );

    CREATE TABLE IF NOT EXISTS product_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      date TEXT NOT NULL,
      payment_type TEXT NOT NULL,
      installments_count INTEGER DEFAULT 1,
      total_value REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER DEFAULT 1,
      inventory_id TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      date TEXT NOT NULL,
      value REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
    );
     
     -- Insert default category if not exists
     INSERT OR IGNORE INTO categories (name) VALUES ('Geral');
  `);

  return db;
};

export const getDb = () => {
    if (!db) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    return db;
};
