import AsyncStorage from '@react-native-async-storage/async-storage';
import { getInfoAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';

export const SYNC_URL_KEY = '@atelier_sync_url';
const SYNC_QUEUE_KEY = '@atelier_sync_queue';

export interface SyncItem {
    id: string;
    action: 'sync_product' | 'sync_sale' | 'sync_category' | 'delete_product' | 'delete_category';
    payload: any;
    timestamp: number;
}

let isProcessing = false;

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
        if (isProcessing) {
            console.log('Sincronização já em andamento, aguardando...');
            return;
        }

        const url = await SyncService.getSyncUrl();
        if (!url) return;

        isProcessing = true;
        try {
            await SyncService._processInternal();
        } finally {
            isProcessing = false;
        }
    },

    _processInternal: async () => {
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
                let finalPayload = item.payload;

                // Transforma imagem local em base64 se for um sync de produto
                if (item.action === 'sync_product' && finalPayload.image && finalPayload.image.startsWith('file://')) {
                    try {
                        const info = await getInfoAsync(finalPayload.image);
                        if (info.exists) {
                            const base64 = await readAsStringAsync(finalPayload.image, { encoding: EncodingType.Base64 });
                            finalPayload = { ...finalPayload, imageBase64: base64 };
                        } else {
                            finalPayload = { ...finalPayload, image: 'APP_ERROR: File does not exist' };
                        }
                    } catch (e: any) {
                        console.error('Erro ao ler imagem como base64:', e);
                        finalPayload = { ...finalPayload, image: 'APP_ERROR: ' + e.message };
                    }
                }

                const response = await fetch(url, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: item.action,
                        payload: finalPayload
                    })
                });

                const result = await response.json();
                if (result.success) {
                    console.log(`Item ${item.id} sincronizado com sucesso.`);
                    // Se for produto e retornou URL da imagem, poderíamos atualizar o banco local
                    if (item.action === 'sync_product' && result.imageUrl) {
                        // Opcional: atualizar URL local para apontar pro Drive
                        // Atualizaremos pelo DatabaseService no futuro caso necessário
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

        // Se novos itens foram adicionados durante o processamento, tenta processar novamente
        const checkQueueStr = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
        if (checkQueueStr) {
            const checkQueue: SyncItem[] = JSON.parse(checkQueueStr);
            if (checkQueue.length > 0 && remaining.length < checkQueue.length) {
                // Há novos itens (ou pelo menos a fila não está vazia e algo mudou)
                // Chamamos recursivamente de forma controlada ou via timeout para não estourar stack
                setTimeout(() => SyncService.processQueue(), 500);
            }
        }
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
