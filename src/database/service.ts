import { initDatabase } from './db';
import { SyncService } from './syncService';

// Interfaces (aligned with app/index.tsx for compatibility)
export interface Produto {
    id: string; // Changed from name to id for better management, but respecting app structure
    name: string;
    price: string;
    quantity: string; // Used in sales context
    inventoryId?: string;
}

export interface ItemEstoque {
    id: string;
    name: string;
    price: string;
    image: string | null;
    category?: string;
    stock: number;
    history: Array<{ date: string; type: 'input' | 'output' | 'sale'; quantity: number }>;
}

export interface Venda {
    id: string;
    client: string;
    date: string;
    products: Produto[];
    paymentType: 'vista' | 'parcelado';
    installments: string;
    installmentList: any[]; // Using any for simplicity in first step, should type properly
    totalValue: number;
}

export const DatabaseService = {
    // --- Initialization ---
    init: async () => {
        await initDatabase();
    },

    // --- Categories ---
    getCategories: async (): Promise<string[]> => {
        const database = await initDatabase();
        const result = await database.getAllAsync<{ name: string }>('SELECT name FROM categories ORDER BY name');
        return result.map(row => row.name);
    },

    addCategory: async (name: string, skipSync: boolean = false): Promise<boolean> => {
        const database = await initDatabase();
        try {
            await database.runAsync('INSERT OR IGNORE INTO categories (name) VALUES (?)', name);

            if (!skipSync) {
                // Sync to Cloud
                SyncService.addToQueue({
                    id: name,
                    action: 'sync_category',
                    payload: name,
                    timestamp: Date.now()
                });
            }

            return true;
        } catch (e) {
            console.error('Error adding category:', e);
            return false;
        }
    },

    deleteCategory: async (name: string): Promise<boolean> => {
        const database = await initDatabase();
        try {
            await database.runAsync('DELETE FROM categories WHERE name = ?', name);
            return true;
        } catch (e) {
            console.error('Error deleting category:', e);
            return false;
        }
    },

    // --- Inventory / Products ---
    getInventory: async (): Promise<ItemEstoque[]> => {
        const database = await initDatabase();
        const products = await database.getAllAsync<any>(`
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id
    `);

        // Fetch history for each product (this is N+1 but acceptable for small datasets, 
        // optimization: fetch all history and map in memory or use JSON_GROUP_ARRAY if supported)
        const inventory: ItemEstoque[] = [];

        for (const p of products) {
            const history = await database.getAllAsync<any>(
                'SELECT date, type, quantity FROM product_history WHERE product_id = ? ORDER BY date DESC',
                p.id
            );

            inventory.push({
                id: p.id,
                name: p.name || 'Produto sem nome',
                price: (p.price || 0).toString(),
                image: p.image,
                category: p.category_name || 'Geral',
                stock: p.stock || 0,
                history: history as any
            });
        }

        return inventory;
    },

    saveProduct: async (product: ItemEstoque, skipSync: boolean = false): Promise<boolean> => {
        const database = await initDatabase();
        try {
            // 1. Get or Create Category ID
            let categoryId: number | null = null;
            if (product.category) {
                const cat = await database.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ?', product.category);
                if (cat) {
                    categoryId = cat.id;
                } else {
                    const res = await database.runAsync('INSERT OR IGNORE INTO categories (name) VALUES (?)', product.category);
                    // Search again after insert or ignore to get the ID (important if it already existed)
                    const searchCat = await database.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ?', product.category);
                    categoryId = searchCat ? searchCat.id : res.lastInsertRowId;
                }
            }

            // 2. Insert or Replace Product
            const safePrice = isNaN(parseFloat(product.price)) ? 0 : parseFloat(product.price);
            await database.runAsync(`
            INSERT OR REPLACE INTO products (id, name, price, image, category_id, stock)
            VALUES (?, ?, ?, ?, ?, ?)
        `, product.id, product.name || 'Sem nome', safePrice, product.image, categoryId, product.stock || 0);

            // 3. Update History 
            // Strategy: We delete old history and re-insert is too aggressive? 
            // Better: The app logic appends to history. We should just sync what we have.
            // For simplicity in migration from "save whole object" pattern:
            // We will clear history for this product and re-insert. 
            // Ideally we should start adding ONLY new history entries, but the app passes the full object.

            await database.runAsync('DELETE FROM product_history WHERE product_id = ?', product.id);

            if (product.history && product.history.length > 0) {
                for (const h of product.history) {
                    await database.runAsync(
                        'INSERT INTO product_history (product_id, date, type, quantity) VALUES (?, ?, ?, ?)',
                        product.id, h.date, h.type, h.quantity
                    );
                }
            }

            if (!skipSync) {
                // Sync to Cloud
                SyncService.addToQueue({
                    id: product.id,
                    action: 'sync_product',
                    payload: product,
                    timestamp: Date.now()
                });
            }

            return true;
        } catch (e) {
            console.error("Error saving product:", e);
            return false;
        }
    },

    deleteProduct: async (id: string): Promise<boolean> => {
        const database = await initDatabase();
        try {
            await database.runAsync('DELETE FROM products WHERE id = ?', id);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    },

    // --- Sales ---
    getSales: async (): Promise<Venda[]> => {
        const database = await initDatabase();
        const salesRows = await database.getAllAsync<any>('SELECT * FROM sales ORDER BY date DESC');

        const sales: Venda[] = [];

        for (const row of salesRows) {
            const items = await database.getAllAsync<any>('SELECT * FROM sale_items WHERE sale_id = ?', row.id);
            const installments = await database.getAllAsync<any>('SELECT * FROM installments WHERE sale_id = ? ORDER BY number ASC', row.id);

            sales.push({
                id: row.id,
                client: row.client_name || 'Cliente final',
                date: row.date || new Date().toISOString().split('T')[0],
                paymentType: (row.payment_type || 'vista') as any,
                installments: (row.installments_count || 1).toString(),
                totalValue: row.total_value || 0,
                products: items.map(i => ({
                    id: (i.id || '').toString(), // Temp id for UI map keys
                    name: i.product_name || 'Produto sem nome',
                    price: (i.price || 0).toString(),
                    quantity: (i.quantity || 1).toString(),
                    inventoryId: i.inventory_id
                })),
                installmentList: installments.map(inst => ({
                    number: inst.number,
                    date: inst.date,
                    value: inst.value,
                    status: inst.status
                }))
            });
        }
        return sales;
    },

    saveSale: async (sale: Venda, skipSync: boolean = false): Promise<boolean> => {
        const database = await initDatabase();
        try {
            // Transaction could be used here but using sequential awaits for simplicity with expo-sqlite async

            await database.runAsync(`
            INSERT OR REPLACE INTO sales (id, client_name, date, payment_type, installments_count, total_value)
            VALUES (?, ?, ?, ?, ?, ?)
          `, sale.id, sale.client || 'Cliente final', sale.date, sale.paymentType, parseInt(sale.installments) || 1,
                sale.products.reduce((acc, p) => acc + ((parseFloat(p.price) || 0) * (parseFloat(p.quantity) || 1)), 0));

            // Items
            await database.runAsync('DELETE FROM sale_items WHERE sale_id = ?', sale.id);
            for (const p of sale.products) {
                const safePrice = isNaN(parseFloat(p.price)) ? 0 : parseFloat(p.price);
                const safeQty = isNaN(parseInt(p.quantity)) ? 1 : parseInt(p.quantity);
                await database.runAsync(`
                  INSERT INTO sale_items (sale_id, product_name, price, quantity, inventory_id)
                  VALUES (?, ?, ?, ?, ?)
              `, sale.id, p.name || 'Produto', safePrice, safeQty, p.inventoryId || null);
            }

            // Installments
            await database.runAsync('DELETE FROM installments WHERE sale_id = ?', sale.id);
            if (sale.installmentList) {
                for (const inst of sale.installmentList) {
                    await database.runAsync(`
                      INSERT INTO installments (sale_id, number, date, value, status)
                      VALUES (?, ?, ?, ?, ?)
                  `, sale.id, inst.number, inst.date, inst.value, inst.status);
                }
            }

            if (!skipSync) {
                // Sync to Cloud
                const totalValue = sale.products.reduce((acc, p) => acc + ((parseFloat(p.price) || 0) * (parseFloat(p.quantity) || 1)), 0);
                SyncService.addToQueue({
                    id: sale.id,
                    action: 'sync_sale',
                    payload: { ...sale, totalValue },
                    timestamp: Date.now()
                });
            }

            return true;
        } catch (e) {
            console.error("Error saving sale:", e);
            return false;
        }
    },

    deleteSale: async (id: string): Promise<boolean> => {
        const database = await initDatabase();
        try {
            await database.runAsync('DELETE FROM sales WHERE id = ?', id);
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    },

    // Custom method to bulk save inventory (for migration)
    bulkSaveInventory: async (inventory: ItemEstoque[], skipSync: boolean = true) => {
        for (const item of inventory) {
            await DatabaseService.saveProduct(item, skipSync);
        }
    },

    // Custom method to bulk save sales (for migration)
    bulkSaveSales: async (sales: Venda[], skipSync: boolean = true) => {
        for (const sale of sales) {
            await DatabaseService.saveSale(sale, skipSync);
        }
    },

    // Custom method to bulk save categories (for migration)
    bulkSaveCategories: async (categories: string[], skipSync: boolean = true) => {
        for (const cat of categories) {
            await DatabaseService.addCategory(cat, skipSync);
        }
    }
};
