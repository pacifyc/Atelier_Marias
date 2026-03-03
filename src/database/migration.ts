import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseService } from './service';

const STORAGE_KEY = '@atelier_data_v1';
const INVENTORY_KEY = '@atelier_inventory_v1';
const CATEGORIES_KEY = '@atelier_categories_v1';
const MIGRATION_KEY = '@atelier_sqlite_migration_v1';

export const migrateFromAsyncStorage = async () => {
    try {
        const hasMigrated = await AsyncStorage.getItem(MIGRATION_KEY);
        if (hasMigrated === 'true') {
            console.log("Migration already completed.");
            return;
        }

        console.log("Starting migration from AsyncStorage to SQLite...");

        // 1. Migrate Categories
        const cData = await AsyncStorage.getItem(CATEGORIES_KEY);
        if (cData) {
            const categories = JSON.parse(cData);
            if (Array.isArray(categories)) {
                await DatabaseService.bulkSaveCategories(categories);
            }
        }

        // 2. Migrate Inventory
        const iData = await AsyncStorage.getItem(INVENTORY_KEY);
        if (iData) {
            const inventory = JSON.parse(iData);
            if (Array.isArray(inventory)) {
                await DatabaseService.bulkSaveInventory(inventory);
            }
        }

        // 3. Migrate Sales
        const sData = await AsyncStorage.getItem(STORAGE_KEY);
        if (sData) {
            const sales = JSON.parse(sData);
            if (Array.isArray(sales)) {
                await DatabaseService.bulkSaveSales(sales);
            }
        }

        await AsyncStorage.setItem(MIGRATION_KEY, 'true');
        console.log("Migration completed successfully.");

    } catch (e) {
        console.error("Migration failed:", e);
    }
};
