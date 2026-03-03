import AsyncStorage from '@react-native-async-storage/async-storage';

export const SYNC_URL_KEY = '@atelier_sync_url';
const SYNC_QUEUE_KEY = '@atelier_sync_queue';

export interface SyncItem {
    id: string;
    action: 'sync_product' | 'sync_sale' | 'sync_category';
    payload: any;
    timestamp: number;
}

export const SyncService = {
    setSyncUrl: async (url: string) => {
        await AsyncStorage.setItem(SYNC_URL_KEY, url);
    },

    getSyncUrl: async () => {
        return await AsyncStorage.getItem(SYNC_URL_KEY);
    },

    addToQueue: async (item: SyncItem) => {
        const queueStr = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
        const queue: SyncItem[] = queueStr ? JSON.parse(queueStr) : [];

        // Evitar duplicados na fila se for o mesmo ID e ação
        const index = queue.findIndex(q => q.id === item.id && q.action === item.action);
        if (index > -1) {
            queue[index] = item;
        } else {
            queue.push(item);
        }

        await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
        // Tentar sincronizar imediatamente se houver internet
        SyncService.processQueue();
    },

    processQueue: async () => {
        const url = await SyncService.getSyncUrl();
        if (!url) return;

        const queueStr = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
        if (!queueStr) return;

        const queue: SyncItem[] = JSON.parse(queueStr);
        if (queue.length === 0) return;

        console.log(`Iniciando sincronização de ${queue.length} itens...`);

        const remaining: SyncItem[] = [];

        for (const item of queue) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: item.action,
                        payload: item.payload
                    })
                });

                const result = await response.json();
                if (result.success) {
                    console.log(`Item ${item.id} sincronizado com sucesso.`);
                    // Se for produto e retornou URL da imagem, poderíamos atualizar o banco local
                    if (item.action === 'sync_product' && result.imageUrl) {
                        // Opcional: atualizar URL local para apontar pro Drive
                    }
                } else {
                    remaining.push(item);
                }
            } catch (error) {
                console.error(`Erro ao sincronizar item ${item.id}:`, error);
                remaining.push(item);
                // Provavelmente sem internet, interromper processamento
                break;
            }
        }

        await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(remaining));
    },

    downloadData: async () => {
        const url = await SyncService.getSyncUrl();
        if (!url) throw new Error('URL de sincronização não configurada.');

        const response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({ action: 'get_all_data' })
        });

        const result = await response.json();
        if (!result.success) throw new Error(result.error || 'Erro ao baixar dados.');

        return result;
    }
};
