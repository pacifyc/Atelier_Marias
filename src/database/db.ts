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
      name TEXT UNIQUE NOT NULL,
      size_type TEXT DEFAULT 'none' -- 'none', 'letter', 'number'
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      image TEXT,
      category_id INTEGER,
      stock INTEGER DEFAULT 0,
      size_number INTEGER, -- 32-45
      size_letter TEXT,   -- P, M, G, GG
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
      product_id TEXT, -- This maps to CÓDIGO DO PRODUTO
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER DEFAULT 1,
      inventory_id TEXT, -- Keep this for backward compatibility if needed, but we'll use product_id/inventory_id
      FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      number INTEGER NOT NULL,
      date TEXT NOT NULL,
      value REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      isLocked INTEGER DEFAULT 0, -- 0 = false, 1 = true
      FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
    );
     
      -- Insert default category if not exists
      INSERT OR IGNORE INTO categories (name) VALUES ('Geral');
  `);

  // --- Migrations for existing databases ---
  try {
    // Check if isLocked exists in installments
    const instInfo = await db.getAllAsync<any>("PRAGMA table_info(installments)");
    if (!instInfo.some((col: any) => col.name === 'isLocked')) {
      console.log("Migrating database: Adding isLocked to installments...");
      await db.execAsync("ALTER TABLE installments ADD COLUMN isLocked INTEGER DEFAULT 0;");
    }

    // Check if product_id exists in sale_items
    const tableInfo = await db.getAllAsync<any>("PRAGMA table_info(sale_items)");
    const columnExists = tableInfo.some((col: any) => col.name === 'product_id');

    if (!columnExists) {
      console.log("Migrating database: Adding product_id to sale_items...");
      await db.execAsync("ALTER TABLE sale_items ADD COLUMN product_id TEXT;");
    }

    // Migration for size features
    const catInfo = await db.getAllAsync<any>("PRAGMA table_info(categories)");
    if (!catInfo.some(col => col.name === 'size_type')) {
      console.log("Migrating database: Adding size_type to categories...");
      await db.execAsync("ALTER TABLE categories ADD COLUMN size_type TEXT DEFAULT 'none';");
    }

    const prodInfo = await db.getAllAsync<any>("PRAGMA table_info(products)");
    if (!prodInfo.some(col => col.name === 'size_number')) {
      console.log("Migrating database: Adding size fields to products...");
      await db.execAsync("ALTER TABLE products ADD COLUMN size_number INTEGER;");
      await db.execAsync("ALTER TABLE products ADD COLUMN size_letter TEXT;");
    }
  } catch (e) {
    console.error("Migration error:", e);
  }

  return db;
};

export const getDb = () => {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
};
